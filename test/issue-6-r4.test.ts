import { describe, expect, test } from "bun:test";
import { loadParserResources } from "../bench/gazetteer";
import { createTaggerParser } from "../src/tagger/parser";
import type { AnyTaggerModel } from "../src/tagger/model";

const { locations } = await loadParserResources("resources/gazetteer.json");
const parser = createTaggerParser((await Bun.file("resources/tagger-model.json").json()) as AnyTaggerModel, locations);
/** The fields as the bench scores them: a field filled from the gazetteer rather than written counts as null. */
const fields = (raw: string) => {
	const result = parser.parse(raw);
	return { ...result.fields, ...Object.fromEntries(result.inferred.map((field) => [field, null])) };
};

describe("contact handle cues", () => {
	test("a handle labelled with its owner, as `ไลน์ป้า:`, stays out of the address", () => {
		const result = fields("ส่งสวนมะม่วงนะคะ\nป้าแดง ไลน์ป้าแดง: daeng.mango\n18 ม.4 สวนมะม่วงป้าแดง ต.ท่าช้าง อ.บางกล่ำ สงขลา 90110\n081-5534120");
		expect(result.address).toBe("18 ม.4 สวนมะม่วงป้าแดง");
		expect(result.name).toBe("ป้าแดง");
	});

	test("a colon with no owner word still reads as before", () => {
		expect(fields("คุณนก ไลน์: nok_shop 12 ม.3 ต.ท่าช้าง อ.บางกล่ำ สงขลา 90110 0815534120").address).toBe("12 ม.3");
	});

	test("a page cue `เพจ` keeps the page name out of the shop name", () => {
		expect(fields("ร้านกาแฟบ้านสวน เพจ บ้านสวนคอฟฟี่ 45 ถ.ราษฎร์ยินดี ต.หาดใหญ่ อ.หาดใหญ่ สงขลา 90110 074-231-556").name)
			.toBe("ร้านกาแฟบ้านสวน");
	});

	test("a page in brackets after the name is a contact bracket", () => {
		expect(fields("ส่งให้น้องบีม (เพจ Beam Shop) 9 ม.4 ต.บ้านเหล่า อ.แม่ใจ พะเยา 56130 0899988776").name).toBe("น้องบีม");
	});

	test("the misspelt cue `ไรน์` is a cue", () => {
		expect(fields("ส่งพี่ฝน ไรน์ fon_9988 ค่ะ 9 ม.2 ต.ท่าช้าง อ.บางกล่ำ สงขลา 90110 0815534120").name).toBe("พี่ฝน");
	});

	test("a word that only contains `เพจ` text is not a cue", () => {
		expect(fields("คุณเพจลดา ใจดี 9 ม.2 ต.ท่าช้าง อ.บางกล่ำ สงขลา 90110 0815534120").name).toBe("คุณเพจลดา ใจดี");
	});
});

describe("a handle that opens a line", () => {
	test("stops at a name label, so the labelled name survives", () => {
		expect(fields("ไลน์ นิดหน่อย ชื่อจริง นิดา แก้วมณี\n7 ม.1 ต.ท่าช้าง อ.บางกล่ำ สงขลา 90110 0815534120").name).toBe("นิดา แก้วมณี");
	});

	test("with only a handle on the line still clears the line", () => {
		expect(fields("เฟส มะปราง สวยใส\nคุณมะปราง 7 ม.1 ต.ท่าช้าง อ.บางกล่ำ สงขลา 90110 0815534120").name).toBe("คุณมะปราง");
	});
});

describe("a name the tagger read inside a handle", () => {
	test("is the name written just before the handle on its line", () => {
		expect(fields("ส่ง Ploy 🌼 (IG: ploy.pl) 12/3 ซ.ลาดพร้าว 15 แขวงจอมพล เขตจตุจักร กทม 10900 0918812345 ค่ะ").name).toBe("Ploy 🌼");
	});

	test("is the name on the line above a handle line", () => {
		const raw = "เอาสีแดงค่ะ\nส่ง แม่น้องใบเตยนะคะ\nไลน์ชื่อ baitoey mama\n9 ม.12 บ้านยาง เกษตรสมบูรณ์ ชัยภูมิ 36120\nเบอร์ 0645518823 ค่ะ";
		expect(fields(raw).name).toBe("แม่น้องใบเตย");
	});

	test("never takes a chat line above with digits or a long sentence", () => {
		const raw = "สั่งเสื้อ 2 ตัวค่ะ\nเฟส: Prayoon Thongdee\n5 ม.1 ต.ท่าช้าง อ.บางกล่ำ สงขลา 90110 0815534120";
		expect(fields(raw).name).not.toBe("สั่งเสื้อ 2 ตัวค่ะ");
	});
});

