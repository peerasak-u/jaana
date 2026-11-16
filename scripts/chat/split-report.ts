/**
 * Scores the multi-recipient path on source files (by default the old dev
 * union), halved into FIT and CHECK by a hash of the message as
 * `bench/fit-check.ts` does, and sorts each failure into a wrong count, a
 * wrong cut, or a right cut with a wrong field. Single-delivery records in the
 * given files count as false splits when cut, alongside every single-delivery
 * record of the train pool and the non-holdout bench files.
 *
 *   bun scripts/chat/split-report.ts [files...] [--show fit|check] [--json out.jsonl]
 *
 * CHECK failures of a `dev/` file are never shown, and its CHECK totals only
 * with --check: that half is looked at a few times a round, never read.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { CHAT_ROOT, loadChatPool, loadSourceFile, locationMap, sourcePoolOf } from "../../bench/chat/load";
import { HOLDOUT_FILE, type ChatRecord } from "../../bench/chat/markup";
import { FIELD_NAMES } from "../../bench/metrics";
import { loadParserResources } from "../../bench/gazetteer";
import { createTaggerParser } from "../../src/tagger/parser";
import type { TaggerModel } from "../../src/tagger/model";
import { createSplitter } from "../../src/tagger/split";

const OLD_UNION = ["bench/chat/sources/spent/multi-recipient.v3.txt", "bench/chat/sources/train/multi-recipient.txt"];
const args = Bun.argv.slice(2);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const show = option("--show");
const jsonOut = option("--json");
const paths = args.filter((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
const files = paths.length > 0 ? paths : OLD_UNION;
for (const path of files) {
	if (/(?:^|\/)bench\/[^/]+$/u.test(path) && HOLDOUT_FILE.test(path)) throw new Error(`${path} is a sealed holdout`);
}
const half = (raw: string) => (Number(BigInt(Bun.hash(`fit-check:${raw}`)) % 2n) === 0 ? "fit" : "check");

const { locations } = await loadParserResources("resources/gazetteer.json");
const model = (await Bun.file("resources/tagger-model.json").json()) as TaggerModel;
const parser = createTaggerParser(model, locations);
const split = createSplitter(locations);
const map = locationMap(locations);

interface Mark { readonly delivery: number; readonly start: number; readonly end: number }

/** Each message's marks with the delivery they are numbered for, keyed by the unmarked message. */
async function marksOf(path: string): Promise<Map<string, Mark[]>> {
	const byRaw = new Map<string, Mark[]>();
	for (const block of (await Bun.file(path).text()).split(/^===$/mu)) {
		const body = block.split(/^---$/mu)[1]?.replace(/^\n/u, "").replace(/\n+$/u, "");
		if (body === undefined) continue;
		let raw = "";
		let cursor = 0;
		const marks: Mark[] = [];
		for (const match of body.matchAll(/\[\[([A-Z])(\d*):([\s\S]*?)\]\]/gu)) {
			raw += body.slice(cursor, match.index);
			cursor = match.index + match[0].length;
			const start = raw.length;
			raw += match[3]!;
			marks.push({ delivery: match[2] === "" ? 0 : Number(match[2]) - 1, start, end: raw.length });
		}
		raw += body.slice(cursor);
		byRaw.set(raw, marks);
	}
	return byRaw;
}

type Kind = "count" | "cut" | "field";
interface Row {
	readonly id: string;
	readonly half: "fit" | "check";
	readonly sealed: boolean;
	readonly kind: Kind | null;
	readonly detail: string;
	readonly raw: string;
}

const rows: Row[] = [];
const givenSingles: ChatRecord[] = [];
for (const path of files) {
	const { records } = await loadSourceFile(path, sourcePoolOf(path), map);
	const marks = await marksOf(path);
	const sealed = /(?:^|\/)dev\/[^/]+$/u.test(path);
	for (const record of records) {
		if (record.recipients.length > 1) rows.push(score(record, marks.get(record.raw) ?? [], sealed));
		else givenSingles.push(record);
	}
}

function score(record: ChatRecord, marks: readonly Mark[], sealed: boolean): Row {
	const blocks = split(record.raw);
	const actual = parser.parse(record.raw).recipients.map(({ fields, inferred }) =>
		({ ...fields, ...Object.fromEntries(inferred.map((field) => [field, null])) }));
	const base = { id: record.id, half: half(record.raw), sealed, raw: record.raw } as const;
	if (actual.length !== record.recipients.length) {
		return { ...base, kind: "count", detail: `want ${record.recipients.length} got ${actual.length}` };
	}
	const stray = marks.filter((mark) => {
		const block = blocks[mark.delivery];
		return !block || mark.start < block.start || mark.end > block.end;
	});
	if (stray.length > 0) {
		return { ...base, kind: "cut", detail: stray.map((mark) => `${mark.delivery + 1}:${JSON.stringify(record.raw.slice(mark.start, mark.end))}`).join(" ") };
	}
	const wrong: string[] = [];
	record.recipients.forEach((want, index) => {
		for (const field of FIELD_NAMES) {
			const got = actual[index]![field] ?? null;
			if (got !== (want[field] ?? null)) wrong.push(`${field}#${index + 1} want ${JSON.stringify(want[field])} got ${JSON.stringify(got)}`);
		}
	});
	return { ...base, kind: wrong.length > 0 ? "field" : null, detail: wrong.join("; ") };
}

const benchFiles = (await readdir(join(CHAT_ROOT, "bench"))).filter((file) => file.endsWith(".txt") && !HOLDOUT_FILE.test(file));
const bench = await Promise.all(benchFiles.map((file) => loadSourceFile(join(CHAT_ROOT, "bench", file), "bench", map)));
const singles = [...(await loadChatPool("train", locations)).records, ...bench.flatMap((loaded) => loaded.records)]
	.filter((record) => record.recipients.length === 1);
const falseSplits = singles.filter((record) => split(record.raw).length > 1);
const givenFalseSplits = givenSingles.filter((record) => split(record.raw).length > 1);

const summary = (half?: "fit" | "check") => {
	const set = rows.filter((row) => half === undefined || row.half === half);
	const count = (kind: Kind | null) => set.filter((row) => row.kind === kind).length;
	return `${half ?? "union"}: exact ${count(null)}/${set.length}, recipientCount ${set.length - count("count")}/${set.length}, cut ${count("cut")}, field ${count("field")}`;
};
const sealedCheckHidden = rows.some((row) => row.sealed) && !args.includes("--check");
console.log([
	summary("fit"),
	...(sealedCheckHidden ? ["check: hidden for dev/ files, pass --check"] : [summary("check"), summary()]),
	`falseSplits ${falseSplits.length}/${singles.length} ${falseSplits.map((record) => record.id).join(" ")}`,
	`falseSplits (given files) ${givenFalseSplits.length}/${givenSingles.length} ${givenFalseSplits.map((record) => record.id).join(" ")}`,
].join("\n"));
if (show) {
	for (const row of rows.filter((row) => row.half === show && row.kind !== null && !(show === "check" && row.sealed))) {
		const blocks = split(row.raw).map((block) => JSON.stringify(row.raw.slice(block.start, block.end)));
		console.log(`\n## ${row.id} ${row.kind} ${row.detail}\n${blocks.join("\n  |\n")}`);
	}
}
if (jsonOut) await Bun.write(jsonOut, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
