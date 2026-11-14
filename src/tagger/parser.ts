import { similarityRatio } from "../candidate/fuzzy-match";
import { normalizeCandidate, normalizePostcode } from "../normalize";
import type { LocationTuple, OutputLabel, ParsedFields } from "../types";
import { ANCHOR_FIELDS, createAnchorer, type Anchor } from "./anchor";
import { decodeTags, spanEdges } from "./decode";
import { featurize } from "./features";
import { recutPhone } from "./phone";
import { latinSkeleton, thaiSkeleton } from "./romanize";
import { composeRecipient } from "./compose";
import { compileTaggerModel, TAGS, type Tag, type TaggerModel } from "./model";
import {
	findMisspelt,
	findStandalone,
	findTruncated,
	insideOtherName,
	insidePlaceName,
	straddledMentions,
	writesOtherField,
	type Range,
} from "./mention";
import {
	ADMINISTRATIVE_FIELDS,
	closestTuple,
	createTupleResolver,
	formSimilarity,
	nameForms,
	PROVINCE_ALIASES,
	type AdministrativeField,
	type AdministrativeTexts,
	type AdministrativeValues,
} from "./resolve";

const MIN_SIBLING_RATIO = 0.7;
const MIN_WORD_RATIO = 0.85;
const ROMANIZED =/^[^ก-๎]*[A-Za-z][^ก-๎]*$/u;
const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";
const DISTRICT_BIT = 1 << ANCHOR_FIELDS.indexOf("district");

export interface TaggedSpan {
	readonly label: OutputLabel;
	readonly text: string;
	readonly start: number;
	readonly end: number;
}

export interface TaggedAddress {
	readonly raw: string;
	readonly fields: ParsedFields;
	readonly spans: readonly TaggedSpan[];
}

export interface TaggerParser {
	parse(raw: string): TaggedAddress;
}

const OTHER = TAGS.indexOf("OTHER");
const BRACKETED = new Set([TAGS.indexOf("NAME"), TAGS.indexOf("ORG"), TAGS.indexOf("ADDRESS_DETAIL")]);

/**
 * Gold names and address pieces keep a bracket they open, but the tagger
 * often stops inside one. Extends such a run over untagged text to the
 * closing bracket on the same line.
 */
function closeBrackets(raw: string, tags: Uint8Array): void {
	let depth = 0;
	for (let index = 0; index < raw.length; index += 1) {
		const tag = tags[index]!;
		if (index > 0 && tag !== tags[index - 1]) depth = 0;
		if (!BRACKETED.has(tag)) continue;
		if (raw[index] === "(") depth += 1;
		if (raw[index] === ")") depth = Math.max(0, depth - 1);
		if (depth === 0 || tags[index + 1] === tag) continue;
		let close = index + 1;
		while (close < raw.length && tags[close] === OTHER && raw[close] !== ")" && raw[close] !== "\n") {
			close += 1;
		}
		if (raw[close] === ")" && tags[close] === OTHER) tags.fill(tag, index + 1, close + 1);
	}
}

const NAMED = new Set([TAGS.indexOf("NAME"), TAGS.indexOf("ORG")]);
const BRACKET_AFTER = /^[ \t]*\([^()\n\d+]*\)/u;
/** A sentence-final particle: the bracket is a remark to the seller, which the GUIDE leaves unmarked. */
const REMARK_END = /(?:ค่ะ|คะ|ครับ|นะ|จ้า|จ้ะ|จ๊ะ)\s*\)$/u;

/**
 * The GUIDE keeps brackets written right after a name in the name, whatever
 * they hold, as in `ลุงจันทร์ (ผู้รับ)`, unless they hold a remark to the
 * seller or a number. Extends a name or organisation run over such a
 * bracket group when the tagger left all of it untagged.
 */
function attachBracketAfterName(raw: string, tags: Uint8Array): void {
	for (let end = 1; end < raw.length; end += 1) {
		const tag = tags[end - 1]!;
		if (!NAMED.has(tag) || tags[end] === tag) continue;
		const group = BRACKET_AFTER.exec(raw.slice(end))?.[0];
		if (!group || REMARK_END.test(group) || !tags.subarray(end, end + group.length).every((other) => other === OTHER)) continue;
		tags.fill(tag, end, end + group.length);
	}
}

