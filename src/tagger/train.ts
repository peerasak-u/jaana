import { TAG_COUNT, type TaggerModel } from "./model";

export interface TaggedExample {
	readonly features: readonly Int32Array[];
	readonly tags: ArrayLike<number>;
}

export interface TrainingOptions {
	readonly version: string;
	readonly dimension: number;
	readonly epochs: number;
	readonly seed: number;
}

function shuffle<T>(items: T[], seed: number): void {
	let state = seed >>> 0;
	for (let index = items.length - 1; index > 0; index -= 1) {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		const other = state % (index + 1);
		[items[index], items[other]] = [items[other]!, items[index]!];
	}
}

function bestSequence(
	features: readonly Int32Array[],
	weights: Float32Array,
	transitions: Float32Array,
): Uint8Array {
	const n = features.length;
	const tags = new Uint8Array(n);
	if (n === 0) return tags;
	const scores = new Float64Array(n * TAG_COUNT);
	const back = new Uint8Array(n * TAG_COUNT);
	const emit = new Float64Array(TAG_COUNT);
	for (let position = 0; position < n; position += 1) {
		emit.fill(0);
		for (const feature of features[position]!) {
			const base = feature * TAG_COUNT;
			for (let tag = 0; tag < TAG_COUNT; tag += 1) emit[tag]! += weights[base + tag]!;
		}
		for (let tag = 0; tag < TAG_COUNT; tag += 1) {
			if (position === 0) {
				scores[tag] = emit[tag]!;
				continue;
			}
			let best = -Infinity;
			let from = 0;
			for (let source = 0; source < TAG_COUNT; source += 1) {
				const value = scores[(position - 1) * TAG_COUNT + source]! +
					transitions[source * TAG_COUNT + tag]!;
				if (value > best) {
					best = value;
					from = source;
				}
			}
			scores[position * TAG_COUNT + tag] = best + emit[tag]!;
			back[position * TAG_COUNT + tag] = from;
		}
	}
	let tag = 0;
	for (let candidate = 1; candidate < TAG_COUNT; candidate += 1) {
		if (scores[(n - 1) * TAG_COUNT + candidate]! > scores[(n - 1) * TAG_COUNT + tag]!) {
			tag = candidate;
		}
	}
	for (let position = n - 1; position >= 0; position -= 1) {
		tags[position] = tag;
		tag = back[position * TAG_COUNT + tag]!;
	}
	return tags;
}

class AveragedWeights {
	readonly live: Float32Array;
	private readonly total: Float64Array;
	private readonly stamp: Int32Array;

	constructor(size: number) {
		this.live = new Float32Array(size);
		this.total = new Float64Array(size);
		this.stamp = new Int32Array(size);
	}

	add(index: number, delta: number, step: number): void {
		this.total[index]! += (step - this.stamp[index]!) * this.live[index]!;
		this.stamp[index] = step;
		this.live[index]! += delta;
	}

	average(step: number): Float64Array {
		return this.total.map(
			(value, index) => (value + (step - this.stamp[index]!) * this.live[index]!) / step,
		);
	}
}

/**
 * Averaged structured perceptron over hashed character features, quantized
 * to int8. Deterministic for a given seed and example order.
 */
export function trainTagger(
	examples: readonly TaggedExample[],
	options: TrainingOptions,
): TaggerModel {
	const weights = new AveragedWeights(options.dimension * TAG_COUNT);
	const transitions = new AveragedWeights(TAG_COUNT * TAG_COUNT);
	const order = [...examples];
	let step = 0;
	for (let epoch = 0; epoch < options.epochs; epoch += 1) {
		shuffle(order, options.seed + epoch);
		for (const example of order) {
			step += 1;
			const guess = bestSequence(example.features, weights.live, transitions.live);
			for (let position = 0; position < guess.length; position += 1) {
				const gold = example.tags[position]!;
				const predicted = guess[position]!;
				if (gold !== predicted) {
					for (const feature of example.features[position]!) {
						weights.add(feature * TAG_COUNT + gold, 1, step);
						weights.add(feature * TAG_COUNT + predicted, -1, step);
					}
				}
				if (position === 0) continue;
				const goldSource = example.tags[position - 1]!;
				const predictedSource = guess[position - 1]!;
				if (goldSource !== predictedSource || gold !== predicted) {
					transitions.add(goldSource * TAG_COUNT + gold, 1, step);
					transitions.add(predictedSource * TAG_COUNT + predicted, -1, step);
				}
			}
		}
	}
	const averagedWeights = weights.average(Math.max(step, 1));
	const averagedTransitions = transitions.average(Math.max(step, 1));
	let largest = 0;
	for (const value of averagedWeights) largest = Math.max(largest, Math.abs(value));
	for (const value of averagedTransitions) largest = Math.max(largest, Math.abs(value));
	const scale = largest === 0 ? 1 : largest / 127;
	const quantized = new Int8Array(averagedWeights.length);
	for (let index = 0; index < quantized.length; index += 1) {
		quantized[index] = Math.round(averagedWeights[index]! / scale);
	}
	let binary = "";
	for (let index = 0; index < quantized.length; index += 1) {
		binary += String.fromCharCode(quantized[index]! & 255);
	}
	return {
		version: options.version,
		dimension: options.dimension,
		weights: btoa(binary),
		transitions: Array.from(averagedTransitions, (value) => Math.round(value / scale)),
	};
}