describe("a name after the label `ชื่อ`", () => {
	test("is the name when nothing else is", () => {
		expect(fields("ไลน์ ploy.br ค่ะ ส่งให้น้องชื่อ เตย นะ เบอร์น้อง 0618814532 21/7 ถ.สุขุมวิท กลันทา เมือง บุรีรัมย์").name).toBe("เตย");
	});

	test("a shop name label is not a person's name", () => {
		expect(fields("ชื่อ: ร้านป้าแดง 0618814532 21/7 ถ.สุขุมวิท กลันทา เมือง บุรีรัมย์").name).not.toBe("ร้าน");
	});

	test("does not replace a name the tagger found", () => {
		expect(fields("คุณสมศรี ใจดี ชื่อเล่น ศรี\n7 ม.1 ต.ท่าช้าง อ.บางกล่ำ สงขลา 90110 0815534120").name).toBe("คุณสมศรี ใจดี");
	});
});

describe("a branch designation after a company name", () => {
	test("written outside brackets is left out of the name", () => {
		expect(fields("บริษัท ไทยรุ่งเรืองค้าส่ง จำกัด สำนักงานใหญ่\n12 ถ.ราษฎร์ยินดี ต.หาดใหญ่ อ.หาดใหญ่ สงขลา 90110\n074-231-556").name)
			.toBe("บริษัท ไทยรุ่งเรืองค้าส่ง จำกัด");
	});

	test("a named branch stays in the name", () => {
		expect(fields("คลินิกหมอฟัน สาขาหาดใหญ่\n12 ถ.ราษฎร์ยินดี ต.หาดใหญ่ อ.หาดใหญ่ สงขลา 90110\n074-231-556").name)
			.toBe("คลินิกหมอฟัน สาขาหาดใหญ่");
	});
});

describe("an administrative name cut short with `ฯ`", () => {
	test("resolves to the one province it opens", () => {
		expect(fields("คุณดาว 12 ม.3 ตำบลทุ่งพง อุทัยฯ 0817739025").province).toBe("อุทัยธานี");
		expect(fields("คุณดาว 12 ม.3 ตำบลท่าชนะ สุราษฎร์ฯ 0817739025").province).toBe("สุราษฎร์ธานี");
	});

	test("a full province name is unaffected", () => {
		expect(fields("คุณดาว 12 ม.3 ตำบลทุ่งพง อุทัยธานี 0817739025").province).toBe("อุทัยธานี");
	});
});

describe("a romanized province alias in another case", () => {
	test("in a bracket after the name gives the province", () => {
		expect(fields("Khun Nam (BKK)\n9/12 Soi Sukhumvit 50 Phra Khanong Khlong Toei 10110\n0898143267").province).toBe("กรุงเทพมหานคร");
	});
});

describe("a romanized road suffix", () => {
	test("`Rd` before an unpunctuated administrative name stays in the address", () => {
		expect(fields("Nok 0891234567 77/1 Ramkhamhaeng Rd Hua Mak Bang Kapi Bangkok 10240").address).toBe("77/1 Ramkhamhaeng Rd");
	});

	test("a road name after a comma joins the address with its suffix", () => {
		const result = fields("Ton 0891234567 5/5 Soi Pradit 3, Pradit Rd Bang Phongphang Yan Nawa Bangkok 10120");
		expect(result.address).toBe("5/5 Soi Pradit 3, Pradit Rd");
	});

	test("an address without a road suffix is unaffected", () => {
		expect(fields("Nok 0891234567 77/1 Soi Ramkhamhaeng 24 Hua Mak Bang Kapi Bangkok 10240").address).toBe("77/1 Soi Ramkhamhaeng 24");
	});
});

describe("a bare subdistrict after the หมู่ number", () => {
	test("is the subdistrict when the message writes no other", () => {
		const result = fields("นายสมหมาย ใจกล้า\n44 ม.6 ห้วยสำราญ\n0623317095");
		expect(result.subdistrict).toBe("ห้วยสำราญ");
		expect(result.address).toBe("44 ม.6");
	});

	test("a village with `บ้าน` stays in the address", () => {
		expect(fields("นายสมหมาย ใจกล้า\n44 ม.6 บ้านหนองบัว\n0623317095").address).toBe("44 ม.6 บ้านหนองบัว");
	});

	test("a word that is no subdistrict stays in the address", () => {
		expect(fields("นายสมหมาย ใจกล้า\n44 ม.6 ซอยมะขาม\n0623317095").address).toBe("44 ม.6 ซอยมะขาม");
	});
});

describe("a tagged subdistrict that names a sibling of the anchored one", () => {
	test("wins over a village named after another subdistrict", () => {
		const result = fields("นายอาลี 12 หมู่ 2 บ้านทุ่งขมิ้น นาหม่อม อ.นาหม่อม สงขลา 90310 0846613207");
		expect(result.subdistrict).toBe("นาหม่อม");
		expect(result.address).toBe("12 หมู่ 2 บ้านทุ่งขมิ้น");
	});
});
