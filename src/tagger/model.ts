export const TAGS = [
	"OTHER",
	"NAME",
	"PHONE",
	"ADDRESS_DETAIL",
	"SUBDISTRICT",
	"DISTRICT",
	"PROVINCE",
	"POSTCODE",
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
	if (
		!Number.isInteger(model.dimension) ||
		model.dimension <= 0 ||
		weights.length !== model.dimension * TAG_COUNT
	) {
		throw new Error("tagger model weights do not match its dimension");
	}
	if (model.transitions.length !== TAG_COUNT * TAG_COUNT) {
		throw new Error("tagger model transitions must be TAG_COUNT squared");
	}
	return {
		version: model.version,
		dimension: model.dimension,
		weights,
		transitions: Int32Array.from(model.transitions),
	};
}
