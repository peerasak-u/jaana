import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createAddressParser } from "../src";
import {
	addCalibration,
	createCalibration,
	summarizeCalibration,
} from "./calibration";
import {
	addCandidateFunnel,
	createCandidateFunnel,
	summarizeCandidateFunnel,
} from "./funnel";
import { loadDataset } from "./dataset";
import { loadParserResources } from "./gazetteer";
import {
	parseRecipientList,
	recipientListBlocks,
} from "./list-dataset";
import {
	addResult,
	createMetrics,
	exactAcceptance,
	summarize,
} from "./metrics";

function argument(name: string, fallback?: string): string {
	const index = Bun.argv.indexOf(name);
	const value = index >= 0 ? Bun.argv[index + 1] : fallback;
	if (!value) throw new Error(`missing ${name}`);
	return value;
}

function percentile(values: readonly number[], p: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[
		Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))
	] ?? 0;
}

const inputPath = argument("--input");
const gazetteerPath = argument("--gazetteer", "resources/gazetteer.json");
const outputPath = argument(
	"--output",
	".bench-results/recipient-list.json",
);
const supplementPath = argument(
	"--supplement",
	"bench/fixtures/sakon-messy-v1.jsonl",
);
const minimumExactAccuracy = Number(
	argument("--min-exact-accuracy", "0.95"),
);
const input = await Bun.file(inputPath).text();
const blocks = recipientListBlocks(input);
const structuredRecords = parseRecipientList(input);
const structuredRaw = new Set(structuredRecords.map((record) => record.raw));
const unstructuredBlocks = blocks.filter((block) => !structuredRaw.has(block));
const supplement = await loadDataset(supplementPath);
const supplementByRaw = new Map(supplement.map((record) => [record.raw, record]));
const unmatchedBlocks = unstructuredBlocks.filter(
	(block) => !supplementByRaw.has(block),
);
if (unmatchedBlocks.length > 0) {
	throw new Error(
		`${unmatchedBlocks.length} unstructured recipient-list blocks have no reviewed supplement record`,
	);
}
const records = [
	...structuredRecords,
	...unstructuredBlocks.map((raw, index) => ({
		id: `recipient-list-supplement-${String(index + 1).padStart(4, "0")}`,
		raw,
		style: "messy-reviewed",
		expected: supplementByRaw.get(raw)!.expected,
	})),
];
if (records.length === 0) throw new Error("recipient list is empty");
const resources = await loadParserResources(gazetteerPath);
const engine = createAddressParser(resources);
const diagnostics = createAddressParser(resources, {
	diagnostics: "full",
});
const engineMetrics = createMetrics();
const funnel = createCandidateFunnel();
const engineCalibration = createCalibration();
const engineTimes: number[] = [];
const byStyle = new Map<string, ReturnType<typeof createMetrics>>();

for (const record of records) {
	const engineStart = Bun.nanoseconds();
	const engineResult = engine.parse(record.raw);
	engineTimes.push((Bun.nanoseconds() - engineStart) / 1_000_000);
	addResult(engineMetrics, record.expected, engineResult.fields);
	addCalibration(engineCalibration, record.expected, engineResult);
	addCandidateFunnel(funnel, record.expected, diagnostics.parse(record.raw));
	const style = byStyle.get(record.style) ?? createMetrics();
	addResult(style, record.expected, engineResult.fields);
	byStyle.set(record.style, style);
}

function timing(values: readonly number[]): object {
	return {
		medianMs: percentile(values, 0.5),
		p95Ms: percentile(values, 0.95),
		p99Ms: percentile(values, 0.99),
	};
}

const report = {
	status: "private-recipient-list-aggregate-only",
	generatedAt: new Date().toISOString(),
	resourceVersion: resources.version,
	source: {
		inputChecksum: new Bun.CryptoHasher("sha256").update(input).digest("hex"),
		recordCount: records.length,
		structuredRecords: structuredRecords.length,
		reviewedSupplementRecords: unstructuredBlocks.length,
		unmatchedRecords: unmatchedBlocks.length,
	},
	engine: {
		metrics: summarize(engineMetrics),
		timing: timing(engineTimes),
		calibration: summarizeCalibration(engineCalibration),
	},
	acceptance: exactAcceptance(engineMetrics, minimumExactAccuracy),
	byAddressStyle: Object.fromEntries(
		[...byStyle.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([style, value]) => [style, summarize(value)]),
	),
	candidateFunnel: summarizeCandidateFunnel(funnel),
	privacy: {
		containsRawRecords: false,
		containsExpectedValues: false,
		containsParsedValues: false,
	},
	limitations: [
		"The structured field labels are used only to derive expected fields; the parser receives each complete raw block.",
		"This report contains aggregate metrics only and does not establish production accuracy.",
	],
};
await mkdir(dirname(outputPath), { recursive: true });
await Bun.write(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
	JSON.stringify(
		{
			outputPath,
			records: records.length,
			engine: report.engine,
		},
		null,
		2,
	),
);
if (!report.acceptance.passed) {
	throw new Error(
		`recipient-list benchmark failed: ${report.acceptance.actualExactRecords}/${records.length} exact records; requires ${report.acceptance.requiredExactRecords}`,
	);
}
