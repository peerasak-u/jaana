import type { LocationTuple } from "../types";
import type { Range } from "./mention";
import type { ParseWarning, TaggedAddress } from "./parser";
import { PROVINCE_ALIASES } from "./resolve";

type Kind = "subdistrict" | "district" | "province" | "zipcode";

interface Mention extends Range {
	readonly kind: Kind;
	/** The written name after the prefix, for a subdistrict or district, or the postcode. */
	readonly name?: string;
}

/** One delivery's administrative mentions: written close together, each field once. */
interface Cluster extends Range {
	readonly names: Map<Kind, string | undefined>;
}

/**
 * A prefix and the name after it, which runs to the next prefix, digit, or
 * separator. `ต.` and `อ.` inside a rank such as `ร.ต.อ.`, or the month
 * `ต.ค.`, are no prefix.
 */
const NAME = String.raw`[ \t:]*(?<name>(?:(?!ต\.|ตำบล|แขวง|อ\.|อำเภอ|จ\.|จังหวัด)[^\s\d,/:()])*)`;
const SUBDISTRICT = new RegExp(String.raw`(?:ตำบล|แขวง|(?<![^\s\d]\.)ต\.(?!ค\.))${NAME}`, "gu");
const DISTRICT = new RegExp(String.raw`(?:อำเภอ|เขต|(?<![^\s\d]\.)อ\.)${NAME}`, "gu");
/** `ต` and `อ` written without their dots, as `ตหาดแพง อศรีสงคาม`; trusted only as a pair the gazetteer knows, the district by its first letters to allow a typo. */
const BARE_PAIR = /(?<![ก-๎])ต(?<subdistrict>[ก-๎]{2,})[ \t]*อ(?<district>[ก-๎]{2,})/gu;
const DIGIT_RUN = /[0-9๐-๙]+/gu;
/**
 * Two words written without prefixes, as `ปากตม เชียงคาน` or `สวนใหญ่ 11000`;
 * trusted only when the gazetteer writes the second right after the first.
 */
const BARE_WORDS = /(?<![ก-ฺเ-๎])(?<first>[ก-ฺเ-๎]{3,})(?=[ \t]+(?<second>[ก-ฺเ-๎]+|[0-9๐-๙]{5}(?![0-9๐-๙])))/gu;
/** A phone whose digits hold a run that reads as a postcode, as `+66 81 703 44190`. */
const PHONE_DIGITS = /(?<![0-9])(?:\+66[ \t-]?|0)[0-9](?:[ \t-]?[0-9]){7,9}(?![0-9])/gu;
const THAI_LETTER = /[ก-ฺเ-๎]/u;
/** Long enough to tell a written place name from a person's name after the teacher's `อ.`. */
const NAME_START = 4;
/** Farther apart than this, two mentions belong to different deliveries. */
const MAX_CLUSTER_GAP = 40;
/** A mention the shopper takes back, as `ไม่ใช่ อ.เมือง` or `ไม่ใช่ 33000`. */
const DENIED = /ไม่ใช่[ \t]*$/u;
/** A line that gives an address no parcel goes to: an old one, one for the bill or tax invoice, or the sender's own for a return. */
const NOT_DELIVERED = /ใบกำกับ|ใบเสร็จ|บิล|ภ\.?พ\.?[ \t]*20|เลขผู้เสียภาษี|เลขประจำตัวผู้เสียภาษี|เก่า|ไม่ใช้แล้ว|ไม่ได้อยู่|ไม่มีคนอยู่|ผู้ส่ง|ตีกลับ|ส่งคืน|^[ \t]*(?:จาก|[Ff]rom)[ \t]*:/u;

