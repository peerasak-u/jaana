import { normalizeCandidate } from "../../src/normalize";
import type { Label, LocationTuple, OutputLabel } from "../../src/types";
import type { DatasetSpan, ExpectedAddress } from "../dataset";
import { splitName } from "../org-labels";
import { fnv1a, type ChatRecord } from "./markup";

/** A record cut into consecutive pieces of text. A piece with no label is unmarked text. */
interface Segment {
	readonly label: Label | null;
	readonly text: string;
}

interface Draft {
	readonly segments: readonly Segment[];
	readonly location: LocationTuple;
}

type Random = () => number;

interface Donors {
	/** Donor names by kind, so a person is swapped only for a person and an organisation for an organisation. */
	readonly names: ReadonlyMap<string, readonly string[]>;
	readonly locations: readonly LocationTuple[];
}

export const AUGMENT_OPS = ["location", "name"] as const;
export type AugmentOp = (typeof AUGMENT_OPS)[number];

export interface AugmentOptions {
	/** Variants written per record, on top of the record itself. */
	readonly copies: number;
	readonly seed: number;
	readonly ops: readonly AugmentOp[];
	/** Tuples a variant may move to. Pass only the train pool. */
	readonly locations: readonly LocationTuple[];
}

function randomFrom(seed: number): Random {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

function pick<T>(items: readonly T[], random: Random): T {
	return items[Math.floor(random() * items.length)]!;
}

function segmentsOf(record: ChatRecord): Segment[] {
	const segments: Segment[] = [];
	let cursor = 0;
	for (const span of [...record.spans].sort((left, right) => left.start - right.start)) {
		if (span.start > cursor) segments.push({ label: null, text: record.raw.slice(cursor, span.start) });
		segments.push({ label: span.label, text: record.raw.slice(span.start, span.end) });
		cursor = span.end;
	}
	if (cursor < record.raw.length) segments.push({ label: null, text: record.raw.slice(cursor) });
	return segments;
}

const ADMIN_FIELDS = {
	SUBDISTRICT: "subdistrict",
	DISTRICT: "district",
	PROVINCE: "province",
} as const satisfies Partial<Record<Label, keyof LocationTuple>>;

type AdminLabel = keyof typeof ADMIN_FIELDS;

function isAdmin(label: Label | null): label is AdminLabel {
	return label !== null && label in ADMIN_FIELDS;
}

const PREFIXES = ["กิ่งอำเภอ", "ตำบล", "แขวง", "อำเภอ", "เขต", "จังหวัด", "ต", "อ", "จ", "ข"];

/** The written prefix when the rest of the span is exactly `name`, else null. */
function prefixBefore(text: string, name: string): string | null {
	if (text === name) return "";
	for (const prefix of PREFIXES) {
		const match = new RegExp(`^${prefix}\\.?\\s*`, "u").exec(text);
		if (match && text.slice(match[0].length) === name) return match[0];
	}
	return null;
}

function sameDigitScript(written: string, digits: string): string {
	return /[๐-๙]/u.test(written) ? digits.replace(/\d/gu, (digit) => "๐๑๒๓๔๕๖๗๘๙"[Number(digit)]!) : digits;
}

function isBangkok(location: LocationTuple): boolean {
	return location.province === "กรุงเทพมหานคร";
}

/**
 * Moves the record to another tuple. A span written exactly as its
 * gazetteer name takes the new name behind the same prefix. A misspelt,
 * shortened, or alias span stays as written, so the new tuple must share
 * that field.
 */
function swapLocation(draft: Draft, donors: Donors, random: Random): Draft {
	const fixed: (keyof LocationTuple)[] = [];
	for (const segment of draft.segments) {
		if (!isAdmin(segment.label)) continue;
		const field = ADMIN_FIELDS[segment.label];
		if (prefixBefore(segment.text, draft.location[field]) === null) fixed.push(field);
	}
	const candidates = donors.locations.filter((location) =>
		isBangkok(location) === isBangkok(draft.location) &&
		fixed.every((field) => location[field] === draft.location[field]),
	);
	if (candidates.length === 0) return draft;
	const location = pick(candidates, random);
	const segments = draft.segments.map((segment): Segment => {
		if (segment.label === "POSTCODE") return { ...segment, text: sameDigitScript(segment.text, location.zipcode) };
		if (!isAdmin(segment.label)) return segment;
		const field = ADMIN_FIELDS[segment.label];
		const prefix = prefixBefore(segment.text, draft.location[field]);
		return prefix === null ? segment : { ...segment, text: prefix + location[field] };
	});
	return { segments, location };
}

/** Whether a name holds an organisation, a person, or both, which decides how its record is tagged. */
function nameKind(text: string): string {
	const parts = splitName(text);
	return `${parts.org !== null}:${parts.person !== null}`;
}

function swapName(draft: Draft, donors: Donors, random: Random): Draft {
	const segments = draft.segments.map((segment): Segment =>
		segment.label === "NAME"
			? { ...segment, text: pick(donors.names.get(nameKind(segment.text))!, random) }
			: segment,
	);
	return { ...draft, segments };
}

function assemble(source: ChatRecord, draft: Draft, id: string): ChatRecord {
	let raw = "";
	const spans: DatasetSpan[] = [];
	const location = draft.location;
	for (const segment of draft.segments) {
		const start = raw.length;
		raw += segment.text;
		if (segment.label === null || segment.label === "OTHER") continue;
		const label: OutputLabel = segment.label;
		const canonical = isAdmin(label) ? location[ADMIN_FIELDS[label]] : normalizeCandidate(label, segment.text);
		spans.push({
			label,
			text: segment.text,
			canonical,
			start,
			end: raw.length,
			codePointStart: Array.from(raw.slice(0, start)).length,
			codePointEnd: Array.from(raw).length,
		});
	}
	for (const span of spans) {
		if (raw.slice(span.start, span.end) !== span.text || span.text.trim() !== span.text) {
			throw new Error(`augmented span ${span.label} of ${id} does not match its text`);
		}
	}
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
	return { ...source, id, raw, spans, expected, normalizationExpected: expected, seedLocation: location, recipients: [expected] };
}

function donorsOf(records: readonly ChatRecord[], locations: readonly LocationTuple[]): Donors {
	const names = new Map<string, string[]>();
	for (const record of records) {
		for (const span of record.spans) {
			if (span.label !== "NAME") continue;
			const kind = nameKind(span.text);
			const same = names.get(kind) ?? [];
			same.push(span.text);
			names.set(kind, same);
		}
	}
	return { names, locations };
}

/**
 * Returns the records followed by `copies` variants of each. Names come
 * only from the given records and locations only from
 * `options.locations`, so no benchmark text leaks in. Deterministic for a
 * given seed and input.
 */
export function augmentChatRecords(records: readonly ChatRecord[], options: AugmentOptions): ChatRecord[] {
	const donors = donorsOf(records, options.locations);
	const seen = new Set(records.map((record) => record.raw));
	const result = [...records];
	const steps = {
		location: swapLocation,
		name: swapName,
	} satisfies Record<AugmentOp, (draft: Draft, donors: Donors, random: Random) => Draft>;
	for (const record of records) {
		for (let copy = 1; copy <= options.copies; copy += 1) {
			const id = `${record.id}~${copy}`;
			const random = randomFrom(fnv1a(`${options.seed}:${id}`));
			let draft: Draft = { segments: segmentsOf(record), location: record.seedLocation };
			for (const op of AUGMENT_OPS) {
				if (options.ops.includes(op)) draft = steps[op](draft, donors, random);
			}
			const variant = assemble(record, draft, id);
			if (seen.has(variant.raw)) continue;
			seen.add(variant.raw);
			result.push(variant);
		}
	}
	return result;
}
