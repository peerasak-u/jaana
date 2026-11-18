import { tidyNotes, type NoteRange } from "./trim";

/**
 * The delivery-note reader: a linear model over hashed character features
 * that runs after the field tagger. It sees the message and the field spans,
 * scores every character outside them as note or not, and a two-state
 * Viterbi pass turns the scores into runs. One int8 weight per bucket is the
 * note score; the not-note score is zero.
 */
export interface NoteModel {
	readonly kind: "notes";
	readonly version: string;
	readonly dimension: number;
	/** Base64 of one int8 per bucket. */
	readonly weights: string;
	/** [other→other, other→note, note→other, note→note]. */
	readonly transitions: readonly number[];
	/** Added to every note score; the decision threshold. */
	readonly bias: number;
	/** False keeps runs where the model ends them instead of growing them to whitespace. */
	readonly snap?: boolean;
}

export interface FieldSpan {
	readonly label: string;
	readonly start: number;
	readonly end: number;
}

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";

/** Cue words by kind of note, and the chat that is not one. A kind's bit is its index. */
const CUES: readonly (readonly string[])[] = [
	["ฝาก", "วาง", "ป้อม", "รปภ", "ยาม", "นิติ", "ตู้จดหมาย", "ตู้ไปรษณีย์", "หน้าบ้าน", "หน้าประตู", "หน้าห้อง",
		"เซ็น", "รับแทน", "แขวน", "ล็อบบี้", "lobby", "reception", "เคาน์เตอร์", "แม่บ้าน", "guard", "leave", "front"],
	["โทรก่อน", "โทรหา", "ถึงแล้วโทร", "ก่อนส่ง", "ช่วง", "เย็น", "เช้า", "บ่าย", "โมง", "วันเสาร์", "วันอาทิตย์",
		"ไม่อยู่", "ไม่ค่อยอยู่", "ไม่มีคน", "กริ่ง", "หมา", "call", "before", "after", "weekend", "ทำงาน"],
	["ตรงข้าม", "ใกล้", "ข้าง", "หลัง", "เยื้อง", "เลี้ยว", "ทางเข้า", "เข้าทาง", "ประตู", "รั้ว", "สีฟ้า", "สีเขียว",
		"สีขาว", "สีแดง", "หลังที่", "ซอยแรก", "สุดซอย", "ปากซอย", "หาไม่เจอ", "อยู่", "เซเว่น", "7-11", "ปั๊ม", "opposite", "near", "next to"],
	["ปลายทาง", "cod", "kerry", "เคอรี่", "flash", "แฟลช", "j&t", "เจแอนด์ที", "ems", "อีเอ็มเอส", "ไปรษณีย์",
		"ขนส่ง", "lalamove", "grab", "ด่วน", "พัสดุ"],
	["สั่ง", "เอา", "ไซส์", "size", "ตัว", "ชิ้น", "ขวด", "กล่อง", "แพ็ค", "บาท", "โอน", "สลิป", "ราคา", "ขอบคุณ",
		"สวัสดี", "ชื่อ", "เบอร์", "ที่อยู่", "ไลน์", "line", "ig", "ใบกำกับ", "ใบเสร็จ", "พรี", "cf", "จอง"],
];

function fold(character: string): string {
	if (THAI_DIGITS.includes(character) || /[0-9]/u.test(character)) return "0";
	return character.toLowerCase();
}

function bucket(key: string, dimension: number): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < key.length; index += 1) {
		hash ^= key.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0) % dimension;
}

const FIELD_CODE: Record<string, string> = {
	NAME: "n", PHONE: "p", ADDRESS_DETAIL: "a", SUBDISTRICT: "s", DISTRICT: "d", PROVINCE: "v", POSTCODE: "z",
};

/**
 * Hashed feature buckets per UTF-16 unit, and which units may be a note: a
 * unit inside a field span or a line break never is. Changing a key changes
 * the meaning of trained weights.
 */
