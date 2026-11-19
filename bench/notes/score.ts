import { joinNotes, type FieldSpan } from "../../src/notes/model";
import type { NoteRange } from "../../src/notes/trim";

/** One message with its note gold and the field spans the parser found. */
export interface NoteExample {
	readonly id: string;
	readonly raw: string;
	readonly gold: readonly NoteRange[];
	/** Field spans from the parser: the note reader's input. */
	readonly spans: readonly FieldSpan[];
	/** Gold address-detail spans, to tell a landmark kept in `A` from one lost. */
	readonly goldAddress: readonly NoteRange[];
}

export interface NoteScore {
	readonly records: number;
	readonly withGold: number;
	/** Characters of note text, after the GUIDE trimming, both sides. */
	readonly chars: { readonly precision: number; readonly recall: number; readonly f1: number };
	/** Records whose joined note string matches exactly, null for null. */
	readonly exact: number;
	/** Records with a note, found or not. */
	readonly detection: { readonly precision: number; readonly recall: number };
	/** Records whose gold note text is mostly (≥ half) recovered. */
	readonly mostlyFound: number;
	/** Records with no gold note where something was predicted. */
	readonly spurious: number;
}

function mask(length: number, ranges: readonly NoteRange[]): Uint8Array {
	const value = new Uint8Array(length);
	for (const range of ranges) {
		value.fill(1, range.start, range.end);
	}
	return value;
}

function letters(raw: string, value: Uint8Array): Uint8Array {
	const out = new Uint8Array(value.length);
	for (let index = 0; index < value.length; index += 1) out[index] = value[index]! && !/\s/u.test(raw[index]!) ? 1 : 0;
	return out;
}

export function scoreNotes(examples: readonly NoteExample[], predict: (example: NoteExample) => readonly NoteRange[]): NoteScore & { readonly failures: readonly { id: string; raw: string; gold: string | null; predicted: string | null }[] } {
	let truePositive = 0;
	let falsePositive = 0;
	let falseNegative = 0;
	let exact = 0;
	let withGold = 0;
	let predictedRecords = 0;
	let detected = 0;
	let mostlyFound = 0;
	let spurious = 0;
	const failures: { id: string; raw: string; gold: string | null; predicted: string | null }[] = [];
	for (const example of examples) {
		const predicted = predict(example);
		const gold = letters(example.raw, mask(example.raw.length, example.gold));
		const guess = letters(example.raw, mask(example.raw.length, predicted));
		let hit = 0;
		let goldCount = 0;
		for (let index = 0; index < gold.length; index += 1) {
			if (gold[index] && guess[index]) hit += 1;
			if (gold[index]) goldCount += 1;
			if (gold[index] && !guess[index]) falseNegative += 1;
			if (!gold[index] && guess[index]) falsePositive += 1;
		}
		truePositive += hit;
		const goldText = joinNotes(example.raw, example.gold);
		const predictedText = joinNotes(example.raw, predicted);
		if (goldText === predictedText) exact += 1;
		else failures.push({ id: example.id, raw: example.raw, gold: goldText, predicted: predictedText });
		if (goldText) withGold += 1;
		if (predictedText) predictedRecords += 1;
		if (goldText && predictedText) detected += 1;
		if (goldText && hit * 2 >= goldCount) mostlyFound += 1;
		if (!goldText && predictedText) spurious += 1;
	}
	const precision = truePositive / Math.max(1, truePositive + falsePositive);
	const recall = truePositive / Math.max(1, truePositive + falseNegative);
	return {
		records: examples.length,
		withGold,
		chars: { precision, recall, f1: (2 * precision * recall) / Math.max(1e-9, precision + recall) },
		exact,
		detection: { precision: detected / Math.max(1, predictedRecords), recall: detected / Math.max(1, withGold) },
		mostlyFound,
		spurious,
		failures,
	};
}
