import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { locationMap } from "../bench/chat/load";
import { parseSource } from "../bench/chat/markup";
import { loadParserResources } from "../bench/gazetteer";
import { addRecipients, createMetrics } from "../bench/metrics";

const { locations } = await loadParserResources("resources/gazetteer.json");
const map = locationMap(locations);
const RATCHABURI = "loc: บ่อกระดาน | ปากท่อ | ราชบุรี | 70140";
const FULL = "[[A:12 ม.3]] [[S:ต.บ่อกระดาน]] [[D:อ.ปากท่อ]] [[V:จ.ราชบุรี]] [[Z:70140]]";

function parse(record: string) {
	return parseSource(`===\n${record}`, { file: "fixture.txt", category: "fixture", idPrefix: "fixture", pool: "train", locations: map });
}

function messages(record: string): string[] {
	return parse(record).issues.map((issue) => issue.message);
}

function run(script: string, ...args: string[]) {
	const result = Bun.spawnSync(["bun", script, ...args]);
	return { code: result.exitCode, out: result.stdout.toString() };
}

describe("check.ts on the planted smoke file", () => {
	const { code, out } = run("scripts/chat/check.ts", "test/fixtures/chat-smoke/train/planted.txt");

	test("fails and reports every planted error at its record", () => {
		expect(code).toBe(1);
		const path = "test/fixtures/chat-smoke/train/planted.txt";
		expect(out).toContain(`${path}:1 repeated loc: header`);
		expect(out).toContain(`${path}:6 unknown warning phone-lenght`);
		expect(out).toContain(`${path}:11 N2 mark has no loc2: header`);
		expect(out).toContain(`${path}:16 P span is not a Thai phone number of 9 to 12 digits`);
		expect(out).toContain(`${path}:20 P span is not a Thai phone number of 9 to 12 digits`);
		expect(out).toContain('"validRecords":2,"issues":5');
	});
});

describe("GUIDE v2 records", () => {
	test("a multi-recipient record has one gold per delivery in order", () => {
		const { records, issues } = parse(
			`loc1: บ่อกระดาน | ปากท่อ | ราชบุรี | 70140\nloc2: กำแพงเพชร | รัตภูมิ | สงขลา | 90180\nwarn: multiple-recipients\n---\n` +
				`[[N:คุณเอ]] ${FULL}\nที่ทำงาน [[A2:5 ม.2]] [[S2:ต.กำแพงเพชร]] [[D2:อ.รัตภูมิ]] [[V2:จ.สงขลา]] [[Z2:90180]]`,
		);
		expect(issues).toEqual([]);
		const [record] = records;
		expect(record!.recipients.map((recipient) => [recipient.name, recipient.address, recipient.zipcode])).toEqual([
			["คุณเอ", "12 ม.3", "70140"],
			[null, "5 ม.2", "90180"],
		]);
		expect(record!.expected).toEqual(record!.recipients[0]!);
		expect(record!.warnings).toEqual(["multiple-recipients"]);
	});

	test("an 11-digit phone keeps every digit and needs phone-length", () => {
		expect(messages(`${RATCHABURI}\n---\n[[P:081-234-56789]] ${FULL}`)).toEqual([
			'warn: must be "phone-length" for these marks, not ""',
		]);
		const { records } = parse(`${RATCHABURI}\nwarn: phone-length\n---\n[[P:+66 81 234 56789]] ${FULL}`);
		expect(records[0]!.expected.phone).toBe("08123456789");
	});

	test("ambiguous-location is needed when the written fields fit several tuples", () => {
		const [issue] = parse(`${RATCHABURI}\n---\n[[N:คุณเอ]] [[A:12 ม.3]] [[V:จ.ราชบุรี]]`).issues;
		expect(issue!.warnings).toEqual(["ambiguous-location"]);
		expect(messages(`${RATCHABURI}\nwarn: ambiguous-location\n---\n[[N:คุณเอ]] ${FULL}`)).toEqual([
			'warn: must be "" for these marks, not "ambiguous-location"',
		]);
	});

	test("loc headers must be one loc: or a contiguous loc1:, loc2:, ...", () => {
		expect(messages(`loc1: บ่อกระดาน | ปากท่อ | ราชบุรี | 70140\n---\n[[N:คุณเอ]] ${FULL}`)).toEqual(["one delivery uses loc:, not loc1:"]);
		expect(messages(`${RATCHABURI}\nloc2: กำแพงเพชร | รัตภูมิ | สงขลา | 90180\n---\n[[N:คุณเอ]] ${FULL}`)).toEqual([
			"use either loc: or loc1:, loc2:, ..., not both",
		]);
		expect(messages(`${RATCHABURI}\n---\n[[N1:คุณเอ]] ${FULL}`)).toEqual(["write N, not N1, for the first recipient"]);
	});

	test("contact-handle, place-name and ชื่อเล่น label are kept out of N", () => {
		expect(messages(`${RATCHABURI}\n---\n[[N:คุณบีม (LINE: beam_shop)]] ${FULL}`)).toEqual([
			"N holds a contact-handle bracket. Move it out of the name",
		]);
		expect(messages(`${RATCHABURI}\n---\n[[N:คุณบีม (เชียงใหม่)]] ${FULL}`)).toEqual([
			"N holds a place-name bracket. Move it out of the name",
		]);
		expect(messages(`${RATCHABURI}\n---\nชื่อ[[N:เล่นบีม]] ${FULL}`)).toEqual([
			"N starts with เล่น of the label ชื่อเล่น. Keep the label outside",
		]);
		expect(messages(`${RATCHABURI}\n---\n[[N:คุณสมเกียรติ (หัวหน้าไลน์ 3)]] ${FULL}`)).toEqual([]);
	});
});

