import { describe, expect, test } from "bun:test";
import { loadParserResources } from "../bench/gazetteer";
import { createTaggerParser } from "../src/tagger/parser";
import type { TaggerModel } from "../src/tagger/model";

const { locations } = await loadParserResources("resources/gazetteer.json");
const parser = createTaggerParser((await Bun.file("resources/tagger-model.json").json()) as TaggerModel, locations);
const fields = (raw: string) => parser.parse(raw).fields;

describe("contact handles stay out of the name and the address", () => {
	test.each([
		["after the name", "ป้าสมจิต ไลน์ somjit1960 เบอร์ 0815526031 12 หมู่ 7 ตำบลนาราชควาย อำเภอเมือง นครพนม 48000", "ป้าสมจิต"],
		["after the name with ID", "พี่แนน line id nan.bp 88/19 ซ.จรัญสนิทวงศ์ 69 บางพลัด กทม. 10700 0866104925", "พี่แนน"],
		["glued to the name", "คุณแพรไลน์@prae.loei ส่ง14 ม.6ต.ผาน้อยอ.วังสะพุงจ.เลย42130 0882219904", "คุณแพร"],
		["an @handle before the name", "@nok.phangnga นก นะคะ ส่ง 12/2 ม.5 เหล กะปง พังงา 82170 โทร 0631127459", "นก"],
		["a bracketed handle before the name", "(Line: nid_amnat) นิด 20 ม.11 ต.นาป่าแซง อ.ปทุมราชวงศา อำนาจเจริญ37110 0846620179", "นิด"],
		["FB and IG after the name", "คุณสมใจ ทองแท้ FB สมใจ ทองแท้ / IG somjai.t\n101 ม.2 ต.ตะกรบ อ.ไชยา สุราษฎร์ธานี 84110\n0879413365", "คุณสมใจ ทองแท้"],
	])("cuts a handle written %s", (_, raw, name) => {
		expect(fields(raw).name).toBe(name);
	});

	test("drops a handle line from the address", () => {
		const result = fields("ส่งให้ ลุงสมพร ใจปิง ครับ\nFB: Somporn Jaiping\n7 หมู่ 11 บ้านเรือน ป่าซาง ลำพูน\n0850147723");
		expect(result.address).toBe("7 หมู่ 11");
	});

	test("keeps a department named after the LINE and a housing estate phase", () => {
		expect(fields("คุณสมพร ดีมาก (หัวหน้าไลน์ 2)\n199 ม.8 ต.นาบัว อ.นครไทย พิษณุโลก 65120\n0856630192").name)
			.toBe("คุณสมพร ดีมาก (หัวหน้าไลน์ 2)");
		expect(fields("ส่งที่ 55/123 มบ.อยู่เจริญ เฟส2 ซ.หทัยราษฎร์ 33 แขวงสามวาตะวันออก เขตคลองสามวา กทม 10510 คุณบุญเรือน 0997745521").address)
			.toContain("เฟส2");
	});
});

describe("names", () => {
	test.each([
		["ชื่อเล่นคือต้อมครับ 093-118-2046 56 หมู่ 9 โคกกกม่วง โพนทอง ร้อยเอ็ด", "ต้อม"],
		["ชื่อเล่น:ต่าย / 088-317-6624 / 5 ม.10 ต.นาวัง อ.เมืองอำนาจเจริญ 37000 ปลายทางค่ะ", "ต่าย"],
	])("takes the nickname after its label when nothing else is the name: %s", (raw, name) => {
		expect(fields(raw).name).toBe(name);
	});

	test("keeps a district bracket out of the name", () => {
		expect(fields("อ้อย (อ.ชุมแพ) 0864071125\n241 ม.13 บ้านโนนสะอาด จ.ขอนแก่น 40130").name).toBe("อ้อย");
	});

	test("reads a province nickname in a bracket as the province", () => {
		const result = fields("พี่ตาล (บางกอก) 0937718025 45/8 ซ.เพชรเกษม 69 บางแคเหนือ บางแค 10160");
		expect(result.name).toBe("พี่ตาล");
		expect(result.province).toBe("กรุงเทพมหานคร");
	});

	test("leaves a department written after a person out of the name", () => {
		expect(fields("ส่งที่ทำงานครับ\nคุณกฤษดา ฝ่ายไอที\nอาคารเอสพี ชั้น 9 ถ.งามวงศ์วาน\nแขวงลาดยาว เขตจตุจักร\n081-605-3324").name)
			.toBe("คุณกฤษดา");
	});

	test("keeps the legal form of an English company name", () => {
		const result = fields("Mint Studio Co., Ltd. Fl. 11 Platinum Square, 222 Phetchaburi Rd. Ratchathewi Bangkok 10400 tel 02-650-1188");
		expect(result.name).toBe("Mint Studio Co., Ltd.");
		expect(result.address).toBe("Fl. 11 Platinum Square, 222 Phetchaburi Rd.");
	});
});

