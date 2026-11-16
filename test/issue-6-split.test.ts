import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { CHAT_ROOT, loadChatPool, loadSourceFile, locationMap } from "../bench/chat/load";
import { HOLDOUT_FILE } from "../bench/chat/markup";
import { loadParserResources } from "../bench/gazetteer";
import { createTaggerParser } from "../src/tagger/parser";
import type { TaggerModel } from "../src/tagger/model";
import { createSplitter } from "../src/tagger/split";

const { locations } = await loadParserResources("resources/gazetteer.json");
const shippedModel = (await Bun.file("resources/tagger-model.json").json()) as TaggerModel;
const parser = createTaggerParser(shippedModel, locations);

describe("several deliveries in one message (issue #6 G1)", () => {
	const raw = [
		"มี 2 ออเดอร์ค่ะ:",
		"1) คุณเมย์ 081-111-2233 12/4 ต.สุเทพ อ.เมืองเชียงใหม่ จ.เชียงใหม่ 50200",
		"2) คุณตาล 089-222-3344 99/1 ต.ในเมือง อ.เมืองขอนแก่น จ.ขอนแก่น 40000",
	].join("\n");
	const result = parser.parse(raw);

	test("returns one recipient per numbered order", () => {
		expect(result.recipients.map((recipient) => recipient.fields)).toEqual([
			{
				name: "คุณเมย์",
				phone: "0811112233",
				address: "12/4",
				subdistrict: "สุเทพ",
				district: "เมืองเชียงใหม่",
				province: "เชียงใหม่",
				zipcode: "50200",
			},
			{
				name: "คุณตาล",
				phone: "0892223344",
				address: "99/1",
				subdistrict: "ในเมือง",
				district: "เมืองขอนแก่น",
				province: "ขอนแก่น",
				zipcode: "40000",
			},
		]);
		expect(result.fields).toEqual(result.recipients[0]!.fields);
		expect(result.warnings).toContain("multiple-recipients");
	});

	test("keeps span offsets into the whole message", () => {
		expect(result.raw).toBe(raw);
		for (const span of result.spans) expect(raw.slice(span.start, span.end)).toBe(span.text);
		expect(result.spans.filter((span) => span.label === "PHONE").map((span) => span.text)).toEqual([
			"081-111-2233",
			"089-222-3344",
		]);
	});
});

