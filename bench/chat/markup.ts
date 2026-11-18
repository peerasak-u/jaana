import { normalizeCandidate, normalizePostcode } from "../../src/normalize";
import { NOTE_EDGE } from "../../src/notes/trim";
import type { ParseWarning } from "../../src/tagger/parser";
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
	/** On a `warn:` mismatch, the set the marks need. */
	readonly warnings?: readonly ParseWarning[];
}

/** One `R` piece: a delivery note, kept apart from the seven field spans. */
export interface NoteSpan {
	readonly text: string;
	readonly start: number;
	readonly end: number;
	/** 0 for the first delivery. */
	readonly recipient: number;
}


/**
 * One message. `recipients` holds the gold per delivery in written order,
 * and `expected` repeats the first. `spans` holds every recipient's marks.
 */
export interface ChatRecord extends DatasetRecord {
	readonly tags: readonly string[];
	readonly sourceLine: number;
	readonly warnings: readonly ParseWarning[];
	readonly recipients: readonly ExpectedAddress[];
	/** `R` marks in written order. Empty for a file written before GUIDE v3. */
	readonly notes: readonly NoteSpan[];
}

/**
 * Gold phone digits as typed: separators dropped, Thai digits made ASCII,
 * `+66`/`66` read as a leading 0, and nothing cut. It copies the `+66` rule
 * of `normalizePhone` instead of calling it, so the gold does not move when
 * the parser's phone rules do.
 */
export function goldPhone(text: string): string | null {
	const digits = text
		.replace(/[๐-๙]/gu, (digit) => String("๐๑๒๓๔๕๖๗๘๙".indexOf(digit)))
		.replace(/\D/gu, "")
		.replace(/^(0066|66)0?/u, "0");
	return /^0\d{8,11}$/u.test(digits) ? digits : null;
}

/** A mobile number (06, 08, 09) has 10 digits; any other Thai number has 9. */
export function hasThaiPhoneLength(digits: string): boolean {
	return /^0[689]\d{8}$/u.test(digits) || /^0[1-57]\d{7}$/u.test(digits);
}

const ADMINISTRATIVE = {
	SUBDISTRICT: "subdistrict",
	DISTRICT: "district",
	PROVINCE: "province",
	POSTCODE: "zipcode",
} as const satisfies Partial<Record<OutputLabel, keyof LocationTuple>>;

type AdministrativeField = (typeof ADMINISTRATIVE)[keyof typeof ADMINISTRATIVE];

interface Gazetteer {
	/**
	 * Distinct district, province and postcode routes per projection onto a set
	 * of fields, keyed by field list then values. An open subdistrict alone is
	 * not ambiguous, because the route still delivers.
	 */
	readonly routesPer: Map<string, Set<string>>;
	readonly placeNames: ReadonlySet<string>;
}

const gazetteers = new WeakMap<ReadonlyMap<string, LocationTuple>, Gazetteer>();
const FIELD_SETS = Array.from({ length: 15 }, (_, mask) =>
	Object.values(ADMINISTRATIVE).filter((_, bit) => ((mask + 1) >> bit) & 1),
);

function projection(location: LocationTuple, fields: readonly AdministrativeField[]): string {
	return `${fields.join(",")}=${fields.map((field) => location[field]).join("|")}`;
}

function gazetteerOf(locations: ReadonlyMap<string, LocationTuple>): Gazetteer {
	const cached = gazetteers.get(locations);
	if (cached) return cached;
	const routesPer = new Map<string, Set<string>>();
	const placeNames = new Set(["กทม", "บางกอก", "bkk", "bangkok", "โคราช"]);
	for (const location of locations.values()) {
		for (const fields of FIELD_SETS) {
			const key = projection(location, fields);
			const routes = routesPer.get(key) ?? new Set<string>();
			routes.add(`${location.district}|${location.province}|${location.zipcode}`);
			routesPer.set(key, routes);
		}
		placeNames.add(location.province);
		placeNames.add(location.district);
	}
	const gazetteer = { routesPer, placeNames };
	gazetteers.set(locations, gazetteer);
	return gazetteer;
}

interface RecipientGold {
	readonly location: LocationTuple;
	readonly spans: readonly DatasetSpan[];
}

