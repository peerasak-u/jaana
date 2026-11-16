import type { LocationTuple, OutputLabel } from "../types";
import type { TaggedSpan } from "./parser";
import { normalizePostcode } from "../normalize";
import { formSimilarity, nameForms, PROVINCE_ALIASES, ROMANIZED, type AdministrativeField } from "./resolve";

const FIELD_OF = new Map<OutputLabel, AdministrativeField>([
	["SUBDISTRICT", "subdistrict"],
	["DISTRICT", "district"],
	["PROVINCE", "province"],
]);
/** The fields in the order shoppers write them. */
const SEGMENTS: readonly [OutputLabel, AdministrativeField][] = [
	["SUBDISTRICT", "subdistrict"],
	["DISTRICT", "district"],
	["PROVINCE", "province"],
];
const GAP = /^[ \t,]*$/u;
/** A field prefix written as its own word, which belongs to the name after it. */
const PREFIX_WORD = /^(?:khwaeng|kwaeng|kwang|khet|tambon|amphoe|แขวง|เขต|ตำบล|อำเภอ|จังหวัด)$/iu;
const TRAILING_PREFIX = /(?:^|[ \t,])((?:khwaeng|kwaeng|kwang|khet|แขวง|เขต)[ \t]*)$/iu;
const MIN_SIMILARITY = 0.75;
const KEPT_SIMILARITY = 0.5;

interface Word {
	readonly start: number;
	readonly end: number;
	readonly prefix: boolean;
}

function span(raw: string, label: OutputLabel, start: number, end: number): TaggedSpan {
	return { label, text: raw.slice(start, end), start, end };
}

const MAX_POOL = 300;

/**
 * Re-labels a stretch of administrative spans written next to each other
 * when another cut of its words into subdistrict, district and province
 * matches a gazetteer tuple better. The tagger often splits a romanized
 * name (`Khet | Bangbon`, `Chorakhe | Bua Lat | Prao`) or tags a bare
 * district as the province (`Thung Khru` before the postcode). The tuples
 * are those of the written postcode, or without one those that hold a
 * tagged name exactly. A field prefix word the tagger left at the end of
 * the address before the stretch joins the stretch.
 */
export function createAdministrativeResegmenter(
	locations: readonly LocationTuple[],
): (raw: string, spans: readonly TaggedSpan[]) => TaggedSpan[] {
	const byPostcode = new Map<string, LocationTuple[]>();
	const byName = new Map<string, LocationTuple[]>();
	const add = (index: Map<string, LocationTuple[]>, key: string, location: LocationTuple) => {
		const tuples = index.get(key) ?? [];
		if (tuples[tuples.length - 1] !== location) tuples.push(location);
		index.set(key, tuples);
	};
	for (const location of locations) {
		add(byPostcode, location.zipcode, location);
		for (const name of [location.subdistrict, location.district, location.province, ...(PROVINCE_ALIASES.get(location.province) ?? [])]) {
			add(byName, name, location);
		}
	}
	return (raw, spans) => {
		const postcode = spans.find((span) => span.label === "POSTCODE");
		let pool: readonly LocationTuple[];
		if (postcode) pool = byPostcode.get(normalizePostcode(postcode.text) ?? "") ?? [];
		else {
			const found = new Set<LocationTuple>();
			for (const span of spans) {
				if (!FIELD_OF.has(span.label)) continue;
				for (const [, field] of SEGMENTS) {
					for (const form of nameForms(field, span.text)) for (const location of byName.get(form) ?? []) found.add(location);
				}
			}
			pool = found.size <= MAX_POOL ? [...found] : [];
		}
		return resegment(raw, spans, pool);
	};
}

