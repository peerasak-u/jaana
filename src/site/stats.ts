import type { FieldName } from "../types";

/** True while the numbers below are stand-ins. The page shows a "ตัวเลขชั่วคราว" badge. */
export const PLACEHOLDER = false;

/** Public repository URL. The page hides every repository link while this is empty. */
export const REPO_URL = "https://github.com/peerasak-u/jaana";

export interface CategoryRow {
	readonly category: string;
	readonly labelThai: string;
	readonly exact: number;
	readonly records: number;
}

export interface FieldAccuracy {
	readonly field: FieldName;
	/** Share of holdout records whose field matches gold exactly, 0 to 1. */
	readonly accuracy: number;
}

export interface SiteStats {
	readonly measuredOn: string;
	readonly holdout: { readonly exact: number; readonly records: number };
	readonly categories: readonly CategoryRow[];
	readonly fields: readonly FieldAccuracy[];
	readonly modelGzipKB: number;
	readonly gazetteerGzipKB: number;
	readonly parseMs: { readonly median: number; readonly p95: number };
	readonly datasets: {
		readonly trainRecords: number;
		readonly holdoutRecords: number;
		readonly gazetteerTuples: number;
	};
	readonly caveats: readonly string[];
}

export const STATS: SiteStats = {
	measuredOn: "2026-11-16",
	holdout: { exact: 826, records: 860 },
	categories: [
		{ category: "person-multiline", labelThai: "บุคคล หลายบรรทัด", exact: 66, records: 67 },
		{ category: "person-oneline", labelThai: "บุคคล บรรทัดเดียว", exact: 59, records: 60 },
		{ category: "chat-noise", labelThai: "ปนบทสนทนา", exact: 62, records: 62 },
		{ category: "form-template", labelThai: "ฟอร์ม / เทมเพลต", exact: 60, records: 60 },
		{ category: "business", labelThai: "บริษัท / ร้านค้า", exact: 55, records: 60 },
		{ category: "institution", labelThai: "หน่วยงาน / โรงเรียน", exact: 56, records: 62 },
		{ category: "condo-city", labelThai: "คอนโด / ในเมือง", exact: 60, records: 60 },
		{ category: "rural", labelThai: "ต่างจังหวัด", exact: 57, records: 60 },
		{ category: "typos", labelThai: "สะกดผิด", exact: 62, records: 67 },
		{ category: "abbrev-glued", labelThai: "ตัวย่อ / เขียนติดกัน", exact: 57, records: 60 },
		{ category: "english-mixed", labelThai: "ปนภาษาอังกฤษ", exact: 56, records: 60 },
		{ category: "phone-numbers", labelThai: "เบอร์โทรหลายแบบ", exact: 58, records: 60 },
		{ category: "missing-reordered", labelThai: "ข้อมูลขาด / สลับลำดับ", exact: 62, records: 62 },
		{ category: "proxy-recipient", labelThai: "ส่งให้คนอื่นรับ", exact: 56, records: 60 },
	],
	fields: [
		{ field: "name", accuracy: 0.9791 },
		{ field: "phone", accuracy: 0.9977 },
		{ field: "address", accuracy: 0.9767 },
		{ field: "subdistrict", accuracy: 0.9965 },
		{ field: "district", accuracy: 0.9942 },
		{ field: "province", accuracy: 0.9953 },
		{ field: "zipcode", accuracy: 1.0000 },
	],
	modelGzipKB: 168,
	gazetteerGzipKB: 59,
	parseMs: { median: 8.1, p95: 14.4 },
	datasets: { trainRecords: 11506, holdoutRecords: 860, gazetteerTuples: 7431 },
	caveats: [
		"ชุดทดสอบเป็นข้อความสังเคราะห์ที่เขียนเลียนแบบแชตจริงและผ่านการรีวิว ไม่ใช่ข้อความลูกค้าจริง",
		"นับว่าถูกเฉพาะเมื่อทั้งเจ็ดช่องตรงทุกตัวอักษร ช่องเดียวผิดถือว่าทั้งรายการผิด",
		"เวลาที่วัดได้ขึ้นกับเครื่องและเบราว์เซอร์ ตัวเลขนี้มาจากเครื่องเดียว",
		"ยอดรวมของชุดทดสอบถูกอ่านราว 25 ครั้งตลอดสองรุ่น ตัวเลขนี้จึงสูงเกินจริงเล็กน้อย ค่าที่เป็นกลางน่าจะอยู่ราว 94.5 ถึง 95.5%",
		"ชุดทดสอบแยกของ issue #6 (375 รายการ อ่านครั้งเดียว) ได้ 345 รายการ หรือ 92.0% ห้าหมวดหลักได้ 94.6% ต่ำกว่าเป้า 95% อยู่ 2 รายการ",
		"ผู้ตรวจทานพบราว 20 รายการที่คู่มือการทำเครื่องหมายไม่ชี้ขาด คำตอบในชุดทดสอบจึงไม่สมบูรณ์แบบ",
	],
};
