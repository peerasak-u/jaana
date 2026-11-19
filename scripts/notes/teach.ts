/**
 * Labels delivery notes in chat records that carry no `R` marks, with Claude
 * Haiku as the teacher. Each answer is cached per message, so a rerun only
 * asks for what is missing.
 * usage: bun run scripts/notes/teach.ts [--pool train|spent|dev] [--model claude-haiku-5-5] [--only ids.json] [--limit N] [--batch 40] [--concurrency 6]
 * `--only` names a JSON list of record ids to label, such as the ones a student and teacher disagree on.
 */
import { appendFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadChatPool, loadSourceFile, locationMap } from "../../bench/chat/load";
import { fnv1a, type ChatRecord } from "../../bench/chat/markup";
import { loadParserResources } from "../../bench/gazetteer";
import { hasFreeText, noteKey, placeNotes } from "../../bench/notes/residue";

function option(name: string, fallback: string): string {
	const index = Bun.argv.indexOf(name);
	return index >= 0 && Bun.argv[index + 1] ? Bun.argv[index + 1]! : fallback;
}
const pool = option("--pool", "train");
const limit = Number(option("--limit", "100000"));
const batchSize = Number(option("--batch", "40"));
const concurrency = Number(option("--concurrency", "6"));
const teacherModel = option("--model", "claude-haiku-5-5");
const tag = teacherModel === "claude-haiku-5-5" ? "" : `.${teacherModel.replace(/^claude-/u, "")}`;
const only = option("--only", "");
const output = `bench/notes/teacher/${pool}${tag}.jsonl`;

const guide = await Bun.file("bench/chat/GUIDE.md").text();
const rules = guide.slice(guide.indexOf("### R, the delivery note"), guide.indexOf("## Warnings"));
const SYSTEM = `You label delivery notes in Thai shopping-chat messages for a parcel label. The rules:

${rules}
Each message shows the seven address fields already found wrapped in ⟦ ⟧. Text inside ⟦ ⟧ is never a note. Look only at the text outside them.

Answer with one JSON object and nothing else: keys are the message ids, values are arrays of note pieces. Copy every piece character for character from the message, without its particles, emoji or edge punctuation. One piece per clause. An empty array when the message has no note. Every id must appear.`;

const { locations } = await loadParserResources("resources/gazetteer.json");
let records: ChatRecord[];
if (pool === "train") records = (await loadChatPool("train", locations)).records;
else {
	const map = locationMap(locations);
	records = [];
	for (const file of (await readdir(`bench/chat/sources/${pool}`)).sort()) {
		records.push(...(await loadSourceFile(`bench/chat/sources/${pool}/${file}`, "bench", map)).records);
	}
}

function shown(record: ChatRecord): string {
	let text = "";
	let cursor = 0;
	for (const span of [...record.spans].sort((a, b) => a.start - b.start)) {
		text += record.raw.slice(cursor, span.start) + `⟦${span.text}⟧`;
		cursor = span.end;
	}
	return text + record.raw.slice(cursor);
}

const done = new Set<string>();
const file = Bun.file(output);
if (await file.exists()) for (const line of (await file.text()).split("\n").filter(Boolean)) done.add(JSON.parse(line).key);

const wanted = only ? new Set((await Bun.file(only).json()) as string[]) : null;
const todo = records
	.filter((record) => (pool !== "train" || record.notes.length === 0) && !done.has(noteKey(record.raw)))
	.filter((record) => !wanted || wanted.has(record.id))
	.sort((a, b) => fnv1a(`teach:${a.id}`) - fnv1a(`teach:${b.id}`))
	.slice(0, limit);
// A message with no free text has no note, so it needs no call.
const silent = todo.filter((record) => !hasFreeText(record));
const asked = todo.filter(hasFreeText);
await appendFile(output, silent.map((record) => JSON.stringify({ key: noteKey(record.raw), id: record.id, notes: [] }) + "\n").join(""));
console.error(`${pool}: ${records.length} records, ${done.size} cached, ${silent.length} with no free text, ${asked.length} to ask`);

const batches: ChatRecord[][] = [];
for (let index = 0; index < asked.length; index += batchSize) batches.push(asked.slice(index, index + batchSize));

let cost = 0;
let unplaced = 0;
let failedBatches = 0;
async function call(prompt: string): Promise<{ text: string; cost: number }> {
	const cwd = await mkdtemp(join(tmpdir(), "jaana-teach-"));
	try {
		const child = Bun.spawn([
			"/Users/peerasak/.local/bin/claude", "-p", "--model", teacherModel,
			"--system-prompt", SYSTEM, "--output-format", "json", "--no-session-persistence",
			"--safe-mode", "--strict-mcp-config", "--tools", "", "--", prompt,
		], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
		const timer = setTimeout(() => child.kill(), 240_000);
		const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
		clearTimeout(timer);
		const json = JSON.parse(stdout) as { is_error?: boolean; result?: string; total_cost_usd?: number };
		if (json.is_error || typeof json.result !== "string") throw new Error(`${json.result ?? ""} ${stderr}`.slice(0, 300));
		return { text: json.result, cost: json.total_cost_usd ?? 0 };
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
}

async function runBatch(batch: ChatRecord[], index: number): Promise<void> {
	const ids = batch.map((_, offset) => `m${offset + 1}`);
	const prompt = batch.map((record, offset) => `### ${ids[offset]}\n${shown(record)}`).join("\n\n");
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			const answer = await call(prompt);
			cost += answer.cost;
			const body = answer.text.slice(answer.text.indexOf("{"), answer.text.lastIndexOf("}") + 1);
			const parsed = JSON.parse(body) as Record<string, unknown>;
			const lines: string[] = [];
			batch.forEach((record, offset) => {
				const pieces = parsed[ids[offset]!];
				if (!Array.isArray(pieces)) return;
				const placed = placeNotes(record, pieces.filter((piece): piece is string => typeof piece === "string"));
				unplaced += placed.unplaced;
				lines.push(JSON.stringify({ key: noteKey(record.raw), id: record.id, notes: placed.notes }));
			});
			await appendFile(output, lines.map((line) => line + "\n").join(""));
			console.error(`batch ${index + 1}/${batches.length}: ${lines.length}/${batch.length} answered, $${cost.toFixed(3)} so far`);
			return;
		} catch (error) {
			console.error(`batch ${index + 1} attempt ${attempt + 1}: ${String(error).slice(0, 200)}`);
		}
	}
	failedBatches += 1;
}

let next = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
	while (next < batches.length) {
		const index = next++;
		await runBatch(batches[index]!, index);
	}
}));
console.error(JSON.stringify({ pool, batches: batches.length, failedBatches, unplacedPieces: unplaced, costUsd: Number(cost.toFixed(3)) }));
