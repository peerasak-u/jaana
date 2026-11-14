import { nextTo } from "../src/tagger/compose";
import type { DatasetRecord } from "./dataset";

export interface Range {
	readonly start: number;
	readonly end: number;
}

/** Character ranges a gold record re-tags for the Tagger's internal ORG label. */
export interface RecipientRelabel {
	readonly org: readonly Range[];
	readonly other: readonly Range[];
}

/**
 * Words that open an organisation name. Taken from the gold names of the
 * chat training pool: each opens many names and also opens address pieces
 * of records that name a person elsewhere. Place words that are never a
 * recipient (หอพัก, คอนโด, ตลาด, หมู่บ้าน) are left out on purpose.
 */
export const ORG_CUES = [
	"บริษัท", "บจก", "หจก", "ห้างหุ้นส่วน", "ร้าน", "สำนักงาน", "สำนัก", "โรงเรียน", "รร.",
	"โรงพยาบาล", "รพ.", "คลินิก", "อบต", "อบจ", "องค์การ", "เทศบาล", "ที่ว่าการ", "ศาล", "ศูนย์",
	"วัด", "มัสยิด", "โบสถ์", "สภ.", "สถานี", "สถาบัน", "มหาวิทยาลัย", "วิทยาลัย", "โรงงาน", "โรงสี",
	"สหกรณ์", "มูลนิธิ", "สมาคม", "ชมรม", "สโมสร", "กลุ่ม", "กองร้อย", "กองพัน", "กองบิน", "กองทุน",
	"กองคลัง", "กองช่าง", "ร้อย.", "ค่าย", "ฟาร์ม", "อู่", "ธนาคาร", "ไปรษณีย์", "การไฟฟ้า", "การประปา",
	"ห้าง", "แพปลา", "ล้ง", "กรม", "สสจ",
] as const;

const PERSON_CUES = [
	"คุณ", "K.", "K ", "Khun", "Mr", "Ms", "Mrs", "Miss", "attn", "Attn", "ATTN", "ติดต่อ", "นาย", "นาง",
	"น.ส.", "นส.", "ครู", "ดร.", "ผอ.", "ภก.", "ภญ.", "ทพ.", "ทพญ.", "นพ.", "พญ.", "พี่", "น้อง", "ป้า",
	"ลุง", "น้า", "ยาย", "แม่", "พ่อ", "เจ๊", "เฮีย", "โก", "เถ้าแก่", "ช่าง", "หมอ", "พระ", "หลวง",
	"ผู้จัดการ", "จ.ส.", "ส.อ.", "ส.ต.", "ร.ต.", "พ.ต.", "ด.ต.",
] as const;

const ENGLISH_ORG = /\b(?:Co\.?,?\s*Ltd|Ltd|Company|Limited|Shop|Clinic|Studio|Bakery|Farm|Cafe|Coffee|Online|Supply|Hotel|Resort|Store|Trading|Logistics|School|Hospital)\b/u;

/** Words that start the location part of an address piece after an organisation. */
const ADDRESS_START = /^(?:[0-9๐-๙]|บ้านเลขที่|เลขที่|เลข|ม\.|ม\s?[0-9๐-๙]|หมู่|หอพัก|ซ\.|ซอย|ถ\.|ถนน|อาคาร|ตึก|ชั้น|ห้อง|ตรงข้าม|ใกล้|หลัง|ข้าง|ติด|ภายใน|ใน|หน้า|ตู้|ตำบล|ต\.|อ\.|อำเภอ|แขวง|เขต|จ\.|จังหวัด|นิคม|หมู่บ้าน|มบ\.|Room|Floor|Fl\.|Bldg|Building|No\.|Moo|Soi|Rd|Road)/u;