const PLACE_RUNS = new Set([TAGS.indexOf("ORG"), TAGS.indexOf("ADDRESS_DETAIL")]);
const LINE_REST = /^[ \t]+[\p{L}\p{M}][\p{L}\p{M}.'&]*(?=[ \t]*(?:\n|$))/u;
const PARTICLE = /ค่ะ|คะ|ครับ|นะ|จ้า|ด้วย/u;

/**
 * An organisation or address run that stops one plain word short of its
 * line's end takes that word, as in `บจก. ซีเอ็นที มีเดีย| กรุ๊ป`.
 */
export function finishLine(raw: string, tags: Uint8Array): void {
	for (let end = 1; end < raw.length; end += 1) {
		const tag = tags[end - 1]!;
		if (!PLACE_RUNS.has(tag) || tags[end] === tag) continue;
		const rest = LINE_REST.exec(raw.slice(end))?.[0];
		if (!rest || PARTICLE.test(rest) || !tags.subarray(end, end + rest.length).every((other) => other === OTHER)) continue;
		tags.fill(tag, end, end + rest.length);
	}
}

const POSTCODE = TAGS.indexOf("POSTCODE");
const DIGIT = /[0-9๐-๙]/u;

/**
 * A postcode is five digits written together. A POSTCODE run that holds
 * fewer takes the digits glued to it when that makes exactly five, as in
 * `74|000`.
 */
export function completePostcode(raw: string, tags: Uint8Array): void {
	const start = tags.indexOf(POSTCODE);
	if (start < 0) return;
	let end = start;
	while (end < raw.length && tags[end] === POSTCODE) end += 1;
	let low = start;
	while (low > 0 && DIGIT.test(raw[low - 1]!)) low -= 1;
	let high = end;
	while (high < raw.length && DIGIT.test(raw[high]!)) high += 1;
	const digits = (from: number, to: number) => [...raw.slice(from, to)].filter((character) => DIGIT.test(character)).length;
	if (digits(start, end) !== 5 && digits(low, high) === 5 && high - low === 5) tags.fill(POSTCODE, low, high);
}

interface Run extends Range {
	readonly tag: Tag;
}

function runsOf(raw: string, tags: Uint8Array): Run[] {
	const runs: Run[] = [];
	let start = 0;
	for (let index = 1; index <= raw.length; index += 1) {
		if (index < raw.length && tags[index] === tags[start]) continue;
		const tag = TAGS[tags[start]!]!;
		if (tag !== "OTHER") runs.push({ tag, start, end: index });
		start = index;
	}
	return runs;
}

/** Output spans after the organisation runs are resolved into the name or the address. */
function spansOf(raw: string, runs: readonly Run[]): TaggedSpan[] {
	const recipient = composeRecipient(
		raw,
		runs.find((run) => run.tag === "NAME") ?? null,
		runs.filter((run) => run.tag === "ORG"),
	);
	const span = (label: OutputLabel, range: Range): TaggedSpan =>
		({ label, text: raw.slice(range.start, range.end), start: range.start, end: range.end });
	const spans: TaggedSpan[] = [];
	for (const run of runs) {
		if (run.tag !== "NAME" && run.tag !== "ORG" && run.tag !== "OTHER") spans.push(span(run.tag, run));
	}
	if (recipient.name) spans.push(span("NAME", recipient.name));
	for (const range of recipient.address) spans.push(span("ADDRESS_DETAIL", range));
	return spans.sort((left, right) => left.start - right.start);
}

const ADMINISTRATIVE_LABELS = new Map<OutputLabel, AdministrativeField>([
	["SUBDISTRICT", "subdistrict"],
	["DISTRICT", "district"],
	["PROVINCE", "province"],
]);
const NO_ADMINISTRATIVE: AdministrativeValues = { subdistrict: null, district: null, province: null, zipcode: null };
const TAGGED_FIELDS: readonly [OutputLabel, AdministrativeField | "zipcode"][] = [
	["POSTCODE", "zipcode"],
	["PROVINCE", "province"],
	["DISTRICT", "district"],
	["SUBDISTRICT", "subdistrict"],
];

/**
 * The resolved tuple's fields that the Tagger missed but the text writes on
 * their own. A district is claimed before a same-named subdistrict, because
 * one bare mention of such a name is the district. Misplaced spans count as
 * neither tagged nor free text, and a tagged span that holds its own name
 * leaves the rest of its text free, as in a district span over
 * `คำเขื่อนแก้ว ชานุมาน`.
 */
function untaggedMentions(
	raw: string,
	tuple: LocationTuple,
	spans: readonly TaggedSpan[],
	misplaced: readonly TaggedSpan[],
): { values: Partial<AdministrativeValues>; claimed: Range[] } {
	const text = raw.replace(/[๐-๙]/gu, (digit) => String(THAI_DIGITS.indexOf(digit)));
	const namesOf = (field: AdministrativeField | "zipcode"): string[] => field === "province"
		? [tuple.province, ...(PROVINCE_ALIASES.get(tuple.province) ?? [])]
		: [tuple[field]];
	const taken: Range[] = [...misplaced];
	for (const span of spans) {
		const field = TAGGED_FIELDS.find(([label]) => label === span.label)?.[1];
		if (field === undefined) continue;
		let own: Range = span;
		for (const name of namesOf(field)) {
			const start = text.indexOf(name, span.start);
			if (start >= 0 && start + name.length <= span.end) {
				own = { start, end: start + name.length };
				break;
			}
		}
		taken.push(own);
	}
	const values: Partial<AdministrativeValues> = {};
	const claimed: Range[] = [];
	for (const [label, field] of TAGGED_FIELDS) {
		if (spans.some((span) => span.label === label)) continue;
		const found = namesOf(field).map((name) => findStandalone(text, field, name, taken)).find(Boolean) ??
			(field === "subdistrict" || field === "district" ? findTruncated(text, field, tuple[field], taken) : null) ??
			(field === "province" ? findMisspelt(text, field, tuple.province, taken) : null);
		if (!found) continue;
		values[field] = tuple[field];
		taken.push(found);
		claimed.push(found);
	}
	return { values, claimed };
}

/**
 * Only punctuation between two address runs on one line: the GUIDE marks
 * such a stretch as one piece and keeps its inner punctuation.
 */
const PUNCTUATION_GAP = /^[ \t]*,[ \t,]*$/u;

/**
 * A branch designation written outside brackets is a tax-invoice note, not
 * address detail. In brackets after a company it belongs to the name.
 */
const BRANCH_NOTE = /(?<!\([ \t]*)(?:สาขาที่[ \t]*[0-9๐-๙]+|สนญ\.|สำนักงานใหญ่)/gu;

/** A form's own field labels with nothing filled in, as `(บ้านเลขที่ หมู่ ตำบล ...)` in a question line. */
const FORM_LABELS = /^(?:(?:บ้านเลขที่|เลขที่|หมู่ที่|หมู่|ตำบล|อำเภอ|จังหวัด|ที่อยู่)[\s/:,()]*)+$/u;
/** The label a form answer starts with, which the GUIDE keeps out of the address. */
const ANSWER_LABEL = /^(?:ตอบ|ที่อยู่)[\s:：]+/u;

function branchNotes(raw: string): Range[] {
	return [...raw.matchAll(BRANCH_NOTE)].map((match) => ({ start: match.index, end: match.index + match[0].length }));
}

/**
 * Address detail from the given ranges in text order, touching or
 * overlapping ranges merged, with the claimed administrative mentions and
 * branch notes cut out.
 */
export function addressOf(raw: string, ranges: readonly Range[], administrative: readonly Range[]): string {
	const claimed = [...administrative, ...branchNotes(raw)];
	const merged: Range[] = [];
	for (const range of [...ranges].sort((left, right) => left.start - right.start)) {
		const last = merged[merged.length - 1];
		if (last && (last.end >= range.start || PUNCTUATION_GAP.test(raw.slice(last.end, range.start)))) {
			merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
		} else merged.push(range);
	}
	const pieces: string[] = [];
	for (const span of merged) {
		let start = span.start;
		const cuts = claimed
			.filter((range) => range.start < span.end && span.start < range.end)
			.sort((left, right) => left.start - right.start);
		for (const cut of [...cuts, { start: span.end, end: span.end }]) {
			const piece = raw.slice(start, Math.max(start, cut.start)).replace(/^[\s,]+|[\s,]+$/gu, "").replace(ANSWER_LABEL, "");
			if (piece && !FORM_LABELS.test(piece)) pieces.push(piece);
			start = Math.max(start, cut.end);
		}
	}
	return pieces.join(" ");
}

export function createTaggerParser(
	model: TaggerModel,
	locations: readonly LocationTuple[],
): TaggerParser {
	const compiled = compileTaggerModel(model);
	const anchor = createAnchorer(locations);
	const resolve = createTupleResolver(locations);
	const siblingTuples = new Map<string, LocationTuple[]>();
	for (const location of locations) {
		const key = `${location.province}\u0000${location.district}`;
		const siblings = siblingTuples.get(key) ?? [];
		siblings.push(location);
		siblingTuples.set(key, siblings);
	}

	/**
	 * The anchor picks the first tuple of its district when the written
	 * subdistrict is misspelled, so the tagged span chooses among the
	 * district's subdistricts by similarity, within the written postcode
	 * when it narrows them.
	 */
	function anchoredSubdistrict(tuple: LocationTuple, text: string, zipcode: string | null): string {
		const siblings = siblingTuples.get(`${tuple.province}\u0000${tuple.district}`) ?? [tuple];
		const inPostcode = siblings.filter((sibling) => sibling.zipcode === zipcode);
		const pool = inPostcode.length > 0 ? inPostcode : siblings;
		let best = tuple.subdistrict;
		let bestRatio = MIN_SIBLING_RATIO;
		if (ROMANIZED.test(text)) {
			const written = latinSkeleton(text);
			for (const sibling of pool) {
				const ratio = similarityRatio(written, thaiSkeleton(sibling.subdistrict)) / 100;
				if (ratio > bestRatio) {
					best = sibling.subdistrict;
					bestRatio = ratio;
				}
			}
			return best;
		}
		for (const form of nameForms("subdistrict", text)) {
			if (form === tuple.subdistrict) return tuple.subdistrict;
			for (const sibling of siblings) {
				if (sibling.subdistrict === form) return form;
			}
			for (const sibling of pool) {
				const ratio = similarityRatio(form, sibling.subdistrict) / 100;
				if (ratio > bestRatio) {
					best = sibling.subdistrict;
					bestRatio = ratio;
				}
			}
		}
		return best;
	}

	/**
	 * Shoppers write the subdistrict right before the district. When nothing
	 * else gives the subdistrict, the last word of the address run that ends
	 * just before the district mention on its line is the subdistrict if it
	 * spells, or nearly spells, one of the district's subdistricts, as
	 * `ม.3 บางเพียง บางบ่อ` for บางเพรียง.
	 */
	function subdistrictBefore(
		raw: string,
		tuple: LocationTuple,
		address: readonly Range[],
		district: Range,
		zipcode: string | null,
	): (Range & { name: string }) | null {
		const range = address.find((candidate) =>
			candidate.end <= district.start && /^[ \t,]*$/u.test(raw.slice(candidate.end, district.start)));
		if (!range) return null;
		const piece = raw.slice(range.start, range.end);
		const thai = /(?:^|\s)([ก-๎]+)$/u.exec(piece)?.[1];
		const latin = thai ? undefined : /(?:^|,\s*)([A-Za-z][A-Za-z ]*)$/u.exec(piece)?.[1];
		const word = thai ?? latin;
		if (!word) return null;
		const written = thai ?? latinSkeleton(word);
		const siblings = siblingTuples.get(`${tuple.province}\u0000${tuple.district}`) ?? [tuple];
		const inPostcode = siblings.filter((sibling) => sibling.zipcode === zipcode);
		let best: string | null = null;
		let bestRatio = MIN_WORD_RATIO;
		for (const sibling of inPostcode.length > 0 ? inPostcode : siblings) {
			const ratio = similarityRatio(written, thai ? sibling.subdistrict : thaiSkeleton(sibling.subdistrict)) / 100;
			if (ratio >= bestRatio) {
				best = sibling.subdistrict;
				bestRatio = ratio;
			}
		}
		return best ? { start: range.end - word.length, end: range.end, name: best } : null;
	}

	const postcodeTuples = new Map<string, LocationTuple[]>();
	for (const location of locations) {
		const tuples = postcodeTuples.get(location.zipcode) ?? [];
		tuples.push(location);
		postcodeTuples.set(location.zipcode, tuples);
	}

	/**
	 * The Anchor fixes only the fields it found written exactly. A written
	 * postcode that contradicts it, or an unconfirmed district, leaves the
	 * choice to the tagged spans within the tuples the evidence allows.
	 */
	function resolveTuple(
		anchored: Anchor,
		texts: AdministrativeTexts,
		written: string | null,
	): LocationTuple | null {
		const tuple = anchored.tuple;
		const inPostcode = written ? postcodeTuples.get(written) : undefined;
		if (inPostcode && tuple?.zipcode !== written) return closestTuple(inPostcode, texts);
		if (!tuple || !texts.district) return tuple;
		let confirmed = 0;
		for (const flag of anchored.flags) confirmed |= flag;
		if (confirmed & DISTRICT_BIT) return tuple;
		const subdistrictDisagrees = texts.subdistrict !== undefined &&
			formSimilarity("subdistrict", nameForms("subdistrict", texts.subdistrict), tuple.subdistrict) < 1;
		const pool = [tuple, ...(inPostcode ?? locations).filter((location) =>
			ANCHOR_FIELDS.every((field, bit) =>
				(confirmed & (1 << bit)) === 0 ||
				(field === "subdistrict" && subdistrictDisagrees) ||
				location[field] === tuple[field]),
		)];
		return closestTuple(pool, texts);
	}

	return {
		parse(raw) {
			const anchored = anchor(raw);
			const features = featurize(raw, anchored.flags, compiled.dimension);
			const tags = decodeTags(features, compiled, spanEdges(raw));
			closeBrackets(raw, tags);
			attachBracketAfterName(raw, tags);
			recutPhone(raw, tags);
			completePostcode(raw, tags);
			finishLine(raw, tags);
			const spans = spansOf(raw, runsOf(raw, tags));
			const text = (label: OutputLabel): string | undefined =>
				spans.find((span) => span.label === label)?.text;
			const subdistrict = text("SUBDISTRICT");
			const district = text("DISTRICT");
			const province = text("PROVINCE");
			const zipcode = text("POSTCODE");
			const texts = {
				...(subdistrict ? { subdistrict } : {}),
				...(district ? { district } : {}),
				...(province ? { province } : {}),
			};
			const written = zipcode ? normalizePostcode(zipcode) : null;
			const tuple = resolveTuple(anchored, texts, written);
			const placeNames: Range[] = [];
			const misplaced: TaggedSpan[] = [];
			const mislabeled: TaggedSpan[] = [];
			for (const span of spans) {
				const field = ADMINISTRATIVE_LABELS.get(span.label);
				if (!tuple || field === undefined) continue;
				if (writesOtherField(span.text, field, tuple)) mislabeled.push(span);
				else if (insideOtherName(raw, span, field, tuple)) misplaced.push(span);
				else {
					const place = insidePlaceName(raw, span, field, tuple[field]);
					if (!place) continue;
					misplaced.push(span);
					placeNames.push(place);
				}
			}
			const fieldSpans = spans.filter((span) => !misplaced.includes(span) && !mislabeled.includes(span));
			const kept = (label: OutputLabel): boolean => fieldSpans.some((span) => span.label === label);
			const untagged = tuple ? untaggedMentions(raw, tuple, fieldSpans, misplaced) : { values: {}, claimed: [] };
			const addressRanges = [...spans.filter((span) => span.label === "ADDRESS_DETAIL"), ...placeNames];
			const straddled = tuple
				? ADMINISTRATIVE_FIELDS.flatMap((field) => straddledMentions(raw, field, tuple[field], addressRanges))
				: [];
			const districtSpan = fieldSpans.find((span) => span.label === "DISTRICT");
			const before = tuple && districtSpan && !kept("SUBDISTRICT") && !untagged.values.subdistrict
				? subdistrictBefore(raw, tuple, addressRanges, districtSpan, written)
				: null;
			const address = addressOf(raw, addressRanges, [...untagged.claimed, ...straddled, ...(before ? [before] : [])]);
			const administrative = tuple
				? {
					...NO_ADMINISTRATIVE,
					...untagged.values,
					...(before ? { subdistrict: before.name } : {}),
					...(subdistrict && kept("SUBDISTRICT")
						? { subdistrict: anchoredSubdistrict(tuple, subdistrict, written) }
						: {}),
					...(kept("DISTRICT") ? { district: tuple.district } : {}),
					...(kept("PROVINCE") ? { province: tuple.province } : {}),
					...(zipcode ? { zipcode: tuple.zipcode } : {}),
				}
				: resolve({ ...texts, ...(zipcode ? { zipcode } : {}) });
			const bare = subdistrict?.trim();
			if (
				tuple && bare && tuple.subdistrict === tuple.district &&
				administrative.district === null && administrative.subdistrict === bare &&
				raw.indexOf(bare) === raw.lastIndexOf(bare)
			) {
				// One bare mention of a name the subdistrict and district share is the district.
				administrative.district = administrative.subdistrict;
				administrative.subdistrict = null;
			}
			const name = text("NAME");
			const phone = text("PHONE");
			return {
				raw,
				fields: {
					name: name ? normalizeCandidate("NAME", name) : null,
					phone: phone ? normalizeCandidate("PHONE", phone) : null,
					address: address ? normalizeCandidate("ADDRESS_DETAIL", address) : null,
					...administrative,
				},
				spans,
			};
		},
	};
}
