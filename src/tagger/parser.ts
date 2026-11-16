import { similarityRatio } from "../candidate/fuzzy-match";
import { normalizeCandidate, normalizePostcode, typedPhone } from "../normalize";
import type { LocationTuple, OutputLabel, ParsedFields } from "../types";
import { ANCHOR_FIELDS, createAnchorer, type Anchor } from "./anchor";
import { decodeEmissions, emissionScores, spanEdges } from "./decode";
import { featurize } from "./features";
import { hasThaiLength, recutPhone } from "./phone";
import { fromKedmanee, latinSkeleton, thaiSkeleton } from "./romanize";
import { composeRecipient, labelledNickname } from "./compose";
import { createAdministrativeResegmenter } from "./resegment";
import { clearContactHandles, opensWithContact } from "./contact";
import { createSplitter, parseDeliveries } from "./split";
import {
	compileTaggerModel,
	TAG_COUNT,
	TAGS,
	type AnyTaggerModel,
	type EnsembleTaggerModel,
	type Tag,
	type TaggerModel,
} from "./model";
import { createNeuralEmitter, type NeuralTaggerModel } from "./neural";
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
	createLocationFiller,
	createTupleResolver,
	formSimilarity,
	nameForms,
	PROVINCE_ALIASES,
	ROMANIZED,
	type AdministrativeField,
	type AdministrativeTexts,
	type AdministrativeValues,
} from "./resolve";

const MIN_SIBLING_RATIO = 0.7;
const MIN_WORD_RATIO = 0.85;
const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";
const DISTRICT_BIT = 1 << ANCHOR_FIELDS.indexOf("district");

export interface TaggedSpan {
	readonly label: OutputLabel;
	readonly text: string;
	readonly start: number;
	readonly end: number;
}

/** A condition the caller should check by hand; the fields are still returned. */
export type ParseWarning = "ambiguous-location" | "phone-length" | "multiple-recipients";

export type InferredField = "subdistrict" | "district" | "province" | "zipcode";

export interface TaggedRecipient {
	readonly fields: ParsedFields;
	/** Administrative fields the message did not write, filled from the gazetteer. */
	readonly inferred: readonly InferredField[];
}

/**
 * One parsed message. `recipients` holds one entry per delivery in the
 * message, usually one; `fields` and `inferred` repeat the first entry.
 */
