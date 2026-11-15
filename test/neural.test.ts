import { describe, expect, test } from "bun:test";
import { loadParserResources } from "../bench/gazetteer";
import type { EnsembleTaggerModel, TaggerModel } from "../src/tagger/model";
import type { NeuralTaggerModel } from "../src/tagger/neural";
import { createTaggerParser } from "../src/tagger/parser";

const { locations } = await loadParserResources("resources/gazetteer.json");
const shipped = (await Bun.file("resources/tagger-model.json").json()) as EnsembleTaggerModel;
const linear: TaggerModel = shipped.linear;
const neural: NeuralTaggerModel = shipped.neural;

const MESSAGES = [
	"คุณสมชาย ใจดี\nโทร 089-123-4567\n99/1 หมู่ 2 ถ.นิตโย ต.ธาตุเชิงชุม อ.เมือง จ.สกลนคร 47000",
	"เอาเสื้อยืด 2 ตัว สีดำค่ะ โอนแล้วนะคะ\nคุณสมศรี ใจดี\n45 ม.5 ต.ธาตุเชิงชุม อ.เมือง จ.สกลนคร 47000\n0891234567",
	"ส่งที่ บจก. ซีเอ็นที มีเดีย กรุ๊ป 1/2 ถ.สุขุมวิท แขวงคลองเตย เขตคลองเตย กทม 10110 โทร 0812345678 🙏",
];

function ensemble(neuralWeight: number): EnsembleTaggerModel {
	return { kind: "ensemble", version: "test", linear, neural, neuralWeight };
}

describe("neural tagger", () => {
	test("the shipped neural model parses a labelled multi-line address on its own", () => {
		expect(createTaggerParser(neural, locations).parse(MESSAGES[0]!).fields).toEqual({
			name: "คุณสมชาย ใจดี",
			phone: "0891234567",
			address: "99/1 หมู่ 2 ถ.นิตโย",
			subdistrict: "ธาตุเชิงชุม",
			district: "เมืองสกลนคร",
			province: "สกลนคร",
			zipcode: "47000",
		});
	});

	test("an ensemble with no neural weight parses exactly like the linear model", () => {
		const alone = createTaggerParser(linear, locations);
		const paired = createTaggerParser(ensemble(0), locations);
		for (const message of MESSAGES) expect(paired.parse(message)).toEqual(alone.parse(message));
	});

	test("an ensemble parses a message holding an emoji, two UTF-16 units", () => {
		const fields = createTaggerParser(ensemble(0.03), locations).parse(MESSAGES[2]!).fields;
		expect(fields.phone).toBe("0812345678");
		expect(fields.zipcode).toBe("10110");
	});

	test("a neural model whose tensor shapes disagree with its sizes is rejected", () => {
		expect(() => createTaggerParser({ ...neural, hidden: neural.hidden + 1 }, locations)).toThrow();
	});
});
