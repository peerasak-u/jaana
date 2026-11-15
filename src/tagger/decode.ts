import { TAG_COUNT, TAGS, type CompiledTaggerModel } from "./model";

/** NAME, PHONE and the four administrative tags may each form one run. */
const SINGLE_RUN_BIT = [0, 1, 2, 0, 4, 8, 16, 32, 0];
const MASK_COUNT = 64;
const STATE_COUNT = TAG_COUNT * MASK_COUNT;
const UNREACHABLE = -(2 ** 30);
const BINDS_TO_PREVIOUS = /[ะ-ฺๅ็-๎]/u;
const BINDS_TO_NEXT = /[เ-ไ]/u;
const LATIN = /[A-Za-z]/u;
const WORD = /[\p{L}\p{N}\p{M}]/u;
const ANY_TAG = (1 << TAG_COUNT) - 1;
const OTHER_BIT = 1 << TAGS.indexOf("OTHER");
const PHONE_BIT = 1 << TAGS.indexOf("PHONE");
const ADDRESS_BIT = 1 << TAGS.indexOf("ADDRESS_DETAIL");

/** Per position, the tags (as bits) whose run may start there, end there, and cover it. */
export interface SpanEdges {
	readonly opens: Uint16Array;
	readonly closes: Uint16Array;
	readonly covers: Uint16Array;
}

/**
 * Where a run may start and end, from the gold rules. A field starts on a
 * letter or digit (a phone also on `+` or `(`, an address on `#`) and ends on
 * one or on `)` or `.`. No run starts inside a Thai character cluster (a
 * vowel or tone mark, or after a leading vowel) or a Latin word. Only address
 * detail may cover a line break. No gold span in the training data breaks these.
 */
export function spanEdges(raw: string): SpanEdges {
	const n = raw.length;
	const opens = new Uint16Array(n);
	const closes = new Uint16Array(n);
	const covers = new Uint16Array(n);
	for (let index = 0; index < n; index += 1) {
		const character = raw[index]!;
		const word = WORD.test(character);
		opens[index] = word
			? ANY_TAG
			: OTHER_BIT |
				("+(".includes(character) ? PHONE_BIT : 0) |
				(character === "#" ? ADDRESS_BIT : 0);
		covers[index] = character === "\n" ? OTHER_BIT | ADDRESS_BIT : ANY_TAG;
		closes[index] = word || character === ")" || character === "." ? ANY_TAG : OTHER_BIT;
	}
	for (let index = 1; index < n; index += 1) {
		const previous = raw[index - 1]!;
		const current = raw[index]!;
		if (
			BINDS_TO_PREVIOUS.test(current) ||
			BINDS_TO_NEXT.test(previous) ||
			(LATIN.test(previous) && LATIN.test(current))
		) {
			opens[index] = 0;
			closes[index - 1] = 0;
		}
	}
	return { opens, closes, covers };
}

function unconstrained(n: number): SpanEdges {
	const any = new Uint16Array(n).fill(ANY_TAG);
	return { opens: any, closes: any, covers: any };
}

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
 * contiguous run, and every run starts and ends where `edges` allows. The
 * state is (current tag, set of single-run tags used).
 */
export function decodeTags(
	features: readonly Int32Array[],
	model: Pick<CompiledTaggerModel, "weights" | "transitions">,
	edges: SpanEdges = unconstrained(features.length),
): Uint8Array {
	return decodeEmissions(emissionScores(features, model.weights), model.transitions, edges);
}

/** `decodeTags` over emission scores already computed, `TAG_COUNT` per position. */
export function decodeEmissions(
	emit: Int32Array,
	transitions: Int32Array,
	edges: SpanEdges = unconstrained(emit.length / TAG_COUNT),
): Uint8Array {
	const n = emit.length / TAG_COUNT;
	const tags = new Uint8Array(n);
	if (n === 0) return tags;
	const { opens, closes, covers } = edges;
	let previous = new Int32Array(STATE_COUNT).fill(UNREACHABLE);
	let current = new Int32Array(STATE_COUNT);
	const back = new Int16Array(n * STATE_COUNT);
	for (let tag = 0; tag < TAG_COUNT; tag += 1) {
		if (opens[0]! & covers[0]! & (1 << tag)) previous[tag * MASK_COUNT + SINGLE_RUN_BIT[tag]!] = emit[tag]!;
	}
	for (let position = 1; position < n; position += 1) {
		current.fill(UNREACHABLE);
		const closing = closes[position - 1]!;
		for (let tag = 0; tag < TAG_COUNT; tag += 1) {
			if ((covers[position]! & (1 << tag)) === 0) continue;
			const opening = (opens[position]! & (1 << tag)) !== 0;
			const bit = SINGLE_RUN_BIT[tag]!;
			for (let mask = 0; mask < MASK_COUNT; mask += 1) {
				if ((mask & bit) !== bit) continue;
				const stay = tag * MASK_COUNT + mask;
				let best = previous[stay]! + transitions[tag * TAG_COUNT + tag]!;
				let from = stay;
				const sourceMask = mask & ~bit;
				for (let source = 0; source < TAG_COUNT && opening; source += 1) {
					if (source === tag || (closing & (1 << source)) === 0) continue;
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
		const ends = (closes[n - 1]! & (1 << Math.floor(candidate / MASK_COUNT))) !== 0;
		if (ends && previous[candidate]! > previous[state]!) state = candidate;
	}
	for (let position = n - 1; position >= 0; position -= 1) {
		tags[position] = Math.floor(state / MASK_COUNT);
		state = back[position * STATE_COUNT + state]!;
	}
	return tags;
}