const SEPARATOR = /[\s(/]/u;

function atBoundary(text: string, index: number): boolean {
	return index === 0 || SEPARATOR.test(text[index - 1]!);
}

function startsWithAny(text: string, index: number, words: readonly string[]): boolean {
	return words.some((word) => text.startsWith(word, index));
}

function orgCueAt(text: string, index: number): boolean {
	return atBoundary(text, index) && startsWithAny(text, index, ORG_CUES);
}

/** Index of the first organisation cue at a word boundary, or -1. */
function firstOrgCue(text: string): number {
	if (/^[A-Za-z]/u.test(text) && ENGLISH_ORG.test(text)) return 0;
	for (let index = 0; index < text.length; index += 1) if (orgCueAt(text, index)) return index;
	return ENGLISH_ORG.test(text) ? 0 : -1;
}

function hasPersonCue(text: string): boolean {
	for (let index = 0; index < text.length; index += 1) {
		if (atBoundary(text, index) && startsWithAny(text, index, PERSON_CUES)) return true;
	}
	return false;
}

/**
 * Where the person part of a name that opens with an organisation starts:
 * a bracket group or slash part that names a person, or a person cue after
 * a space. Returns -1 when the whole name is the organisation.
 */
function personStart(text: string, from: number): number {
	for (let index = from; index < text.length; index += 1) {
		const character = text[index]!;
		if (character === "(") {
			const close = text.indexOf(")", index);
			const inner = text.slice(index + 1, close < 0 ? text.length : close);
			if (hasPersonCue(inner)) return index;
			if (close > index) index = close;
			continue;
		}
		if (character === "/") return index;
		if (/\s/u.test(character) && startsWithAny(text, index + 1, PERSON_CUES)) return index;
	}
	return -1;
}

function trimRange(raw: string, start: number, end: number): Range {
	while (start < end && /[\s/]/u.test(raw[start]!)) start += 1;
	while (end > start && /[\s/]/u.test(raw[end - 1]!)) end -= 1;
	return { start, end };
}

/** Splits a gold name into its organisation and person parts, either possibly empty. */
export function splitName(text: string): { org: Range | null; person: Range | null } {
	const cue = firstOrgCue(text);
	if (cue < 0) return { org: null, person: { start: 0, end: text.length } };
	if (cue === 0) {
		const split = personStart(text, 1);
		if (split < 0) return { org: { start: 0, end: text.length }, person: null };
		return { org: trimRange(text, 0, split), person: trimRange(text, split, text.length) };
	}
	const open = text[cue - 1] === "(" ? cue - 1 : cue;
	return { org: trimRange(text, open, text.length), person: trimRange(text, 0, open) };
}

/** Length of the organisation that opens an address piece, or 0 when none does. */
export function leadingOrgLength(text: string): number {
	if (!orgCueAt(text, 0)) return 0;
	let end = text.length;
	for (let index = 1; index < text.length; index += 1) {
		const character = text[index]!;
		if (character === "\n" || character === ",") {
			end = index;
			break;
		}
		const previous = text[index - 1]!;
		const tokenStart = /\s/u.test(previous);
		if (/[0-9๐-๙]/u.test(character) && (tokenStart || /[฀-๿]/u.test(previous))) {
			end = index;
			break;
		}
		if (/^ม\.\s?[0-9๐-๙]/u.test(text.slice(index))) {
			end = index;
			break;
		}
		if (character === "(" && ADDRESS_START.test(text.slice(index + 1))) {
			end = index;
			break;
		}
		if (tokenStart && ADDRESS_START.test(text.slice(index))) {
			end = index;
			break;
		}
	}
	return trimRange(text, 0, end).end;
}

function shift(range: Range, by: number): Range {
	return { start: range.start + by, end: range.end + by };
}

/**
 * The ORG re-tagging of one gold record, derived from its spans so the
 * composition rule in `src/tagger/compose.ts` maps the derived tags back
 * to the same name and address. A name's organisation part is ORG and the
 * separator before its person part is OTHER. An organisation that opens an
 * address piece is ORG only when the name holds a person, because with no
 * person the composition would promote it to the name, and only when it
 * is written apart from the name, because next to it the composition
 * would join the two.
 */
export function recipientRelabel(record: Pick<DatasetRecord, "raw" | "spans">): RecipientRelabel {
	const spans = record.spans;
	const org: Range[] = [];
	const other: Range[] = [];
	const name = spans.find((span) => span.label === "NAME");
	let person = false;
	if (name) {
		const parts = splitName(name.text);
		if (parts.org) org.push(shift(parts.org, name.start));
		if (parts.person) person = true;
		if (parts.org && parts.person) {
			const [left, right] = parts.org.start < parts.person.start
				? [parts.org, parts.person]
				: [parts.person, parts.org];
			if (right.start > left.end) other.push(shift({ start: left.end, end: right.start }, name.start));
		}
	}
	if (name && person) {
		for (const span of spans) {
			if (span.label !== "ADDRESS_DETAIL") continue;
			const length = leadingOrgLength(span.text);
			const range = { start: span.start, end: span.start + length };
			if (length > 0 && !nextTo(record.raw, name, range)) org.push(range);
		}
	}
	return { org, other };
}
