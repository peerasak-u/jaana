import { cueMarksOfRaw } from "./features";
import { TAG_COUNT } from "./model";

/** Per-UTF-16-unit inputs besides the character: six anchor bits, then 18 cue bits. */
const FEATURE_BITS = 24;
/** Log-probabilities become integer scores at this many per nat, never below `FLOOR`. */
const SCALE = 100;
const FLOOR = -3000;
const UNKNOWN = 1;
const FIRST_ID = 2;

const TENSOR_NAMES = [
	"embed",
	"project",
	"forwardInput",
	"forwardHidden",
	"backwardInput",
	"backwardHidden",
	"out",
] as const;
const BIAS_NAMES = [
	"projectBias",
	"forwardInputBias",
	"forwardHiddenBias",
	"backwardInputBias",
	"backwardHiddenBias",
	"outBias",
] as const;

interface QuantisedTensor {
	readonly shape: readonly number[];
	/** One scale for the whole tensor: a weight is its int8 value times this. */
	readonly scale: number;
	/** Base64 int8, row-major. */
	readonly data: string;
}

/**
 * A character BiGRU tagger, written by `scripts/neural/export_model.py`.
 * Character `vocabulary[i]` has id `i + 2`; an unseen character has id 1.
 * Gates follow PyTorch's GRU order: reset, update, new.
 */
export interface NeuralTaggerModel {
	readonly kind: "neural-bigru";
	readonly version: string;
	readonly vocabulary: string;
	readonly embedding: number;
	readonly width: number;
	readonly hidden: number;
	readonly tensors: Readonly<Record<(typeof TENSOR_NAMES)[number], QuantisedTensor>>;
	readonly biases: Readonly<Record<(typeof BIAS_NAMES)[number], readonly number[]>>;
}

type Weights = Record<(typeof TENSOR_NAMES)[number] | (typeof BIAS_NAMES)[number], Float32Array>;

function dequantise(tensor: QuantisedTensor, shape: readonly number[], name: string): Float32Array {
	if (tensor.shape.length !== shape.length || tensor.shape.some((size, index) => size !== shape[index])) {
		throw new Error(`neural tagger tensor ${name} has shape ${tensor.shape.join("x")}, expected ${shape.join("x")}`);
	}
	const bytes = atob(tensor.data);
	const values = new Float32Array(bytes.length);
	for (let index = 0; index < bytes.length; index += 1) {
		values[index] = ((bytes.charCodeAt(index) << 24) >> 24) * tensor.scale;
	}
	return values;
}

function compile(model: NeuralTaggerModel): Weights {
	const { embedding: e, width: w, hidden: h } = model;
	const rows = model.vocabulary.length + FIRST_ID;
	const shapes: Record<(typeof TENSOR_NAMES)[number], number[]> = {
		embed: [rows, e],
		project: [w, e + FEATURE_BITS],
		forwardInput: [3 * h, w],
		forwardHidden: [3 * h, h],
		backwardInput: [3 * h, w],
		backwardHidden: [3 * h, h],
		out: [TAG_COUNT, 2 * h],
	};
	const sizes: Record<(typeof BIAS_NAMES)[number], number> = {
		projectBias: w,
		forwardInputBias: 3 * h,
		forwardHiddenBias: 3 * h,
		backwardInputBias: 3 * h,
		backwardHiddenBias: 3 * h,
		outBias: TAG_COUNT,
	};
	const weights = {} as Weights;
	for (const name of TENSOR_NAMES) weights[name] = dequantise(model.tensors[name], shapes[name], name);
	for (const name of BIAS_NAMES) {
		if (model.biases[name].length !== sizes[name]) throw new Error(`neural tagger bias ${name} has the wrong length`);
		weights[name] = Float32Array.from(model.biases[name]);
	}
	return weights;
}

const THAI_ZERO = 0x0e50;

/** The vocabulary key of one UTF-16 unit, as the trainer folds it: digits to `0`, letters to lower case. */
function keyOf(code: number): string {
	if (code >= 0xd800 && code <= 0xdfff) return "�";
	if ((code >= 48 && code <= 57) || (code >= THAI_ZERO && code <= THAI_ZERO + 9)) return "0";
	const character = String.fromCharCode(code);
	const lower = character.toLowerCase();
	return lower.length === 1 ? lower : character;
}

function sigmoid(value: number): number {
	return 1 / (1 + Math.exp(-value));
}

/**
 * One direction of the GRU over the projected inputs `x` (`n * width`),
 * writing hidden states into `out` at stride `2 * hidden` from `offset`.
 */
