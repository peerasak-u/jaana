import { basename } from "node:path";
import { loadParserResources } from "../bench/gazetteer";
import { goldTags } from "../bench/tagger-data";
import { loadTrainingRecords } from "../bench/training-records";
import { addResult, createMetrics } from "../bench/metrics";
import { createAnchorer } from "../src/tagger/anchor";
import { featurize } from "../src/tagger/features";
import { createTaggerParser } from "../src/tagger/parser";
import { trainTagger } from "../src/tagger/train";
import { AUGMENT_OPS, type AugmentOp } from "../bench/chat/augment";

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
const dimension = Number(value("--dimension", "65536"));
const epochs = Number(value("--epochs", "8"));
const seed = Number(value("--seed", "20260720"));
const margin = Number(value("--margin", "200"));
const prune = Number(value("--prune", "2"));
const version = value("--model-version", `thai-address-tagger-d${dimension}`);

const { locations } = await loadParserResources(gazetteerPath);
const augmentMultiplier = Number(value("--augment", "1"));
const augmentOps = value("--augment-ops", AUGMENT_OPS.join(",")).split(",") as AugmentOp[];
const { partitions, records: trainRecords, chatRecords, benchPoolDropped } = await loadTrainingRecords({
	datasetPaths,
	extraPaths,
	locations,
	withChat: Bun.argv.includes("--chat-train"),
	chatPercent: Number(value("--chat-percent", "100")),
	augment: augmentMultiplier,
	augmentOps,
	seed,
});
const { split, extraDropped } = partitions;
const anchor = createAnchorer(locations);
const started = performance.now();
const model = trainTagger(
	trainRecords.map((record) => {
		const flags = anchor(record.raw).flags;
		return {
			get features() {
				return featurize(record.raw, flags, dimension);
			},
			tags: goldTags(record),
		};
	}),
	{ version, dimension, epochs, seed, margin, prune },
);
const trainingMs = performance.now() - started;

const artifact = {
	...model,
	training: {
		datasets: datasetPaths.map((path) => basename(path)),
		extraDatasets: extraPaths.map((path) => basename(path)),
		trainRecords: trainRecords.length,
		chatTrainRecords: chatRecords,
		augment: augmentMultiplier > 1 ? { multiplier: augmentMultiplier, ops: augmentOps } : undefined,
		benchPoolDropped,
		extraDropped,
		developmentRecords: split.development.length,
		evaluationRecords: split.evaluation.length,
		splitMethod: split.method,
		epochs,
		seed,
		margin,
		prune,
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
