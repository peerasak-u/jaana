import { closeSync, openSync, writeSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { AUGMENT_OPS } from "../../bench/chat/augment";
import type { DatasetRecord } from "../../bench/dataset";
import { loadParserResources } from "../../bench/gazetteer";
import { goldTags } from "../../bench/tagger-data";
import { loadTrainingRecords } from "../../bench/training-records";
import { createAnchorer } from "../../src/tagger/anchor";
import { cueMarksOfRaw } from "../../src/tagger/features";
import type { TaggerModel } from "../../src/tagger/model";
import { linearScorer } from "../../src/tagger/parser";
import { loadFirstBatch } from "./first-batch";

function option(name: string, fallback: string): string {
	const index = Bun.argv.indexOf(name);
	return index >= 0 && Bun.argv[index + 1] ? Bun.argv[index + 1]! : fallback;
}

const data = process.env.THAI_ADDRESS_DATA ?? `${process.env.HOME}/Workspace/indie/thai-address-synth-dataset/data/generated`;
const outDir = option("--out-dir", "resources/experiments/neural/data");
const augment = Number(option("--augment", "16"));
const seed = Number(option("--seed", "20260720"));
const linearPath = option("--linear", "resources/tagger-model.json");

const { locations } = await loadParserResources("resources/gazetteer.json");
const anchor = createAnchorer(locations);
const linear = linearScorer((await Bun.file(linearPath).json()) as TaggerModel);

/** One sequence: per UTF-16 unit the anchor flags, the cue bits (inside, starts << 6, follows << 12) and the gold tag. */
function row(record: DatasetRecord, withLinear: boolean): Record<string, unknown> {
	const flags = anchor(record.raw).flags;
	const cues = cueMarksOfRaw(record.raw);
	return {
		raw: record.raw,
		tags: Array.from(goldTags(record)).join(""),
		flags: Array.from(flags),
		cues: Array.from(cues.inside, (inside, index) => inside | (cues.starts[index]! << 6) | (cues.follows[index]! << 12)),
		...(withLinear ? { linear: Array.from(linear.score(record.raw, flags)) } : {}),
	};
}

function writeJsonl(path: string, lines: Iterable<Record<string, unknown>>): number {
	const file = openSync(path, "w");
	let count = 0;
	for (const line of lines) {
		writeSync(file, `${JSON.stringify(line)}\n`);
		count += 1;
	}
	closeSync(file);
	return count;
}

await mkdir(outDir, { recursive: true });
const training = await loadTrainingRecords({
	datasetPaths: [`${data}/construction-v1.jsonl`, `${data}/name-robust-v1-2040-r1.jsonl`],
	extraPaths: [`${data}/chat-v2-scale-1500-r1.jsonl`, `${data}/address-detail-robust-v1-600-r1.jsonl`],
	locations,
	withChat: true,
	chatPercent: 100,
	augment,
	augmentOps: AUGMENT_OPS,
	seed,
});
const withLinearTrain = Bun.argv.includes("--linear-train");
const trainCount = writeJsonl(
	join(outDir, `train-a${augment}.jsonl`),
	(function* () {
		for (const record of training.records) yield { id: record.id, ...row(record, withLinearTrain) };
	})(),
);
const { dev, test1 } = await loadFirstBatch(locations);
const benchCount = writeJsonl(
	join(outDir, "bench.jsonl"),
	[...dev.map((record) => ({ split: "dev", record })), ...test1.map((record) => ({ split: "test1", record }))]
		.map(({ split, record }) => ({ id: record.id, split, ...row(record, true) })),
);
console.log(JSON.stringify({ outDir, train: trainCount, chatTrain: training.chatRecords, bench: benchCount, dev: dev.length, test1: test1.length }));