/** A numbered or bulleted list item, or an order number such as `#2` or `#A1030 ➡️`, at a line start. */
const LIST_ITEM = String.raw`(?<=^|\n)[ \t]*(?:\(?\d{1,2}(?:\.(?!\d)|\)|/(?=[ \t]))|[กขคง]\.(?=[ \t])|[A-D]\)|[①-⑩]|[-•*★☆✅]|🔸|🔹|#[A-Za-z]{0,3}\d{1,7}(?![\d/])(?:[ \t]*(?:➡️|➡|→|->|=>|:))?)`;
/** Words that open the next delivery, as `ที่ 2`, `ส่วนอีกที่`, `ลังสอง`. */
const PHRASE = [
	String.raw`(?:คนที่|ผู้รับคนที่|ออเดอร์ที่|ออเดอร์|ที่อยู่(?:ที่)?|(?<!หมู่|ซอย|ซ\.|เลข)ที่|เซ[ตท]|ชุดที่|กล่องที่|ล็อต)[ \t]*\d(?![\d/])`,
	String.raw`(?:ส่วน)?อีก(?:ที่|อัน|กล่อง|ขวด|ชุด|ออเดอร์|คน|เซ[ตท]|ล็อต|ลัง)(?:นึง|หนึ่ง)?|ส่วนอีก`,
	String.raw`(?:คนที่|คน|ที่|อัน|กล่อง|ขวด|ชุด|ล็อต|ลัง|เซ[ตท])(?:แรก|สอง|สาม)`,
	// Drop-off points, branches, and children are named mid-line too, as `ห้างเอ สาขา 2`, so only a line start opens one.
	String.raw`(?<=^|\n)[ \t]*(?:(?:จุดส่ง|จุด|สาขา)(?:ที่)?[ \t]*\d(?![\d/])|จุด(?:แรก|สอง|สาม)|คน(?:โต|กลาง|เล็ก))`,
	// A parcel counted at a line start, as `ลัง2`, `ชิ้นแรก`, `ชิ้นที่สอง`; mid-line it is a quantity, as `ส่ง 2 ลัง`.
	String.raw`(?<=^|\n)[ \t]*(?:ลัง|กล่อง|ชิ้น|ห่อ|ถุง|แพ็[คก]|ผืน|ขวด|ชุด|พัสดุ|ของ)(?:ที่)?[ \t]*(?:\d(?![\d/])|แรก|สอง|สาม)`,
].join("|");
const ITEM_LINE = new RegExp(String.raw`(?<marker>${LIST_ITEM})[^\n]*`, "gu");
const OPENER = new RegExp(String.raw`(?:${LIST_ITEM}|${PHRASE})[ \t]*`, "gu");
const OPENING_PHRASE = new RegExp(PHRASE, "u");
/** Weaker joiners between two deliveries written on one line. */
const JOINER = /[ \t](?:\/[ \t]|(?:และ|กับ)(?:ส่ง)?(?:ที่(?![ \t]*\d)[ \t]*|[ \t]))/u;
const PHONE = /(?:\+66|0)[0-9๐-๙][0-9๐-๙ \-]{7,11}[0-9๐-๙]/u;
const PARTICLES = /^(?:นะ|ค่ะ|คะ|ครับ|จ้า|จ้ะ)*$/u;

/** Delivery blocks in written order. Text between two blocks, such as a list marker, belongs to neither. */
export type Splitter = (raw: string) => readonly Range[];

/**
 * Parses each delivery block on its own and joins the results, with span
 * offsets into the whole message. One block is the whole message.
 */
export function parseDeliveries(
	raw: string,
	blocks: readonly Range[],
	parse: (text: string) => TaggedAddress,
): TaggedAddress {
	if (blocks.length === 1) return parse(raw);
	const parsed = blocks.map((block) => ({ block, result: parse(raw.slice(block.start, block.end)) }));
	const recipients = parsed.flatMap(({ result }) => result.recipients);
	const warnings = new Set<ParseWarning>(parsed.flatMap(({ result }) => result.warnings));
	warnings.add("multiple-recipients");
	return {
		raw,
		...recipients[0]!,
		spans: parsed.flatMap(({ block, result }) =>
			result.spans.map((span) => ({ ...span, start: span.start + block.start, end: span.end + block.start }))),
		warnings: [...warnings],
		recipients,
	};
}

