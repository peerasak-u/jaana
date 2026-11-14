import type { AdministrativeField } from "./resolve";

export interface Range {
	readonly start: number;
	readonly end: number;
}

const THAI_LETTER = /[ก-๎]/u;
const PREFIX: Record<AdministrativeField, RegExp> = {
	subdistrict: /(ตำบล|แขวง|ต\.?)\s*$/u,
	district: /(อำเภอ|เขต|อ\.?)\s*$/u,
	province: /(จังหวัด|จ\.?)\s*$/u,
};
const FOLLOWER = /^(ตำบล|แขวง|อำเภอ|เขต|จังหวัด|[ตอจ]\.?|ค่ะ|คะ|ครับ|นะ|จ้า)/u;
const PLACE_MARKER = /(บ้าน|หมู่บ้าน|มบ\.|ถ\.|ถนน|ซ\.|ซอย|รพ\.|โรงพยาบาล|รร\.|โรงเรียน|สนง\.|วัด|อุทยานฯ?|-)\s*$/u;

function overlaps(start: number, end: number, ranges: readonly Range[]): boolean {
	return ranges.some((range) => start < range.end && range.start < end);
}

/**
 * Where `name` is written on its own outside `taken`, with its field prefix:
 * bounded by non-letters, a field prefix, or a neighbouring field, and not
 * part of a village, road, or organisation name.
 */
export function findStandalone(
	raw: string,
	field: AdministrativeField | "zipcode",
	name: string,
	taken: readonly Range[],
): Range | null {
	for (let start = raw.indexOf(name); start >= 0; start = raw.indexOf(name, start + 1)) {
		const end = start + name.length;
		if (overlaps(start, end, taken)) continue;
		if (field === "zipcode") {
			if (!/\d/u.test(raw[start - 1] ?? "") && !/\d/u.test(raw[end] ?? "")) return { start, end };
			continue;
		}
		const before = raw.slice(0, start);
		const prefix = PREFIX[field].exec(before);
		const left = prefix ? start - prefix[0].length : start;
		const adjoins = (index: number) => taken.some((range) => range.end === index || range.start === index);
		const leftOk = left === 0 || !THAI_LETTER.test(raw[left - 1]!) || adjoins(left);
		const rightOk =
			end === raw.length || !THAI_LETTER.test(raw[end]!) || FOLLOWER.test(raw.slice(end)) || adjoins(end);
		if (leftOk && rightOk && !PLACE_MARKER.test(raw.slice(0, left))) return { start: left, end };
	}
	return null;
}
