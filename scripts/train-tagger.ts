import { basename } from "node:path";
import { loadParserResources } from "../bench/gazetteer";
import { goldTags, loadTaggerPartitions } from "../bench/tagger-data";
import { addResult, createMetrics } from "../bench/metrics";
import { createAnchorer } from "../src/tagger/anchor";
import { featurize } from "../src/tagger/features";
import { createTaggerParser } from "../src/tagger/parser";
import { trainTagger } from "../src/tagger/train";

function values(name: string): string[] {
	const result: string[] = [];
	for (let index = 0; index < Bun.argv.length; index += 1) {
		if (Bun.argv[index] === name && Bun.argv[index + 1]) result.push(Bun.argv[index + 1]!);
	}
	return result;
}

function value(name: string, fallback: string): string {
	return values(name)[0] ?? fallback;
}

const datasetPaths = values("--dataset");
const extraPaths = values("--extra-dataset");
if (datasetPaths.length === 0) throw new Error("at least one --dataset is required");
const gazetteerPath = value("--gazetteer", "resources/gazetteer.json");
const outputPath = value("--output", "resources/tagger-model.json");
const dimension = Number(value("--dimension", "32768"));
const epochs = Number(value("--epochs", "8"));
const seed = Number(value("--seed", "20260720"));
const version = value("--model-version", `thai-address-tagger-d${dimension}`);

const { locations } = await loadParserResources(gazetteerPath);
const { split, extraTrain, extraDropped } = await loadTaggerPartitions(datasetPaths, extraPaths);
const anchor = createAnchorer(locations);
const trainRecords = [...split.train, ...extraTrain];
const started = performance.now();
const model = trainTagger(
	trainRecords.map((record) => ({
		features: featurize(record.raw, anchor(record.raw).flags, dimension),
		tags: goldTags(record),
	})),
	{ version, dimension, epochs, seed },
);
const trainingMs = performance.now() - started;

const artifact = {
	...model,
	training: {
		datasets: datasetPaths.map((path) => basename(path)),
		extraDatasets: extraPaths.map((path) => basename(path)),
		trainRecords: trainRecords.length,
		extraDropped,
		developmentRecords: split.development.length,
		evaluationRecords: split.evaluation.length,
		splitMethod: split.method,
		epochs,
		seed,
	},
};
const json = `${JSON.stringify(artifact)}\n`;
await Bun.write(outputPath, json);

const parser = createTaggerParser(model, locations);
const development = createMetrics();
for (const record of split.development) {
	addResult(development, record.expected, parser.parse(record.raw).fields);
}
console.log(JSON.stringify({
	outputPath,
	version,
	trainRecords: trainRecords.length,
	trainingMs: Math.round(trainingMs),
	bytes: json.length,
	gzipBytes: Bun.gzipSync(json).length,
	developmentExact: `${development.exactRecords}/${development.records}`,
}, null, 2));
