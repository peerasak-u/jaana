import { describe, expect, test } from "bun:test";
import { loadParserResources } from "../bench/gazetteer";
import { createTaggerParser } from "../src/tagger/parser";
import type { TaggerModel } from "../src/tagger/model";

const { locations } = await loadParserResources("resources/gazetteer.json");
const parser = createTaggerParser((await Bun.file("resources/tagger-model.json").json()) as TaggerModel, locations);
const fields = (raw: string) => parser.parse(raw).fields;

describe("a phone keeps the digits typed past a space", () => {
	test("a group that ends its line joins the number", () => {
		const result = parser.parse("คุณวีระ ทองมา\n12 ม.3 ต.ท่าบัว อ.โพทะเล จ.พิจิตร 66130\nโทร 0861 445 2093 1");
		expect(result.fields.phone).toBe("086144520931");
		expect(result.warnings).toContain("phone-length");
	});

	test("a group that starts with 0 joins the number mid-line", () => {
		const result = fields("น้องเมย์ 0957728816 0 บ.หนองแวง 88ม9 ต.เมืองน้อย อ.ธวัชบุรี ร้อยเอ็ด");
		expect(result.phone).toBe("09577288160");
		expect(result.address).toBe("บ.หนองแวง 88ม9");
	});

	test("a house number after the phone stays in the address", () => {
		const result = fields("คุณเอ 0812345678 9 ม.3 ต.หัวถนน อ.พนัสนิคม ชลบุรี 20140");
		expect(result.phone).toBe("0812345678");
		expect(result.address).toBe("9 ม.3");
	});
});

describe("a phone the tagger left untagged", () => {
	const company = "บริษัท สมุทรค้าเหล็ก จำกัด\n99 ม.4 ต.บางพลีน้อย อ.บางบ่อ สมุทรปราการ 10560\n";

	test("is the number after a tax ID", () => {
		expect(fields(`${company}เลขประจำตัวผู้เสียภาษี 0105561023457 มือถือ 089 410 2266`).phone).toBe("0894102266");
	});

	test("is never the tax ID itself", () => {
		expect(fields(`${company}เลขผู้เสียภาษี 0105561023457`).phone).toBeNull();
	});
});

describe("a place word inside another field's name", () => {
	test("does not pull the province after it into the address", () => {
		const result = fields("ป้าแดง 081 332 4410 21 ม.2 ต.หัวถนน ชลบุรี");
		expect(result.address).toBe("21 ม.2");
		expect(result.province).toBe("ชลบุรี");
	});

	test("a province named in a road still belongs to the road", () => {
		expect(fields("12 ถนนชลบุรี ต.หัวถนน อ.พนัสนิคม 20140 ป้าแดง 0813324410").address).toBe("12 ถนนชลบุรี");
	});
});

describe("romanized names compare by sound", () => {
	test.each([
		["a silent letter and รร", "khwaeng Khuha Sawan khet Phasi Charoen 10160", "คูหาสวรรค์"],
		["an r that lengthens a vowel", "or ngern saimai bkk 10220", "ออเงิน"],
	])("matches %s", (_, admin, subdistrict) => {
		expect(fields(`Nok 0891234567 88 Soi Phetkasem 5 ${admin}`).subdistrict).toBe(subdistrict);
	});

	test("a neighbouring subdistrict of the same postcode keeps its match", () => {
		expect(fields("Nok 0891234567 5/1 Soi Phetkasem 33 khwaeng Bang Wa khet Phasi Charoen 10160").subdistrict).toBe("บางหว้า");
	});
});

describe("names the tagger missed", () => {
	test.each([
		["a bracketed handle", "(ไลน์ @suanlamyai) สวนลำไยป้าศรี 41 ม.2 ต.ทับไทร อ.โป่งน้ำร้อน จันทบุรี 22140 โทร 0892234561", "สวนลำไยป้าศรี"],
		["a labelled handle", "Line: fon_fon88 ฝน ศุภาลัย ซิตี้ อาคาร C ห้อง 905 แขวงบางยี่ขัน เขตบางพลัด กทม 10700 0918852203", "ฝน"],
	])("takes the word after %s that opens the message", (_, raw, name) => {
		expect(fields(raw).name).toBe(name);
	});

	test("leaves a village after a handle in the address", () => {
		const result = fields("(ไลน์ @abc) หมู่บ้านสุขใจ 12/3 ต.ทับไทร อ.โป่งน้ำร้อน จันทบุรี 22140 0892234561");
		expect(result.name).toBeNull();
		expect(result.address).toBe("หมู่บ้านสุขใจ 12/3");
	});

	test.each([
		["pls send Fern 41/2 Soi Ekkachai 12 Khwaeng Bangkhuntien Khet Jomtong 10150 0882104473", "Fern"],
		["send to Pim 9 Soi Phet Kasem 28 Phasi Charoen 10160 0612009874 COD ka", "Pim"],
	])("takes the name after an English send label: %s", (raw, name) => {
		expect(fields(raw).name).toBe(name);
	});

	test("a courier after send is not a name", () => {
		expect(fields("send Kerry 22 Soi Phet Kasem 28 Phasi Charoen 10160 0612009874").name).toBeNull();
	});
});