describe("how the splitter counts and cuts deliveries", () => {
	const split = createSplitter(locations);
	const blocks = (raw: string) => split(raw).map((block) => raw.slice(block.start, block.end).trim());

	test("two deliveries that share a postcode but write different subdistricts are two", () => {
		const raw = "จุดส่ง 1 คุณเอ แขวงสามเสนใน เขตพญาไท 10400 0811112233\nคุณบี แขวงมักกะสัน เขตราชเทวี 10400 0822223344";
		expect(parser.parse(raw).recipients).toHaveLength(2);
	});

	test("one delivery that writes its subdistrict and postcode twice stays one", () => {
		const raw = "คุณเอ 12 ม.3 ต.สุเทพ อ.เมืองเชียงใหม่ 50200 0811112233\nย้ำนะคะ ต.สุเทพ อ.เมืองเชียงใหม่ 50200";
		expect(split(raw)).toHaveLength(1);
	});

	test("a delivery written with dotless prefixes counts when the gazetteer knows the pair", () => {
		const raw = "ร้านเอ 9 ต.สุเทพ อ.เมืองเชียงใหม่ 50200 0811112233\nคุณบี 4 ม.8 ตหาดแพง อศรีสงคาม นครพนม 0822223344";
		expect(blocks(raw)).toEqual(["ร้านเอ 9 ต.สุเทพ อ.เมืองเชียงใหม่ 50200 0811112233", "คุณบี 4 ม.8 ตหาดแพง อศรีสงคาม นครพนม 0822223344"]);
	});

	test("dotless words that are no gazetteer pair add no delivery", () => {
		const raw = "ร้านเอ 9 ต.สุเทพ อ.เมืองเชียงใหม่ 50200 0811112233\nตลาดนัด อยู่ตรงข้ามวัด นครพนม";
		expect(split(raw)).toHaveLength(1);
	});

	test("list items that each write a phone and a place are deliveries, even with only a province", () => {
		const raw = "🔸 คุณยายผ่องศรี 14 ม.2 ต.บางปลากด อ.ป่าโมก อ่างทอง 14130 035-662-109\n🔸 ตาจันทร์ บ้านนากั้ง ม.4 บึงกาฬ 0846632210";
		expect(blocks(raw)).toEqual(["คุณยายผ่องศรี 14 ม.2 ต.บางปลากด อ.ป่าโมก อ่างทอง 14130 035-662-109", "ตาจันทร์ บ้านนากั้ง ม.4 บึงกาฬ 0846632210"]);
	});

	test("a form whose list items hold one delivery's phone and place stays one", () => {
		const raw = "- ชื่อ: คุณยายผ่องศรี 0846632210\n- ที่อยู่: 14 ม.2 ต.บางปลากด อ.ป่าโมก อ่างทอง 14130\n- เบอร์สำรอง: 035-662-109";
		expect(split(raw)).toHaveLength(1);
	});

	test("ordinal openers such as จุดส่ง 2, คนกลาง, and B) belong to no delivery", () => {
		expect(blocks("จุดส่ง 1 คุณเอ ต.สุเทพ อ.เมืองเชียงใหม่ 50200\nจุดส่ง 2 คุณบี ต.ในเมือง อ.เมืองขอนแก่น 40000")).toEqual([
			"คุณเอ ต.สุเทพ อ.เมืองเชียงใหม่ 50200",
			"คุณบี ต.ในเมือง อ.เมืองขอนแก่น 40000",
		]);
		expect(blocks("คนโต คุณเอ ต.สุเทพ อ.เมืองเชียงใหม่ 50200\nคนกลาง คุณบี ต.ในเมือง อ.เมืองขอนแก่น 40000")[1]).toBe("คุณบี ต.ในเมือง อ.เมืองขอนแก่น 40000");
		expect(blocks("A) ร้านเอ ต.สุเทพ อ.เมืองเชียงใหม่ 50200\nB) ร้านบี ต.ในเมือง อ.เมืองขอนแก่น 40000")[1]).toBe("ร้านบี ต.ในเมือง อ.เมืองขอนแก่น 40000");
	});

	test("a branch or drop-off number written mid-line inside one delivery does not split it", () => {
		expect(split("บจก.เอ ต.สุเทพ อ.เมืองเชียงใหม่ ห้างเอ สาขา 2 จ.เชียงใหม่ 50200 0811112233")).toHaveLength(1);
		expect(split("คุณเอ ต.สุเทพ อ.เมืองเชียงใหม่ ใกล้จุด 3 จ.เชียงใหม่ 50200")).toHaveLength(1);
	});
});

describe("one delivery stays one recipient", () => {
	test.each([
		["two phones", "คุณกอล์ฟ 0812345678 หรือ 0898765432 44/1 ต.สุเทพ อ.เมืองเชียงใหม่ จ.เชียงใหม่ 50200"],
		[
			"an old address taken back",
			"ที่อยู่เก่า 19 ม.2 ต.กุดยาลวน อ.ตระการพืชผล ไม่ใช้แล้ว\nนางสาวสุภาวดี 205 ม.8 ต.ขุหลุ อ.ตระการพืชผล อุบลราชธานี 34130",
		],
		["a postcode taken back", "66 ม.10 ต.ยาง อ.กันทรารมย์ ศรีสะเกษ 33130 (รหัส 33130 นะ ไม่ใช่ 33000)"],
	])("%s", (_, raw) => {
		const result = parser.parse(raw);
		expect(result.recipients).toHaveLength(1);
		expect(result.warnings).not.toContain("multiple-recipients");
	});

	test("no single-delivery record of the train pool, dev, or test1 is split", async () => {
		const map = locationMap(locations);
		const benchFiles = (await readdir(join(CHAT_ROOT, "bench"))).filter((file) => file.endsWith(".txt") && !HOLDOUT_FILE.test(file));
		const bench = await Promise.all(benchFiles.map((file) => loadSourceFile(join(CHAT_ROOT, "bench", file), "bench", map)));
		const records = [...(await loadChatPool("train", locations)).records, ...bench.flatMap((loaded) => loaded.records)];
		const split = createSplitter(locations);
		const wrong = records.filter((record) => record.recipients.length === 1 && split(record.raw).length > 1);
		expect(wrong.map((record) => record.id)).toEqual([]);
	});
});