/**
 * When each warning is expected, from the marks alone. `warn:` must list
 * exactly these, so the checker tells a writer what to add.
 */
const EXPECTED_WARNINGS: Record<ParseWarning, (recipients: readonly RecipientGold[], gazetteer: Gazetteer) => boolean> = {
	"ambiguous-location": (recipients, gazetteer) =>
		recipients.some(({ location, spans }) => {
			const written = Object.entries(ADMINISTRATIVE)
				.filter(([label]) => spans.some((span) => span.label === label))
				.map(([, field]) => field);
			// Matches the parser: a postcode alone fills and flags nothing.
			return written.some((field) => field !== "zipcode") && gazetteer.routesPer.get(projection(location, written))!.size > 1;
		}),
	"phone-length": (recipients) =>
		recipients.some(({ spans }) => spans.some((span) => span.label === "PHONE" && !hasThaiPhoneLength(span.canonical!))),
	"multiple-recipients": (recipients) => recipients.length > 1,
};

export const WARNINGS = Object.keys(EXPECTED_WARNINGS) as ParseWarning[];

const CONTACT_HANDLE = /^\s*(?:line\b|ไลน์|ig\b|fb\b|facebook\b|เฟส(?![\s\d]*\d)|id\s*(?:line|ไลน์)|@)/iu;

/** The bare place name a bracket holds: no dots, spaces, or prefix. */
export function bracketPlace(inner: string): string {
	return inner.replace(/[.\s]/gu, "").toLowerCase().replace(/^(?:จังหวัด|อำเภอ|เขต|จ|อ)/u, "");
}