test("relabel-v2 moves brackets and labels out of N, fills warn:, and is idempotent", async () => {
	const directory = join(await mkdtemp(join(tmpdir(), "relabel-")), "train");
	await mkdir(directory);
	const path = join(directory, "fixture.txt");
	await Bun.write(
		path,
		[
			"===",
			RATCHABURI,
			"---",
			`[[N:คุณบีม (LINE: beam_shop)]] ${FULL}`,
			"===",
			"loc: ป้อมปราบ | ป้อมปราบศัตรูพ่าย | กรุงเทพมหานคร | 10100",
			"---",
			"[[N:คุณแป้ง (กทม.)]] [[A:9 ซ.1]] [[S:แขวงป้อมปราบ]] [[D:เขตป้อมปราบศัตรูพ่าย]] [[Z:10100]]",
			"===",
			RATCHABURI,
			"---",
			"ชื่อ[[N:เล่น บีม]] [[A:12 ม.3]] [[V:จ.ราชบุรี]]",
			"",
		].join("\n"),
	);
	const first = run("scripts/chat/relabel-v2.ts", path, "--write");
	expect(first.code).toBe(0);
	expect(JSON.parse(first.out)).toMatchObject({ contactHandle: 1, placeName: 1, placeMarked: 1, nameLabel: 1, recordsChanged: 3, issuesAfter: 0 });
	const text = await Bun.file(path).text();
	expect(text).toContain("[[N:คุณบีม]] (LINE: beam_shop)");
	expect(text).toContain("[[N:คุณแป้ง]] ([[V:กทม.]])");
	expect(text).toContain("tags: alias");
	expect(text).toContain("ชื่อเล่น [[N:บีม]]");
	expect(text).toContain("warn: ambiguous-location");
	const second = run("scripts/chat/relabel-v2.ts", path, "--write");
	expect(JSON.parse(second.out)).toMatchObject({ recordsChanged: 0, written: false });
});

test("a message is exact only when every recipient matches in order", () => {
	const one = { name: "เอ", phone: null, address: "1", subdistrict: null, district: null, province: null, zipcode: null };
	const two = { ...one, name: "บี" };
	const metrics = createMetrics();
	addRecipients(metrics, [one, two], [one, two]);
	addRecipients(metrics, [one, two], [two, one]);
	addRecipients(metrics, [one, two], [one]);
	expect(metrics.exactRecords).toBe(1);
	expect(metrics.fields.name).toEqual({ correct: 3, total: 6 });
});

test("spent and dev sources hold bench locations, train sources train ones", async () => {
	const { sourcePoolOf } = await import("../bench/chat/load");
	expect(sourcePoolOf("bench/chat/sources/dev/x.r4.txt")).toBe("bench");
	expect(sourcePoolOf("bench/chat/sources/spent/x.v3.txt")).toBe("bench");
	expect(sourcePoolOf("bench/chat/sources/train/x.dev.txt")).toBe("train");
	expect(() => sourcePoolOf("elsewhere/x.txt")).toThrow();
});
