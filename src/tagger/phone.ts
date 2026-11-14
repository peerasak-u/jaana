import { TAGS } from "./model";

const PHONE = TAGS.indexOf("PHONE");
const OTHER = TAGS.indexOf("OTHER");
const DIGIT = /[0-9๐-๙]/u;
const NUMBER_CHARACTER = /[0-9๐-๙+()\-. ]/u;
const SEPARATOR = /[()\-. ]/u;

function digitValue(character: string): string {
	const thai = "๐๑๒๓๔๕๖๗๘๙".indexOf(character);
	return thai >= 0 ? String(thai) : character;
}

/**
 * National digits a Thai number needs after its leading 0: nine for a
 * mobile (06, 08, 09), eight for a landline (02 to 07).
 */
function subscriberLength(first: string): number | null {
	if ("689".includes(first)) return 9;
	if ("234567".includes(first)) return 8;
	return null;
}

/**
 * End of the Thai phone number written from `start`: `0` and the subscriber
 * digits, or `+66`, `(+66)`, or `66` and the subscriber digits with an
 * optional 0. Separators may sit between digits. Null when none starts there.
 */
function numberEnd(raw: string, start: number, limit: number): number | null {
	let index = start;
	const skip = () => {
		while (index < limit && SEPARATOR.test(raw[index]!)) index += 1;
	};
	const digitAt = () => (index < limit && DIGIT.test(raw[index]!) ? digitValue(raw[index]!) : null);
	if (raw[index] === "(") index += 1;
	let international = false;
	if (raw[index] === "+") index += 1;
	if (digitAt() === "6" && digitValue(raw[index + 1] ?? "") === "6") {
		international = true;
		index += 2;
		if (raw[index] === ")") index += 1;
		skip();
		if (digitAt() === "0") index += 1;
	} else if (digitAt() === "0") index += 1;
	else return null;
	if (!international && raw[start] !== "0") return null;
	skip();
	const first = digitAt();
	const length = first === null ? null : subscriberLength(first);
	if (length === null) return null;
	let digits = 0;
	while (index < limit && digits < length) {
		if (DIGIT.test(raw[index]!)) digits += 1;
		else if (!SEPARATOR.test(raw[index]!)) return null;
		index += 1;
	}
	return digits === length ? index : null;
}

/**
 * Re-cuts the PHONE run to the first well-formed Thai number in the stretch
 * of number characters around it, as in `ส่งทองใบ0874412093|9ม.7` or
 * `ปิยะพงษ์ (+66)861174209`. Characters the run gives up go to the run they
 * touch, characters the number takes leave their run.
 */
export function recutPhone(raw: string, tags: Uint8Array): void {
	const start = tags.indexOf(PHONE);
	if (start < 0) return;
	let end = start;
	while (end < raw.length && tags[end] === PHONE) end += 1;
	let low = start;
	while (low > 0 && NUMBER_CHARACTER.test(raw[low - 1]!)) low -= 1;
	let high = end;
	while (high < raw.length && NUMBER_CHARACTER.test(raw[high]!)) high += 1;
	for (let from = low; from < end; from += 1) {
		const opens = from === start || (/[0+(]/u.test(raw[from]!) && !DIGIT.test(raw[from - 1] ?? ""));
		if (!opens) continue;
		const to = numberEnd(raw, from, high);
		if (to === null || to <= start) continue;
		if (from === start && to === end) return;
		for (let index = start; index < from; index += 1) tags[index] = OTHER;
		for (let index = to; index < end; index += 1) tags[index] = OTHER;
		if (start > 0 && DIGIT.test(raw[start - 1]!)) {
			for (let index = start; index < from && DIGIT.test(raw[index]!); index += 1) tags[index] = tags[start - 1]!;
		}
		if (end < raw.length && DIGIT.test(raw[end]!)) {
			for (let index = end - 1; index >= to && DIGIT.test(raw[index]!); index -= 1) tags[index] = tags[end]!;
		}
		tags.fill(PHONE, from, to);
		return;
	}
}