export function noteFeatures(
	raw: string,
	spans: readonly FieldSpan[],
	dimension: number,
): { rows: Int32Array[]; free: Uint8Array } {
	const n = raw.length;
	const field = new Array<string>(n).fill("");
	for (const span of spans) for (let index = span.start; index < span.end; index += 1) field[index] = FIELD_CODE[span.label] ?? "x";
	const free = new Uint8Array(n);
	for (let index = 0; index < n; index += 1) free[index] = field[index] === "" && raw[index] !== "\n" ? 1 : 0;
	const folded = Array.from(raw, fold);
	// Field text reads as one placeholder, so the window sees the layout around a field, not its words.
	const view = folded.map((character, index) => (field[index] ? `<${field[index]}>` : character));
	const c = (index: number): string => (index < 0 || index >= n ? "^" : view[index]!);

	const lower = folded.join("");
	const inside = new Uint8Array(n);
	const starts = new Uint8Array(n);
	CUES.forEach((words, kind) => {
		const bit = 1 << kind;
		for (const word of words) {
			for (let at = lower.indexOf(word); at >= 0; at = lower.indexOf(word, at + 1)) {
				starts[at]! |= bit;
				for (let index = at; index < at + word.length; index += 1) inside[index]! |= bit;
			}
		}
	});

	// A segment is a stretch of free text on one line, between fields or line edges.
	const segmentStart = new Int32Array(n);
	const segmentEnd = new Int32Array(n);
	for (let index = 0; index < n; index += 1) {
		segmentStart[index] = index > 0 && free[index - 1] && free[index] ? segmentStart[index - 1]! : index;
	}
	for (let index = n - 1; index >= 0; index -= 1) {
		segmentEnd[index] = index < n - 1 && free[index + 1] && free[index] ? segmentEnd[index + 1]! : index;
	}
	const firstField = field.findIndex((value) => value !== "");
	let lastField = -1;
	for (let index = n - 1; index >= 0; index -= 1) {
		if (field[index]) {
			lastField = index;
			break;
		}
	}
	const lineOf = new Int32Array(n);
	const lineFields: string[] = [""];
	for (let index = 0, line = 0; index < n; index += 1) {
		lineOf[index] = line;
		const code = field[index]!;
		if (code && !lineFields[line]!.includes(code)) lineFields[line] = lineFields[line]! + code;
		if (raw[index] === "\n") {
			line += 1;
			lineFields.push("");
		}
	}
	const lineCount = lineFields.length;
	const segmentCues = new Map<number, number>();
	for (let index = 0; index < n; index += 1) {
		if (free[index]) segmentCues.set(segmentStart[index]!, (segmentCues.get(segmentStart[index]!) ?? 0) | inside[index]!);
	}
	const tokens: string[] = [];
	const tokenOf = new Int32Array(n).fill(-1);
	for (let index = 0; index < n; index += 1) {
		if (/\s/u.test(raw[index]!) || !free[index]) continue;
		if (index === 0 || /\s/u.test(raw[index - 1]!) || !free[index - 1]) tokens.push("");
		tokens[tokens.length - 1] += folded[index]!;
		tokenOf[index] = tokens.length - 1;
	}
	const token = (index: number): string => {
		const text = tokens[index];
		return text === undefined ? "^" : text.length > 12 ? text.slice(0, 12) : text;
	};

	const rows: Int32Array[] = [];
	let lastCue = 0;
	for (let i = 0; i < n; i += 1) {
		if (!free[i]) {
			rows.push(new Int32Array(0));
			lastCue = 0;
			continue;
		}
		const row: number[] = [bucket("b", dimension)];
		const add = (key: string): void => {
			row.push(bucket(key, dimension));
		};
		for (let o = -3; o <= 3; o += 1) add(`u${o}:${c(i + o)}`);
		for (let o = -4; o <= 3; o += 1) add(`b${o}:${c(i + o)}${c(i + o + 1)}`);
		for (let o = -4; o <= 2; o += 1) add(`t${o}:${c(i + o)}${c(i + o + 1)}${c(i + o + 2)}`);
		add(`q-:${c(i - 4)}${c(i - 3)}${c(i - 2)}${c(i - 1)}`);
		add(`q+:${c(i + 1)}${c(i + 2)}${c(i + 3)}${c(i + 4)}`);
		for (let o = 5; o <= 12; o += 1) {
			add(`L:${c(i - o)}${c(i - o + 1)}`);
			add(`R:${c(i + o - 1)}${c(i + o)}`);
		}
		const start = segmentStart[i]!;
		const end = segmentEnd[i]!;
		const left = start > 0 ? (field[start - 1] || (raw[start - 1] === "\n" ? "^" : "?")) : "^";
		const right = end < n - 1 ? (field[end + 1] || (raw[end + 1] === "\n" ? "$" : "?")) : "$";
		const length = end - start + 1;
		const sizeClass = length < 6 ? 0 : length < 15 ? 1 : length < 30 ? 2 : length < 60 ? 3 : 4;
		const place = firstField < 0 ? "o" : i < firstField ? "b" : i > lastField ? "a" : "m";
		const line = lineOf[i]!;
		const lineClass = `${line === 0 ? 1 : 0}${line === lineCount - 1 ? 1 : 0}`;
		const cuesHere = segmentCues.get(start) ?? 0;
		add(`sg:${left}${right}`);
		add(`sz:${sizeClass}:${left}${right}`);
		add(`sp:${Math.min(i - start, 8)}:${Math.min(end - i, 8)}`);
		add(`pl:${place}`);
		add(`pl2:${place}:${left}${right}`);
		add(`lf:${lineFields[line]}`);
		add(`lf2:${lineFields[line]!.length > 0 ? 1 : 0}:${lineClass}:${place}`);
		add(`sc:${cuesHere}`);
		add(`sc2:${cuesHere}:${place}`);
		add(`sc3:${cuesHere}:${left}${right}`);
		add(`ci:${inside[i]}`);
		add(`cs:${starts[i]}`);
		add(`cl:${lastCue}:${inside[i]}`);
		if (starts[i]) lastCue = starts[i]!;
		const t = tokenOf[i]!;
		if (t >= 0) {
			add(`w0:${token(t)}`);
			add(`w-:${token(t - 1)}`);
			add(`w+:${token(t + 1)}`);
			add(`w2:${token(t)}:${token(t + 1)}`);
		} else add(`sp:${raw[i] === " " ? "s" : raw[i]}`);
		rows.push(Int32Array.from(row));
		if (raw[i] === "\n") lastCue = 0;
	}
	return { rows, free };
}

