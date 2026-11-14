import { mkdir } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { createAddressParser } from "../src";
import { createTaggerParser } from "../src/tagger/parser";
import type { TaggerModel } from "../src/tagger/model";
import { loadDataset, type DatasetRecord, type ExpectedAddress } from "./dataset";
import { addResult, createMetrics, FIELD_NAMES, summarize, type MetricAccumulator } from "./metrics";
import { loadParserResources } from "./gazetteer";
import { loadTaggerPartitions } from "./tagger-data";

function values(name: string): string[] {
	const result: string[] = [];
	for (let index = 0; index < Bun.argv.length; index += 1) {
		if (Bun.argv[index] === name && Bun.argv[index + 1]) result.push(Bun.argv[index + 1]!);
	}
	return result;
}

const datasetPaths = values("--dataset");
if (datasetPaths.length === 0) throw new Error("at least one --dataset is required");
const gazetteerPath = values("--gazetteer")[0] ?? "resources/gazetteer.json";
const modelPath = values("--model")[0] ?? "resources/tagger-model.json";
const fixturePath = values("--fixture")[0] ?? "bench/fixtures/sakon-messy-v1.jsonl";
const outputPath = values("--output")[0] ?? ".bench-results/tagger.json";

const { locations } = await loadParserResources(gazetteerPath);
const model = (await Bun.file(modelPath).json()) as TaggerModel;
const systems = {
	tagger: createTaggerParser(model, locations),
	engine: createAddressParser({ version: "gazetteer", locations }),
};
type SystemName = keyof typeof systems;
const SYSTEM_NAMES = Object.keys(systems) as SystemName[];

function percentile(sorted: readonly number[], fraction: number): number {
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function evaluate(records: readonly DatasetRecord[], groupOf?: (record: DatasetRecord) => string) {
	const metrics = Object.fromEntries(SYSTEM_NAMES.map((name) => [name, createMetrics()])) as Record<SystemName, MetricAccumulator>;
	const times = Object.fromEntries(SYSTEM_NAMES.map((name) => [name, [] as number[]])) as Record<SystemName, number[]>;
	const groups = new Map<string, Record<SystemName, MetricAccumulator>>();
	for (const record of records) {
		for (const name of SYSTEM_NAMES) {
			const started = Bun.nanoseconds();
			let fields: ExpectedAddress | null = null;
			try {
				fields = { ...systems[name].parse(record.raw).fields };
			} catch {
				fields = null;
			}
			times[name].push((Bun.nanoseconds() - started) / 1e6);
			addResult(metrics[name], record.expected, fields);
			if (!groupOf) continue;
			const key = groupOf(record);
			const group = groups.get(key) ??
				(Object.fromEntries(SYSTEM_NAMES.map((system) => [system, createMetrics()])) as Record<SystemName, MetricAccumulator>);
			addResult(group[name], record.expected, fields);
			groups.set(key, group);
		}
	}
	return {
		records: records.length,
		...Object.fromEntries(SYSTEM_NAMES.map((name) => {
			const sorted = [...times[name]].sort((left, right) => left - right);
			return [name, {
				metrics: summarize(metrics[name]),
				timing: { medianMs: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95) },
			}];
		})),
		...(groupOf
			? {
				groups: Object.fromEntries(
					[...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, group]) => [
						key,
						Object.fromEntries(SYSTEM_NAMES.map((name) => [name, `${group[name].exactRecords}/${group[name].records}`])),
					]),
				),
			}
			: {}),
		exact: Object.fromEntries(SYSTEM_NAMES.map((name) => [name, `${metrics[name].exactRecords}/${metrics[name].records}`])) as Record<SystemName, string>,
		fieldCorrect: Object.fromEntries(SYSTEM_NAMES.map((name) => [
			name,
			Object.fromEntries(FIELD_NAMES.map((field) => [field, metrics[name].fields[field].correct])),
		])) as Record<SystemName, Record<(typeof FIELD_NAMES)[number], number>>,
		p95Ms: Object.fromEntries(SYSTEM_NAMES.map((name) => [
			name,
			Number(percentile([...times[name]].sort((left, right) => left - right), 0.95).toFixed(2)),
		])) as Record<SystemName, number>,
	};
}

const { split } = await loadTaggerPartitions(datasetPaths, []);
for (const record of [...split.development.slice(0, 50)]) {
	for (const name of SYSTEM_NAMES) systems[name].parse(record.raw);
}
const modelText = await Bun.file(modelPath).text();
const report = {
	status: "exploratory-synthetic-only",
	model: { path: modelPath, version: model.version, bytes: modelText.length, gzipBytes: Bun.gzipSync(modelText).length },
	datasets: datasetPaths.map((path) => basename(path)),
	development: evaluate(split.development),
	evaluation: evaluate(split.evaluation, (record) => record.caseType),
	fixture: { path: fixturePath, ...evaluate(await loadDataset(fixturePath)) },
	limitations: [
		"Synthetic records are not a human-reviewed gold set.",
		"The rule engine was developed against the messy fixture; the tagger never saw it.",
		"The private acceptance list is not part of this report.",
	],
};
await mkdir(dirname(outputPath), { recursive: true });
await Bun.write(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
	outputPath,
	model: report.model,
	development: report.development.exact,
	evaluation: report.evaluation.exact,
	fixture: report.fixture.exact,
	evaluationFields: Object.fromEntries(SYSTEM_NAMES.map((name) => [
		name,
		FIELD_NAMES.map((field) => `${field} ${report.evaluation.fieldCorrect[name][field]}`).join(", "),
	])),
	evaluationP95Ms: report.evaluation.p95Ms,
}, null, 2));
