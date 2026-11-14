const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";
const FAR_CONTEXT_FROM = 4;
const FAR_CONTEXT_TO = 14;

function characterClass(character: string): string {
	if (character === "\n") return "N";
	if (/\s/u.test(character)) return "S";
	if (/[0-9๐-๙]/u.test(character)) return "D";
	if (/[A-Za-z]/u.test(character)) return "A";
	if (/[฀-๿]/u.test(character)) return "T";
	return character;
}

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

const PHONE_LIKE = /(?:\+?66|0)[0-9](?:[\s.-]?[0-9]){7,8}(?![0-9])/u;
const POSTCODE_LIKE = /(?<![0-9])[0-9]{5}(?![0-9])/u;

/**
 * One coarse class per line: anchored, holds a phone, holds a postcode,
 * digit-run count and length. Order and chat lines differ from address
 * lines in these, beyond the reach of the character window.
 */
function lineSummaries(raw: string, anchorFlags: Uint8Array): string[] {
	const summaries: string[] = [];
	let start = 0;
	for (const text of raw.split("\n")) {
		const digits = text.replace(/[๐-๙]/gu, (digit) => String(digit.charCodeAt(0) - 0x0e50));
		let anchored = 0;
		for (let index = start; index < start + text.length; index += 1) {
			if ((anchorFlags[index] ?? 0) & 15) anchored = 1;
		}
		const runs = Math.min(digits.match(/[0-9]+/gu)?.length ?? 0, 3);
		const length = text.length < 15 ? 0 : text.length < 40 ? 1 : text.length < 80 ? 2 : 3;
		summaries.push(
			`${anchored}${PHONE_LIKE.test(digits) ? 1 : 0}${POSTCODE_LIKE.test(digits) ? 1 : 0}${runs}${length}`,
		);
		start += text.length + 1;
	}
	return summaries;
}

/** Cue words by category. A category's bit is its index. */
const CUES: readonly (readonly string[])[] = [
	["คุณ", "นาย", "นาง", "นางสาว", "น.ส.", "นส.", "ด.ช.", "ด.ญ.", "ดร.", "ครู", "พระ", "พี่", "น้อง",
		"ป้า", "ลุง", "น้า", "แม่", "พ่อ", "ยาย", "อาจารย์", "ผอ.", "พว.", "ภก.", "ผญบ.", "k.", "khun",
		"mr.", "mrs.", "ms.", "miss"],
	["บริษัท", "บจก", "บมจ", "หจก", "ร้าน", "โรงเรียน", "รร.", "วัด", "รพ.", "โรงพยาบาล", "อบต",
		"เทศบาล", "คลินิก", "โรงงาน", "สำนักงาน", "กลุ่ม", "ฟาร์ม", "มูลนิธิ", "สหกรณ์", "จำกัด",
		"shop", "cafe", "café", "hotel", "resort", "รีสอร์ท", "co.,", "ltd"],
	["ชื่อ", "ผู้รับ", "ส่งให้", "ส่งถึง", "ส่ง", "ถึง", "ที่อยู่", "โทร", "เบอร์", "เบอ", "tel", "mobile",
		"attn", "ติดต่อ", "name", "addr", "call", "ฝากให้", "to:", "ship to"],
	["บ้านเลขที่", "เลขที่", "ม.", "หมู่", "ซ.", "ซอย", "ถ.", "ถนน", "หมู่บ้าน", "มบ.", "คอนโด", "ชั้น",
		"ห้อง", "อาคาร", "ตึก", "หอพัก", "อพาร์ท", "soi", "rd.", "road", "room", "fl."],
	["ค่ะ", "คะ", "ครับ", "นะคะ", "นะครับ", "จ้า", "จ้ะ", "นะ", "ka", "krub", "ขอบคุณ", "สวัสดี"],
	["สั่ง", "เอา", "ตัว", "ชิ้น", "ขวด", "กล่อง", "ถุง", "หลอด", "โอน", "สลิป", "บาท", "size", "สี",
		"แพ็ค", "ปลายทาง", "cod", "ด้วย", "ไม่อยู่", "ก่อนส่ง"],
];

interface CueMarks {
	readonly inside: Uint8Array;
	readonly starts: Uint8Array;
	/** Cue categories that end right before this position, past spaces and colons. */
	readonly follows: Uint8Array;
}

function cueMarks(lower: string): CueMarks {
	const n = lower.length;
	const inside = new Uint8Array(n);
	const starts = new Uint8Array(n);
	const follows = new Uint8Array(n);
	CUES.forEach((words, category) => {
		const bit = 1 << category;
		for (const word of words) {
			for (let at = lower.indexOf(word); at >= 0; at = lower.indexOf(word, at + 1)) {
				starts[at]! |= bit;
				for (let index = at; index < at + word.length; index += 1) inside[index]! |= bit;
				let next = at + word.length;
				while (next < n && /[ \t:：]/u.test(lower[next]!)) next += 1;
				if (next < n) follows[next]! |= bit;
			}
		}
	});
	return { inside, starts, follows };
}