/** Note scores per unit, the not-note score being zero. */
export function noteScores(rows: readonly Int32Array[], weights: Int8Array | Float64Array, bias: number): Float64Array {
	const scores = new Float64Array(rows.length);
	for (let index = 0; index < rows.length; index += 1) {
		let total = bias;
		for (const feature of rows[index]!) total += weights[feature]!;
		scores[index] = total;
	}
	return scores;
}

const BINDS_TO_PREVIOUS = /[ะ-ฺๅ็-๎]/u;
const BINDS_TO_NEXT = /[เ-ไ]/u;
const LATIN = /[A-Za-z]/u;

/** Whether a note may start at `index`, and end right before it: never inside a Thai cluster or a Latin word. */
export function noteBreaks(raw: string): Uint8Array {
	const breaks = new Uint8Array(raw.length + 1).fill(1);
	for (let index = 1; index < raw.length; index += 1) {
		const previous = raw[index - 1]!;
		const current = raw[index]!;
		if (BINDS_TO_PREVIOUS.test(current) || BINDS_TO_NEXT.test(previous) || (LATIN.test(previous) && LATIN.test(current))) breaks[index] = 0;
	}
	return breaks;
}

/**
 * Best note/not-note labelling. A unit that is not free is never a note, and
 * a note opens and closes only where `breaks` allows.
 */
export function decodeNotes(scores: Float64Array, free: Uint8Array, transitions: readonly number[], breaks?: Uint8Array): Uint8Array {
	const n = scores.length;
	const labels = new Uint8Array(n);
	if (n === 0) return labels;
	const at = (index: number): boolean => !breaks || breaks[index] === 1;
	const back = new Uint8Array(n * 2);
	let other = 0;
	let note = free[0] ? scores[0]! : -Infinity;
	for (let index = 1; index < n; index += 1) {
		const close = at(index) ? note + transitions[2]! : -Infinity;
		const keep = other + transitions[0]!;
		back[index * 2] = keep >= close ? 0 : 1;
		let nextNote = -Infinity;
		if (free[index]) {
			const stay = note + transitions[3]!;
			const open = at(index) ? other + transitions[1]! : -Infinity;
			back[index * 2 + 1] = stay >= open ? 1 : 0;
			nextNote = Math.max(stay, open) + scores[index]!;
		}
		other = Math.max(keep, close);
		note = nextNote;
	}
	let state = note > other && at(n) ? 1 : 0;
	for (let index = n - 1; index >= 0; index -= 1) {
		labels[index] = state;
		state = back[index * 2 + state]!;
	}
	return labels;
}

/**
 * Note runs as tidied clause pieces. Each run first grows to the whitespace
 * around it, within free text, because the model often stops a character
 * short of a word's edge; the particles a word carries are trimmed after.
 */
export function noteRanges(raw: string, labels: Uint8Array, free?: Uint8Array): NoteRange[] {
	const runs: NoteRange[] = [];
	const open = (index: number): boolean => !free || free[index] === 1;
	for (let index = 0; index < labels.length; index += 1) {
		if (!labels[index]) continue;
		let start = index;
		let end = index;
		while (end < labels.length && labels[end]) end += 1;
		index = end;
		if (free) {
			while (start > 0 && open(start - 1) && !/\s/u.test(raw[start - 1]!)) start -= 1;
			while (end < raw.length && open(end) && !/\s/u.test(raw[end]!)) end += 1;
		}
		const last = runs[runs.length - 1];
		if (last && start <= last.end) runs[runs.length - 1] = { start: last.start, end: Math.max(end, last.end) };
		else runs.push({ start, end });
	}
	return tidyNotes(raw, runs);
}

export interface NoteReader {
	read(raw: string, spans: readonly FieldSpan[]): NoteRange[];
}

export function createNoteReader(model: NoteModel): NoteReader {
	const weights = Int8Array.from(atob(model.weights), (character) => (character.charCodeAt(0) << 24) >> 24);
	if (weights.length !== model.dimension) throw new Error(`note model holds ${weights.length} weights, not ${model.dimension}`);
	return {
		read(raw, spans) {
			const { rows, free } = noteFeatures(raw, spans, model.dimension);
			return noteRanges(raw, decodeNotes(noteScores(rows, weights, model.bias), free, model.transitions, noteBreaks(raw)), model.snap === false ? undefined : free);
		},
	};
}

/** The note pieces joined the way address pieces are: one space, written order. */
export function joinNotes(raw: string, ranges: readonly NoteRange[]): string | null {
	const text = ranges.map((range) => raw.slice(range.start, range.end).replace(/\s+/gu, " ")).join(" ");
	return text === "" ? null : text;
}
