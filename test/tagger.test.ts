import { describe, expect, test } from "bun:test";
import { loadParserResources } from "../bench/gazetteer";
import { createAnchorer } from "../src/tagger/anchor";
import { findStandalone, findTruncated } from "../src/tagger/mention";
import { decodeTags, spanEdges } from "../src/tagger/decode";
import { compileTaggerModel, TAG_COUNT, TAGS, type TaggerModel } from "../src/tagger/model";
import { addressOf, createTaggerParser } from "../src/tagger/parser";
import { createTupleResolver } from "../src/tagger/resolve";
import { trainTagger } from "../src/tagger/train";

const { locations } = await loadParserResources("resources/gazetteer.json");
const shippedModel = (await Bun.file("resources/tagger-model.json").json()) as TaggerModel;

const NAME = TAGS.indexOf("NAME");
const OTHER = TAGS.indexOf("OTHER");
const ADDRESS = TAGS.indexOf("ADDRESS_DETAIL");

function runCount(tags: Uint8Array, tag: number): number {
	let runs = 0;
	for (let index = 0; index < tags.length; index += 1) {
		if (tags[index] === tag && tags[index - 1] !== tag) runs += 1;
	}
	return runs;
}

describe("tuple anchoring", () => {
	const anchor = createAnchorer(locations);

	test("a subdistrict mention is not also counted as its same-named district", () => {
		expect(anchor("แขวงสีลม เขตบางรัก กรุงเทพมหานคร 10500").tuple).toEqual({
			subdistrict: "สีลม",
			district: "บางรัก",
			province: "กรุงเทพมหานคร",
			zipcode: "10500",
		});
	});

	test("one administrative name is not enough to anchor a tuple", () => {
		const anchored = anchor("จังหวัดสกลนคร");
		expect(anchored.tuple).toBeNull();
		expect(anchored.flags.every((flag) => flag === 0)).toBe(true);
	});

	test("Thai digits in the postcode anchor like ASCII digits", () => {
		expect(anchor("ต.ธาตุเชิงชุม จ.สกลนคร ๔๗๐๐๐").tuple?.zipcode).toBe("47000");
	});
});

describe("administrative mentions", () => {
	test("a prefixed leading part of a long name is a mention of it", () => {
		const raw = "10100 เขตป้อมปราบ แขวงวัดโสมนัส";
		expect(findTruncated(raw, "district", "ป้อมปราบศัตรูพ่าย", [])).toEqual({ start: 6, end: 17 });
		expect(findTruncated("ป้อมปราบ 10100", "district", "ป้อมปราบศัตรูพ่าย", [])).toBeNull();
	});

	test("a name inside a village or road name is not standalone", () => {
		expect(findStandalone("62 ม.9 บ้านมะเฟือง อ.พุทไธสง", "subdistrict", "มะเฟือง", [])).toBeNull();
		expect(findStandalone("ถ.บางกรวย-ไทรน้อย", "subdistrict", "ไทรน้อย", [])).toBeNull();
		expect(findStandalone("ม.3 ไร่รถ ดอนเจดีย์", "subdistrict", "ไร่รถ", [])).toEqual({ start: 4, end: 9 });
	});
});

describe("address composition", () => {
	const ranges = (raw: string, ...pieces: string[]) =>
		pieces.map((piece) => ({ start: raw.indexOf(piece), end: raw.indexOf(piece) + piece.length }));

	test("pieces separated only by a comma are one piece that keeps the comma", () => {
		const raw = "English Dept., โรงเรียนสาทร 31 ซ.งามดูพลี";
		expect(addressOf(raw, ranges(raw, "English Dept.", "โรงเรียนสาทร 31 ซ.งามดูพลี"), [])).toBe(raw);
	});

	test("pieces interrupted by other text are joined with one space", () => {
		const raw = "45 ม.5 โทร 0891234567 ซ.วัดดอน";
		expect(addressOf(raw, ranges(raw, "45 ม.5", "ซ.วัดดอน"), [])).toBe("45 ม.5 ซ.วัดดอน");
		const lines = "45 ม.5,\nซ.วัดดอน";
		expect(addressOf(lines, ranges(lines, "45 ม.5", "ซ.วัดดอน"), [])).toBe("45 ม.5 ซ.วัดดอน");
	});
});