/**
 * Hashed feature buckets for every UTF-16 unit of `raw`. Changing any key
 * below changes the meaning of trained weights, so retrain the model.
 */
export function featurize(
	raw: string,
	anchorFlags: Uint8Array,
	dimension: number,
): Int32Array[] {
	const n = raw.length;
	const folded: string[] = [];
	const classes: string[] = [];
	for (let index = 0; index < n; index += 1) {
		folded.push(fold(raw[index]!));
		classes.push(characterClass(raw[index]!));
	}
	const c = (index: number): string => (index < 0 || index >= n ? "^" : folded[index]!);
	const k = (index: number): string => (index < 0 || index >= n ? "^" : classes[index]!);
	const a = (index: number): number => (anchorFlags[index] ?? 0) & 15;
	const runStart = new Int32Array(n);
	const runEnd = new Int32Array(n);
	for (let i = 0; i < n; i += 1) {
		runStart[i] = i > 0 && classes[i] === classes[i - 1] ? runStart[i - 1]! : i;
	}
	for (let i = n - 1; i >= 0; i -= 1) {
		runEnd[i] = i < n - 1 && classes[i] === classes[i + 1] ? runEnd[i + 1]! : i;
	}
	const digitCount = classes.filter((value) => value === "D").length;
	const lines = lineSummaries(raw, anchorFlags);
	const cues = cueMarks(folded.map((value) => (value.length === 1 ? value : "?")).join(""));
	const nextCue = new Uint8Array(n + 1);
	for (let i = n - 1; i >= 0; i -= 1) {
		nextCue[i] = raw[i] === "\n" ? 0 : cues.starts[i + 1] || nextCue[i + 1]!;
	}
	let lastCue = 0;
	const rows: Int32Array[] = [];
	let line = 0;
	let lineStart = 0;
	for (let i = 0; i < n; i += 1) {
		const row: number[] = [bucket("b", dimension)];
		const add = (key: string): void => {
			row.push(bucket(key, dimension));
		};
		for (let o = -3; o <= 3; o += 1) add(`u${o}:${c(i + o)}`);
		for (let o = -3; o <= 2; o += 1) add(`b${o}:${c(i + o)}${c(i + o + 1)}`);
		for (let o = -3; o <= 1; o += 1) add(`t${o}:${c(i + o)}${c(i + o + 1)}${c(i + o + 2)}`);
		add(`q-:${c(i - 4)}${c(i - 3)}${c(i - 2)}${c(i - 1)}`);
		add(`q+:${c(i + 1)}${c(i + 2)}${c(i + 3)}${c(i + 4)}`);
		let shape = "";
		for (let o = -5; o <= 5; o += 1) shape += k(i + o);
		add(`s:${shape}`);
		add(`s3:${shape.slice(3, 8)}`);
		for (let o = FAR_CONTEXT_FROM; o <= FAR_CONTEXT_TO; o += 1) {
			add(`L:${c(i - o)}${c(i - o + 1)}${c(i - o + 2)}`);
			add(`R:${c(i + o - 2)}${c(i + o - 1)}${c(i + o)}`);
		}
		const runLength = runEnd[i]! - runStart[i]! + 1;
		add(`r:${classes[i]}${Math.min(runLength, 12)}`);
		add(`rp:${classes[i]}${Math.min(i - runStart[i]!, 6)}:${Math.min(runEnd[i]! - i, 6)}`);
		add(`dt:${Math.min(digitCount, 20)}`);
		add(`ln:${Math.min(line, 4)}`);
		add(`lp:${Math.min(Math.floor((i - lineStart) / 4), 10)}`);
		add(`pos:${Math.floor((10 * i) / n)}`);
		add(`rem:${Math.min(Math.floor((n - i) / 6), 10)}`);
		add(`a:${a(i)}`);
		add(`ab:${(anchorFlags[i]! >> 4) & 3}:${a(i)}`);
		add(`a-:${a(i - 1)}:${a(i)}`);
		add(`a+:${a(i)}:${a(i + 1)}`);
		add(`a2:${a(i - 2)}:${a(i)}:${a(i + 2)}`);
		add(`ac:${a(i)}:${c(i - 1)}${c(i - 2)}`);
		const here = lines[line]!;
		add(`lc:${here}`);
		add(`lc-:${lines[line - 1] ?? "^"}:${here}`);
		add(`lc+:${here}:${lines[line + 1] ?? "^"}`);
		add(`lf:${line === 0 ? 1 : 0}${line === lines.length - 1 ? 1 : 0}`);
		add(`lk:${here}:${classes[i]}`);
		add(`ci:${cues.inside[i]}`);
		add(`cs:${cues.starts[i]}`);
		add(`cf:${cues.follows[i]}`);
		add(`cl:${lastCue}:${cues.inside[i]}`);
		add(`cn:${cues.inside[i]}:${nextCue[i]}`);
		if (cues.starts[i]) lastCue = cues.starts[i]!;
		rows.push(Int32Array.from(row));
		if (raw[i] === "\n") {
			lastCue = 0;
			line += 1;
			lineStart = i + 1;
		}
	}
	return rows;
}
