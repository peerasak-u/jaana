import { describe, expect, test } from "bun:test";
import { locationMap } from "../bench/chat/load";
import { parseSource } from "../bench/chat/markup";
import { loadParserResources } from "../bench/gazetteer";
import { goldTags } from "../bench/tagger-data";
import { composeRecipient } from "../src/tagger/compose";
import { TAGS } from "../src/tagger/model";
import { normalizeCandidate } from "../src/normalize";

const { locations } = await loadParserResources("resources/gazetteer.json");

function record(message: string) {
	const { records, issues } = parseSource(`===\nloc: บ่อกระดาน | ปากท่อ | ราชบุรี | 70140\n---\n${message}`, {
		file: "fixture.txt",
		category: "fixture",
		idPrefix: "fixture",
		pool: "train",
		locations: locationMap(locations),
	});
	expect(issues).toEqual([]);
	return records[0]!;
}

function tagged(message: string, tag: (typeof TAGS)[number]): string[] {
	const source = record(message);
	const tags = goldTags(source);
	const index = TAGS.indexOf(tag);
	const runs: string[] = [];
	let start = -1;
	for (let position = 0; position <= tags.length; position += 1) {
		if (tags[position] === index && start < 0) start = position;
		if (tags[position] !== index && start >= 0) {
			runs.push(source.raw.slice(start, position));
			start = -1;
		}
	}
	return runs;
}

/** Name and address the composition rebuilds from the derived tags alone. */
function roundTrip(message: string) {
	const source = record(message);
	const tags = goldTags(source);
	const runs: { tag: string; start: number; end: number }[] = [];
	let start = 0;
	for (let position = 1; position <= tags.length; position += 1) {
		if (position < tags.length && tags[position] === tags[start]) continue;
		runs.push({ tag: TAGS[tags[start]!]!, start, end: position });
		start = position;
	}
	const recipient = composeRecipient(
		source.raw,
		runs.find((run) => run.tag === "NAME") ?? null,
		runs.filter((run) => run.tag === "ORG"),
	);
	const address = [...runs.filter((run) => run.tag === "ADDRESS_DETAIL"), ...recipient.address]
		.sort((left, right) => left.start - right.start)
		.map((range) => source.raw.slice(range.start, range.end))
		.join(" ");
	return {
		derived: {
			name: recipient.name ? normalizeCandidate("NAME", source.raw.slice(recipient.name.start, recipient.name.end)) : null,
			address: normalizeCandidate("ADDRESS_DETAIL", address),
		},
		gold: { name: source.expected.name, address: source.expected.address },
	};
}

describe("derived organisation tags", () => {
	const messages = [
		"[[N:หจก.ศรีวิไลการโยธา]] [[A:55 ม.2]] [[S:ต.บ่อกระดาน]]",
		"[[A:ร้านขายยาธีรเภสัช]]\n[[N:ภก.ธีรวัฒน์ ใจบุญ]]\n[[A:เลขที่ 201 ม.3]] [[D:อ.ปากท่อ]]",
		"[[N:บจก.รุ่งเรืองการค้า (คุณเอ ฝ่ายจัดซื้อ)]] [[A:12/3 ถ.มิตรภาพ]]",
		"[[N:ครูวาสนา ปินตา โรงเรียนบ้านดงวิทยา]] [[A:ม.3]]",
		"[[N:คุณสมชาย]] [[P:0812345678]] [[A:บริษัท เอบีซี จำกัด 12/3 ถ.มิตรภาพ]]",
		"[[N:คุณสมชาย]] [[A:หอพักสุขใจ ห้อง 5]]",
	];
	for (const message of messages) {
		test(`rebuild the gold name and address: ${message.split("\n")[0]}`, () => {
			const { derived, gold } = roundTrip(message);
			expect(derived).toEqual(gold);
		});
	}

	test("an organisation with no person is ORG, not NAME", () => {
		expect(tagged("[[N:หจก.ศรีวิไลการโยธา]] [[A:55 ม.2]]", "ORG")).toEqual(["หจก.ศรีวิไลการโยธา"]);
		expect(tagged("[[N:หจก.ศรีวิไลการโยธา]] [[A:55 ม.2]]", "NAME")).toEqual([]);
	});

	test("an organisation that opens the address of a named person is ORG up to its location", () => {
		expect(tagged("[[N:คุณสมชาย]]\n[[A:บริษัท เอบีซี จำกัด 12/3 ถ.มิตรภาพ]]", "ORG")).toEqual(["บริษัท เอบีซี จำกัด"]);
	});

	test("an organisation and its contact person are split into ORG and NAME", () => {
		const message = "[[N:บจก.รุ่งเรืองการค้า (คุณเอ ฝ่ายจัดซื้อ)]] [[A:12/3]]";
		expect(tagged(message, "ORG")).toEqual(["บจก.รุ่งเรืองการค้า"]);
		expect(tagged(message, "NAME")).toEqual(["(คุณเอ ฝ่ายจัดซื้อ)"]);
	});

	test("an organisation word anywhere in a name marks it as an organisation", () => {
		const message = "[[N:บ้านมุงวิวเขาโฮมสเตย์ (คุณกาญจนา)]] [[A:9 ม.2]]";
		expect(tagged(message, "ORG")).toEqual(["บ้านมุงวิวเขาโฮมสเตย์"]);
		expect(tagged("[[N:คุณสมชาย]]\n[[A:Silom Grand Hotel, 88 ถ.สุรวงศ์]]", "ORG")).toEqual(["Silom Grand Hotel"]);
	});

	test("a place word that is never a recipient stays address detail", () => {
		expect(tagged("[[N:คุณสมชาย]] [[A:หอพักสุขใจ ห้อง 5]]", "ORG")).toEqual([]);
	});
});