function resegment(
	raw: string,
	spans: readonly TaggedSpan[],
	pool: readonly LocationTuple[],
): TaggedSpan[] {
	if (pool.length === 0) return [...spans];
	const result = [...spans].sort((left, right) => left.start - right.start);
	for (let first = 0; first < result.length; first += 1) {
		if (!FIELD_OF.has(result[first]!.label)) continue;
		let last = first;
		while (
			last + 1 < result.length && FIELD_OF.has(result[last + 1]!.label) &&
			GAP.test(raw.slice(result[last]!.end, result[last + 1]!.start))
		) last += 1;
		let start = result[first]!.start;
		const before = result[first - 1];
		const prefix = before?.label === "ADDRESS_DETAIL" && GAP.test(raw.slice(before.end, start))
			? TRAILING_PREFIX.exec(before.text)
			: null;
		if (prefix && before) {
			start = before.end - prefix[1]!.length;
			const trimmed = raw.slice(before.start, start).trimEnd();
			result[first] = span(raw, result[first]!.label, start, result[first]!.end);
			if (trimmed) result[first - 1] = span(raw, "ADDRESS_DETAIL", before.start, before.start + trimmed.length);
			else {
				result.splice(first - 1, 1);
				first -= 1;
				last -= 1;
			}
		}
		const stretch = result.slice(first, last + 1);
		const better = bestCut(raw, stretch, pool);
		if (better) {
			result.splice(first, stretch.length, ...better);
			last = first + better.length - 1;
		}
		first = last;
	}
	return result;
}

function bestCut(raw: string, stretch: readonly TaggedSpan[], pool: readonly LocationTuple[]): TaggedSpan[] | null {
	const words: Word[] = [];
	const start = stretch[0]!.start;
	for (const match of raw.slice(start, stretch[stretch.length - 1]!.end).matchAll(/[^\s,]+/gu)) {
		words.push({ start: start + match.index, end: start + match.index + match[0].length, prefix: PREFIX_WORD.test(match[0]) });
	}
	if (words.length > 8) return null;
	const cache = new Map<string, number>();
	const similarity = (field: AdministrativeField, from: number, to: number, name: string): number => {
		const key = `${field}\u0000${from}\u0000${to}\u0000${name}`;
		let value = cache.get(key);
		if (value === undefined) {
			value = formSimilarity(field, nameForms(field, raw.slice(from, to)), name);
			cache.set(key, value);
		}
		return value;
	};
	// A tagged piece that half matches its field, as the short alias `สุราษ`,
	// keeps the tagger's cut; one that matches nothing adds nothing. In a
	// romanized stretch a cut that scores as well while covering such a
	// stray piece with matching ones wins.
	let current = 0;
	let stray = false;
	for (const location of pool) {
		let score = 0;
		let unmatched = false;
		for (const piece of stretch) {
			const field = FIELD_OF.get(piece.label)!;
			const value = PREFIX_WORD.test(piece.text) ? 0 : similarity(field, piece.start, piece.end, location[field]);
			if (value >= KEPT_SIMILARITY) score += value;
			else unmatched = true;
		}
		if (score > current || (score === current && !unmatched)) {
			current = score;
			stray = unmatched;
		}
	}
	const cuts = [0, ...words.flatMap((word, index) => (word.prefix ? [] : [index + 1]))];
	let best: TaggedSpan[] | null = null;
	const romanized = ROMANIZED.test(raw.slice(start, stretch[stretch.length - 1]!.end));
	let bestScore = stray && romanized ? current - 1e-9 : current;
	// Cuts with no subdistrict and the longest district come first, so one
	// bare name the subdistrict and district share is the district.
	for (const location of pool) {
		for (const one of cuts) {
			for (const two of [...cuts].reverse()) {
				if (two < one) continue;
				const bounds = [[0, one], [one, two], [two, words.length]] as const;
				let score = 0;
				const pieces: TaggedSpan[] = [];
				for (const [index, [from, to]] of bounds.entries()) {
					if (from === to) continue;
					const [label, field] = SEGMENTS[index]!;
					const value = similarity(field, words[from]!.start, words[to - 1]!.end, location[field]);
					if (value < MIN_SIMILARITY) {
						score = -1;
						break;
					}
					score += value;
					pieces.push(span(raw, label, words[from]!.start, words[to - 1]!.end));
				}
				if (score > bestScore) {
					best = pieces;
					bestScore = score;
				}
			}
		}
	}
	return best;
}
