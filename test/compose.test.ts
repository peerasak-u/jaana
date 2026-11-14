import { describe, expect, test } from "bun:test";
import { composeRecipient, type Range } from "../src/tagger/compose";

function at(raw: string, text: string): Range {
	const start = raw.indexOf(text);
	if (start < 0) throw new Error(`${text} is not in ${raw}`);
	return { start, end: start + text.length };
}

function compose(raw: string, person: string | null, orgs: readonly string[]) {
	const recipient = composeRecipient(raw, person ? at(raw, person) : null, orgs.map((org) => at(raw, org)));
	return {
		name: recipient.name ? raw.slice(recipient.name.start, recipient.name.end) : null,
		address: recipient.address.map((range) => raw.slice(range.start, range.end)),
	};
}

describe("recipient composition", () => {
	const cases: readonly [string, string, string | null, readonly string[], string | null, readonly string[]][] = [
		["organisation then bracketed person on one line", "บจก.รุ่งเรือง (คุณเอ) 12/3 ถ.มิตรภาพ", "(คุณเอ)", ["บจก.รุ่งเรือง"], "บจก.รุ่งเรือง (คุณเอ)", []],
		["person then organisation on one line", "ครูวาสนา ปินตา โรงเรียนบ้านดง ม.3", "ครูวาสนา ปินตา", ["โรงเรียนบ้านดง"], "ครูวาสนา ปินตา โรงเรียนบ้านดง", []],
		["organisation and person joined by a slash", "หจก.ไชยวาน / คุณบุญเลิศ", "คุณบุญเลิศ", ["หจก.ไชยวาน"], "หจก.ไชยวาน / คุณบุญเลิศ", []],
		["organisation on its own line goes to the address", "ร้านขายยาธีรเภสัช\nภก.ธีรวัฒน์ ใจบุญ\nเลขที่ 201", "ภก.ธีรวัฒน์ ใจบุญ", ["ร้านขายยาธีรเภสัช"], "ภก.ธีรวัฒน์ ใจบุญ", ["ร้านขายยาธีรเภสัช"]],
		["a field between them keeps them apart", "คุณสมชาย 0812345678 บริษัท เอบีซี จำกัด", "คุณสมชาย", ["บริษัท เอบีซี จำกัด"], "คุณสมชาย", ["บริษัท เอบีซี จำกัด"]],
		["an organisation with no person is the name", "หจก.ศรีวิไลการโยธา 55 ม.2", null, ["หจก.ศรีวิไลการโยธา"], "หจก.ศรีวิไลการโยธา", []],
		["with no person a later organisation apart from the first is address", "ร้านเจ๊ติ๋ม\nตลาดสด วัดบางพลี", null, ["ร้านเจ๊ติ๋ม", "วัดบางพลี"], "ร้านเจ๊ติ๋ม", ["วัดบางพลี"]],
		["a person alone is the name", "คุณสมชาย ใจดี 12 ม.3", "คุณสมชาย ใจดี", [], "คุณสมชาย ใจดี", []],
		["nothing tagged gives no name", "12 ม.3", null, [], null, []],
	];
	for (const [title, raw, person, orgs, name, address] of cases) {
		test(title, () => {
			expect(compose(raw, person, orgs)).toEqual({ name, address: [...address] });
		});
	}

	test("a person bracket left open by the Tagger is closed", () => {
		expect(compose("บจก.รุ่งเรือง (คุณเอ) 12/3", "(คุณเอ", ["บจก.รุ่งเรือง"]).name).toBe("บจก.รุ่งเรือง (คุณเอ)");
	});
});
