import { mkdir } from "node:fs/promises";
import { createAddressParser } from "../src";
import { createTaggerParser } from "../src/tagger/parser";
import type { AnyTaggerModel } from "../src/tagger/model";
import { loadChatPool } from "./chat/load";
import { holdoutOf, isHoldout, splitOf, type ChatRecord } from "./chat/markup";
import type { ExpectedAddress } from "./dataset";
import { loadParserResources } from "./gazetteer";
import { addResult, createMetrics, exactAcceptance, FIELD_NAMES, summarize, type MetricAccumulator } from "./metrics";

function option(name: string): string | undefined {
	const index = Bun.argv.indexOf(name);
	return index >= 0 ? Bun.argv[index + 1] : undefined;
}

const modelPath = option("--model") ?? "resources/tagger-model.json";
const outputPath = option("--output") ?? ".bench-results/chat.json";
const failuresPath = option("--failures") ?? ".bench-results/chat-dev-failures.jsonl";
const test1FailuresPath = ".bench-results/chat-test1-failures.jsonl";
const minimum = option("--min-test-exact");
const rounds = Number(option("--timing-rounds") ?? "3");
const readHoldout = Bun.argv.includes("--read-holdout");
if (minimum !== undefined && !readHoldout) throw new Error("--min-test-exact scores the holdout, so it needs --read-holdout");

const { locations } = await loadParserResources("resources/gazetteer.json");
const model = (await Bun.file(modelPath).json()) as AnyTaggerModel;
const systems = {
	tagger: createTaggerParser(model, locations),
	engine: createAddressParser({ version: "gazetteer", locations }),
};
type SystemName = keyof typeof systems;
const SYSTEM_NAMES = Object.keys(systems) as SystemName[];

const { records, issues } = await loadChatPool("bench", locations);
if (issues.length > 0) {
	for (const issue of issues) console.error(`${issue.file}:${issue.line} ${issue.message}`);
	throw new Error(`${issues.length} source issues. Fix them before benchmarking`);
}

function parseWith(name: SystemName, raw: string): ExpectedAddress | null {
	try {
		const result = systems[name].parse(raw);
		// Gold marks only what the shopper wrote, so gazetteer-filled fields are not scored here.
		const inferred = "inferred" in result ? result.inferred : [];
		return { ...result.fields, ...Object.fromEntries(inferred.map((field) => [field, null])) };
	} catch {
		return null;
	}
}

