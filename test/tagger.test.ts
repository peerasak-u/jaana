import { describe, expect, test } from "bun:test";
import { loadParserResources } from "../bench/gazetteer";
import { createAnchorer } from "../src/tagger/anchor";
import { decodeTags } from "../src/tagger/decode";
import { compileTaggerModel, TAG_COUNT, TAGS, type TaggerModel } from "../src/tagger/model";
import { createTaggerParser } from "../src/tagger/parser";
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
});

describe("training", () => {
	test("a trained model survives quantization and reproduces its training tags", () => {
		const examples = [
			{ features: [0, 0, 1, 2, 2].map((feature) => Int32Array.of(feature)), tags: [NAME, NAME, OTHER, ADDRESS, ADDRESS] },
			{ features: [2, 1, 0].map((feature) => Int32Array.of(feature)), tags: [ADDRESS, OTHER, NAME] },
		];
		const model = trainTagger(examples, { version: "toy", dimension: 4, epochs: 5, seed: 1 });
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

	test("empty input yields no fields", () => {
		expect(Object.values(parser.parse("").fields).every((value) => value === null)).toBe(true);
	});
});
