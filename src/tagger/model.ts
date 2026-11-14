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
 * Frozen tagger weights: `dimension * TAG_COUNT` int8 entries, row-major by
 * hashed feature bucket. With `encoding: "ascii"` each weight is one
 * character (see `encodeWeights`), which gzips far better than base64.
 * Without it, `weights` is base64 bytes. Scores are compared, never
 * interpreted, so no scale is stored.
 */
export interface TaggerModel {
	readonly version: string;
	readonly dimension: number;
	readonly encoding?: "ascii";
	readonly weights: string;
	readonly transitions: readonly number[];
}

/** Printable ASCII that needs no JSON escape, so the model stays one plain string. */
const ALPHABET = Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index))
	.filter((character) => character !== '"' && character !== "\\")
	.join("");
const DIRECT = 45;
const ESCAPE = ALPHABET[2 * DIRECT + 1]!;

/**
 * Weights within ±45 map to one alphabet character, zero to the middle
 * one. Larger ones are rare and take the escape character plus two hex
 * digits of the byte.
 */
export function encodeWeights(weights: Int8Array): string {
	let text = "";
	for (const weight of weights) {
		text += Math.abs(weight) <= DIRECT
			? ALPHABET[weight + DIRECT]
			: ESCAPE + (weight & 255).toString(16).padStart(2, "0");
	}
	return text;
}

function decodeWeights(model: TaggerModel): Int8Array {
	if (model.encoding !== "ascii") {
		return Int8Array.from(atob(model.weights), (character) => (character.charCodeAt(0) << 24) >> 24);
	}
	const text = model.weights;
	const value = new Int8Array(128);
	for (let index = 0; index < ALPHABET.length; index += 1) value[ALPHABET.charCodeAt(index)] = index - DIRECT;
	const weights = new Int8Array(text.length);
	let count = 0;
	for (let index = 0; index < text.length; index += 1) {
		if (text[index] === ESCAPE) {
			weights[count] = (Number.parseInt(text.slice(index + 1, index + 3), 16) << 24) >> 24;
			index += 2;
		} else {
			weights[count] = value[text.charCodeAt(index)]!;
		}
		count += 1;
	}
	return weights.subarray(0, count);
}

export interface CompiledTaggerModel {
	readonly version: string;
	readonly dimension: number;
	readonly weights: Int8Array;
	readonly transitions: Int32Array;
}

export function compileTaggerModel(model: TaggerModel): CompiledTaggerModel {
	const weights = decodeWeights(model);
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