/** GUIDE v2: a bracket after a name that holds either kind is not part of `N`. */
export function nameBracketKind(
	inner: string,
	locations: ReadonlyMap<string, LocationTuple>,
): "contact-handle" | "place-name" | null {
	if (CONTACT_HANDLE.test(inner)) return "contact-handle";
	const { placeNames } = gazetteerOf(locations);
	const bare = inner.replace(/[.\s]/gu, "").toLowerCase();
	return placeNames.has(bare) || placeNames.has(bracketPlace(inner)) ? "place-name" : null;
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

/**
 * Bench files written later as `<category>.v<N>.txt` are sealed holdouts, one
 * set per N. They are never trained on, and their failures are never written.
 */
export const HOLDOUT_FILE = /\.v\d+\.txt$/u;

export function holdoutOf(id: string): string | null {
	return /\.(v\d+)-\d+$/u.exec(id)?.[1] ?? null;
}

export function isHoldout(record: { readonly id: string }): boolean {
	return holdoutOf(record.id) !== null;
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

interface Header {
	/** One per delivery, in written order. */
	readonly locations: readonly LocationTuple[];
	readonly tags: readonly string[];
	readonly warnings: readonly ParseWarning[];
}

function headerOf(lines: readonly string[], options: ParseOptions, fail: (message: string) => void): Header | null {
	const seen = new Set<string>();
	const numbered = new Map<number, LocationTuple>();
	let single: LocationTuple | undefined;
	let tags: string[] = [];
	let warnings: ParseWarning[] = [];
	let valid = true;
	const reject = (message: string): void => {
		fail(message);
		valid = false;
	};
	for (const line of lines) {
		if (line.trim() === "") continue;
		const match = /^(loc(\d*)|tags|warn):(.*)$/u.exec(line);
		if (!match) {
			reject(`unknown header line: ${line}`);
			continue;
		}
		const [, key, number, value] = match as unknown as [string, string, string, string];
		if (seen.has(key)) {
			reject(`repeated ${key}: header`);
			continue;
		}
		seen.add(key);
		if (key === "tags") {
			tags = value.split(",").map((tag) => tag.trim()).filter(Boolean);
			continue;
		}
		if (key === "warn") {
			const values = value.split(",").map((warning) => warning.trim()).filter(Boolean);
			for (const warning of values) {
				if (!(WARNINGS as string[]).includes(warning)) reject(`unknown warning ${warning}. Use ${WARNINGS.join(", ")}`);
			}
			if (new Set(values).size !== values.length) reject("warn: lists a warning twice");
			warnings = WARNINGS.filter((warning) => values.includes(warning));
			continue;
		}
		if (number !== "" && !/^[1-9]\d*$/u.test(number)) {
			reject(`${key}: is not loc: or loc1:, loc2:, ...`);
			continue;
		}
		const tupleKey = value.split("|").map((part) => part.trim()).join("|");
		const location = options.locations.get(tupleKey);
		if (!location) reject(`${key} is not a gazetteer tuple: ${tupleKey}`);
		else if (poolOf(location) !== options.pool) reject(`${key} belongs to the ${poolOf(location)} pool, not ${options.pool}: ${tupleKey}`);
		else if (number === "") single = location;
		else numbered.set(Number(number), location);
	}
	if (!valid) return null;
	if (single && numbered.size > 0) reject("use either loc: or loc1:, loc2:, ..., not both");
	else if (numbered.size === 1) reject("one delivery uses loc:, not loc1:");
	else if (!single && numbered.size === 0) reject("record has no loc: line");
	else {
		for (let index = 1; index <= numbered.size; index += 1) {
			if (!numbered.has(index)) reject(`loc${index}: is missing`);
		}
	}
	if (!valid) return null;
	const locations = single ? [single] : Array.from({ length: numbered.size }, (_, index) => numbered.get(index + 1)!);
	return { locations, tags, warnings };
}

function expectedOf(spans: readonly DatasetSpan[]): ExpectedAddress {
	const find = (label: OutputLabel): string | null => spans.find((span) => span.label === label)?.canonical ?? null;
	const address = spans.filter((span) => span.label === "ADDRESS_DETAIL").map((span) => span.text).join(" ");
	return {
		name: find("NAME"),
		phone: find("PHONE"),
		address: address ? normalizeCandidate("ADDRESS_DETAIL", address) : null,
		subdistrict: find("SUBDISTRICT"),
		district: find("DISTRICT"),
		province: find("PROVINCE"),
		zipcode: find("POSTCODE"),
	};
}

export function parseSource(
	text: string,
	options: ParseOptions,
): { records: ChatRecord[]; issues: SourceIssue[] } {
	const { file } = options;
	const gazetteer = gazetteerOf(options.locations);
	const issues: SourceIssue[] = [];
	const records: ChatRecord[] = [];
	const seen = new Set<string>();
	for (const block of blocksOf(text, file, issues)) {
		const fail = (message: string): void => {
			issues.push({ file, line: block.line, message });
		};
		const before = issues.length;
		const header = headerOf(block.header, options, fail);
		if (!header) continue;
		const { tags } = header;

		let raw = "";
		const spans: DatasetSpan[] = [];
		const notes: NoteSpan[] = [];
		const byRecipient: DatasetSpan[][] = header.locations.map(() => []);
		const pattern = /\[\[([A-Z])(\d*):([\s\S]*?)\]\]/gu;
		let cursor = 0;
		for (const match of block.body.matchAll(pattern)) {
			raw += block.body.slice(cursor, match.index);
			cursor = match.index + match[0].length;
			const mark = match[1] as Mark;
			const number = match[2]!;
			const spanText = match[3]!;
			if ((match[1] as string) === "R") {
				const start = raw.length;
				raw += spanText;
				if (number !== "" && (number === "1" || !/^[1-9]\d*$/u.test(number) || Number(number) > header.locations.length)) {
					fail(number === "1" ? "write R, not R1, for the first recipient" : `R${number} mark has no loc${number}: header`);
					continue;
				}
				if (spanText.trim() !== spanText || spanText === "") fail(`R span is empty or has edge whitespace: "${spanText}"`);
				if (spanText.includes("\n")) fail("R span crosses a line break");
				if (spanText.includes("[[")) fail("R span covers another mark");
				if (NOTE_EDGE.test(spanText)) fail(`R span "${spanText}" keeps a particle at its edge. Leave it outside`);
				notes.push({ text: spanText, start, end: raw.length, recipient: number === "" ? 0 : Number(number) - 1 });
				continue;
			}
			const label = MARKS[mark];
			if (!label) {
				fail(`unknown mark ${match[1]}`);
				continue;
			}
			const start = raw.length;
			raw += spanText;
			if (number !== "" && (number === "1" || !/^[1-9]\d*$/u.test(number) || Number(number) > header.locations.length)) {
				fail(number === "1" ? `write ${mark}, not ${mark}1, for the first recipient` : `${mark}${number} mark has no loc${number}: header`);
				continue;
			}
			const recipient = number === "" ? 0 : Number(number) - 1;
			const location = header.locations[recipient]!;
			const own = byRecipient[recipient]!;
			if (spanText.trim() !== spanText || spanText === "") fail(`${mark} span is empty or has edge whitespace: "${spanText}"`);
			if (label !== "ADDRESS_DETAIL" && spanText.includes("\n")) fail(`${mark} span crosses a line break`);
			if (label !== "ADDRESS_DETAIL" && own.some((span) => span.label === label)) fail(`more than one ${mark}${number} span`);
			let canonical: string | null = normalizeCandidate(label, spanText);
			if (label === "PHONE") {
				canonical = goldPhone(spanText);
				if (canonical === null) fail(`P span is not a Thai phone number of 9 to 12 digits: "${spanText}"`);
			}
			if (label === "POSTCODE") {
				if (normalizePostcode(spanText) !== location.zipcode) fail(`Z span "${spanText}" is not the loc postcode ${location.zipcode}`);
			}
			if (label === "NAME") {
				for (const bracket of spanText.matchAll(/\(([^()]*)\)/gu)) {
					const kind = nameBracketKind(bracket[1]!, options.locations);
					if (kind) fail(`${mark}${number} holds a ${kind} bracket. Move it out of the name`);
				}
				if (spanText.startsWith("เล่น") && /ชื่อ\s*$/u.test(raw.slice(0, start))) fail(`${mark}${number} starts with เล่น of the label ชื่อเล่น. Keep the label outside`);
			}
			for (const [administrative, field] of Object.entries(ADMINISTRATIVE)) {
				if (label !== administrative || field === "zipcode") continue;
				canonical = location[field];
				if (!tags.includes("alias") && !resemblesName(spanText, canonical)) {
					fail(`${mark} span "${spanText}" does not resemble ${canonical}. Fix the mark, or add the tag alias if it is a nickname or romanized form`);
				}
			}
			const span: DatasetSpan = {
				label,
				text: spanText,
				canonical,
				start,
				end: raw.length,
				codePointStart: Array.from(raw.slice(0, start)).length,
				codePointEnd: Array.from(raw).length,
			};
			spans.push(span);
			own.push(span);
		}
		raw += block.body.slice(cursor);
		if (raw.includes("[[") || raw.includes("]]")) fail("message still contains [[ or ]] after removing marks");
		if (raw.trim() === "") fail("message is empty");
		if (raw.length > 700) fail(`message is ${raw.length} characters, over the 700 limit`);
		if (spans.length === 0) fail("message has no marked span");
		byRecipient.forEach((own, index) => {
			if (index > 0 && own.length === 0) fail(`loc${index + 1}: has no marked span`);
		});
		if (seen.has(raw)) fail("duplicate message in this file");
		seen.add(raw);
		if (issues.length > before) continue;

		const gold = byRecipient.map((own, index) => ({ location: header.locations[index]!, spans: own }));
		const warnings = WARNINGS.filter((warning) => EXPECTED_WARNINGS[warning](gold, gazetteer));
		if (warnings.join(",") !== header.warnings.join(",")) {
			issues.push({
				file,
				line: block.line,
				message: `warn: must be "${warnings.join(", ")}" for these marks, not "${header.warnings.join(", ")}"`,
				warnings,
			});
			continue;
		}
		const recipients = byRecipient.map(expectedOf);
		records.push({
			id: `${options.idPrefix}-${String(records.length + 1).padStart(4, "0")}`,
			raw,
			caseType: options.category,
			difficulty: "chat",
			spans,
			expected: recipients[0]!,
			normalizationExpected: recipients[0]!,
			seedLocation: header.locations[0]!,
			partition: { profile: options.idPrefix },
			tags,
			sourceLine: block.line,
			warnings,
			recipients,
			notes,
		});
	}
	return { records, issues };
}
