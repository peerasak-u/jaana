import { describe, expect, test } from "bun:test";
import { loadParserResources } from "../bench/gazetteer";
import { normalizePhone } from "../src/normalize";
import { createTaggerParser } from "../src/tagger/parser";
import type { TaggerModel } from "../src/tagger/model";

const { locations } = await loadParserResources("resources/gazetteer.json");
const shippedModel = (await Bun.file("resources/tagger-model.json").json()) as TaggerModel;
const parser = createTaggerParser(shippedModel, locations);

const CHIANG_MAI = "ต.สุเทพ อ.เมืองเชียงใหม่ จ.เชียงใหม่ 50200";

function parsed(raw: string) {
	const result = parser.parse(raw);
	expect(result.recipients[0]!.fields).toEqual(result.fields);
	return result;
}

describe("phone length (issue #6 D1)", () => {
	test.each([
		["11 digits", `คุณกอล์ฟ 08123456789 44/1 ${CHIANG_MAI}`, "08123456789"],
		["12 digits", `คุณกอล์ฟ 081234567891 44/1 ${CHIANG_MAI}`, "081234567891"],
		["11 digits with dashes", `คุณกอล์ฟ 081-234-56789 44/1 ${CHIANG_MAI}`, "08123456789"],
		["11 digits at the end", `คุณกอล์ฟ 44/1 ${CHIANG_MAI} 08123456789`, "08123456789"],
		["9-digit mobile", `คุณกอล์ฟ 081234567 44/1 ${CHIANG_MAI}`, "081234567"],
	])("keeps a %s number as typed and warns", (_, raw, phone) => {
		const result = parsed(raw);
		expect(result.fields.phone).toBe(phone);
		expect(result.fields.address).toBe("44/1");
		expect(result.warnings).toContain("phone-length");
	});

	test.each([
		["10-digit mobile", `คุณกอล์ฟ 0812345678 44/1 ${CHIANG_MAI}`, "0812345678"],
		["9-digit landline", `คุณกอล์ฟ 021234567 44/1 ${CHIANG_MAI}`, "021234567"],
	])("takes a %s without a warning", (_, raw, phone) => {
		const result = parsed(raw);
		expect(result.fields.phone).toBe(phone);
		expect(result.warnings).not.toContain("phone-length");
	});

	test("still gives up a digit glued to the next address word", () => {
		const result = parsed(`ส่งทองใบ08744120939ม.7 ${CHIANG_MAI}`);
		expect(result.fields.phone).toBe("0874412093");
		expect(result.warnings).not.toContain("phone-length");
	});

	test("never takes a 13-digit tax ID as the phone", () => {
		expect(parsed(`บจก.เอ 0105556012345 44/1 ${CHIANG_MAI}`).fields.phone).toBeNull();
		expect(parsed(`คุณกอล์ฟ เลขผู้เสียภาษี 0105556012345 44/1 ${CHIANG_MAI}`).fields.phone).toBeNull();
	});

	test("leaves the Candidate Engine's phone rule at 9 or 10 digits", () => {
		expect(normalizePhone("08123456789")).toBeNull();
		expect(normalizePhone("0812345678")).toBe("0812345678");
	});
});

describe("name boundaries (issue #6 C1, LINE)", () => {
	test.each([
		"ชื่อเล่น สุรินทร์",
		`ชื่อเล่น สุรินทร์ 081-234-5678 12 ม.4 ${CHIANG_MAI}`,
		`ชื่อเล่นคือ สุรินทร์ 081-234-5678 12 ม.4 ${CHIANG_MAI}`,
	])("drops the nickname label from %s", (raw) => {
		expect(parsed(raw).fields.name).toBe("สุรินทร์");
	});

	test.each([
		`คุณบีม (LINE: beam_shop) 99 ม.2 ${CHIANG_MAI}`,
		`คุณบีม (ไลน์ beam) 99 ม.2 ${CHIANG_MAI}`,
		`คุณบีม (@beam) 99 ม.2 ${CHIANG_MAI}`,
		`คุณบีม (เชียงใหม่) 99 ม.2 ${CHIANG_MAI}`,
		"คุณบีม (กทม.) 99 ถ.สุขุมวิท แขวงบางนา เขตบางนา กรุงเทพฯ 10260",
		"คุณบีม (บางกอก) 99 ถ.สุขุมวิท แขวงบางนา เขตบางนา กรุงเทพฯ 10260",
	])("keeps a contact or place bracket out of the name in %s", (raw) => {
		const result = parsed(raw);
		expect(result.fields.name).toBe("คุณบีม");
		expect(result.fields.address).toStartWith("99");
	});

	test.each(["น้องแอน", "แม่"])("keeps a (%s) bracket in the name", (inner) => {
		expect(parsed(`คุณบีม (${inner}) 99 ม.2 ${CHIANG_MAI}`).fields.name).toBe(`คุณบีม (${inner})`);
	});
});

describe("name typed on the English layout (issue #6 R5)", () => {
	test("reads a Kedmanee-mistyped name as Thai", () => {
		expect(parsed(`l;ylfu 0812345678 99 ม.2 ${CHIANG_MAI}`).fields.name).toBe("สวัสดี");
	});

	test("leaves an English name alone", () => {
		expect(parsed(`Mayuree S. 0812345678 99 ม.2 ${CHIANG_MAI}`).fields.name).toBe("Mayuree S.");
	});
});
