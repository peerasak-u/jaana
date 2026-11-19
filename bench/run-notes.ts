/**
 * Scores the delivery-note reader against the cue-word baseline.
 * usage: bun run bench/run-notes.ts [--model resources/notes-model.json] [--set dev|test] [--read-holdout] [--failures N]
 *
 * `test` is the sealed notes.v5 file. It prints aggregates only, needs
 * --read-holdout, and logs the read to .audit/holdout-reads.tsv, with the
 * seven-field exact count of the shipped tagger on the same records.
 */
import { appendFile } from "node:fs/promises";
import { createNoteReader, type NoteModel } from "../src/notes/model";
import { createTaggerParser } from "../src";
import type { AnyTaggerModel } from "../src/tagger/model";
import { loadSourceFile, locationMap } from "./chat/load";
import { loadParserResources } from "./gazetteer";
import { addRecipients, createMetrics } from "./metrics";
import { loadNoteSet } from "./notes/data";
import { ruleNotes } from "./notes/rules";
import { scoreNotes } from "./notes/score";

function option(name: string, fallback: string): string {
	const index = Bun.argv.indexOf(name);
	return index >= 0 && Bun.argv[index + 1] ? Bun.argv[index + 1]! : fallback;
}
const modelPath = option("--model", "resources/notes-model.json");
const set = option("--set", "dev") as "dev" | "test";
const showFailures = Number(option("--failures", "0"));
if (set === "test" && !Bun.argv.includes("--read-holdout")) throw new Error("the test set is sealed: pass --read-holdout to read it once");
if (set === "test" && showFailures > 0) throw new Error("test failures are never printed");

const noteModel = (await Bun.file(modelPath).json()) as NoteModel;
const reader = createNoteReader(noteModel);
const examples = await loadNoteSet(set);
const started = performance.now();
const learned = scoreNotes(examples, (example) => reader.read(example.raw, example.spans));
const readMs = (performance.now() - started) / examples.length;
const rules = scoreNotes(examples, (example) => ruleNotes(example.raw, example.spans));

const summary = (score: ReturnType<typeof scoreNotes>) => ({
	withNote: score.withGold,
	charPrecision: Number(score.chars.precision.toFixed(3)),
	charRecall: Number(score.chars.recall.toFixed(3)),
	charF1: Number(score.chars.f1.toFixed(3)),
	exactRecords: score.exact,
	notesMostlyFound: score.mostlyFound,
	spuriousRecords: score.spurious,
});
const modelText = await Bun.file(modelPath).text();
const report: Record<string, unknown> = {
	set,
	records: examples.length,
	model: noteModel.version,
	modelGzipBytes: Bun.gzipSync(modelText).length,
	readerMsPerMessage: Number(readMs.toFixed(3)),
	reader: summary(learned),
	cueRules: summary(rules),
};

if (set === "test") {
	const { locations } = await loadParserResources("resources/gazetteer.json");
	const records = (await loadSourceFile("bench/chat/sources/bench/notes.v5.txt", "bench", locationMap(locations))).records;
	const tagger = createTaggerParser((await Bun.file("resources/tagger-model.json").json()) as AnyTaggerModel, locations);
	const metrics = createMetrics();
	for (const record of records) {
		const result = tagger.parse(record.raw);
		addRecipients(metrics, record.recipients, result.recipients.map(({ fields, inferred }) => ({ ...fields, ...Object.fromEntries(inferred.map((field) => [field, null])) })));
	}
	report.taggerSevenFieldExact = `${metrics.exactRecords}/${metrics.records}`;
	const stamp = new Date().toISOString();
	await appendFile(".audit/holdout-reads.tsv", [
		[stamp, "resources/tagger-model.json", Bun.gzipSync(await Bun.file("resources/tagger-model.json").text()).length, "v5/notes-seven-fields", metrics.exactRecords, metrics.records].join("\t"),
		[stamp, modelPath, report.modelGzipBytes, "v5/notes-exact", learned.exact, examples.length].join("\t"),
	].join("\n") + "\n");
}
console.log(JSON.stringify(report, null, 1));
for (const failure of learned.failures.slice(0, showFailures)) {
	console.log(`--- ${failure.id}\n${failure.raw}\n  gold: ${failure.gold}\n  pred: ${failure.predicted}`);
}
