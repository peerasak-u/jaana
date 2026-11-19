/**
 * Trains the delivery-note reader: an averaged structured perceptron over
 * `noteFeatures`, quantized to one int8 per bucket. Scores the dev set and,
 * with --rules, the cue-word baseline beside it.
 * usage: bun run scripts/notes/train.ts [--tune-bias] [--no-snap] [--eval dev|heldout] [--dimension 32768] [--epochs 8] [--margin 1] [--output resources/notes-model.json] [--failures N]
 */
import { decodeNotes, noteBreaks, noteFeatures, noteRanges, noteScores, type NoteModel } from "../../src/notes/model";
import type { NoteRange } from "../../src/notes/trim";
import { fnv1a } from "../../bench/chat/markup";
import { loadNoteSet } from "../../bench/notes/data";
import { ruleNotes } from "../../bench/notes/rules";
import { scoreNotes, type NoteExample } from "../../bench/notes/score";

function option(name: string, fallback: string): string {
	const index = Bun.argv.indexOf(name);
	return index >= 0 && Bun.argv[index + 1] ? Bun.argv[index + 1]! : fallback;
}
const dimension = Number(option("--dimension", "32768"));
const epochs = Number(option("--epochs", "8"));
const margin = Number(option("--margin", "1"));
const output = option("--output", "resources/experiments/notes/notes-model.json");
const showFailures = Number(option("--failures", "0"));
const snap = !Bun.argv.includes("--no-snap");
const evalSet = option("--eval", "dev") as "dev" | "test" | "heldout";

// `heldout` keeps a tenth of the train pool out, for a smoke run before the dev set exists.
const pool = await loadNoteSet("train");
const heldOut = (example: NoteExample): boolean => evalSet === "heldout" && fnv1a(`notes:${example.id}`) % 10 === 0;
const train = pool.filter((example) => !heldOut(example));
const evaluation = evalSet === "heldout" ? pool.filter(heldOut) : await loadNoteSet(evalSet);
console.error(`train ${train.length} (${train.filter((example) => example.gold.length > 0).length} with notes), ${evalSet} ${evaluation.length}`);

interface Prepared {
	readonly rows: Int32Array[];
	readonly free: Uint8Array;
	readonly target: Uint8Array;
	readonly breaks: Uint8Array;
}

function prepare(example: NoteExample): Prepared {
	const { rows, free } = noteFeatures(example.raw, example.spans, dimension);
	const target = new Uint8Array(example.raw.length);
	for (const range of example.gold) for (let index = range.start; index < range.end; index += 1) target[index] = free[index]!;
	return { rows, free, target, breaks: noteBreaks(example.raw) };
}

const prepared = train.map(prepare);
const weights = new Float64Array(dimension);
const total = new Float64Array(dimension);
const stamp = new Float64Array(dimension);
const transitions = [0, 0, 0, 0];
const transitionTotal = [0, 0, 0, 0];
let bias = 0;
let biasTotal = 0;
let step = 1;

function bump(feature: number, delta: number): void {
	total[feature]! += (step - stamp[feature]!) * weights[feature]!;
	stamp[feature] = step;
	weights[feature]! += delta;
}

for (let epoch = 0; epoch < epochs; epoch += 1) {
	const order = prepared.map((_, index) => index).sort((a, b) => fnv1a(`${epoch}:${a}`) - fnv1a(`${epoch}:${b}`));
	let wrong = 0;
	for (const index of order) {
		const { rows, free, target, breaks } = prepared[index]!;
		const scores = noteScores(rows, weights, bias);
		// Cost-augmented: the wrong label gets a head start of `margin`.
		for (let position = 0; position < scores.length; position += 1) scores[position]! += target[position] ? -margin : margin;
		const guess = decodeNotes(scores, free, transitions, breaks);
		for (let position = 0; position < guess.length; position += 1) {
			if (guess[position] === target[position]) continue;
			wrong += 1;
			const delta = target[position] ? 1 : -1;
			for (const feature of rows[position]!) bump(feature, delta);
			bias += delta;
		}
		for (let position = 1; position < guess.length; position += 1) {
			transitions[target[position - 1]! * 2 + target[position]!]! += 1;
			transitions[guess[position - 1]! * 2 + guess[position]!]! -= 1;
		}
		for (let slot = 0; slot < 4; slot += 1) transitionTotal[slot]! += transitions[slot]!;
		biasTotal += bias;
		step += 1;
	}
	console.error(`epoch ${epoch + 1}: ${wrong} wrong units`);
}
const averaged = new Float64Array(dimension);
for (let feature = 0; feature < dimension; feature += 1) {
	averaged[feature] = (total[feature]! + (step - stamp[feature]!) * weights[feature]!) / step;
}
const averagedTransitions = transitionTotal.map((value) => value / step);
const averagedBias = biasTotal / step;

