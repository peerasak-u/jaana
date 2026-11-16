import { mkdir } from "node:fs/promises";
import { createTaggerParser } from "../src/tagger/parser";
import type { AnyTaggerModel } from "../src/tagger/model";
import { loadSourceFile, locationMap } from "./chat/load";
import type { ChatRecord } from "./chat/markup";
import type { ExpectedAddress } from "./dataset";
import { loadParserResources } from "./gazetteer";
import { addRecipients, createMetrics, FIELD_NAMES, type MetricAccumulator } from "./metrics";

/**
 * Splits a dev union into FIT and CHECK halves by a hash of the message, so
 * rules written from FIT failures can be scored on records they were not
 * written from. Only FIT failures are written to disk by default; pass
 * --check-failures once at the end of a round to write CHECK failures too.
 */
const paths = Bun.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const writeCheckFailures = Bun.argv.includes("--check-failures");
const half = (raw: string) => (Number(BigInt(Bun.hash(`fit-check:${raw}`)) % 2n) === 0 ? "fit" : "check");

const { locations } = await loadParserResources("resources/gazetteer.json");
const model = (await Bun.file("resources/tagger-model.json").json()) as AnyTaggerModel;
const parser = createTaggerParser(model, locations);
const byKey = locationMap(locations);
const records: ChatRecord[] = [];
for (const path of paths) {
	const loaded = await loadSourceFile(path, path.includes("/sources/spent/") ? "bench" : "train", byKey);
	if (loaded.issues.length > 0) throw new Error(`${loaded.issues.length} source issues in ${path}`);
	records.push(...loaded.records);
}

const totals = { fit: new Map<string, MetricAccumulator>(), check: new Map<string, MetricAccumulator>() };
const failures = { fit: [] as object[], check: [] as object[] };
for (const record of records) {
	const side = half(record.raw);
	const result = parser.parse(record.raw);
	const actual: ExpectedAddress[] = result.recipients.map(({ fields, inferred }) => ({
		...fields,
		...Object.fromEntries(inferred.map((field) => [field, null])),
	}));
	const metrics = totals[side].get(record.caseType) ?? createMetrics();
	totals[side].set(record.caseType, metrics);
	addRecipients(metrics, record.recipients, actual);
	const wrong: Record<string, { expected: string | null; actual: string | null }> = {};
	for (let index = 0; index < Math.max(record.recipients.length, actual.length); index += 1) {
		for (const field of FIELD_NAMES) {
			const want = record.recipients[index]?.[field] ?? null;
			const got = actual[index]?.[field] ?? null;
			if (got !== want) wrong[index === 0 ? field : `${field}#${index + 1}`] = { expected: want, actual: got };
		}
	}
	if (Object.keys(wrong).length > 0) failures[side].push({ id: record.id, category: record.caseType, raw: record.raw, wrong });
}

const summary = (map: Map<string, MetricAccumulator>) => {
	const rows = [...map.entries()].sort(([left], [right]) => left.localeCompare(right));
	const exact = rows.reduce((sum, [, metrics]) => sum + metrics.exactRecords, 0);
	const all = rows.reduce((sum, [, metrics]) => sum + metrics.records, 0);
	return { total: `${exact}/${all}`, ...Object.fromEntries(rows.map(([category, metrics]) => [category, `${metrics.exactRecords}/${metrics.records}`])) };
};
await mkdir(".bench-results", { recursive: true });
await Bun.write(".bench-results/fit-failures.jsonl", failures.fit.map((failure) => JSON.stringify(failure)).join("\n") + "\n");
if (writeCheckFailures) await Bun.write(".bench-results/check-failures.jsonl", failures.check.map((failure) => JSON.stringify(failure)).join("\n") + "\n");
console.log(JSON.stringify({ fit: summary(totals.fit), check: summary(totals.check) }, null, 2));
