import type { ChatRecord } from "../../bench/chat/markup";
import { loadParserResources } from "../../bench/gazetteer";
import { addResult, createMetrics, FIELD_NAMES } from "../../bench/metrics";
import { TAG_COUNT, type TaggerModel } from "../../src/tagger/model";
import { createScoredParser, linearScorer, type TagScorer } from "../../src/tagger/parser";
import { loadFirstBatch } from "./first-batch";

/**
 * Exact-record accuracy on dev and test1, as `bench/run-chat.ts` counts it,
 * for the linear model (`--model`) or for emission scores supplied per record
 * (`--scores`, JSON `{ transitions, scores: { [id]: number[] } }`).
 */
function option(name: string): string | undefined {
	const index = Bun.argv.indexOf(name);
	return index >= 0 ? Bun.argv[index + 1] : undefined;
}

const { locations } = await loadParserResources("resources/gazetteer.json");
const { dev, test1 } = await loadFirstBatch(locations);
const scoresPath = option("--scores");
const modelPath = option("--model") ?? "resources/tagger-model.json";
const failuresPath = option("--failures");

function suppliedScorer(supplied: { transitions: number[]; scores: Record<string, number[]> }): TagScorer {
	const byRaw = new Map<string, Int32Array>();
	for (const record of [...dev, ...test1]) {
		const scores = supplied.scores[record.id];
		if (!scores) throw new Error(`no scores for ${record.id}`);
		if (scores.length !== record.raw.length * TAG_COUNT) throw new Error(`score length mismatch for ${record.id}`);
		byRaw.set(record.raw, Int32Array.from(scores));
	}
	return {
		score: (raw) => byRaw.get(raw) ?? (() => { throw new Error("no scores for this text"); })(),
		transitions: Int32Array.from(supplied.transitions),
	};
}

const scorer = scoresPath
	? suppliedScorer(await Bun.file(scoresPath).json())
	: linearScorer((await Bun.file(modelPath).json()) as TaggerModel);
const parser = createScoredParser(scorer, locations);
const failures: string[] = [];

function evaluate(name: string, set: readonly ChatRecord[]) {
	const metrics = createMetrics();
	for (const record of set) {
		const actual = { ...parser.parse(record.raw).fields };
		addResult(metrics, record.expected, actual);
		const wrong = FIELD_NAMES.filter((field) => actual[field] !== record.expected[field]);
		if (wrong.length > 0) {
			failures.push(JSON.stringify({
				id: record.id,
				split: name,
				raw: record.raw,
				wrong: Object.fromEntries(wrong.map((field) => [field, { expected: record.expected[field], actual: actual[field] }])),
			}));
		}
	}
	return {
		exact: metrics.exactRecords,
		records: metrics.records,
		fields: Object.fromEntries(FIELD_NAMES.map((field) => [field, metrics.fields[field].correct])),
	};
}

const result = { dev: evaluate("dev", dev), test1: evaluate("test1", test1) };
if (failuresPath) await Bun.write(failuresPath, `${failures.join("\n")}\n`);
console.log(JSON.stringify(result));