export interface TaggedAddress extends TaggedRecipient {
	readonly raw: string;
	readonly spans: readonly TaggedSpan[];
	readonly warnings: readonly ParseWarning[];
	readonly recipients: readonly TaggedRecipient[];
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
const BRACKET_AFTER = /^[ \t]*\([^()\n+]*\)/u;
/** A number in brackets after a name is address detail or a phone, unless it is a short one after a word, as `(หัวหน้าไลน์ 2)`. */
const BRACKET_NUMBER = /\d{3}|(?:ม\.|หมู่|ซ\.|ซอย|ถ\.|ชั้น|ห้อง|เลขที่|\/|^[ \t]*\([ \t]*\d)/u;
/** A sentence-final particle: the bracket is a remark to the seller, which the GUIDE leaves unmarked. */
const REMARK_END = /(?:ค่ะ|คะ|ครับ|นะ|จ้า|จ้ะ|จ๊ะ)\s*\)$/u;

function placeKey(text: string): string {
	return text.toLowerCase().replace(/^(?:จังหวัด|อำเภอ|เขต|จ\.|อ\.)/u, "").replace(/[\s.ฯ]/gu, "");
}

/** Province and district names and the province aliases, as `placeKey` writes them. */
function placeKeys(locations: readonly LocationTuple[]): ReadonlySet<string> {
	const names = [
		...locations.flatMap((location) => [location.province, location.district]),
		...[...PROVINCE_ALIASES.values()].flat(),
	];
	return new Set(names.map(placeKey));
}

/** A bracket group holding a contact handle or only a province, district or city, which the GUIDE keeps out of the name. */
function outsideName(group: string, places: ReadonlySet<string>): boolean {
	const inner = group.slice(group.indexOf("(") + 1, -1);
	return opensWithContact(inner) || places.has(placeKey(inner));
}

const LAST_BRACKET = /[ \t]*\([^()\n]*\)$/u;

/** Drops such a bracket group where the tagger ends the name with it, as in `คุณบีม (LINE: beam_shop)`. */
function withoutTrailingBracket(raw: string, name: Range, places: ReadonlySet<string>): Range {
	const match = LAST_BRACKET.exec(raw.slice(name.start, name.end));
	if (!match || match.index === 0 || !outsideName(match[0], places)) return name;
	return { start: name.start, end: name.start + match.index };
}

/**
 * The GUIDE keeps brackets written right after a name in the name, as in
 * `ลุงจันทร์ (ผู้รับ)`, unless they hold a remark to the seller, a number,
 * a contact handle, or only a province, district or city. Extends a name or
 * organisation run over such a bracket group when the tagger left all of
 * it untagged.
 */
function attachBracketAfterName(raw: string, tags: Uint8Array, places: ReadonlySet<string>): void {
	for (let end = 1; end < raw.length; end += 1) {
		const tag = tags[end - 1]!;
		if (!NAMED.has(tag) || tags[end] === tag) continue;
		const group = BRACKET_AFTER.exec(raw.slice(end))?.[0];
		if (!group || REMARK_END.test(group) || outsideName(group, places) || (/\d/u.test(group) && BRACKET_NUMBER.test(group))) continue;
		if (!tags.subarray(end, end + group.length).every((other) => other === OTHER)) continue;
		tags.fill(tag, end, end + group.length);
	}
}

/**
 * The tagger leaves a name written only after the label `ชื่อเล่น` untagged.
 * With no name or organisation run, that nickname is the name, and so is
 * a name after an English `send to`, which the tagger leaves untagged or
 * reads as the start of the address.
 */
function tagLabelledNickname(raw: string, tags: Uint8Array): void {
	if (tags.some((tag) => NAMED.has(tag))) return;
	const nickname = labelledNickname(raw);
	if (nickname) tags.fill(TAGS.indexOf("NAME"), nickname.start, nickname.end);
	const sent = nickname ? null : sentName(raw);
	if (!sent || !tags.subarray(sent.start, sent.end).every((tag) => tag === OTHER || tag === ADDRESS)) return;
	tags.fill(TAGS.indexOf("NAME"), sent.start, sent.end);
	for (let index = sent.end; /[ \t,]/u.test(raw[index] ?? "") && tags[index] === ADDRESS; index += 1) tags[index] = OTHER;
}

const ADDRESS = TAGS.indexOf("ADDRESS_DETAIL");
const SEND_TO =/(?<![A-Za-z])(?:send|ship|deliver)(?:[ \t]+to)?[ \t]+((?:[A-Z][a-z]+)(?:[ \t]+[A-Z][a-z]*\.?)?)(?=[ \t,]+[0-9๐-๙])/u;
const COURIER = /^(?:Kerry|Flash|Thai|Post|Ems|Grab|Lalamove|Cod|Line|Express)$/iu;

/** The capitalized words after an English `send to`, right before the house number or phone, as `pls send Mook 12/88`. */
function sentName(raw: string): Range | null {
	const match = SEND_TO.exec(raw);
	if (!match || match[1]!.split(/[ \t]+/u).some((word) => COURIER.test(word))) return null;
	const end = match.index + match[0].length;
	return { start: end - match[1]!.length, end };
}

const LEGAL_SUFFIX = /^,?[ \t]*(?:Ltd\.?|Limited|Inc\.?)(?![A-Za-z])/iu;

/**
 * A company name keeps its legal form, but the tagger often ends the name
 * at `Co.` and starts the address with `, Ltd.`. The suffix joins the name.
 */
function joinLegalSuffix(raw: string, tags: Uint8Array): void {
	for (let end = 1; end < raw.length; end += 1) {
		const tag = tags[end - 1]!;
		if (!NAMED.has(tag) || tags[end] === tag || !/co\.$/iu.test(raw.slice(0, end))) continue;
		const suffix = LEGAL_SUFFIX.exec(raw.slice(end))?.[0];
		if (suffix) tags.fill(tag, end, end + suffix.length);
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

const THAI_LETTER = /[ก-๎]/u;
/** District first: one bare mention of a name the subdistrict and district share is the district. */
const LEAD_FIELDS: readonly AdministrativeField[] = ["district", "subdistrict", "province"];

/**
 * An address run that starts glued to untagged chat text (`ส่ง|ตะกั่วป่าค่ะ`,
 * `เพื่อนหนูเองที่|ตากฟ้า 56 ม.12`) and opens with a whole name of the
 * resolved tuple opens with that field's mention, not with address detail.
 */
function gluedFieldWords(
	raw: string,
	tags: Uint8Array,
	address: readonly Range[],
	tuple: LocationTuple,
): (Range & { field: AdministrativeField })[] {
	const leads: (Range & { field: AdministrativeField })[] = [];
	for (const range of address) {
		if (range.start === 0 || !THAI_LETTER.test(raw[range.start - 1]!) || tags[range.start - 1] !== OTHER) continue;
		const field = LEAD_FIELDS.find((candidate) => {
			const end = range.start + tuple[candidate].length;
			return raw.startsWith(tuple[candidate], range.start) && end <= range.end &&
				(end === range.end || !THAI_LETTER.test(raw[end]!));
		});
		if (field) leads.push({ start: range.start, end: range.start + tuple[field].length, field });
	}
	return leads;
}

/** A word that opens a place or organisation name, which shoppers glue to `ส่ง`. */
const PLACE_OPENER = /^(?:วัด|ร้าน|โรง|บจก|บมจ|หจก|บริษัท|รร\.|รพ\.|บ้าน|หมู่บ้าน|คลินิก|สหกรณ์|ตลาด|สำนักงาน|ที่ทำการ|ศูนย์|หอ|อาคาร|คอนโด)/u;

/**
 * Address runs that start glued to untagged chat text and hold no digit
 * or place word,
 * as `เครื่องวัด|ความดันดิจิตอล`, when another address piece holds the
 * place: a word of the conversation, not address detail.
 */
export function chatDebris(raw: string, tags: Uint8Array, address: readonly Range[]): Range[] {
	const glued = address.filter((range) =>
		range.start > 0 && THAI_LETTER.test(raw[range.start - 1]!) && tags[range.start - 1] === OTHER &&
		!/[0-9๐-๙]/u.test(raw.slice(range.start, range.end)) && !PLACE_OPENER.test(raw.slice(range.start, range.end)));
	return glued.length < address.length ? glued : [];
}

const PREFIX_WORD = /อำเภอ|ตำบล|จังหวัด|แขวง/gu;

const FIELD_TAGS = new Set(["SUBDISTRICT", "DISTRICT", "PROVINCE"].map((tag) => TAGS.indexOf(tag as Tag)));

/**
 * A run boundary never falls inside a field prefix word. When the rest of
 * the word is a field run, the whole word is that field's prefix. Otherwise
 * the rest of the word, and the name glued to it, join the run that holds
 * the word's first letters, as in the office `ที่ว่าการอำ|เภอท่าตะเกียบ`.
 */
export function joinPrefixWords(raw: string, tags: Uint8Array): void {
	for (const match of raw.matchAll(PREFIX_WORD)) {
		const start = match.index;
		const end = start + match[0].length;
		const tag = tags[start]!;
		let split = start + 1;
		while (split < end && tags[split] === tag) split += 1;
		if (split === end) continue;
		if (FIELD_TAGS.has(tags[split]!)) {
			tags.fill(tags[split]!, start, split);
			continue;
		}
		if (tag === OTHER) continue;
		let stop = end;
		while (stop < raw.length && /[^\s]/u.test(raw[stop]!) && tags[stop] === tags[split]) stop += 1;
		tags.fill(tag, split, stop);
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
function spansOf(raw: string, runs: readonly Run[], places: ReadonlySet<string>): TaggedSpan[] {
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
	if (recipient.name) spans.push(span("NAME", withoutTrailingBracket(raw, recipient.name, places)));
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
 * A branch designation written outside brackets, or a tax ID label, is a
 * tax-invoice note, not address detail. In brackets after a company a
 * branch belongs to the name.
 */
const BRANCH_NOTE = /(?<!\([ \t]*)(?:สาขาที่[ \t]*[0-9๐-๙]+|สนญ\.|สำนักงานใหญ่)|เลข(?:ที่|ประจำตัว)?(?:ผู้เสีย)?ภาษี|ภพ\.?[ \t]*20/gu;

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

/** Emission scores, `TAG_COUNT` per UTF-16 unit, and the transition scores the decoder adds between tags. */
export interface TagScorer {
	score(raw: string, anchorFlags: Uint8Array): Int32Array;
	readonly transitions: Int32Array;
}

export function linearScorer(model: TaggerModel): TagScorer {
	const compiled = compileTaggerModel(model);
	return {
		score: (raw, anchorFlags) => emissionScores(featurize(raw, anchorFlags, compiled.dimension), compiled.weights),
		transitions: compiled.transitions,
	};
}

function neuralScorer(model: NeuralTaggerModel): TagScorer {
	const transitions = new Int32Array(TAG_COUNT * TAG_COUNT);
	if (model.transitions) {
		if (model.transitions.length !== transitions.length) throw new Error("neural tagger transitions must be the tag count squared");
		transitions.set(model.transitions);
	}
	return { score: createNeuralEmitter(model), transitions };
}

/** Linear scores plus `neuralWeight` times the neural ones, and likewise for transitions. */
function ensembleScorer(model: EnsembleTaggerModel): TagScorer {
	const linear = linearScorer(model.linear);
	const neural = neuralScorer(model.neural);
	const transitions = linear.transitions.map((value, index) => Math.round(value + model.neuralWeight * neural.transitions[index]!));
	return {
		score(raw, anchorFlags) {
			const scores = linear.score(raw, anchorFlags);
			const extra = neural.score(raw, anchorFlags);
			for (let index = 0; index < scores.length; index += 1) {
				scores[index] = Math.round(scores[index]! + model.neuralWeight * extra[index]!);
			}
			return scores;
		},
		transitions,
	};
}

function scorerOf(model: AnyTaggerModel): TagScorer {
	switch (model.kind) {
		case undefined:
			return linearScorer(model);
		case "neural-bigru":
			return neuralScorer(model);
		case "ensemble":
			return ensembleScorer(model);
	}
}

export function createTaggerParser(
	model: AnyTaggerModel,
	locations: readonly LocationTuple[],
): TaggerParser {
	return createScoredParser(scorerOf(model), locations);
}

export function createScoredParser(
	scorer: TagScorer,
	locations: readonly LocationTuple[],
): TaggerParser {
	const anchor = createAnchorer(locations);
	const resolve = createTupleResolver(locations);
	const fillLocation = createLocationFiller(locations);
	const resegment = createAdministrativeResegmenter(locations);
	const places = placeKeys(locations);
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

	const split = createSplitter(locations);
	const delivery: TaggerParser = {
		parse(raw) {
			const anchored = anchor(raw);
			const tags = decodeEmissions(scorer.score(raw, anchored.flags), scorer.transitions, spanEdges(raw));
			closeBrackets(raw, tags);
			attachBracketAfterName(raw, tags, places);
			clearContactHandles(raw, tags);
			tagLabelledNickname(raw, tags);
			joinLegalSuffix(raw, tags);
			recutPhone(raw, tags);
			completePostcode(raw, tags);
			finishLine(raw, tags);
			joinPrefixWords(raw, tags);
			const spans = resegment(raw, spansOf(raw, runsOf(raw, tags), places));
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
					const place = insidePlaceName(raw, span, field, tuple);
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
			const debris = chatDebris(raw, tags, addressRanges);
			const leads = tuple ? gluedFieldWords(raw, tags, addressRanges, tuple) : [];
			const address = addressOf(raw, addressRanges, [
				...untagged.claimed,
				...straddled,
				...(before ? [before] : []),
				...leads,
				...debris,
			]);
			const administrative = tuple
				? {
					...NO_ADMINISTRATIVE,
					...Object.fromEntries(leads.map((lead) => [lead.field, tuple[lead.field]])),
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
			const location = fillLocation(administrative);
			const nameText = text("NAME");
			const name = nameText ? normalizeCandidate("NAME", nameText) : null;
			const phoneText = text("PHONE");
			const phone = phoneText ? typedPhone(phoneText) : null;
			const warnings: ParseWarning[] = [
				...(location.ambiguous ? ["ambiguous-location" as const] : []),
				...(phone && !hasThaiLength(phone) ? ["phone-length" as const] : []),
			];
			const recipient: TaggedRecipient = {
				fields: {
					name: name === null ? null : fromKedmanee(name) ?? name,
					phone,
					address: address ? normalizeCandidate("ADDRESS_DETAIL", address) : null,
					...location.values,
				},
				inferred: location.inferred,
			};
			return { raw, ...recipient, spans, warnings, recipients: [recipient] };
		},
	};
	return { parse: (raw) => parseDeliveries(raw, split(raw), delivery.parse) };
}
