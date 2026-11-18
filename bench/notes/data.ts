import { mkdir, readdir } from "node:fs/promises";
import { createTaggerParser } from "../../src";
import type { AnyTaggerModel } from "../../src/tagger/model";
import type { FieldSpan } from "../../src/notes/model";
import { tidyNotes, type NoteRange } from "../../src/notes/trim";
import { loadChatPool, loadSourceFile, locationMap } from "../chat/load";
import { fnv1a, type ChatRecord } from "../chat/markup";
import { loadParserResources } from "../gazetteer";
import { noteKey } from "./residue";
import type { NoteExample } from "./score";

export type NoteSet = "train" | "dev" | "test";

const CACHE = "bench/notes/cache";

async function teacherLabels(pool: string): Promise<Map<string, NoteRange[]>> {
	const labels = new Map<string, NoteRange[]>();
	const file = Bun.file(`bench/notes/teacher/${pool}.jsonl`);
	if (!(await file.exists())) return labels;
	for (const line of (await file.text()).split("\n").filter(Boolean)) {
		const entry = JSON.parse(line) as { key: string; notes: NoteRange[] };
		labels.set(entry.key, entry.notes);
	}
	return labels;
}

async function folderRecords(folder: string, locations: Parameters<typeof locationMap>[0], only?: RegExp): Promise<ChatRecord[]> {
	const map = locationMap(locations);
	const records: ChatRecord[] = [];
	for (const file of (await readdir(`bench/chat/sources/${folder}`)).sort()) {
		if (only && !only.test(file)) continue;
		const loaded = await loadSourceFile(`bench/chat/sources/${folder}/${file}`, "bench", map);
		if (loaded.issues.length > 0) throw new Error(`${file}: ${loaded.issues.length} issues, run scripts/chat/check.ts`);
		records.push(...loaded.records);
	}
	return records;
}

/**
 * The note sets. `train` is the chat train pool: `R` marks where a file has
 * them (GUIDE v3 files), teacher labels elsewhere. `dev` is the spent and dev
 * folders with their added `R` marks. NOTES_TEACHER picks the teacher
 * labels: `both` (default) keeps Haiku's and Sonnet's where both exist,
 * `sonnet` prefers Sonnet's, `haiku` uses Haiku's alone. `test` is the sealed `notes.v5` file.
 * Field spans come from the shipped parser, cached per model.
 */
export async function loadNoteSet(set: NoteSet, modelPath = "resources/tagger-model.json"): Promise<NoteExample[]> {
	const { locations } = await loadParserResources("resources/gazetteer.json");
	let labelled: { record: ChatRecord; gold: readonly NoteRange[] }[];
	if (set === "train") {
		// The stronger teacher relabelled the records where a note was likely; its label wins where it exists.
		const mode = process.env.NOTES_TEACHER ?? "both";
		const haiku = await teacherLabels("train");
		const sonnet = mode === "haiku" ? new Map<string, NoteRange[]>() : await teacherLabels("train.sonnet-5-5");
		const records = (await loadChatPool("train", locations)).records;
		labelled = records.flatMap((record): { record: ChatRecord; gold: readonly NoteRange[] }[] => {
			if (record.caseType === "notes") return [{ record, gold: record.notes }];
			const key = noteKey(record.raw);
			const strong = sonnet.get(key);
			const weak = haiku.get(key);
			// "both" keeps one copy per teacher where they both labelled, so a span they disagree on counts half.
			if (strong && weak && mode === "both") return [{ record, gold: strong }, { record, gold: weak }];
			const gold = strong ?? weak;
			return gold ? [{ record, gold }] : [];
		});
	} else if (set === "dev") {
		const records = [...(await folderRecords("spent", locations)), ...(await folderRecords("dev", locations))];
		labelled = records.map((record) => ({ record, gold: record.notes }));
	} else {
		labelled = (await folderRecords("bench", locations, /^notes\.v5\.txt$/u)).map((record) => ({ record, gold: record.notes }));
	}

	const modelText = await Bun.file(modelPath).text();
	await mkdir(CACHE, { recursive: true });
	const cachePath = `${CACHE}/spans-${set}-${fnv1a(modelText).toString(36)}.json`;
	const cacheFile = Bun.file(cachePath);
	const cache: Record<string, FieldSpan[]> = (await cacheFile.exists()) ? await cacheFile.json() : {};
	let parser: ReturnType<typeof createTaggerParser> | null = null;
	let added = 0;
	const examples = labelled.map(({ record, gold }) => {
		const key = noteKey(record.raw);
		let spans = cache[key];
		if (!spans) {
			parser ??= createTaggerParser(JSON.parse(modelText) as AnyTaggerModel, locations);
			spans = parser.parse(record.raw).spans.map(({ label, start, end }) => ({ label, start, end }));
			cache[key] = spans;
			added += 1;
		}
		return {
			id: record.id,
			raw: record.raw,
			gold: tidyNotes(record.raw, gold),
			spans,
			goldAddress: record.spans.filter((span) => span.label === "ADDRESS_DETAIL").map(({ start, end }) => ({ start, end })),
		};
	});
	if (added > 0) await Bun.write(cachePath, JSON.stringify(cache));
	return examples;
}
