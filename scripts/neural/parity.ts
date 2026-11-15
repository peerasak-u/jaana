import { loadParserResources } from "../../bench/gazetteer";
import { createAnchorer } from "../../src/tagger/anchor";
import { createNeuralEmitter, type NeuralTaggerModel } from "../../src/tagger/neural";
import { loadFirstBatch } from "./first-batch";

/**
 * Compares the TypeScript forward pass with the NumPy reference scores that
 * export_model.py wrote, over every dev and test1 record, and times it.
 * usage: parity.ts <model.json>
 */
const modelPath = Bun.argv[2];
if (!modelPath) throw new Error("usage: parity.ts <model.json>");
const model = (await Bun.file(modelPath).json()) as NeuralTaggerModel;
const reference = (await Bun.file(modelPath.replace(".json", ".reference-scores.json")).json()) as {
	scores: Record<string, number[]>;
};
const { locations } = await loadParserResources("resources/gazetteer.json");
const anchor = createAnchorer(locations);
const emit = createNeuralEmitter(model);
const { dev, test1 } = await loadFirstBatch(locations);
let units = 0;
let differing = 0;
let largest = 0;
let argmaxFlips = 0;
for (const record of [...dev, ...test1]) {
	const ours = emit(record.raw, anchor(record.raw).flags);
	const theirs = reference.scores[record.id]!;
	if (theirs.length !== ours.length) throw new Error(`length mismatch on ${record.id}`);
	for (let t = 0; t < record.raw.length; t += 1) {
		let best = 0;
		let theirBest = 0;
		for (let tag = 0; tag < 9; tag += 1) {
			const index = t * 9 + tag;
			const gap = Math.abs(ours[index]! - theirs[index]!);
			if (gap > 0) differing += 1;
			largest = Math.max(largest, gap);
			if (ours[index]! > ours[t * 9 + best]!) best = tag;
			if (theirs[index]! > theirs[t * 9 + theirBest]!) theirBest = tag;
		}
		if (best !== theirBest) argmaxFlips += 1;
		units += 1;
	}
}
const long = [...dev, ...test1].sort((a, b) => b.raw.length - a.raw.length)[0]!;
const raw = long.raw.padEnd(300, " ").slice(0, 300);
const flags = anchor(raw).flags;
const samples: number[] = [];
for (let round = 0; round < 60; round += 1) {
	const started = Bun.nanoseconds();
	emit(raw, flags);
	samples.push((Bun.nanoseconds() - started) / 1e6);
}
samples.sort((a, b) => a - b);
console.log(JSON.stringify({
	units,
	scoresDiffering: differing,
	largestGap: largest,
	argmaxFlips,
	forward300MedianMs: Number(samples[30]!.toFixed(2)),
	forward300P95Ms: Number(samples[57]!.toFixed(2)),
}));
