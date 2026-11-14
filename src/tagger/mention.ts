import { similarityRatio } from "../candidate/fuzzy-match";
import type { LocationTuple } from "../types";
import { ADMINISTRATIVE_FIELDS, type AdministrativeField } from "./resolve";

export type LocationNames = Pick<LocationTuple, AdministrativeField>;

export interface Range {
	readonly start: number;
	readonly end: number;
}

const MIN_TRUNCATED_LENGTH = 4;
const MIN_MISSPELT_RATIO = 0.85;
const THAI_LETTER = /[ก-๎]/u;
const PREFIX: Record<AdministrativeField, RegExp> = {
	subdistrict: /(ตำบล|แขวง|ต\.?)\s*$/u,
	district: /(อำเภอ|เขต|อ\.?)\s*$/u,
	province: /(จังหวัด|จ\.?)\s*$/u,
};
const FOLLOWER = /^(ตำบล|แขวง|อำเภอ|เขต|จังหวัด|[ตอจ]\.?|ค่ะ|คะ|ครับ|นะ|จ้า)/u;
const PLACE_WORD = "(บ้าน|หมู่บ้าน|มบ\\.|ถ\\.|ถนน|ซ\\.|ซอย|รพ\\.|โรงพยาบาล|รร\\.|โรงเรียน|สนง\\.|วัด|อุทยานฯ?|-)";
const PLACE_BEFORE_NAME = new RegExp(`${PLACE_WORD} ?$`, "u");
const PLACE_BEFORE_PREFIX = new RegExp(`${PLACE_WORD}$`, "u");

function overlaps(start: number, end: number, ranges: readonly Range[]): boolean {
	return ranges.some((range) => start < range.end && range.start < end);
}

function occurrences(raw: string, name: string): Range[] {
	const found: Range[] = [];
	for (let start = raw.indexOf(name); start >= 0; start = raw.indexOf(name, start + 1)) {
		found.push({ start, end: start + name.length });
	}
	return found;
}

const contains = (outer: Range, inner: Range): boolean =>
	outer.start <= inner.start && inner.end <= outer.end;

/**
 * Whether a span tagged as `field` only covers part of another field's
 * longer name, as `พังงา` inside the district `เมืองพังงา` or `บางเขน`
 * inside the subdistrict `ตลาดบางเขน`.
 */
export function insideOtherName(
	raw: string,
	span: Range,
	field: AdministrativeField,
	tuple: LocationNames,
): boolean {
	const own = occurrences(raw, tuple[field]).filter((range) => contains(range, span));
	return ADMINISTRATIVE_FIELDS.some((other) => {
		if (other === field || tuple[other] === tuple[field]) return false;
		return occurrences(raw, tuple[other]).some((outer) =>
			contains(outer, span) &&
			own.every((range) => contains(outer, range) && outer.end - outer.start > range.end - range.start),
		);
	});
}

/**
 * Where `name` is written on its own outside `taken`, with its field prefix:
 * bounded by non-letters, a field prefix, or a neighbouring field, and not
 * part of a village, road, or organisation name. With `prefixed`, only a
 * mention after a written field prefix counts.
 */
export function findStandalone(
	raw: string,
	field: AdministrativeField | "zipcode",
	name: string,
	taken: readonly Range[],
	prefixed = false,
): Range | null {
	for (let start = raw.indexOf(name); start >= 0; start = raw.indexOf(name, start + 1)) {
		const end = start + name.length;
		if (overlaps(start, end, taken)) continue;
		if (field === "zipcode") {
			if (!/\d/u.test(raw[start - 1] ?? "") && !/\d/u.test(raw[end] ?? "")) return { start, end };
			continue;
		}
		const found = standaloneAt(raw, field, { start, end }, taken, prefixed);
		if (found) return found;
	}
	return null;
}