describe("tuple resolver", () => {
	const resolve = createTupleResolver(locations);

	test("a misspelled province resolves through the other tagged fields", () => {
		expect(resolve({
			subdistrict: "ต.ธาตุเชิงชุม",
			district: "อ.เมือง",
			province: "จ.สกนคร",
			zipcode: "47000",
		})).toEqual({
			subdistrict: "ธาตุเชิงชุม",
			district: "เมืองสกลนคร",
			province: "สกลนคร",
			zipcode: "47000",
		});
	});

	test("a province nickname resolves to its province", () => {
		expect(resolve({ district: "อ.นาตาล", province: "อุบลฯ" }).province).toBe("อุบลราชธานี");
		expect(resolve({ district: "เขตจอมทอง", province: "dm," }).province).toBe("กรุงเทพมหานคร");
	});

	test("an unknown name resolves to nothing", () => {
		expect(resolve({ province: "ดาวอังคาร" }).province).toBeNull();
	});
});

describe("single-run decoding", () => {
	function modelPreferring(tagByFeature: readonly number[]) {
		const weights = new Int8Array(tagByFeature.length * TAG_COUNT);
		tagByFeature.forEach((tag, feature) => {
			weights[feature * TAG_COUNT + tag] = 10;
		});
		return { weights, transitions: new Int32Array(TAG_COUNT * TAG_COUNT) };
	}
	const sequence = [0, 0, 1, 1, 0, 0].map((feature) => Int32Array.of(feature));

	test("NAME cannot resume after it has ended", () => {
		const tags = decodeTags(sequence, modelPreferring([NAME, OTHER]));
		expect(runCount(tags, NAME)).toBe(1);
	});

	test("ADDRESS_DETAIL may form several runs", () => {
		const tags = decodeTags(sequence, modelPreferring([ADDRESS, OTHER]));
		expect([...tags]).toEqual([ADDRESS, ADDRESS, OTHER, OTHER, ADDRESS, ADDRESS]);
	});

	test("a span edge never splits a Thai character cluster or a Latin word", () => {
		const raw = "ร้านKhun";
		const features = [0, 0, 1, 1, 0, 1, 1, 1].map((feature) => Int32Array.of(feature));
		const tags = decodeTags(features, modelPreferring([NAME, OTHER]), spanEdges(raw));
		expect([...tags]).toEqual([NAME, NAME, NAME, OTHER, OTHER, OTHER, OTHER, OTHER]);
	});

	test("a name neither starts on an opening bracket nor ends on a space", () => {
		const raw = "(คุณเอ) ";
		const features = [...raw].map(() => Int32Array.of(0));
		const tags = decodeTags(features, modelPreferring([NAME]), spanEdges(raw));
		expect([...tags]).toEqual([OTHER, NAME, NAME, NAME, NAME, NAME, NAME, OTHER]);
	});

	test("only ADDRESS_DETAIL may cover a line break", () => {
		const raw = "a\nb";
		const everywhere = [0, 0, 0].map((feature) => Int32Array.of(feature));
		expect([...decodeTags(everywhere, modelPreferring([NAME]), spanEdges(raw))][1]).not.toBe(NAME);
		expect([...decodeTags(everywhere, modelPreferring([ADDRESS]), spanEdges(raw))]).toEqual([ADDRESS, ADDRESS, ADDRESS]);
	});
});

