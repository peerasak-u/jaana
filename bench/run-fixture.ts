import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createAddressParser } from "../src";
import { loadDataset } from "./dataset";
import { loadParserResources } from "./gazetteer";
import { addResult, createMetrics, summarize } from "./metrics";

function argument(name: string, fallback?: string): string {
	const index = Bun.argv.indexOf(name);
	const value = index >= 0 ? Bun.argv[index + 1] : fallback;
	if (!value) throw new Error(`missing ${name}`);
	return value;
}

const datasetPath = argument("--dataset", "bench/fixtures/sakon-messy-v1.jsonl");
const gazetteerPath = argument("--gazetteer", "resources/gazetteer.json");
const outputPath = argument(
	"--output",
	".bench-results/sakon-messy-v1.json",
);
const records = await loadDataset(datasetPath);
const parser = createAddressParser(await loadParserResources(gazetteerPath));
const metrics = createMetrics();
const byCase = new Map<string, ReturnType<typeof createMetrics>>();

for (const record of records) {
	const actual = parser.parse(record.raw).fields;
	addResult(metrics, record.expected, actual);
	const caseMetrics = byCase.get(record.caseType) ?? createMetrics();
	addResult(caseMetrics, record.expected, actual);
	byCase.set(record.caseType, caseMetrics);
}

const report = {
	status: "exploratory-messy-fixture",
	datasetPath,
	gazetteerPath,
	evaluatedRecords: records.length,
	metrics: summarize(metrics),
	byCaseType: Object.fromEntries(
		[...byCase.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, value]) => [key, summarize(value)]),
	),
	limitations: [
		"This fixture is hand-authored and not a production-quality gold set.",
		"Several records intentionally contain typos, Thai digits, missing prefixes, or reordered fields.",
		"Results should be reported separately from the synthetic construction benchmark.",
	],
};
await mkdir(dirname(outputPath), { recursive: true });
await Bun.write(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, evaluatedRecords: records.length, metrics: report.metrics }, null, 2));
