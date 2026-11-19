import { normalizeCandidate, normalizePostcode } from "../../src/normalize";
import { goldPhone } from "../chat/markup";
import type { ExpectedAddress } from "../dataset";

export const SYSTEM_PROMPT = "You extract Thai shipping addresses. Reply with JSON only.";

interface Example {
	readonly message: string;
	readonly recipients: readonly ExpectedAddress[];
}

/** The worked examples of bench/chat/GUIDE.md, with admin fields from their `loc:` lines. */
const EXAMPLES: readonly Example[] = [
	{
		message: "ส่งที่นี่นะคะ\nคุณวิไลพร ทองดี โทร 089-123-4567\n45/2 ม.3 ซ.วัดดอน ต.ดอนกระเบื้อง อ.โพธาราม จ.ราชบุรี 70120\nขอบคุณค่ะ 🙏",
		recipients: [{ name: "คุณวิไลพร ทองดี", phone: "0891234567", address: "45/2 ม.3 ซ.วัดดอน", subdistrict: "ดอนกระเบื้อง", district: "โพธาราม", province: "ราชบุรี", zipcode: "70120" }],
	},
	{
		message: "99 หมู่บ้านสุขใจ โทร๐๘๑ ๒๓๔ ๕๖๗๘ อ.เมือง สมุทรปรากาน10270 บจก.รุ่งเรืองการค้า (คุณเอ)",
		recipients: [{ name: "บจก.รุ่งเรืองการค้า (คุณเอ)", phone: "0812345678", address: "99 หมู่บ้านสุขใจ", subdistrict: null, district: "เมืองสมุทรปราการ", province: "สมุทรปราการ", zipcode: "10270" }],
	},
	{
		message: "1. คุณวิไลพร ทองดี 089-123-4567 45/2 ม.3 ต.บ่อกระดาน อ.ปากท่อ 70140\n2. ส่งให้แม่ คุณสมศรี ทองดี 12 ม.5 ต.กำแพงเพชร อ.รัตภูมิ สงขลา 90180",
		recipients: [
			{ name: "คุณวิไลพร ทองดี", phone: "0891234567", address: "45/2 ม.3", subdistrict: "บ่อกระดาน", district: "ปากท่อ", province: null, zipcode: "70140" },
			{ name: "คุณสมศรี ทองดี", phone: null, address: "12 ม.5", subdistrict: "กำแพงเพชร", district: "รัตภูมิ", province: "สงขลา", zipcode: "90180" },
		],
	},
];