// int8: the scale maps the 99.9th percentile weight to 127, larger ones clip.
const magnitudes = Array.from(averaged, Math.abs).filter((value) => value > 0).sort((a, b) => a - b);
const scale = 127 / (magnitudes[Math.floor(magnitudes.length * 0.999)] ?? 1);
const quantized = Int8Array.from(averaged, (value) => Math.max(-127, Math.min(127, Math.round(value * scale))));
let model: NoteModel = {
	kind: "notes",
	version: `notes-perceptron-d${dimension}-e${epochs}-m${margin}`,
	dimension,
	weights: Buffer.from(quantized.buffer).toString("base64"),
	transitions: averagedTransitions.map((value) => Math.round(value * scale)),
	bias: Math.round(averagedBias * scale),
	...(snap ? {} : { snap: false }),
};
await Bun.write(output, `${JSON.stringify(model)}\n`);

const evaluationRows = new Map(evaluation.map((example) => [example.id, noteFeatures(example.raw, example.spans, dimension)]));
function predictWith(example: NoteExample, bias = model.bias): NoteRange[] {
	const { rows, free } = evaluationRows.get(example.id)!;
	return noteRanges(example.raw, decodeNotes(noteScores(rows, quantized, bias), free, model.transitions, noteBreaks(example.raw)), snap ? free : undefined);
}

// --tune-bias moves the note threshold to the best character F1 on the evaluation set. Use it on dev only.
if (Bun.argv.includes("--tune-bias")) {
	if (evalSet === "test") throw new Error("never tune on the sealed test set");
	let best = { shift: 0, f1: -1 };
	for (let shift = -60; shift <= 60; shift += 6) {
		const f1 = scoreNotes(evaluation, (example) => predictWith(example, model.bias + shift)).chars.f1;
		console.error(`bias ${shift >= 0 ? "+" : ""}${shift}: char F1 ${f1.toFixed(3)}`);
		if (f1 > best.f1) best = { shift, f1 };
	}
	model = { ...model, bias: model.bias + best.shift, version: `${model.version}-b${best.shift}` };
	await Bun.write(output, `${JSON.stringify(model)}\n`);
}

const learned = scoreNotes(evaluation, (example) => predictWith(example));
const rules = scoreNotes(evaluation, (example) => ruleNotes(example.raw, example.spans));
const text = await Bun.file(output).text();
const summary = (score: ReturnType<typeof scoreNotes>) => ({
	records: score.records,
	withGold: score.withGold,
	charP: Number(score.chars.precision.toFixed(3)),
	charR: Number(score.chars.recall.toFixed(3)),
	charF1: Number(score.chars.f1.toFixed(3)),
	exact: score.exact,
	detectP: Number(score.detection.precision.toFixed(3)),
	detectR: Number(score.detection.recall.toFixed(3)),
	mostlyFound: score.mostlyFound,
	spurious: score.spurious,
});
console.log(JSON.stringify({ set: evalSet, model: model.version, gzipBytes: Bun.gzipSync(text).length, learned: summary(learned), rules: summary(rules) }));
for (const failure of learned.failures.slice(0, showFailures)) {
	console.log(`--- ${failure.id}\n${failure.raw}\n  gold: ${failure.gold}\n  pred: ${failure.predicted}`);
}
