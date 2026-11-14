import { TAG_COUNT, type CompiledTaggerModel } from "./model";

/** NAME, PHONE and the four administrative tags may each form one run. */
const SINGLE_RUN_BIT = [0, 1, 2, 0, 4, 8, 16, 32, 0];
const MASK_COUNT = 64;
const STATE_COUNT = TAG_COUNT * MASK_COUNT;
const UNREACHABLE = -(2 ** 30);

export function emissionScores(
	features: readonly Int32Array[],
	weights: Int8Array,
): Int32Array {
	const scores = new Int32Array(features.length * TAG_COUNT);
	for (let position = 0; position < features.length; position += 1) {
		const row = position * TAG_COUNT;
		for (const feature of features[position]!) {
			const base = feature * TAG_COUNT;
			for (let tag = 0; tag < TAG_COUNT; tag += 1) {
				scores[row + tag]! += weights[base + tag]!;
			}
		}
	}
	return scores;
}

/**
 * Best tag sequence in which every single-run tag appears as at most one
 * contiguous run. The state is (current tag, set of single-run tags used).
 */
export function decodeTags(
	features: readonly Int32Array[],
	model: Pick<CompiledTaggerModel, "weights" | "transitions">,
): Uint8Array {
	const n = features.length;
	const tags = new Uint8Array(n);
	if (n === 0) return tags;
	const emit = emissionScores(features, model.weights);
	const transitions = model.transitions;
	let previous = new Int32Array(STATE_COUNT).fill(UNREACHABLE);
	let current = new Int32Array(STATE_COUNT);
	const back = new Int16Array(n * STATE_COUNT);
	for (let tag = 0; tag < TAG_COUNT; tag += 1) {
		previous[tag * MASK_COUNT + SINGLE_RUN_BIT[tag]!] = emit[tag]!;
	}
	for (let position = 1; position < n; position += 1) {
		current.fill(UNREACHABLE);
		for (let tag = 0; tag < TAG_COUNT; tag += 1) {
			const bit = SINGLE_RUN_BIT[tag]!;
			for (let mask = 0; mask < MASK_COUNT; mask += 1) {
				if ((mask & bit) !== bit) continue;
				const stay = tag * MASK_COUNT + mask;
				let best = previous[stay]! + transitions[tag * TAG_COUNT + tag]!;
				let from = stay;
				const sourceMask = mask & ~bit;
				for (let source = 0; source < TAG_COUNT; source += 1) {
					if (source === tag) continue;
					const sourceBit = SINGLE_RUN_BIT[source]!;
					if ((sourceMask & sourceBit) !== sourceBit) continue;
					const state = source * MASK_COUNT + sourceMask;
					const value = previous[state]! + transitions[source * TAG_COUNT + tag]!;
					if (value > best) {
						best = value;
						from = state;
					}
				}
				if (best <= UNREACHABLE / 2) continue;
				current[stay] = best + emit[position * TAG_COUNT + tag]!;
				back[position * STATE_COUNT + stay] = from;
			}
		}
		[previous, current] = [current, previous];
	}
	let state = 0;
	for (let candidate = 1; candidate < STATE_COUNT; candidate += 1) {
		if (previous[candidate]! > previous[state]!) state = candidate;
	}
	for (let position = n - 1; position >= 0; position -= 1) {
		tags[position] = Math.floor(state / MASK_COUNT);
		state = back[position * STATE_COUNT + state]!;
	}
	return tags;
}
