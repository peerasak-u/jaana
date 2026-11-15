import { encodeWeights, TAG_COUNT, type TaggerModel } from "./model";

export interface TaggedExample {
	/** Read once per training step, so a getter may featurize on demand instead of holding every row. */
	readonly features: readonly Int32Array[];
	readonly tags: ArrayLike<number>;
}

export interface TrainingOptions {
	readonly version: string;
	readonly dimension: number;
	readonly epochs: number;
	readonly seed: number;
	/** Score bonus for every wrong tag while training, so updates also fire on narrow wins. */
	readonly margin?: number;
	/**
	 * Weights the first run averages below this many int8 steps are held at
	 * zero while a second run retrains around them. Zeros gzip to almost
	 * nothing, so this trades training time for a smaller model.
	 */
	readonly prune?: number;
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
	gold: ArrayLike<number>,
	margin: number,
): Uint8Array {
	const n = features.length;
	const tags = new Uint8Array(n);
	if (n === 0) return tags;
	const scores = new Float64Array(n * TAG_COUNT);
	const back = new Uint8Array(n * TAG_COUNT);
	const emit = new Float64Array(TAG_COUNT);
	for (let position = 0; position < n; position += 1) {
		emit.fill(margin);
		emit[gold[position]!] = 0;
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

interface Averaged {
	readonly weights: Float64Array;
	readonly transitions: Float64Array;
}

/** One full training run. A weight outside `keep` never moves from zero. */
function averagedPerceptron(
	examples: readonly TaggedExample[],
	options: TrainingOptions,
	keep?: Uint8Array,
): Averaged {
	const weights = new AveragedWeights(options.dimension * TAG_COUNT);
	const transitions = new AveragedWeights(TAG_COUNT * TAG_COUNT);
	const update = (index: number, delta: number, step: number): void => {
		if (keep === undefined || keep[index]) weights.add(index, delta, step);
	};
	const order = [...examples];
	let step = 0;
	for (let epoch = 0; epoch < options.epochs; epoch += 1) {
		shuffle(order, options.seed + epoch);
		for (const example of order) {
			step += 1;
			const features = example.features;
			const guess = bestSequence(
				features,
				weights.live,
				transitions.live,
				example.tags,
				options.margin ?? 0,
			);
			for (let position = 0; position < guess.length; position += 1) {
				const gold = example.tags[position]!;
				const predicted = guess[position]!;
				if (gold !== predicted) {
					for (const feature of features[position]!) {
						update(feature * TAG_COUNT + gold, 1, step);
						update(feature * TAG_COUNT + predicted, -1, step);
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
	return {
		weights: weights.average(Math.max(step, 1)),
		transitions: transitions.average(Math.max(step, 1)),
	};
}

/** The int8 step: the largest weight or transition maps to 127. */
function stepOf(model: Averaged): number {
	let largest = 0;
	for (const value of model.weights) largest = Math.max(largest, Math.abs(value));
	for (const value of model.transitions) largest = Math.max(largest, Math.abs(value));
	return largest === 0 ? 1 : largest / 127;
}

/**
 * Averaged structured perceptron over hashed character features, quantized
 * to int8. Deterministic for a given seed and example order. With `prune`,
 * a second run retrains around the weights the first run left small.
 */
export function trainTagger(
	examples: readonly TaggedExample[],
	options: TrainingOptions,
): TaggerModel {
	let model = averagedPerceptron(examples, options);
	if (options.prune) {
		const cut = options.prune * stepOf(model);
		const keep = Uint8Array.from(model.weights, (value) => (Math.abs(value) >= cut ? 1 : 0));
		model = averagedPerceptron(examples, options, keep);
	}
	const scale = stepOf(model);
	const quantized = Int8Array.from(model.weights, (value) => Math.round(value / scale));
	return {
		version: options.version,
		dimension: options.dimension,
		encoding: "ascii",
		weights: encodeWeights(quantized),
		transitions: Array.from(model.transitions, (value) => Math.round(value / scale)),
	};
}
