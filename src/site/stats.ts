import type { FieldName } from "../types";

/** True while the numbers below are stand-ins. The page shows a "ตัวเลขชั่วคราว" badge. */
export const PLACEHOLDER = true;

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
	holdout: { exact: 1190, records: 1400 },
	categories: [
		{ category: "person-multiline", labelThai: "บุคคล หลายบรรทัด", exact: 92, records: 100 },
		{ category: "person-oneline", labelThai: "บุคคล บรรทัดเดียว", exact: 88, records: 100 },
		{ category: "chat-noise", labelThai: "ปนบทสนทนา", exact: 84, records: 100 },
		{ category: "form-template", labelThai: "ฟอร์ม / เทมเพลต", exact: 90, records: 100 },
		{ category: "business", labelThai: "บริษัท / ร้านค้า", exact: 80, records: 100 },
		{ category: "institution", labelThai: "หน่วยงาน / โรงเรียน", exact: 78, records: 100 },
		{ category: "condo-city", labelThai: "คอนโด / ในเมือง", exact: 86, records: 100 },
		{ category: "rural", labelThai: "ต่างจังหวัด", exact: 87, records: 100 },
		{ category: "typos", labelThai: "สะกดผิด", exact: 76, records: 100 },
		{ category: "abbrev-glued", labelThai: "ตัวย่อ / เขียนติดกัน", exact: 83, records: 100 },
		{ category: "english-mixed", labelThai: "ปนภาษาอังกฤษ", exact: 79, records: 100 },
		{ category: "phone-numbers", labelThai: "เบอร์โทรหลายแบบ", exact: 85, records: 100 },
		{ category: "missing-reordered", labelThai: "ข้อมูลขาด / สลับลำดับ", exact: 81, records: 100 },
		{ category: "proxy-recipient", labelThai: "ส่งให้คนอื่นรับ", exact: 81, records: 100 },
	],
	fields: [
		{ field: "name", accuracy: 0.93 },
		{ field: "phone", accuracy: 0.98 },
		{ field: "address", accuracy: 0.9 },
		{ field: "subdistrict", accuracy: 0.96 },
		{ field: "district", accuracy: 0.96 },
		{ field: "province", accuracy: 0.98 },
		{ field: "zipcode", accuracy: 0.98 },
	],
	modelGzipKB: 120,
	gazetteerGzipKB: 61,
	parseMs: { median: 1.5, p95: 4 },
	datasets: { trainRecords: 10000, holdoutRecords: 1400, gazetteerTuples: 7431 },
	caveats: [
		"ชุดทดสอบเป็นข้อความสังเคราะห์ที่เขียนเลียนแบบแชตจริงและผ่านการรีวิว ไม่ใช่ข้อความลูกค้าจริง",
		"นับว่าถูกเฉพาะเมื่อทั้งเจ็ดช่องตรงทุกตัวอักษร ช่องเดียวผิดถือว่าทั้งรายการผิด",
		"เวลาที่วัดได้ขึ้นกับเครื่องและเบราว์เซอร์ ตัวเลขนี้มาจากเครื่องเดียว",
	],
};
