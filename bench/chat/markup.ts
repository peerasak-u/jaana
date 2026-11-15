import { normalizeCandidate, normalizePhone, normalizePostcode } from "../../src/normalize";
import type { LocationTuple, OutputLabel } from "../../src/types";
import type { DatasetRecord, DatasetSpan, ExpectedAddress } from "../dataset";

export const MARKS = {
	N: "NAME",
	P: "PHONE",
	A: "ADDRESS_DETAIL",
	S: "SUBDISTRICT",
	D: "DISTRICT",
	V: "PROVINCE",
	Z: "POSTCODE",
} as const satisfies Record<string, OutputLabel>;

type Mark = keyof typeof MARKS;

export type Pool = "bench" | "train";

export interface SourceIssue {
	readonly file: string;
	readonly line: number;
	readonly message: string;
}

export interface ChatRecord extends DatasetRecord {
	readonly tags: readonly string[];
	readonly sourceLine: number;
}

export function fnv1a(text: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

export function locationKey(location: LocationTuple): string {
	return [location.subdistrict, location.district, location.province, location.zipcode].join("|");
}

/** A quarter of the gazetteer is reserved for benchmark records. Training text never uses it. */
export function poolOf(location: LocationTuple): Pool {
	return fnv1a(locationKey(location)) % 4 === 0 ? "bench" : "train";
}

export function splitOf(raw: string): "dev" | "test" {
	return fnv1a(`split:${raw}`) % 2 === 0 ? "dev" : "test";
}

const PREFIXES = ["กิ่งอำเภอ", "ตำบล", "แขวง", "อำเภอ", "เขต", "จังหวัด", "ต", "อ", "จ", "ข"];

function distance(left: string, right: string): number {
	let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let i = 1; i <= left.length; i += 1) {
		const current = [i];
		for (let j = 1; j <= right.length; j += 1) {
			current[j] = Math.min(
				previous[j]! + 1,
				current[j - 1]! + 1,
				previous[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1),
			);
		}
		previous = current;
	}
	return previous[right.length]!;
}

function resemblesName(surface: string, written: string): boolean {
	const canonical = written.replace(/[\s.]/gu, "");
	const bare = surface.replace(/[\s.:,\-ฯ]/gu, "");
	const forms = [bare, ...PREFIXES.filter((prefix) => bare.startsWith(prefix)).map((prefix) => bare.slice(prefix.length))];
	return forms.some((form) =>
		form.length >= 2 &&
		(distance(form, canonical) / canonical.length <= 0.5 ||
			(form.length >= 4 && canonical.startsWith(form))),
	);
}

interface RawBlock {
	readonly line: number;
	readonly header: readonly string[];
	readonly body: string;
}

function blocksOf(text: string, file: string, issues: SourceIssue[]): RawBlock[] {
	const lines = text.replace(/\r\n/gu, "\n").split("\n");
	const blocks: RawBlock[] = [];
	let index = 0;
	while (index < lines.length && lines[index] !== "===") index += 1;
	while (index < lines.length) {
		const line = index + 1;
		index += 1;
		const header: string[] = [];
		while (index < lines.length && lines[index] !== "---" && lines[index] !== "===") {
			header.push(lines[index]!);
			index += 1;
		}
		if (lines[index] !== "---") {
			issues.push({ file, line, message: "record has no --- line between header and message" });
			continue;
		}
		index += 1;
		const body: string[] = [];
		while (index < lines.length && lines[index] !== "===") {
			body.push(lines[index]!);
			index += 1;
		}
		while (body.length > 0 && body[body.length - 1]!.trim() === "") body.pop();
		blocks.push({ line, header, body: body.join("\n") });
	}
	return blocks;
}

export interface ParseOptions {
	readonly file: string;
	readonly category: string;
	readonly idPrefix: string;
	readonly pool: Pool;
	readonly locations: ReadonlyMap<string, LocationTuple>;
}