describe("training", () => {
	test.each([0, 200])("a model trained with margin %d survives quantization and reproduces its training tags", (margin) => {
		const examples = [
			{ features: [0, 0, 1, 2, 2].map((feature) => Int32Array.of(feature)), tags: [NAME, NAME, OTHER, ADDRESS, ADDRESS] },
			{ features: [2, 1, 0].map((feature) => Int32Array.of(feature)), tags: [ADDRESS, OTHER, NAME] },
		];
		const model = trainTagger(examples, { version: "toy", dimension: 4, epochs: 5, seed: 1, margin });
		const compiled = compileTaggerModel(model);
		for (const example of examples) {
			expect([...decodeTags(example.features, compiled)]).toEqual(example.tags);
		}
	});

	test("a model whose weights do not match its dimension is rejected", () => {
		expect(() => compileTaggerModel({ ...shippedModel, dimension: shippedModel.dimension + 1 })).toThrow();
	});
});

describe("shipped tagger model", () => {
	const parser = createTaggerParser(shippedModel, locations);

	test("parses a labelled multi-line address", () => {
		expect(parser.parse(
			"คุณสมชาย ใจดี\nโทร 089-123-4567\n99/1 หมู่ 2 ถ.นิตโย ต.ธาตุเชิงชุม อ.เมือง จ.สกลนคร 47000",
		).fields).toEqual({
			name: "คุณสมชาย ใจดี",
			phone: "0891234567",
			address: "99/1 หมู่ 2 ถ.นิตโย",
			subdistrict: "ธาตุเชิงชุม",
			district: "เมืองสกลนคร",
			province: "สกลนคร",
			zipcode: "47000",
		});
	});

	test("a name between a label and a particle excludes both", () => {
		const fields = parser.parse(
			"45 ม.5 ต.ธาตุเชิงชุม อ.เมือง จ.สกลนคร 47000 ผู้รับ สมพงษ์ ครับ 0891234567",
		).fields;
		expect(fields.name).toBe("สมพงษ์");
		expect(fields.address).toBe("45 ม.5");
	});

	test("an order line before the address is not address detail", () => {
		expect(parser.parse(
			"เอาเสื้อยืด 2 ตัว สีดำค่ะ โอนแล้วนะคะ\nคุณสมศรี ใจดี\n45 ม.5 ต.ธาตุเชิงชุม อ.เมือง จ.สกลนคร 47000\n0891234567",
		).fields.address).toBe("45 ม.5");
	});

	test("an organisation keeps its bracketed contact person", () => {
		expect(parser.parse(
			"บจก.สกลรุ่งเรือง (คุณมานี ฝ่ายบัญชี)\n99/1 หมู่ 2 ถ.นิตโย ต.ธาตุเชิงชุม อ.เมือง จ.สกลนคร 47000\n0891234567",
		).fields.name).toBe("บจก.สกลรุ่งเรือง (คุณมานี ฝ่ายบัญชี)");
	});

	test("every span reproduces its source offsets", () => {
		const raw = "นายทดสอบ ใจดี 081-234-5678 บ้านเลขที่ 1 ปทุมวัน กรุงเทพมหานคร 10330";
		const result = parser.parse(raw);
		expect(result.spans.length).toBeGreaterThan(0);
		for (const span of result.spans) expect(raw.slice(span.start, span.end)).toBe(span.text);
		expect(result.fields.phone).toBe("0812345678");
		expect(result.fields.province).toBe("กรุงเทพมหานคร");
	});

	test("a misspelled subdistrict resolves to the closest subdistrict of the anchored district", () => {
		const fields = parser.parse("คุณศศิธร 0645508812 5/88 ม.3 ต.บึงคำพ้อย อ.ลำลูกกา จ.ปทุมธานี 12150").fields;
		expect(fields.subdistrict).toBe("บึงคำพร้อย");
		expect(fields.district).toBe("ลำลูกกา");
	});

	test("a written postcode overrides an anchor that contradicts it", () => {
		expect(parser.parse("นายประสิทธิ์ ทองอยู่ 0811234567 5 ม.3 ต.หาดทะนง อ.เมืองอุทัย จ.อุทัยทานี 61000").fields).toMatchObject({
			subdistrict: "หาดทนง",
			district: "เมืองอุทัยธานี",
			province: "อุทัยธานี",
			zipcode: "61000",
		});
	});

	test("a misspelled district resolves within the tuples of the anchored province and postcode", () => {
		expect(parser.parse("คุณบี 0897153306 199/45 ซ.จันทน์ 18 แขวงยานาวา เขตสาธร กทม 10120").fields).toMatchObject({
			subdistrict: "ยานนาวา",
			district: "สาทร",
			province: "กรุงเทพมหานคร",
		});
	});

	test("a standalone administrative name the Tagger left untagged is still output", () => {
		expect(parser.parse("น.ส.ชไมพร อินทร์แก้ว ปทุมธานี คลองหลวง คลองหก 12120 เลขที่ 8/45 หมู่บ้านพิมานรัตน์ ม.10 เบอร์ 0632287104").fields).toMatchObject({
			subdistrict: "คลองหก",
			district: "คลองหลวง",
			province: "ปทุมธานี",
			zipcode: "12120",
		});
	});

	test("a province written only inside its city district's name is not output", () => {
		const fields = parser.parse("ณัฐวุฒิ หมานหลี 0623391457 5/1 ม.1 ต.ป่ากอ อ.เมืองพังงา 82000").fields;
		expect(fields.district).toBe("เมืองพังงา");
		expect(fields.province).toBeNull();
	});

	test("a place name inside a village name stays in the address detail", () => {
		const fields = parser.parse("ครูจิราภรณ์ 089-581-4407 62 ม.9 บ้านมะเฟือง อ.พุทไธสง บุรีรัมย์ 31120").fields;
		expect(fields.subdistrict).toBeNull();
		expect(fields.district).toBe("พุทไธสง");
		expect(fields.address).toBe("62 ม.9 บ้านมะเฟือง");
	});

	test("a province nickname the Tagger left untagged is still output", () => {
		expect(parser.parse("ไทรน้อย นนท์ 11150 บ้านเลขที่ 64/1 ม.6 | เบอร์ 0985531276 | พี่โอ๋").fields).toMatchObject({
			district: "ไทรน้อย",
			province: "นนทบุรี",
		});
	});

	test("a village name that matches another subdistrict does not pin the tuple", () => {
		expect(parser.parse("นายสมชาย ภูมิวงศ์ 0835518462 39 ม.8 บ.เขวา ต.เขวาไหญ่ อ.กันทรวิไชย มหาสารคาม").fields).toMatchObject({
			subdistrict: "เขวาใหญ่",
			district: "กันทรวิชัย",
			province: "มหาสารคาม",
		});
	});

	test("one bare mention of a name shared by subdistrict and district is the district", () => {
		const fields = parser.parse("ชื่อ อนุชา พรหมมา\n212/4 ม.1 ถ.สิงหวัฒน์\nวังทอง พิษณุโลก 65130\n062 448 1093").fields;
		expect(fields.subdistrict).toBeNull();
		expect(fields.district).toBe("วังทอง");
		expect(parser.parse("อนุชา 0624481093 212/4 ม.1 วังทอง วังทอง พิษณุโลก 65130").fields).toMatchObject({
			subdistrict: "วังทอง",
			district: "วังทอง",
		});
	});

	test("a field written inside another field's tagged span is still output", () => {
		expect(parser.parse("16ม4บ้านคำเขื่อนแก้ว คำเขื่อนแก้ว ชานุมาน อำนาจเจริญ / บุญส่ง 0879904411").fields).toMatchObject({
			subdistrict: "คำเขื่อนแก้ว",
			district: "ชานุมาน",
			province: "อำนาจเจริญ",
		});
	});

	test("empty input yields no fields", () => {
		expect(Object.values(parser.parse("").fields).every((value) => value === null)).toBe(true);
	});
});
