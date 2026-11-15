import { expandGazetteer, type CompactGazetteer } from "../gazetteer";
import type { AnyTaggerModel } from "../tagger/model";
import { createTaggerParser, type TaggedAddress } from "../tagger/parser";
import gazetteer from "../../resources/gazetteer.json";
import model from "../../resources/tagger-model.json";
import { EXAMPLES } from "./examples";

const ROUNDS = 5;

const parser = createTaggerParser(
	model as unknown as AnyTaggerModel,
	expandGazetteer(gazetteer as unknown as CompactGazetteer),
);

for (const example of EXAMPLES) parser.parse(example.text);

export interface TimedParse {
	readonly result: TaggedAddress;
	/** Median of ROUNDS warm parses of the same input, in milliseconds. */
	readonly ms: number;
	readonly rounds: number;
}

export function parseTimed(raw: string): TimedParse {
	const times: number[] = [];
	let result = parser.parse(raw);
	for (let round = 0; round < ROUNDS; round += 1) {
		const start = performance.now();
		result = parser.parse(raw);
		times.push(performance.now() - start);
	}
	times.sort((left, right) => left - right);
	return { result, ms: times[Math.floor(ROUNDS / 2)]!, rounds: ROUNDS };
}