/** The mention, prefix included, when the written name at `name` stands on its own in the sense of `findStandalone`. */
function standaloneAt(
	raw: string,
	field: AdministrativeField,
	name: Range,
	taken: readonly Range[],
	prefixed: boolean,
): Range | null {
	const { start, end } = name;
	const left = prefixStart(raw, field, start);
	if (prefixed && left === start) return null;
	const adjoins = (index: number) => taken.some((range) => range.end === index || range.start === index);
	const leftOk = left === 0 || !THAI_LETTER.test(raw[left - 1]!) || adjoins(left);
	const rightOk =
		end === raw.length || !THAI_LETTER.test(raw[end]!) || FOLLOWER.test(raw.slice(end)) || adjoins(end);
	return leftOk && rightOk && placeWordBefore(raw, left, start) === null ? { start: left, end } : null;
}

/**
 * A prefixed mention of the leading part of `name`, as `เขตป้อมปราบ` for
 * ป้อมปราบศัตรูพ่าย or `อ.อรัญ` for อรัญประเทศ.
 */
export function findTruncated(
	raw: string,
	field: AdministrativeField,
	name: string,
	taken: readonly Range[],
): Range | null {
	for (let length = name.length - 1; length >= MIN_TRUNCATED_LENGTH; length -= 1) {
		const found = findStandalone(raw, field, name.slice(0, length), taken, true);
		if (found) return found;
	}
	return null;
}

/**
 * A whole Thai word outside `taken`, bounded by non-letters and with its
 * field prefix, that misspells `name`, as `รัอยเอ็ด` for ร้อยเอ็ด.
 */
export function findMisspelt(
	raw: string,
	field: AdministrativeField,
	name: string,
	taken: readonly Range[],
): Range | null {
	for (const word of raw.matchAll(/[ก-๎]+/gu)) {
		const start = word.index;
		const end = start + word[0].length;
		const ratio = similarityRatio(word[0], name) / 100;
		if (overlaps(start, end, taken) || ratio < MIN_MISSPELT_RATIO || ratio === 1) continue;
		const found = standaloneAt(raw, field, { start, end }, taken, false);
		if (found) return found;
	}
	return null;
}

/**
 * Standalone mentions of `name`, prefix included, that the address only
 * partly covers: a run edge that falls inside a written field name, as in
 * `ถ.พญาไท แขวงถน|นพญาไท`, is a slip, and the whole mention is the field.
 */
export function straddledMentions(
	raw: string,
	field: AdministrativeField,
	name: string,
	address: readonly Range[],
): Range[] {
	const covered: Range[] = [];
	for (const range of [...address].sort((left, right) => left.start - right.start)) {
		const last = covered[covered.length - 1];
		if (last && last.end >= range.start) covered[covered.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
		else covered.push(range);
	}
	return occurrences(raw, name).flatMap((written) => {
		const mention = standaloneAt(raw, field, written, [], false);
		const straddles = mention !== null && covered.some((range) =>
			overlaps(mention.start, mention.end, [range]) && !contains(range, written));
		return straddles ? [mention] : [];
	});
}

function prefixStart(raw: string, field: AdministrativeField, start: number): number {
	const prefix = PREFIX[field].exec(raw.slice(0, start));
	return prefix ? start - prefix[0].length : start;
}

/**
 * Where the place word that makes a name part of a village, road, or
 * organisation starts. A written field prefix marks the name as a field
 * unless the place word is glued to it, as in `สนง.เขตวังทองหลาง`.
 */
function placeWordBefore(raw: string, left: number, start: number): number | null {
	const pattern = left < start ? PLACE_BEFORE_PREFIX : PLACE_BEFORE_NAME;
	return pattern.exec(raw.slice(0, left))?.index ?? null;
}

/**
 * The village, road, or organisation name a span tagged as `field` lies
 * in, from its place word: the span lies within the only written `name` and the place word before it, such
 * as `บ้าน` or `รพ.`. A name written again elsewhere may be the field there.
 */
export function insidePlaceName(
	raw: string,
	span: Range,
	field: AdministrativeField,
	name: string,
): Range | null {
	const written = occurrences(raw, name);
	if (written.length !== 1) return null;
	const range = written[0]!;
	const marker = placeWordBefore(raw, prefixStart(raw, field, range.start), range.start);
	return marker !== null && span.start >= marker && span.end <= range.end
		? { start: marker, end: range.end }
		: null;
}
