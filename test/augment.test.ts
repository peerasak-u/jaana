import { describe, expect, test } from "bun:test";
import { AUGMENT_OPS, augmentChatRecords, type AugmentOptions } from "../bench/chat/augment";
import { locationMap, loadChatPool } from "../bench/chat/load";
import { locationKey, parseSource, poolOf, type ChatRecord } from "../bench/chat/markup";
import { loadParserResources } from "../bench/gazetteer";
import { normalizeCandidate } from "../src/normalize";

const { locations } = await loadParserResources("resources/gazetteer.json");
const trainLocations = locations.filter((location) => poolOf(location) === "train");
const trainKeys = new Set(trainLocations.map(locationKey));

function parse(body: string): ChatRecord[] {
	const { records, issues } = parseSource(body, {
		file: "fixture.txt",
		category: "fixture",
		idPrefix: "fixture",
		pool: "train",
		locations: locationMap(locations),
	});
	expect(issues).toEqual([]);
	return records;
}

const FIXTURE = `===
loc: บ่อกระดาน | ปากท่อ | ราชบุรี | 70140
---
ส่ง [[N:ร้านเจ๊ติ๋มของชำ]] ค่ะ
[[A:5 หมู่ 3]] [[S:ตำบลบ่อกระดาน]] [[D:อ. ปากท่อ]] [[V:ราชบุรี]] [[Z:๗๐๑๔๐]]
โทร [[P:032-210-458]]
===
loc: สะเดา | นางรอง | บุรีรัมย์ | 31110
tags: typo-province
---
ชื่อ [[N:อำไพ สีดา]]
[[A:บ้านเลขที่ 3 ม.14]] [[S:ต.สะเดา]] [[D:อ.นางรอง]] [[V:บุรีรัม]]
เบอ [[P:0897712034]]
===
loc: แม่ต๋ำ | เมืองพะเยา | พะเยา | 56000
---
[[N:พี่แก้ว]] [[P:0956623108]] [[A:210 ม.4]] [[S:ต.แม่ต๋ำ]] [[D:อ.เมือง]] [[V:พะเยา]]`;

function options(overrides: Partial<AugmentOptions> = {}): AugmentOptions {
	return { copies: 4, seed: 7, ops: AUGMENT_OPS, locations: trainLocations, ...overrides };
}

function variantsOf(records: readonly ChatRecord[], given: AugmentOptions): ChatRecord[] {
	return augmentChatRecords(records, given).slice(records.length);
}

function adminText(record: ChatRecord, label: string): string | undefined {
	return record.spans.find((span) => span.label === label)?.text;
}

describe("chat augmentation", () => {
	test("keeps the source records first and is deterministic for a seed", () => {
		const records = parse(FIXTURE);
		const first = augmentChatRecords(records, options());
		expect(first.slice(0, records.length)).toEqual(records);
		expect(augmentChatRecords(records, options())).toEqual(first);
		expect(augmentChatRecords(records, options({ seed: 8 }))).not.toEqual(first);
	});

	test("moves a cleanly written location to a coherent train-pool tuple with the same prefixes", () => {
		const [shop] = parse(FIXTURE);
		for (const variant of variantsOf([shop!], options({ ops: ["location"] }))) {
			const location = variant.seedLocation;
			expect(trainKeys.has(locationKey(location))).toBe(true);
			expect(adminText(variant, "SUBDISTRICT")).toBe(`ตำบล${location.subdistrict}`);
			expect(adminText(variant, "DISTRICT")).toBe(`อ. ${location.district}`);
			expect(adminText(variant, "PROVINCE")).toBe(location.province);
			expect(adminText(variant, "POSTCODE")).toBe(location.zipcode.replace(/\d/gu, (digit) => "๐๑๒๓๔๕๖๗๘๙"[Number(digit)]!));
			expect(variant.expected.district).toBe(location.district);
		}
	});

	test("keeps a misspelt or shortened name as written and picks a tuple that shares it", () => {
		const [, typo, mueang] = parse(FIXTURE);
		for (const variant of variantsOf([typo!], options({ ops: ["location"] }))) {
			expect(adminText(variant, "PROVINCE")).toBe("บุรีรัม");
			expect(variant.seedLocation.province).toBe("บุรีรัมย์");
		}
		for (const variant of variantsOf([mueang!], options({ ops: ["location"] }))) {
			expect(adminText(variant, "DISTRICT")).toBe("อ.เมือง");
			expect(variant.seedLocation.district).toBe("เมืองพะเยา");
		}
	});

	test("resamples phone digits in the same written format", () => {
		const [shop] = parse(FIXTURE);
		for (const variant of variantsOf([shop!], options({ ops: ["phone"] }))) {
			expect(adminText(variant, "PHONE")).toMatch(/^03\d-\d{3}-\d{3}$/u);
			expect(variant.raw.replace(/\d/gu, "#")).toBe(shop!.raw.replace(/\d/gu, "#"));
		}
	});

	test("every span of every variant of the training pool equals its raw slice", async () => {
		const { records } = await loadChatPool("train", locations);
		const variants = variantsOf(records, options({ copies: 2 }));
		expect(variants.length).toBeGreaterThan(records.length * 1.9);
		for (const variant of variants) {
			expect(trainKeys.has(locationKey(variant.seedLocation))).toBe(true);
			for (const span of variant.spans) {
				expect(variant.raw.slice(span.start, span.end)).toBe(span.text);
				expect(span.text.trim()).toBe(span.text);
				expect(Array.from(variant.raw).slice(span.codePointStart, span.codePointEnd).join("")).toBe(span.text);
				if (span.label === "NAME" || span.label === "PHONE") expect(span.canonical).toBe(normalizeCandidate(span.label, span.text));
			}
		}
	});
});
