import { typedPhone } from "../normalize";
import { TAGS } from "./model";

const PHONE = TAGS.indexOf("PHONE");
const OTHER = TAGS.indexOf("OTHER");
const ADDRESS = TAGS.indexOf("ADDRESS_DETAIL");
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

/** Whether normalized phone digits have the length their prefix calls for. */
export function hasThaiLength(digits: string): boolean {
	const length = subscriberLength(digits[1] ?? "");
	return length !== null && digits.length === length + 1;
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

const CORRECTION = /แก้เบอร์|แก้ไขเบอร์|เบอร์ผิด|เบอร์ที่ถูก|ที่ถูกคือ/u;

/**
 * The GUIDE marks the corrected number when the message corrects its phone
 * (`แก้เบอร์เป็น ...`), because the first one is wrong. Moves the PHONE run
 * to the first well-formed number after a correction cue.
 */
function correctPhone(raw: string, tags: Uint8Array): void {
	const cue = CORRECTION.exec(raw);
	if (!cue) return;
	for (let from = cue.index + cue[0].length; from < raw.length; from += 1) {
		if (DIGIT.test(raw[from - 1]!) || !/[0+(]/u.test(raw[from]!)) continue;
		let limit = from;
		while (limit < raw.length && NUMBER_CHARACTER.test(raw[limit]!)) limit += 1;
		const to = numberEnd(raw, from, limit);
		if (to === null || DIGIT.test(raw[to] ?? "")) continue;
		for (let index = 0; index < tags.length; index += 1) if (tags[index] === PHONE) tags[index] = OTHER;
		tags.fill(PHONE, from, to);
		return;
	}
}

/**
 * Whether a number that ends at `to` takes, past a space, digits the tagger
 * gave another field, as `081234567 4` does from `081234567 44/1`.
 */
function takesFieldAcrossSpace(raw: string, tags: Uint8Array, end: number, to: number): boolean {
	const space = raw.slice(end, to).search(/\s/u);
	if (space < 0) return false;
	for (let index = end + space; index < to; index += 1) {
		if (tags[index] !== OTHER && tags[index] !== PHONE) return true;
	}
	return false;
}

/** What opens a house number or `หมู่` glued after a number, as `9ม.7` in `08744120939ม.7`. */
const ADDRESS_NEXT = /^(?:[0-9๐-๙/]|ม\.|ม\s|หมู่|ซ\.|ถ\.)/u;

/**
 * Keeps the PHONE run when it already holds a whole number as typed, of a
 * length `typedPhone` accepts, and what follows it on its line does not
 * open address detail. Digits before its 0, as `6` in `47ม.6061904337`,
 * cannot open a Thai number, so they go back to the address run they touch.
 */
function keepsTyped(raw: string, tags: Uint8Array, start: number, end: number): boolean {
	let from = start;
	if (typedPhone(raw.slice(start, end)) === null) {
		while (from < end && /[1-9๑-๙]/u.test(raw[from]!)) from += 1;
		if (from === start || from - start > 2 || DIGIT.test(raw[start - 1] ?? "")) return false;
	}
	if (typedPhone(raw.slice(from, end)) === null) return false;
	const after = raw.slice(end);
	if (!/^\s*\n/u.test(after) && ADDRESS_NEXT.test(after.replace(/^[ \t]+/u, ""))) return false;
	tags.fill(tags[start - 1] === ADDRESS ? ADDRESS : OTHER, start, from);
	return true;
}

/**
 * Re-cuts the PHONE run to the first well-formed Thai number in the stretch
 * of number characters around it, as in `ส่งทองใบ0874412093|9ม.7` or
 * `ปิยะพงษ์ (+66)861174209`. Characters the run gives up go to the run they
 * touch, characters the number takes leave their run. Untagged digits typed
 * on to the number up to a space or the end, as in `08123456789 44/1`, stay
 * in it, so the phone keeps what the customer typed.
 */
export function recutPhone(raw: string, tags: Uint8Array): void {
	correctPhone(raw, tags);
	if (!tags.includes(PHONE)) tagUntaggedPhone(raw, tags);
	recut(raw, tags);
	joinTrailingGroup(raw, tags);
}

/**
 * The GUIDE marks the only number a message gives, but the tagger sometimes
 * leaves a well-formed one untagged, as after a tax ID or under a label it
 * has not seen. With no PHONE run, the first whole Thai number in untagged
 * text is the phone. A number glued to a longer digit run, such as a
 * 13-digit tax ID, or to a Latin word or code, is not one.
 */
function tagUntaggedPhone(raw: string, tags: Uint8Array): void {
	for (let from = 0; from < raw.length; from += 1) {
		const before = raw[from - 1] ?? " ";
		if (!/[0+(]/u.test(raw[from]!) || (/[\p{L}\p{N}_@#/.\-]/u.test(before) && !/[ก-๎]/u.test(before))) continue;
		let limit = from;
		while (limit < raw.length && NUMBER_CHARACTER.test(raw[limit]!)) limit += 1;
		const to = numberEnd(raw, from, limit);
		if (to === null || /[0-9๐-๙\p{L}]/u.test(raw[to] ?? "")) continue;
		if (!tags.subarray(from, to).every((tag) => tag === OTHER)) continue;
		tags.fill(PHONE, from, to);
		return;
	}
}

/**
 * One or two more digits typed past a space after a whole number, as
 * `0818883240 2` at the end of a line, are part of the number as typed. A
 * group that starts with 0 cannot be a house number, so it joins wherever
 * it stands; any other group joins only when nothing follows it on its line.
 */
function joinTrailingGroup(raw: string, tags: Uint8Array): void {
	const start = tags.indexOf(PHONE);
	if (start < 0) return;
	let end = start;
	while (end < raw.length && tags[end] === PHONE) end += 1;
	const group = /^[ \t]+([0-9๐-๙]{1,2})(?![0-9๐-๙])/u.exec(raw.slice(end));
	if (!group || typedPhone(raw.slice(start, end)) === null) return;
	const to = end + group[0].length;
	const rest = raw.slice(to);
	const joins = /^[0๐]/u.test(group[1]!) ? /^(?:\s|$)/u.test(rest) : /^[ \t]*(?:\n|$)/u.test(rest);
	if (!joins || typedPhone(raw.slice(start, to)) === null) return;
	tags.fill(PHONE, end, to);
}

function recut(raw: string, tags: Uint8Array): void {
	const start = tags.indexOf(PHONE);
	if (start < 0) return;
	let end = start;
	while (end < raw.length && tags[end] === PHONE) end += 1;
	if (keepsTyped(raw, tags, start, end)) return;
	let low = start;
	while (low > 0 && NUMBER_CHARACTER.test(raw[low - 1]!)) low -= 1;
	let high = end;
	while (high < raw.length && NUMBER_CHARACTER.test(raw[high]!)) high += 1;
	for (let from = low; from < end; from += 1) {
		const opens = from === start || (/[0+(]/u.test(raw[from]!) && !DIGIT.test(raw[from - 1] ?? ""));
		if (!opens) continue;
		const to = numberEnd(raw, from, high);
		if (to === null || to <= start || takesFieldAcrossSpace(raw, tags, end, to)) continue;
		if (from !== start || to !== end) {
			for (let index = start; index < from; index += 1) tags[index] = OTHER;
			for (let index = to; index < end; index += 1) tags[index] = OTHER;
			if (start > 0 && DIGIT.test(raw[start - 1]!)) {
				for (let index = start; index < from && DIGIT.test(raw[index]!); index += 1) tags[index] = tags[start - 1]!;
			}
			if (end < raw.length && DIGIT.test(raw[end]!)) {
				for (let index = end - 1; index >= to && DIGIT.test(raw[index]!); index -= 1) tags[index] = tags[end]!;
			}
			tags.fill(PHONE, from, to);
		}
		let typed = to;
		while (typed < raw.length && DIGIT.test(raw[typed]!) && tags[typed] === OTHER) typed += 1;
		const ends = typed === raw.length || /\s/u.test(raw[typed]!);
		if (typed > to && DIGIT.test(raw[to - 1]!) && ends && typedPhone(raw.slice(from, typed)) !== null) {
			tags.fill(PHONE, to, typed);
		}
		return;
	}
}