/**
 * Cuts a message into delivery blocks before tagging. A message is several
 * deliveries only when it writes two clusters of administrative mentions,
 * each a postcode or at least two of subdistrict, district, and province;
 * a phone or a list marker alone never splits. Chatter before the first
 * delivery belongs to it.
 */
export function createSplitter(locations: readonly LocationTuple[]): Splitter {
	const zipcodes = new Set(locations.map((location) => location.zipcode));
	const starts = {
		subdistrict: new Set(locations.map((location) => location.subdistrict.slice(0, NAME_START))),
		district: new Set(locations.map((location) => location.district.slice(0, NAME_START))),
	};
	const pairs = new Set(locations.map((location) => `${location.subdistrict}|${location.district.slice(0, NAME_START)}`));
	const names = new Set([...locations.map((location) => location.province), ...[...PROVINCE_ALIASES.values()].flat()]);
	/**
	 * What the gazetteer writes after a bare subdistrict or district: its
	 * district (in full, or as `เมือง` and a province alias), its province or
	 * an alias, and its postcode.
	 */
	const next = new Map<string, { districts: Set<string>; provinces: Set<string>; zipcodes: Set<string> }>();
	const follow = (kind: "subdistrict" | "district", word: string) => {
		const key = `${kind}|${word}`;
		const entry = next.get(key) ?? { districts: new Set<string>(), provinces: new Set<string>(), zipcodes: new Set<string>() };
		next.set(key, entry);
		return entry;
	};
	for (const location of locations) {
		const aliases = PROVINCE_ALIASES.get(location.province) ?? [];
		for (const kind of ["subdistrict", "district"] as const) {
			const entry = follow(kind, location[kind]);
			for (const name of [location.province, ...aliases]) entry.provinces.add(name);
			entry.zipcodes.add(location.zipcode);
			if (kind === "subdistrict") {
				entry.districts.add(location.district);
				if (location.district.startsWith("เมือง")) for (const alias of aliases) entry.districts.add(`เมือง${alias}`);
			}
		}
	}
	const province = new RegExp(
		`(?:จังหวัด|จ\\.)[ \\t]*(?:${[...names].sort((left, right) => right.length - left.length).map(escape).join("|")})?|${[...names].map(escape).join("|")}`,
		"gu",
	);

	function mentions(raw: string): Mention[] {
		const found: Mention[] = [];
		for (const [pattern, kind] of [[SUBDISTRICT, "subdistrict"], [DISTRICT, "district"]] as const) {
			for (const match of raw.matchAll(pattern)) {
				const name = match.groups!.name!;
				// A prefix glued to a word, as in `ที่ว่าการอำเภอ` or `ผอ.`, opens a name only right after another mention.
				const glued = match.index > 0 && THAI_LETTER.test(raw[match.index - 1]!) &&
					!found.some((mention) => mention.end === match.index);
				if (glued || !starts[kind].has(name.slice(0, NAME_START))) continue;
				found.push({ kind, name, start: match.index, end: match.index + match[0].length });
			}
		}
		for (const match of raw.matchAll(BARE_PAIR)) {
			const subdistrict = match.groups!.subdistrict!;
			const district = match.groups!.district!;
			if (!pairs.has(`${subdistrict}|${district.slice(0, NAME_START)}`)) continue;
			const end = match.index + match[0].length;
			found.push({ kind: "subdistrict", name: subdistrict, start: match.index, end: match.index + 1 + subdistrict.length });
			found.push({ kind: "district", name: district, start: end - district.length - 1, end });
		}
		const bare: Mention[] = [];
		const covered = (start: number, end: number) => [...found, ...bare].some((mention) => mention.start < end && start < mention.end);
		for (const match of raw.matchAll(BARE_WORDS)) {
			const { first, second } = match.groups as { first: string; second: string };
			const start = match.index;
			const end = start + first.length;
			const secondStart = raw.indexOf(second, end);
			// A province, as `มหาชัย 74000`, also names a subdistrict of its capital; read it as the province.
			if (covered(start, end) || names.has(first)) continue;
			const postcode = /^[0-9๐-๙]/u.test(second) ? toAscii(second) : undefined;
			const [subdistrict, district] = [next.get(`subdistrict|${first}`), next.get(`district|${first}`)];
			const startsWith = (set: Set<string> | undefined) => [...set ?? []].find((name) => second.startsWith(name));
			const after = postcode ? undefined : startsWith(subdistrict?.districts);
			// Many places name a subdistrict and its district alike, so the word after decides: a district
			// follows a subdistrict, a province most often follows a district, and a postcode follows either.
			const [bySubdistrict, byDistrict] = postcode
				? [subdistrict?.zipcodes.has(postcode), district?.zipcodes.has(postcode)]
				: [Boolean(after ?? startsWith(subdistrict?.provinces)), Boolean(startsWith(district?.provinces))];
			const kind = after || (bySubdistrict && !byDistrict) ? "subdistrict"
				: byDistrict && !(postcode && bySubdistrict) ? "district" : undefined;
			if (!kind) continue;
			bare.push({ kind, name: first, start, end });
			if (after) bare.push({ kind: "district", name: after, start: secondStart, end: secondStart + after.length });
		}
		// A bare reading that disagrees with another on its line, with no postcode or phone between to end a delivery, is a road or shop name.
		const endsBetween = (from: number, to: number) => /(?<![0-9])[0-9]{5}(?![0-9])/u.test(raw.slice(from, to)) || PHONE.test(raw.slice(from, to));
		for (const mention of bare) {
			const disagrees = [...found, ...bare].some((other) => other !== mention && other.kind === mention.kind &&
				!sameName(other.name, mention.name) && !other.name?.startsWith(mention.name!) && !mention.name!.startsWith(other.name ?? "") &&
				!raw.slice(Math.min(other.end, mention.end), Math.max(other.start, mention.start)).includes("\n") &&
				!endsBetween(Math.min(other.end, mention.end), Math.max(other.start, mention.start)));
			if (!disagrees) found.push(mention);
		}
		const named = [...found];
		for (const match of raw.matchAll(province)) {
			const end = match.index + match[0].length;
			if (!named.some((mention) => mention.start < end && match.index < mention.end)) {
				found.push({ kind: "province", start: match.index, end });
			}
		}
		const phones = [...raw.matchAll(PHONE_DIGITS)].map((match) => ({ start: match.index, end: match.index + match[0].length }));
		for (const match of raw.matchAll(DIGIT_RUN)) {
			if (phones.some((phone) => phone.start <= match.index && match.index < phone.end)) continue;
			const digits = toAscii(match[0]);
			// A postcode glued to the phone after it, as `841600897723165`.
			const glued = digits.length >= 14 && digits[5] === "0";
			if ((digits.length === 5 || glued) && zipcodes.has(digits.slice(0, 5))) {
				found.push({ kind: "zipcode", name: digits.slice(0, 5), start: match.index, end: match.index + 5 });
			}
		}
		return found
			.filter((mention) => !DENIED.test(raw.slice(Math.max(0, mention.start - 12), mention.start)))
			.sort((left, right) => left.start - right.start);
	}

	/**
	 * Clusters with a postcode or at least two fields, without the ones on a
	 * line that says nothing goes there, which are returned as `unsent` lines.
	 * Neighbours that write the same subdistrict, district, or postcode, or
	 * that complete each other, are one delivery.
	 */
	function clusters(raw: string): { found: Cluster[]; unsent: Range[] } {
		const groups: { start: number; end: number; names: Map<Kind, string | undefined> }[] = [];
		for (const mention of mentions(raw)) {
			const group = groups[groups.length - 1];
			const repeated = group?.names.has(mention.kind) && mention.kind !== "province" &&
				!sameName(group.names.get(mention.kind), mention.name);
			const between = group ? raw.slice(group.end, mention.start) : "";
			// A postcode usually ends a delivery, so a new line or a phone after it starts the next one.
			const opens = OPENING_PHRASE.test(between) ||
				(group?.names.has("zipcode") && (between.includes("\n") || PHONE.test(between)));
			if (group && mention.start - group.end <= MAX_CLUSTER_GAP && !repeated && !opens) {
				group.end = Math.max(group.end, mention.end);
				group.names.set(mention.kind, mention.name);
			} else groups.push({ start: mention.start, end: mention.end, names: new Map([[mention.kind, mention.name]]) });
		}
		const unsent: Range[] = [];
		const kept = groups.filter((group) => {
			if (group.names.size < 2 && !group.names.has("zipcode")) return false;
			const line = { start: lineStart(raw, group.start), end: lineEnd(raw, group.end) };
			if (!NOT_DELIVERED.test(raw.slice(line.start, line.end))) return true;
			unsent.push({ start: line.start, end: Math.min(raw.length, line.end + 1) });
			return false;
		});
		const merged: Cluster[] = [];
		for (const group of kept) {
			const last = merged[merged.length - 1];
			const between = last ? raw.slice(last.end, group.start) : "";
			// A bare postcode is one the shopper forgot to write with the rest, as `รหัส 48150 ค่ะ ลืม`.
			const bare = [last, group].some((cluster) => cluster?.names.size === 1);
			const completes = (bare || (!PHONE.test(between) && !OPENING_PHRASE.test(between))) &&
				[...group.names.keys()].every((kind) => kind === "province" || !last?.names.has(kind));
			if (last && ((sharesName(last, group) && !conflicts(last, group)) || completes)) {
				merged[merged.length - 1] = { start: last.start, end: group.end, names: new Map([...last.names, ...group.names]) };
			} else merged.push(group);
		}
		return { found: merged, unsent };
	}

	/**
	 * List items that each write a phone and an administrative mention, for a
	 * message whose deliveries are too sparse to cluster, as a second item with
	 * only a province. No single delivery of the train pool writes two.
	 */
	function items(raw: string): Range[] {
		const found = mentions(raw);
		return [...raw.matchAll(ITEM_LINE)]
			.map((match) => ({ start: match.index + match.groups!.marker!.length, end: match.index + match[0].length }))
			.filter((item) => PHONE.test(raw.slice(item.start, item.end)) &&
				found.some((mention) => item.start <= mention.start && mention.end <= item.end));
	}

	return (raw) => {
		const clustered = clusters(raw);
		let found: readonly Range[] = clustered.found;
		if (found.length < 2) found = items(raw);
		if (found.length < 2) return [{ start: 0, end: raw.length }];
		// A line giving the bill's or an old address, between or around deliveries, belongs to none of them.
		const unsentIn = (from: number, to: number) => clustered.unsent.filter((line) => from <= line.start && line.end <= to);
		const blocks: Range[] = [];
		let start = firstStart(raw, Math.max(0, ...unsentIn(0, found[0]!.start).map((line) => line.end)), found[0]!.start);
		for (let index = 1; index < found.length; index += 1) {
			const [after, before] = [found[index - 1]!.end, found[index]!.start];
			const cut = cutBetween(raw, start, after, before);
			const unsent = unsentIn(after, before);
			blocks.push({ start, end: Math.min(cut.end, ...unsent.map((line) => line.start)) });
			start = Math.max(cut.start, ...unsent.map((line) => line.end));
		}
		blocks.push({ start, end: Math.min(raw.length, ...unsentIn(found[found.length - 1]!.end, raw.length).map((line) => line.start)) });
		return blocks;
	};
}

