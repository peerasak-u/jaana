import { mkdir } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { createAddressParser } from "../src";
import {
	addCalibration,
	createCalibration,
	summarizeCalibration,
} from "./calibration";
import { loadDataset, type ExpectedAddress } from "./dataset";
import {
	addCandidateFunnel,
	createCandidateFunnel,
	summarizeCandidateFunnel,
} from "./funnel";
import { loadParserResources } from "./gazetteer";
import { loadLegacyParser } from "./legacy";
import { addResult, createMetrics, summarize } from "./metrics";
import { splitForTraining } from "./split";

function argument(name: string, fallback?: string): string {
	const index = Bun.argv.indexOf(name);
	const value = index >= 0 ? Bun.argv[index + 1] : fallback;
	if (!value) throw new Error(`missing ${name}`);
	return value;
}

function argumentsFor(name: string): string[] {
	const values: string[] = [];
	for (let index = 0; index < Bun.argv.length; index += 1) {
		if (Bun.argv[index] === name && Bun.argv[index + 1]) values.push(Bun.argv[index + 1]!);
	}
	return values;
}

function percentile(values: readonly number[], p: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	return (
		sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ??
		0
	);
}

const datasetPaths = argumentsFor("--dataset");
if (datasetPaths.length === 0) throw new Error("missing --dataset");
const gazetteerPath = argument("--gazetteer", "resources/gazetteer.json");
const splitSeed = argument("--seed", "20260720");
const legacyPath = argument(
	"--legacy",
	`${process.env.HOME}/Workspace/indie/thai-address-splitter`,
);
const outputPath = argument(
	"--output",
	".bench-results/engine.json",
);

const datasetFamilies = await Promise.all(datasetPaths.map(loadDataset));
const records = datasetFamilies.flat();
const familyById = new Map<string, string>();
for (const [index, family] of datasetFamilies.entries()) {
	const familyId = basename(datasetPaths[index] ?? `dataset-${index + 1}`);
	for (const record of family) {
		if (familyById.has(record.id)) {
			throw new Error(`duplicate dataset id across files: ${record.id}`);
		}
		familyById.set(record.id, familyId);
	}
}
const split = splitForTraining(records, splitSeed);
const evaluation = split.evaluation;
const resources = await loadParserResources(gazetteerPath);

const engine = createAddressParser(resources);
const diagnosticParser = createAddressParser(resources, {
	diagnostics: "full",
});
const legacy = loadLegacyParser(legacyPath);
const engineMetrics = createMetrics();
const legacyMetrics = createMetrics();
const engineTimes: number[] = [];
const legacyTimes: number[] = [];
interface SystemMetrics {
	engine: ReturnType<typeof createMetrics>;
	legacy: ReturnType<typeof createMetrics>;
}
const byCase = new Map<string, SystemMetrics>();
const byDatasetFamily = new Map<string, SystemMetrics>();
const candidateFunnel = createCandidateFunnel();
const engineCalibration = createCalibration();

for (const record of evaluation) {
	let engineOutput: ExpectedAddress | null = null;
	let legacyOutput: ExpectedAddress | null = null;
	let engineResult: ReturnType<typeof engine.parse> | null = null;
	const engineStart = Bun.nanoseconds();
	try {
		engineResult = engine.parse(record.raw);
		engineOutput = { ...engineResult.fields };
	} catch {
		engineOutput = null;
	} finally {
		engineTimes.push((Bun.nanoseconds() - engineStart) / 1_000_000);
	}
	const legacyStart = Bun.nanoseconds();
	try {
		legacyOutput = legacy(record.raw);
	} catch {
		legacyOutput = null;
	} finally {
		legacyTimes.push((Bun.nanoseconds() - legacyStart) / 1_000_000);
	}
	addResult(engineMetrics, record.expected, engineOutput);
	addResult(legacyMetrics, record.expected, legacyOutput);
	if (engineResult) addCalibration(engineCalibration, record.expected, engineResult);
	addCandidateFunnel(
		candidateFunnel,
		record.expected,
		diagnosticParser.parse(record.raw),
		record.spans,
		record.normalizationExpected,
	);
	const slice = byCase.get(record.caseType) ?? {
		engine: createMetrics(),
		legacy: createMetrics(),
	};
	addResult(slice.engine, record.expected, engineOutput);
	addResult(slice.legacy, record.expected, legacyOutput);
	byCase.set(record.caseType, slice);
	const familyId = familyById.get(record.id) ?? "unknown";
	const family = byDatasetFamily.get(familyId) ?? {
		engine: createMetrics(),
		legacy: createMetrics(),
	};
	addResult(family.engine, record.expected, engineOutput);
	addResult(family.legacy, record.expected, legacyOutput);
	byDatasetFamily.set(familyId, family);
}

function timing(values: readonly number[]): object {
	return {
		medianMs: percentile(values, 0.5),
		p95Ms: percentile(values, 0.95),
		p99Ms: percentile(values, 0.99),
	};
}

const report = {
	status: "exploratory-synthetic-only",
	generatedAt: new Date().toISOString(),
	runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
	resourceVersion: resources.version,
	split: {
		seed: splitSeed,
		method: split.method,
		evaluationIds: evaluation.map((record) => record.id),
	},
	source: {
		datasets: datasetPaths.map((path) => basename(path)),
		recordCount: records.length,
	},
	evaluatedRecords: evaluation.length,
	engine: {
		metrics: summarize(engineMetrics),
		timing: timing(engineTimes),
		calibration: summarizeCalibration(engineCalibration),
	},
	legacy: { metrics: summarize(legacyMetrics), timing: timing(legacyTimes) },
	byCaseType: Object.fromEntries(
		[...byCase.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, value]) => [
				key,
				{
					engine: summarize(value.engine),
					legacy: summarize(value.legacy),
				},
			]),
	),
	byDatasetFamily: Object.fromEntries(
		[...byDatasetFamily.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, value]) => [
				key,
				{
					engine: summarize(value.engine),
					legacy: summarize(value.legacy),
				},
			]),
	),
	candidateFunnel: summarizeCandidateFunnel(candidateFunnel),
	limitations: [
		"Construction records are synthetic and are not a human-reviewed gold set.",
		"The split excludes cross-partition records and holds out complete location tuples plus generator-declared evaluation template families.",
		"No production-quality superiority claim is supported by this report.",
	],
};
await mkdir(dirname(outputPath), { recursive: true });
await Bun.write(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
	JSON.stringify(
		{
			outputPath,
			evaluatedRecords: evaluation.length,
			engine: report.engine,
			legacy: report.legacy,
		},
		null,
		2,
	),
);
