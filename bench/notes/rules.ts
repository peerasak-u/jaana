import type { FieldSpan } from "../../src/notes/model";
import { trimNote, type NoteRange } from "../../src/notes/trim";

/** Words that make a stretch of free text a note in the cue-word baseline. */
const NOTE_CUE = /ฝาก(?!ส่ง)|วางไว้|วางหน้า|ป้อมยาม|รปภ|นิติ|ตู้จดหมาย|โทรก่อน|ถึงแล้วโทร|ก่อนส่ง|ส่งช่วง|ช่วงเย็น|ช่วงเช้า|หลัง\s*\d+\s*โมง|ไม่อยู่|ไม่มีคน|หมาดุ|ตรงข้าม|ใกล้|เยื้อง|เลี้ยว|ทางเข้า|เข้าทาง|ประตู|รั้ว|ปลายทาง|\bcod\b|kerry|เคอรี่|flash|แฟลช|j&t|\bems\b|ไปรษณีย์/iu;

/**
 * The rule baseline: every stretch of free text on one line, between field
 * spans, that holds a note cue word, trimmed the GUIDE way.
 */
export function ruleNotes(raw: string, spans: readonly FieldSpan[]): NoteRange[] {
	const covered = new Uint8Array(raw.length);
	for (const span of spans) covered.fill(1, span.start, span.end);
	const ranges: NoteRange[] = [];
	for (let index = 0; index < raw.length; index += 1) {
		if (covered[index] || raw[index] === "\n") continue;
		let end = index;
		while (end < raw.length && !covered[end] && raw[end] !== "\n") end += 1;
		if (NOTE_CUE.test(raw.slice(index, end))) {
			const trimmed = trimNote(raw, { start: index, end });
			if (trimmed) ranges.push(trimmed);
		}
		index = end;
	}
	return ranges;
}
