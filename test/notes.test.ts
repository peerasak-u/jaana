import { describe, expect, test } from "bun:test";
import { locationMap } from "../bench/chat/load";
import { parseSource } from "../bench/chat/markup";
import { loadParserResources } from "../bench/gazetteer";
import { placeNotes } from "../bench/notes/residue";
import { decodeNotes, noteBreaks, noteFeatures, type NoteModel } from "../src/notes/model";
import { tidyNotes, trimNote } from "../src/notes/trim";
import { createTaggerParser, expandGazetteer } from "../src";
import gazetteer from "../resources/gazetteer.json";
import model from "../resources/tagger-model.json";

const { locations } = await loadParserResources("resources/gazetteer.json");
const map = locationMap(locations);
const RATCHABURI = "loc: บ่อกระดาน | ปากท่อ | ราชบุรี | 70140";
const FULL = "[[A:12 ม.3]] [[S:ต.บ่อกระดาน]] [[D:อ.ปากท่อ]] [[V:จ.ราชบุรี]] [[Z:70140]]";

function parse(record: string) {
	return parseSource(`===\n${record}`, { file: "fixture.txt", category: "fixture", idPrefix: "fixture", pool: "train", locations: map });
}

describe("R marks", () => {
	test("are kept apart from the field spans, in written order", () => {
		const { records, issues } = parse(`${RATCHABURI}\n---\n[[N:คุณแดง]] ${FULL}\n[[R:บ้านอยู่ตรงข้ามร้านของชำ]] [[R:ฝากร้านของชำ]]ได้เลยค่ะ`);
		expect(issues).toEqual([]);
		const record = records[0]!;
		expect(record.notes.map((note) => note.text)).toEqual(["บ้านอยู่ตรงข้ามร้านของชำ", "ฝากร้านของชำ"]);
		expect(record.spans.some((span) => span.text.includes("ร้านของชำ"))).toBe(false);
		expect(record.raw.slice(record.notes[1]!.start, record.notes[1]!.end)).toBe("ฝากร้านของชำ");
	});

	test("leave particles outside", () => {
		const messages = parse(`${RATCHABURI}\n---\n${FULL} [[R:ปลายทางค่ะ]] [[R:ส่ง flash na]]`).issues.map((issue) => issue.message);
		expect(messages).toContain('R span "ปลายทางค่ะ" keeps a particle at its edge. Leave it outside');
		expect(messages).toContain('R span "ส่ง flash na" keeps a particle at its edge. Leave it outside');
	});

	test("never cross a line break", () => {
		const messages = parse(`${RATCHABURI}\n---\n${FULL} [[R:โทรก่อน\nส่ง]]`).issues.map((issue) => issue.message);
		expect(messages).toContain("R span crosses a line break");
	});
});

describe("note trimming", () => {
	const at = (raw: string, piece: string) => ({ start: raw.indexOf(piece), end: raw.indexOf(piece) + piece.length });

	test("drops particles, emoji and edge punctuation", () => {
		const raw = "(ฝากรปภ.ไว้ได้เลยค่ะ 🙏)";
		const range = trimNote(raw, { start: 0, end: raw.length })!;
		expect(raw.slice(range.start, range.end)).toBe("ฝากรปภ.ไว้");
	});

	test("cuts a run at a particle between two clauses and keeps numbers inside a clause", () => {
		const raw = "ส่งไปรษณีย์ไทยนะ ขนส่งอื่นหาไม่เจอ โทรก่อน 30 นาที";
		const pieces = tidyNotes(raw, [{ start: 0, end: raw.length }]).map(({ start, end }) => raw.slice(start, end));
		expect(pieces).toEqual(["ส่งไปรษณีย์ไทย", "ขนส่งอื่นหาไม่เจอ โทรก่อน 30 นาที"]);
	});

	test("places a teacher piece only in free text", () => {
		const record = {
			raw: "ฝากป้อมยาม 12 ม.3 ฝากป้อมยามนะ",
			spans: [{ label: "ADDRESS_DETAIL", text: "12 ม.3", canonical: null, start: 11, end: 17, codePointStart: 11, codePointEnd: 17 }] as never,
		};
		const placed = placeNotes(record, ["ฝากป้อมยาม", "ไม่มีในข้อความ"]);
		expect(placed.unplaced).toBe(1);
		expect(placed.notes).toEqual([at(record.raw, "ฝากป้อมยาม")]);
	});
});

