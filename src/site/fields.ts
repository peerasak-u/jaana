import type { FieldName, OutputLabel } from "../types";

export interface FieldMeta {
	readonly key: FieldName;
	readonly label: OutputLabel;
	readonly thai: string;
}

export const FIELDS: readonly FieldMeta[] = [
	{ key: "name", label: "NAME", thai: "ชื่อผู้รับ" },
	{ key: "phone", label: "PHONE", thai: "เบอร์โทร" },
	{ key: "address", label: "ADDRESS_DETAIL", thai: "ที่อยู่" },
	{ key: "subdistrict", label: "SUBDISTRICT", thai: "แขวง / ตำบล" },
	{ key: "district", label: "DISTRICT", thai: "เขต / อำเภอ" },
	{ key: "province", label: "PROVINCE", thai: "จังหวัด" },
	{ key: "zipcode", label: "POSTCODE", thai: "รหัสไปรษณีย์" },
];

export const FIELD_BY_LABEL = new Map(FIELDS.map((field) => [field.label, field]));