function runGru(
	x: Float32Array,
	n: number,
	width: number,
	hidden: number,
	input: Float32Array,
	recurrent: Float32Array,
	inputBias: Float32Array,
	recurrentBias: Float32Array,
	reverse: boolean,
	out: Float32Array,
	offset: number,
): void {
	const gates = 3 * hidden;
	const gx = new Float32Array(gates);
	const gh = new Float32Array(gates);
	const state = new Float32Array(hidden);
	for (let step = 0; step < n; step += 1) {
		const t = reverse ? n - 1 - step : step;
		const xt = t * width;
		for (let g = 0; g < gates; g += 1) {
			let sum = inputBias[g]!;
			const row = g * width;
			for (let k = 0; k < width; k += 1) sum += input[row + k]! * x[xt + k]!;
			gx[g] = sum;
			let recurrentSum = recurrentBias[g]!;
			const hiddenRow = g * hidden;
			for (let k = 0; k < hidden; k += 1) recurrentSum += recurrent[hiddenRow + k]! * state[k]!;
			gh[g] = recurrentSum;
		}
		const base = t * 2 * hidden + offset;
		for (let k = 0; k < hidden; k += 1) {
			const reset = sigmoid(gx[k]! + gh[k]!);
			const update = sigmoid(gx[hidden + k]! + gh[hidden + k]!);
			const candidate = Math.tanh(gx[2 * hidden + k]! + reset * gh[2 * hidden + k]!);
			state[k] = (1 - update) * candidate + update * state[k]!;
			out[base + k] = state[k]!;
		}
	}
}

/** Integer emission scores, `TAG_COUNT` per UTF-16 unit of `raw`: scaled log-probabilities of each tag. */
export function createNeuralEmitter(model: NeuralTaggerModel): (raw: string, anchorFlags: Uint8Array) => Int32Array {
	const weights = compile(model);
	const ids = new Map<string, number>();
	for (let index = 0; index < model.vocabulary.length; index += 1) ids.set(model.vocabulary[index]!, index + FIRST_ID);
	const { embedding: e, width, hidden } = model;
	const inputs = e + FEATURE_BITS;
	return (raw, anchorFlags) => {
		const n = raw.length;
		const cues = cueMarksOfRaw(raw);
		const x = new Float32Array(n * width);
		for (let t = 0; t < n; t += 1) {
			const id = ids.get(keyOf(raw.charCodeAt(t))) ?? UNKNOWN;
			const bits = ((anchorFlags[t] ?? 0) & 63) | (cues.inside[t]! << 6) | (cues.starts[t]! << 12) | (cues.follows[t]! << 18);
			const embedRow = id * e;
			for (let o = 0; o < width; o += 1) {
				const row = o * inputs;
				let sum = weights.projectBias[o]!;
				for (let k = 0; k < e; k += 1) sum += weights.project[row + k]! * weights.embed[embedRow + k]!;
				for (let bit = 0; bit < FEATURE_BITS; bit += 1) {
					if (bits & (1 << bit)) sum += weights.project[row + e + bit]!;
				}
				x[t * width + o] = sum > 0 ? sum : 0;
			}
		}
		const states = new Float32Array(n * 2 * hidden);
		runGru(x, n, width, hidden, weights.forwardInput, weights.forwardHidden, weights.forwardInputBias, weights.forwardHiddenBias, false, states, 0);
		runGru(x, n, width, hidden, weights.backwardInput, weights.backwardHidden, weights.backwardInputBias, weights.backwardHiddenBias, true, states, hidden);
		const scores = new Int32Array(n * TAG_COUNT);
		const logits = new Float64Array(TAG_COUNT);
		for (let t = 0; t < n; t += 1) {
			let largest = -Infinity;
			for (let tag = 0; tag < TAG_COUNT; tag += 1) {
				let sum = weights.outBias[tag]!;
				const row = tag * 2 * hidden;
				for (let k = 0; k < 2 * hidden; k += 1) sum += weights.out[row + k]! * states[t * 2 * hidden + k]!;
				logits[tag] = sum;
				if (sum > largest) largest = sum;
			}
			let total = 0;
			for (let tag = 0; tag < TAG_COUNT; tag += 1) total += Math.exp(logits[tag]! - largest);
			const log = Math.log(total);
			for (let tag = 0; tag < TAG_COUNT; tag += 1) {
				scores[t * TAG_COUNT + tag] = Math.max(FLOOR, Math.round((logits[tag]! - largest - log) * SCALE));
			}
		}
		return scores;
	};
}
