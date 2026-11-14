import { describe, expect, test } from "bun:test";
import { loadParserResources } from "../bench/gazetteer";
import { createAnchorer } from "../src/tagger/anchor";
import { boundJoins, decodeTags } from "../src/tagger/decode";
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
		const tags = decodeTags(features, modelPreferring([NAME, OTHER]), boundJoins(raw));
		expect([...tags]).toEqual([NAME, NAME, NAME, OTHER, OTHER, OTHER, OTHER, OTHER]);
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

	test("every span reproduces its source offsets", () => {
		const raw = "นายทดสอบ ใจดี 081-234-5678 บ้านเลขที่ 1 ปทุมวัน กรุงเทพมหานคร 10330";
		const result = parser.parse(raw);
		expect(result.spans.length).toBeGreaterThan(0);
		for (const span of result.spans) expect(raw.slice(span.start, span.end)).toBe(span.text);
		expect(result.fields.phone).toBe("0812345678");
		expect(result.fields.province).toBe("กรุงเทพมหานคร");
	});

	test("empty input yields no fields", () => {
		expect(Object.values(parser.parse("").fields).every((value) => value === null)).toBe(true);
	});
});
