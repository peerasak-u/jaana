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
