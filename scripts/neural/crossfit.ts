import { closeSync, openSync, writeSync } from "node:fs";
import { AUGMENT_OPS } from "../../bench/chat/augment";
import { fnv1a } from "../../bench/chat/markup";
import { loadParserResources } from "../../bench/gazetteer";
import { goldTags } from "../../bench/tagger-data";
import { loadTrainingRecords } from "../../bench/training-records";
import { createAnchorer } from "../../src/tagger/anchor";
import { featurize } from "../../src/tagger/features";
import { linearScorer } from "../../src/tagger/parser";
import { trainTagger } from "../../src/tagger/train";

/**
 * Linear scores for every training sequence from a linear tagger that never
 * saw it: two folds by source record (augmented copies `<id>~<n>` stay with
 * their source), each scored by the model trained on the other. Written as
 * int16, `TAG_COUNT` per UTF-16 unit, in export order, so a stacked net trains
 * on scores as noisy as the ones it meets at parse time.
 */
function option(name: string, fallback: string): string {
	const index = Bun.argv.indexOf(name);
	return index >= 0 && Bun.argv[index + 1] ? Bun.argv[index + 1]! : fallback;
}

const data = process.env.THAI_ADDRESS_DATA ?? `${process.env.HOME}/Workspace/indie/thai-address-synth-dataset/data/generated`;
const augment = Number(option("--augment", "16"));
const seed = Number(option("--seed", "20260720"));
const output = option("--output", `resources/experiments/neural/data/train-a${augment}.linear.i16`);

const { locations } = await loadParserResources("resources/gazetteer.json");
const anchor = createAnchorer(locations);
const { records } = await loadTrainingRecords({
	datasetPaths: [`${data}/construction-v1.jsonl`, `${data}/name-robust-v1-2040-r1.jsonl`],
	extraPaths: [`${data}/chat-v2-scale-1500-r1.jsonl`, `${data}/address-detail-robust-v1-600-r1.jsonl`],
	locations,
	withChat: true,
	chatPercent: 100,
	augment,
	augmentOps: AUGMENT_OPS,
	seed,
});
const flags = records.map((record) => anchor(record.raw).flags);
const fold = records.map((record) => fnv1a(`fold:${record.id.split("~")[0]}`) % 2);
const scores: Int32Array[] = new Array(records.length);
for (const held of [0, 1]) {
	const started = performance.now();
	const examples = records.flatMap((record, index) => fold[index] === held ? [] : [{
		get features() {
			return featurize(record.raw, flags[index]!, 65536);
		},
		tags: goldTags(record),
	}]);
	const model = trainTagger(examples, { version: `crossfit-${held}`, dimension: 65536, epochs: 8, seed, margin: 200, prune: 0 });
	const scorer = linearScorer(model);
	records.forEach((record, index) => {
		if (fold[index] === held) scores[index] = scorer.score(record.raw, flags[index]!);
	});
	console.log(JSON.stringify({ held, trained: examples.length, minutes: ((performance.now() - started) / 60000).toFixed(1) }));
}
const file = openSync(output, "w");
for (const score of scores) writeSync(file, Int16Array.from(score, (value) => Math.max(-32768, Math.min(32767, value))));
closeSync(file);
console.log(JSON.stringify({ output, records: records.length }));