function toAscii(digits: string): string {
	return digits.replace(/[๐-๙]/gu, (digit) => String("๐๑๒๓๔๕๖๗๘๙".indexOf(digit)));
}

function escape(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function lineStart(raw: string, index: number): number {
	return raw.lastIndexOf("\n", index - 1) + 1;
}

function lineEnd(raw: string, index: number): number {
	const end = raw.indexOf("\n", index);
	return end < 0 ? raw.length : end;
}

/** Names written twice may differ by a particle glued to one, as `น้ำโสม` and `น้ำโสมนะคะ`. */
function sameName(left: string | undefined, right: string | undefined): boolean {
	if (left === undefined || right === undefined) return false;
	const [short, long] = left.length <= right.length ? [left, right] : [right, left];
	return long.startsWith(short) && PARTICLES.test(long.slice(short.length));
}

/** A bare `เมือง` names the capital district of any province, so it ties nothing together. */
function sharesName(left: Cluster, right: Cluster): boolean {
	return (["subdistrict", "district", "zipcode"] as const).some((kind) => left.names.get(kind) !== "เมือง" &&
		sameName(left.names.get(kind), right.names.get(kind)));
}

/** One delivery writes one subdistrict, district, and postcode, so two clusters that write different ones are two deliveries. */
function conflicts(left: Cluster, right: Cluster): boolean {
	return (["subdistrict", "district", "zipcode"] as const).some((kind) => {
		const [one, other] = [left.names.get(kind), right.names.get(kind)];
		return one !== undefined && other !== undefined && !one.startsWith(other) && !other.startsWith(one);
	});
}

/**
 * The first delivery starts at `from`, or after the opener that numbers it
 * when no phone is written between `from` and that opener.
 */
function firstStart(raw: string, from: number, before: number): number {
	let start = from;
	OPENER.lastIndex = from;
	for (let opener = OPENER.exec(raw); opener && opener.index < before; opener = OPENER.exec(raw)) {
		if (!PHONE.test(raw.slice(from, opener.index))) start = opener.index + opener[0].length;
	}
	return start;
}

/**
 * Where the delivery whose administrative mentions end at `after` stops and
 * the one whose mentions start at `before` begins: at an opener, which
 * belongs to neither when it opens its line or follows the previous
 * delivery on one line, else a blank line, else a line start, else a joiner
 * on the same line.
 */
function cutBetween(raw: string, blockStart: number, after: number, before: number): { end: number; start: number } {
	const at = (index: number) => ({ end: index, start: index });
	OPENER.lastIndex = after;
	const opener = OPENER.exec(raw);
	if (opener && opener.index < before) {
		const line = lineStart(raw, opener.index);
		const end = opener.index + opener[0].length;
		if (line <= after) return { end: opener.index, start: end };
		return /^[ \t]*$/u.test(raw.slice(line, opener.index)) ? { end: line, start: end } : at(line);
	}
	const gap = raw.slice(after, before);
	// A joiner on the line, as `... 10160 กับที่ออฟฟิศ ...`, belongs to neither delivery.
	const joiner = gap.includes("\n") ? null : JOINER.exec(gap);
	if (joiner) return { end: after + joiner.index, start: after + joiner.index + joiner[0].length };
	return at(cutWithoutOpener(raw, blockStart, after, before));
}

function cutWithoutOpener(raw: string, blockStart: number, after: number, before: number): number {
	const gap = raw.slice(after, before);
	const blank = /\n[ \t]*\n/u.exec(gap);
	if (blank) return after + blank.index + blank[0].length;
	const lines = [...gap.matchAll(/\n/gu)].map((match) => after + match.index + 1);
	if (lines.length > 0) {
		// The phone on the line after a delivery written without one is that delivery's phone.
		const phoneless = !PHONE.test(raw.slice(blockStart, lines[0]));
		return lines.length > 1 && phoneless && PHONE.test(raw.slice(lines[0], lines[1])) ? lines[1]! : lines[0]!;
	}
	const phone = PHONE.exec(gap);
	if (phone && !PHONE.test(raw.slice(blockStart, after))) return after + phone.index + phone[0].length;
	return after + (/^[^\s]*/u.exec(gap)?.[0].length ?? 0);
}