export function parseSource(
	text: string,
	options: ParseOptions,
): { records: ChatRecord[]; issues: SourceIssue[] } {
	const { file } = options;
	const issues: SourceIssue[] = [];
	const records: ChatRecord[] = [];
	const seen = new Set<string>();
	for (const block of blocksOf(text, file, issues)) {
		const fail = (message: string): void => {
			issues.push({ file, line: block.line, message });
		};
		const before = issues.length;
		let location: LocationTuple | undefined;
		let tags: string[] = [];
		for (const headerLine of block.header) {
			if (headerLine.trim() === "") continue;
			const match = /^(loc|tags):(.*)$/u.exec(headerLine);
			if (!match) {
				fail(`unknown header line: ${headerLine}`);
				continue;
			}
			if (match[1] === "tags") {
				tags = match[2]!.split(",").map((tag) => tag.trim()).filter(Boolean);
				continue;
			}
			const key = match[2]!.split("|").map((part) => part.trim()).join("|");
			location = options.locations.get(key);
			if (!location) fail(`loc is not a gazetteer tuple: ${key}`);
			else if (poolOf(location) !== options.pool) fail(`loc belongs to the ${poolOf(location)} pool, not ${options.pool}: ${key}`);
		}
		if (!location) {
			if (issues.length === before) fail("record has no loc: line");
			continue;
		}

		let raw = "";
		const spans: DatasetSpan[] = [];
		const pattern = /\[\[([A-Z]):([\s\S]*?)\]\]/gu;
		let cursor = 0;
		for (const match of block.body.matchAll(pattern)) {
			raw += block.body.slice(cursor, match.index);
			cursor = match.index + match[0].length;
			const mark = match[1] as Mark;
			const spanText = match[2]!;
			const label = MARKS[mark];
			if (!label) {
				fail(`unknown mark ${match[1]}`);
				continue;
			}
			if (spanText.trim() !== spanText || spanText === "") fail(`${mark} span is empty or has edge whitespace: "${spanText}"`);
			if (label !== "ADDRESS_DETAIL" && spanText.includes("\n")) fail(`${mark} span crosses a line break`);
			if (label !== "ADDRESS_DETAIL" && spans.some((span) => span.label === label)) fail(`more than one ${mark} span`);
			const start = raw.length;
			raw += spanText;
			let canonical: string | null = normalizeCandidate(label, spanText);
			if (label === "PHONE" && normalizePhone(spanText) === null) fail(`P span is not a Thai phone number: "${spanText}"`);
			if (label === "POSTCODE") {
				if (normalizePostcode(spanText) !== location.zipcode) fail(`Z span "${spanText}" is not the loc postcode ${location.zipcode}`);
			}
			for (const [field, administrative] of [["subdistrict", "SUBDISTRICT"], ["district", "DISTRICT"], ["province", "PROVINCE"]] as const) {
				if (label !== administrative) continue;
				canonical = location[field];
				if (!tags.includes("alias") && !resemblesName(spanText, canonical)) {
					fail(`${mark} span "${spanText}" does not resemble ${canonical}. Fix the mark, or add the tag alias if it is a nickname or romanized form`);
				}
			}
			spans.push({
				label,
				text: spanText,
				canonical,
				start,
				end: raw.length,
				codePointStart: Array.from(raw.slice(0, start)).length,
				codePointEnd: Array.from(raw).length,
			});
		}
		raw += block.body.slice(cursor);
		if (raw.includes("[[") || raw.includes("]]")) fail("message still contains [[ or ]] after removing marks");
		if (raw.trim() === "") fail("message is empty");
		if (raw.length > 700) fail(`message is ${raw.length} characters, over the 700 limit`);
		if (spans.length === 0) fail("message has no marked span");
		if (seen.has(raw)) fail("duplicate message in this file");
		seen.add(raw);
		if (issues.length > before) continue;

		const find = (label: OutputLabel): string | null => spans.find((span) => span.label === label)?.canonical ?? null;
		const address = spans.filter((span) => span.label === "ADDRESS_DETAIL").map((span) => span.text).join(" ");
		const expected: ExpectedAddress = {
			name: find("NAME"),
			phone: find("PHONE"),
			address: address ? normalizeCandidate("ADDRESS_DETAIL", address) : null,
			subdistrict: find("SUBDISTRICT"),
			district: find("DISTRICT"),
			province: find("PROVINCE"),
			zipcode: find("POSTCODE"),
		};
		records.push({
			id: `${options.idPrefix}-${String(records.length + 1).padStart(4, "0")}`,
			raw,
			caseType: options.category,
			difficulty: "chat",
			spans,
			expected,
			normalizationExpected: expected,
			seedLocation: location,
			partition: { profile: options.idPrefix },
			tags,
			sourceLine: block.line,
		});
	}
	return { records, issues };
}
