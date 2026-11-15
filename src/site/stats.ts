import type { FieldName } from "../types";

/** True while the numbers below are stand-ins. The page shows a "ตัวเลขชั่วคราว" badge. */
export const PLACEHOLDER = false;

/** Public repository URL. The page hides every repository link while this is empty. */
export const REPO_URL = "";

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
	measuredOn: "2026-11-15",
	holdout: { exact: 823, records: 860 },
	categories: [
		{ category: "person-multiline", labelThai: "บุคคล หลายบรรทัด", exact: 66, records: 67 },
		{ category: "person-oneline", labelThai: "บุคคล บรรทัดเดียว", exact: 58, records: 60 },
		{ category: "chat-noise", labelThai: "ปนบทสนทนา", exact: 62, records: 62 },
		{ category: "form-template", labelThai: "ฟอร์ม / เทมเพลต", exact: 58, records: 60 },
		{ category: "business", labelThai: "บริษัท / ร้านค้า", exact: 55, records: 60 },
		{ category: "institution", labelThai: "หน่วยงาน / โรงเรียน", exact: 57, records: 62 },
		{ category: "condo-city", labelThai: "คอนโด / ในเมือง", exact: 60, records: 60 },
		{ category: "rural", labelThai: "ต่างจังหวัด", exact: 57, records: 60 },
		{ category: "typos", labelThai: "สะกดผิด", exact: 64, records: 67 },
		{ category: "abbrev-glued", labelThai: "ตัวย่อ / เขียนติดกัน", exact: 57, records: 60 },
		{ category: "english-mixed", labelThai: "ปนภาษาอังกฤษ", exact: 53, records: 60 },
		{ category: "phone-numbers", labelThai: "เบอร์โทรหลายแบบ", exact: 59, records: 60 },
		{ category: "missing-reordered", labelThai: "ข้อมูลขาด / สลับลำดับ", exact: 60, records: 62 },
		{ category: "proxy-recipient", labelThai: "ส่งให้คนอื่นรับ", exact: 57, records: 60 },
	],
	fields: [
		{ field: "name", accuracy: 0.9756 },
		{ field: "phone", accuracy: 0.9988 },
		{ field: "address", accuracy: 0.9802 },
		{ field: "subdistrict", accuracy: 0.9930 },
		{ field: "district", accuracy: 0.9919 },
		{ field: "province", accuracy: 0.9930 },
		{ field: "zipcode", accuracy: 1.0000 },
	],
	modelGzipKB: 168,
	gazetteerGzipKB: 59,
	parseMs: { median: 8.4, p95: 14.6 },
	datasets: { trainRecords: 10773, holdoutRecords: 860, gazetteerTuples: 7431 },
	caveats: [
		"ชุดทดสอบเป็นข้อความสังเคราะห์ที่เขียนเลียนแบบแชตจริงและผ่านการรีวิว ไม่ใช่ข้อความลูกค้าจริง",
		"นับว่าถูกเฉพาะเมื่อทั้งเจ็ดช่องตรงทุกตัวอักษร ช่องเดียวผิดถือว่าทั้งรายการผิด",
		"เวลาที่วัดได้ขึ้นกับเครื่องและเบราว์เซอร์ ตัวเลขนี้มาจากเครื่องเดียว",
		"โมเดลที่ฝึกซ้ำด้วย seed อื่นได้ 820 จาก 860 ผลจึงแกว่งได้ราว 3 รายการ",
		"ผู้ตรวจทานพบราว 20 รายการที่คู่มือการทำเครื่องหมายไม่ชี้ขาด คำตอบในชุดทดสอบจึงไม่สมบูรณ์แบบ",
	],
};