const INSTRUCTIONS = `Extract the shipping address from a chat message a Thai online shopper sent to a seller.

Return exactly one JSON object and nothing else:
{"recipients":[{"name":...,"phone":...,"address":...,"subdistrict":...,"district":...,"province":...,"zipcode":...}]}
Every value is a string or null.

General rule: extract only what the shopper wrote. A field the message does not contain is null. Never infer a field from another one (for example, never fill province or district from the postcode, and never fill the postcode from the place names).

name, the recipient:
- The one string that names who receives the parcel, as written.
- Keep the honorific or title (คุณ, นาย, น.ส., ดร., K., Khun, Mr.), a kinship or call word joined to the name (ป้าน้อย, ลุงสมพงษ์, น้องมายด์, ครูวาสนา), and a company's legal form (บริษัท ... จำกัด, บจก., หจก., ร้าน).
- Keep brackets right after the name that hold a nickname, relation, department or contact person: "คุณสมศรี ใจดี (แม่)", "บจก.เอบีซี (attn. คุณบี)".
- Drop the label (ชื่อ:, ชื่อเล่น, ชื่อเล่นคือ, ผู้รับ, ส่งให้, ถึง, attn.) and particles after the name (ค่ะ, ครับ, นะคะ).
- Drop a bracket holding a contact handle (starting with LINE, ไลน์, IG, FB, Facebook, เฟส, ID ไลน์, @) and a bracket holding only a province or district name such as (กทม.) or (เชียงใหม่).
- An organisation and its contact person written next to each other on one line are one name. A person and an organisation written apart: the person is the name and the organisation goes in address. With no person, the organisation is the name.
- A department or job title next to a person, with no organisation on that line, is not part of the name.
- With a buyer and a different recipient, or a proxy (ฝากให้แม่ คุณสมศรี), the name is the person who receives.

phone:
- The recipient's number, digits only as typed: drop separators, make Thai digits ASCII, read a leading +66 or 66 as 0. Never add or drop a digit, even if the length looks wrong.
- When the buyer and the recipient each give a number, take the recipient's. With two numbers for one person, take the first, unless the message corrects it (แก้เบอร์เป็น ...), then take the corrected one.
- Never an extension, order number, tracking number, LINE ID or 13-digit tax ID.

address:
- Everything that locates the place below the subdistrict: house number (บ้านเลขที่ and เลขที่ stay), หมู่, village, building, floor, room, soi, road, a place used as the location (school, company, market, temple), and a landmark that says where it is, brackets included ("12 ม.4 (ตรงข้ามวัดป่า)").
- Drop labels (ที่อยู่:, ส่งที่), edge punctuation, courier instructions (โทรก่อนส่ง, ฝากไว้ที่ป้อมยาม), greetings, order details and payment notes.
- When other fields interrupt it, join the pieces with one space in the order written.

subdistrict, district, province:
- The official gazetteer name without its prefix (no ตำบล/ต./แขวง/อำเภอ/อ./เขต/จังหวัด/จ.), with typos fixed and nicknames or romanized forms expanded (กทม → กรุงเทพมหานคร, โคราช → นครราชสีมา, Bang Na → บางนา).
- อ.เมือง is เมือง plus the province name, for example เมืองราชบุรี.
- A subdistrict and district with the same name written twice: the first is subdistrict, the second district. Written once without a prefix: it is the district.
- A place name inside a road or village name (ถ.สกล-นาแก, หมู่บ้านเมืองทอง) belongs to address.

zipcode: the 5-digit postcode in ASCII digits, as written.

Several deliveries (numbered orders, ส่วนอีกที่, a gift next to the buyer's own address, work and home of one person): one object per delivery, in written order. A field written once for two deliveries appears only in the delivery where it is written; it is null in the other.`;

function exampleText({ message, recipients }: Example, index: number): string {
	return `Example ${index + 1}\nMessage:\n${message}\nJSON:\n${JSON.stringify({ recipients })}`;
}

export function userPrompt(message: string): string {
	return `${INSTRUCTIONS}\n\n${EXAMPLES.map(exampleText).join("\n\n")}\n\nNow the real message.\nMessage:\n${message}\nJSON:`;
}

const ADMIN_PREFIX = /^(?:ตำบล|ต\.|แขวง|อำเภอ|อ\.|เขต|จังหวัด|จ\.)\s*/u;

function clean(value: unknown): string | null {
	if (typeof value !== "string" && typeof value !== "number") return null;
	const text = String(value).trim().replace(/\s+/gu, " ");
	return text === "" ? null : text;
}

function admin(value: unknown): string | null {
	const text = clean(value);
	return text === null ? null : clean(text.replace(ADMIN_PREFIX, ""));
}

function jsonOf(text: string): unknown {
	const unfenced = text.replace(/```(?:json)?/giu, "");
	const start = unfenced.indexOf("{");
	const end = unfenced.lastIndexOf("}");
	if (start < 0 || end < start) return null;
	try {
		return JSON.parse(unfenced.slice(start, end + 1));
	} catch {
		return null;
	}
}

/**
 * Formatting only: the answer's JSON, whitespace collapsed, admin prefixes
 * dropped, and phone, postcode and address put in the gold's canonical form.
 * Null when the answer holds no `recipients` array of objects.
 */
export function parseAnswer(text: string): ExpectedAddress[] | null {
	const json = jsonOf(text) as { recipients?: unknown } | null;
	if (!json || !Array.isArray(json.recipients)) return null;
	if (!json.recipients.every((item) => typeof item === "object" && item !== null)) return null;
	return (json.recipients as Record<string, unknown>[]).map((item) => {
		const phone = clean(item.phone);
		const zipcode = clean(item.zipcode);
		const address = clean(item.address);
		return {
			name: clean(item.name),
			phone: phone === null ? null : (goldPhone(phone) ?? (phone.replace(/\D/gu, "") || null)),
			address: address === null ? null : normalizeCandidate("ADDRESS_DETAIL", address),
			subdistrict: admin(item.subdistrict),
			district: admin(item.district),
			province: admin(item.province),
			zipcode: zipcode === null ? null : (normalizePostcode(zipcode) ?? zipcode),
		};
	});
}