function percentile(sorted: readonly number[], fraction: number): number {
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

interface Failure {
	readonly id: string;
	readonly category: string;
	readonly tags: readonly string[];
	readonly raw: string;
	readonly wrong: Record<string, { expected: string | null; actual: string | null }>;
}

function evaluate(set: readonly ChatRecord[], collectFailures: boolean) {
	const metrics = Object.fromEntries(SYSTEM_NAMES.map((name) => [name, createMetrics()])) as Record<SystemName, MetricAccumulator>;
	const categories = new Map<string, Record<SystemName, MetricAccumulator>>();
	const failures: Failure[] = [];
	for (const record of set) {
		const group = categories.get(record.caseType) ??
			(Object.fromEntries(SYSTEM_NAMES.map((name) => [name, createMetrics()])) as Record<SystemName, MetricAccumulator>);
		categories.set(record.caseType, group);
		for (const name of SYSTEM_NAMES) {
			const actual = parseWith(name, record.raw);
			addResult(metrics[name], record.expected, actual);
			addResult(group[name], record.expected, actual);
			if (!collectFailures || name !== "tagger") continue;
			const wrong: Failure["wrong"] = {};
			for (const field of FIELD_NAMES) {
				const got = actual?.[field] ?? null;
				if (got !== record.expected[field]) wrong[field] = { expected: record.expected[field], actual: got };
			}
			if (Object.keys(wrong).length > 0) {
				failures.push({ id: record.id, category: record.caseType, tags: record.tags, raw: record.raw, wrong });
			}
		}
	}
	return {
		records: set.length,
		systems: Object.fromEntries(SYSTEM_NAMES.map((name) => [name, summarize(metrics[name])])),
		categories: Object.fromEntries(
			[...categories.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([category, group]) => [
				category,
				Object.fromEntries(SYSTEM_NAMES.map((name) => [name, `${group[name].exactRecords}/${group[name].records}`])),
			]),
		),
		metrics,
		failures,
	};
}

function time(set: readonly ChatRecord[]) {
	for (const record of set.slice(0, 100)) for (const name of SYSTEM_NAMES) systems[name].parse(record.raw);
	return Object.fromEntries(SYSTEM_NAMES.map((name) => {
		const samples: number[] = [];
		let characters = 0;
		for (let round = 0; round < rounds; round += 1) {
			for (const record of set) {
				const started = Bun.nanoseconds();
				const result = systems[name].parse(record.raw);
				samples.push((Bun.nanoseconds() - started) / 1e6);
				characters += result.raw.length;
			}
		}
		samples.sort((left, right) => left - right);
		return [name, {
			parses: samples.length,
			charactersParsed: characters,
			medianMs: Number(percentile(samples, 0.5).toFixed(3)),
			p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
			maxMs: Number(samples[samples.length - 1]!.toFixed(3)),
		}];
	}));
}

/**
 * The first benchmark batch is split in two by hash: dev, and test1, which was
 * sealed until 2026-11-15 and is now a second development set. Holdout files
 * are scored only with --read-holdout, and every such read is logged to
 * `.audit/holdout-reads.tsv`, because each read spends the holdout. Their
 * failures are never written.
 */
const first = records.filter((record) => !isHoldout(record));
const dev = evaluate(first.filter((record) => splitOf(record.raw) === "dev"), true);
const test1 = evaluate(first.filter((record) => splitOf(record.raw) === "test"), true);
const holdoutNames = [...new Set(records.map((record) => holdoutOf(record.id)).filter((name) => name !== null))].sort();
const holdouts = readHoldout
	? Object.fromEntries(holdoutNames.map((name) => [name, evaluate(records.filter((record) => holdoutOf(record.id) === name), false)]))
	: {};
const modelText = await Bun.file(modelPath).text();
const line = (set: ReturnType<typeof evaluate>) => ({
	records: set.records,
	exact: Object.fromEntries(SYSTEM_NAMES.map((name) => [
		name,
		`${set.metrics[name].exactRecords}/${set.records} (${((100 * set.metrics[name].exactRecords) / Math.max(1, set.records)).toFixed(1)}%)`,
	])),
	parseErrors: Object.fromEntries(SYSTEM_NAMES.map((name) => [name, set.metrics[name].failures])),
	taggerFields: FIELD_NAMES.map((field) => `${field} ${set.metrics.tagger.fields[field].correct}`).join(", "),
	categories: Object.fromEntries(Object.entries(set.categories).map(([category, value]) => [category, value.tagger])),
});
const report = {
	model: { path: modelPath, version: model.version, bytes: modelText.length, gzipBytes: Bun.gzipSync(modelText).length },
	dev: { records: dev.records, systems: dev.systems, categories: dev.categories },
	test1: { records: test1.records, systems: test1.systems, categories: test1.categories },
	holdouts: readHoldout
		? Object.fromEntries(Object.entries(holdouts).map(([name, set]) => [name, { records: set.records, systems: set.systems, categories: set.categories }]))
		: Object.fromEntries(holdoutNames.map((name) => [name, "sealed"])),
	timing: time(records),
};
await mkdir(".bench-results", { recursive: true });
await Bun.write(outputPath, `${JSON.stringify(report, null, 2)}\n`);
await Bun.write(failuresPath, dev.failures.map((failure) => JSON.stringify(failure)).join("\n") + "\n");
await Bun.write(test1FailuresPath, test1.failures.map((failure) => JSON.stringify(failure)).join("\n") + "\n");
console.log(JSON.stringify({ model: report.model, dev: line(dev), test1: line(test1), holdouts: readHoldout ? Object.fromEntries(Object.entries(holdouts).map(([name, set]) => [name, line(set)])) : report.holdouts, timing: report.timing, outputPath, failuresPath, test1FailuresPath }, null, 2));

if (readHoldout) {
	const log = ".audit/holdout-reads.tsv";
	const header = (await Bun.file(log).exists()) ? "" : "ts\tmodel\tgzipBytes\tholdout\ttaggerExact\trecords\n";
	const rows = Object.entries(holdouts)
		.map(([name, set]) => [new Date().toISOString(), modelPath, report.model.gzipBytes, name, set.metrics.tagger.exactRecords, set.records].join("\t"))
		.join("\n");
	await mkdir(".audit", { recursive: true });
	await Bun.write(log, `${(await Bun.file(log).exists()) ? await Bun.file(log).text() : ""}${header}${rows}\n`);
}

if (minimum !== undefined) {
	const target = holdouts[holdoutNames.at(-1)!]!;
	const acceptance = exactAcceptance(target.metrics.tagger, Number(minimum));
	console.log(JSON.stringify({ acceptance }));
	if (!acceptance.passed) process.exit(1);
}
