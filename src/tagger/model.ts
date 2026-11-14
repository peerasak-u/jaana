export const TAGS = [
	"OTHER",
	"NAME",
	"PHONE",
	"ADDRESS_DETAIL",
	"SUBDISTRICT",
	"DISTRICT",
	"PROVINCE",
	"POSTCODE",
	"ORG",
] as const;

export type Tag = (typeof TAGS)[number];
export const TAG_COUNT = TAGS.length;

/**
 * Frozen tagger weights. `weights` is a base64 Int8Array of
 * `dimension * TAG_COUNT` entries, row-major by hashed feature bucket.
 * Scores are compared, never interpreted, so no scale is stored.
 */
export interface TaggerModel {
	readonly version: string;
	readonly dimension: number;
	readonly weights: string;
	readonly transitions: readonly number[];
}

export interface CompiledTaggerModel {
	readonly version: string;
	readonly dimension: number;
	readonly weights: Int8Array;
	readonly transitions: Int32Array;
}

export function compileTaggerModel(model: TaggerModel): CompiledTaggerModel {
	const binary = atob(model.weights);
	const weights = new Int8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		weights[index] = (binary.charCodeAt(index) << 24) >> 24;
	}
	const trained = weights.length / model.dimension;
	if (
		!Number.isInteger(model.dimension) ||
		model.dimension <= 0 ||
		!Number.isInteger(trained) ||
		trained < 1 ||
		trained > TAG_COUNT
	) {
		throw new Error("tagger model weights do not match its dimension");
	}
	if (model.transitions.length !== trained * trained) {
		throw new Error("tagger model transitions must be its tag count squared");
	}
	return {
		version: model.version,
		dimension: model.dimension,
		...widen(weights, model.transitions, model.dimension, trained),
	};
}

const NEVER = -128;

/**
 * Tags are only ever appended, so a model trained before a tag existed
 * scores that tag so low that decoding never picks it.
 */
function widen(
	weights: Int8Array,
	transitions: readonly number[],
	dimension: number,
	trained: number,
): { weights: Int8Array; transitions: Int32Array } {
	if (trained === TAG_COUNT) return { weights, transitions: Int32Array.from(transitions) };
	const wide = new Int8Array(dimension * TAG_COUNT).fill(NEVER);
	for (let feature = 0; feature < dimension; feature += 1) {
		wide.set(weights.subarray(feature * trained, (feature + 1) * trained), feature * TAG_COUNT);
	}
	const wideTransitions = new Int32Array(TAG_COUNT * TAG_COUNT);
	for (let source = 0; source < trained; source += 1) {
		for (let target = 0; target < trained; target += 1) {
			wideTransitions[source * TAG_COUNT + target] = transitions[source * trained + target]!;
		}
	}
	return { weights: wide, transitions: wideTransitions };
}