describe("note decoding", () => {
	test("never labels a field unit or a line break, and never opens inside a Thai cluster", () => {
		const raw = "ส่ง คุณแดง\nวางไว้หน้าบ้าน";
		const spans = [{ label: "NAME", start: 4, end: 10 }];
		const { rows, free } = noteFeatures(raw, spans, 1024);
		expect(rows.length).toBe(raw.length);
		expect(Array.from(free.subarray(4, 11))).toEqual([0, 0, 0, 0, 0, 0, 0]);
		const scores = new Float64Array(raw.length).fill(5);
		const labels = decodeNotes(scores, free, [0, 0, 0, 0], noteBreaks(raw));
		expect(Array.from(labels.subarray(4, 11))).toEqual([0, 0, 0, 0, 0, 0, 0]);
		// A score that wants a note to open on the vowel of `ไว้` is overruled.
		const vowel = raw.indexOf("ว้") + 1;
		const pointed = new Float64Array(raw.length).fill(-5);
		pointed.fill(5, vowel, raw.length);
		const cut = decodeNotes(pointed, free, [0, 0, 0, 0], noteBreaks(raw));
		expect(cut[vowel]).toBe(cut[vowel - 1]);
	});
});

describe("parser with a note model", () => {
	const locations = expandGazetteer(gazetteer as never);
	// A model whose every weight is zero and whose bias favours notes: every free unit reads as a note.
	const eager: NoteModel = { kind: "notes", version: "test", dimension: 16, weights: btoa("\0".repeat(16)), transitions: [0, 0, 0, 0], bias: 10 };
	const message = "คุณสมชาย ใจดี 0891234567\n12 ม.4 ต.ธาตุเชิงชุม อ.เมือง จ.สกลนคร 47000\nวางไว้หน้าประตูได้เลยค่ะ";

	test("leaves the seven fields as the parser without notes returns them", () => {
		const plain = createTaggerParser(model as never, locations).parse(message);
		const withNotes = createTaggerParser(model as never, locations, { notes: eager }).parse(message);
		expect(withNotes.fields).toEqual(plain.fields);
		expect(plain.notes).toBeUndefined();
		expect(withNotes.notes).toBe("วางไว้หน้าประตู");
		expect(withNotes.noteSpans).toEqual([{ text: "วางไว้หน้าประตู", start: message.indexOf("วางไว้"), end: message.indexOf("วางไว้") + 15 }]);
	});
});

describe("note tidying at glued particles", () => {
	test("cuts a clause boundary that a particle marks without a space", () => {
		const raw = "ไม่ต้องโทรค่ะวางหน้าบ้านได้เลย เก็บปลายทาง 650)";
		const pieces = tidyNotes(raw, [{ start: 0, end: raw.length }]).map(({ start, end }) => raw.slice(start, end));
		expect(pieces).toEqual(["ไม่ต้องโทร", "วางหน้าบ้าน", "เก็บปลายทาง 650"]);
	});
});

describe("the shipped note model", async () => {
	const notes = (await Bun.file("resources/notes-model.json").json()) as NoteModel;
	const parser = createTaggerParser(model as never, expandGazetteer(gazetteer as never), { notes });

	test("keeps a landmark inside the address run in the address", () => {
		const result = parser.parse("คุณสมชาย ใจดี 0891234567\n12 ม.4 ตรงข้ามร้านของชำป้าแดง ต.ธาตุเชิงชุม อ.เมือง จ.สกลนคร 47000\nวางของไว้หน้าประตูรั้วได้เลยค่ะ");
		expect(result.fields.address).toBe("12 ม.4 ตรงข้ามร้านของชำป้าแดง");
		expect(result.notes).toBe("วางของไว้หน้าประตูรั้ว");
	});

	test("reads a landmark written as its own sentence as a note", () => {
		const result = parser.parse("88 ม.2 ต.หนองบัว อ.เมือง จ.อุดรธานี 41000 คุณแดง 0812345678 บ้านอยู่ตรงข้ามร้านของชำ รั้วสีเขียว ถ้าไม่อยู่ฝากร้านของชำได้เลยค่ะ");
		expect(result.fields.address).toBe("88 ม.2");
		expect(result.notes).toBe("บ้านอยู่ตรงข้ามร้านของชำ รั้วสีเขียว ถ้าไม่อยู่ฝากร้านของชำ");
	});

	test("finds no note in order chat", () => {
		expect(parser.parse("เอาปลาส้ม 3 ห่อค่ะ คุณบัว 0632221111 15 ม.3 ต.นาโพธิ์ อ.กุฉินารายณ์ กาฬสินธุ์ 46110 ขอบคุณค่ะ").notes).toBeNull();
	});
});