describe("phones as typed", () => {
	test.each([
		["glued to a particle", "7 ม.12 ต.หนองกง อ.นางรอง 31110 ผู้รับแพรวา09154420871ค่ะ", "09154420871"],
		["glued to the house number label", "นางสาวพิมพ์ชนก แสนดี โทร0432281907บ้านเลขที่14 ม.2 ต.ทางขวาง อ.แวงน้อย ขอนแก่น 40230", "0432281907"],
		["with a digit group at the line end", "ยายจำปี 09 3318 2204 71\n5 ม.6 บ้านบึง บ้านคา ราชบุรี", "093318220471"],
	])("keeps a number %s", (_, raw, phone) => {
		expect(fields(raw).phone).toBe(phone);
	});

	test("gives a house number digit glued before the number back to the address", () => {
		const result = fields("ธีรวัฒน์ จันทร์หอม 47ม.6061904337ต.หนองไม้แก่น อ.แปลงยาว แปดริ้ว 24190");
		expect(result.phone).toBe("061904337");
		expect(result.address).toBe("47ม.6");
	});

	test("keeps tax ID labels out of the address", () => {
		expect(fields("บริษัท หนองแคฟีดมิลล์ จำกัด\nเลขที่ภาษี 0195547001836\n88 ม.5 ถ.พหลโยธิน ต.หนองปลิง อ.หนองแค สระบุรี 18140\nโทร 036-370-582").address)
			.toBe("88 ม.5 ถ.พหลโยธิน");
	});
});

describe("administrative spans re-cut against the gazetteer", () => {
	test.each([
		["a romanized district split from its prefix", "Somchai P. 15/3 Soi Ekachai 76 Khet Bangbon 10150 Tel 0891234590", { district: "บางบอน", province: null }],
		["a romanized district tagged as the province", "Pim Dorm 2 Rm. 314, 126 Pracha Uthit Rd. Thung Khru 10140 0941268833", { district: "ทุ่งครุ", province: null }],
		["a romanized name split in three", "send 2 K.Bow 55/9 Soi Nakniwat 48 Chorakhe Bua Lat Prao 10230 0612245098", { subdistrict: "จรเข้บัว", district: "ลาดพร้าว" }],
		["a Thai subdistrict tagged as the district", "นายเฉลิม ทองอยู่ 18 ม.5 บางกระบือ ปทุม 0852208746 ครับ", { subdistrict: "บางกระบือ", province: "ปทุมธานี" }],
		["a Thai subdistrict written with a space", "กัญญารัตน์ เพชรรัตน์\n212/3 ถ.ชายน้ำ ต.ปากพนังฝั่ง ตะวันตก 80140\n0805517632", { subdistrict: "ปากพนังฝั่งตะวันตก" }],
	])("%s", (_, raw, expected) => {
		const parsed = parser.parse(raw);
		const written = { ...parsed.fields, ...Object.fromEntries(parsed.inferred.map((field) => [field, null])) };
		expect(written).toMatchObject(expected);
	});

	test("keeps a short province alias the tagger cut on its own", () => {
		const result = parser.parse("ส่ง ป้าสมใจ ศรีทอง 61 ม.2 ต.บ้านทำเนียบ อ.คีรีรัฐ สุราษ 84180");
		expect(result.fields.province).toBe("สุราษฎร์ธานี");
		expect(result.inferred).not.toContain("province");
	});
});

describe("district names written short", () => {
	test.each([
		["แม่ประนอม 46 ม.2 บ้านหนองแสง อ.จตุรพักตร์ เบอร์ 0619902734", "จตุรพักตรพิมาน"],
		["คุณครูรัตนา บ.ดอนกลาง ม.1 เลขที่ 66 อ.โกสุม โทร 0647701253", "โกสุมพิสัย"],
		["คุณปิยนุช แก้วมณี\n111/27 มบ.ศุภาลัยวิลล์\nต.บางรักน้อย อ.เมืองนนท์\n0896631047", "เมืองนนทบุรี"],
	])("resolves %s", (raw, district) => {
		expect(parser.parse(raw).fields.district).toBe(district);
	});
});
