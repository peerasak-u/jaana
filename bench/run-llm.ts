import { appendFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTaggerParser } from "../src/tagger/parser";
import type { AnyTaggerModel } from "../src/tagger/model";
import { loadChatPool, loadSourceFile, locationMap } from "./chat/load";
import { fnv1a, holdoutOf, isHoldout, type ChatRecord } from "./chat/markup";
import type { ExpectedAddress } from "./dataset";
import { loadParserResources } from "./gazetteer";
import { parseAnswer, SYSTEM_PROMPT, userPrompt } from "./llm/prompt";
import { addRecipients, createMetrics, FIELD_NAMES, summarize, type MetricAccumulator } from "./metrics";

function option(name: string): string | undefined {
	const index = Bun.argv.indexOf(name);
	return index >= 0 ? Bun.argv[index + 1] : undefined;
}

interface CallResult {
	readonly text: string;
	readonly wallMs: number;
	readonly apiMs: number | null;
	readonly costUsd: number | null;
	readonly inputTokens: number | null;
	readonly outputTokens: number | null;
}

/** The provider refused for quota or rate. The record is not at fault, so nothing is cached. */
class QuotaError extends Error {}

const QUOTA = /FreeUsageLimitError|rate[ _-]?limit|usage limit|too many requests|quota/iu;
const timeoutMs = Number(option("--timeout") ?? "120") * 1000;

async function spawnCli(argv: readonly string[]): Promise<{ stdout: string; stderr: string; code: number; wallMs: number }> {
	// An empty cwd so the agent sees no repo files.
	const cwd = await mkdtemp(join(tmpdir(), "jaana-llm-"));
	const started = performance.now();
	try {
		const child = Bun.spawn([...argv], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
		const timer = setTimeout(() => child.kill(), timeoutMs);
		const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
		clearTimeout(timer);
		const wallMs = Math.round(performance.now() - started);
		if (child.signalCode) throw new Error(`timed out after ${timeoutMs} ms`);
		return { stdout, stderr, code, wallMs };
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
}

interface SystemSpec {
	readonly label: string;
	readonly defaultConcurrency: number;
	call(prompt: string): Promise<CallResult>;
}

const SYSTEMS = {
	haiku: {
		label: "Claude Haiku 5.5",
		defaultConcurrency: 4,
		async call(prompt) {
			const run = await spawnCli([
				"/Users/peerasak/.local/bin/claude", "-p",
				"--model", "claude-haiku-5-5",
				"--system-prompt", SYSTEM_PROMPT,
				"--output-format", "json",
				"--no-session-persistence",
				// Keeps the user's CLAUDE.md, rules, plugins and MCP servers out of the context.
				"--safe-mode", "--strict-mcp-config",
				"--tools", "",
				"--", prompt,
			]);
			let json: { is_error?: boolean; result?: string; duration_ms?: number; total_cost_usd?: number; usage?: Record<string, number> };
			try {
				json = JSON.parse(run.stdout);
			} catch {
				if (QUOTA.test(run.stderr)) throw new QuotaError(run.stderr.trim().slice(0, 300));
				throw new Error(`exit ${run.code}: ${(run.stderr || run.stdout).trim().slice(0, 300)}`);
			}
			if (json.is_error || typeof json.result !== "string") {
				const message = `${json.result ?? ""} ${run.stderr}`.trim().slice(0, 300);
				if (QUOTA.test(message)) throw new QuotaError(message);
				throw new Error(`is_error: ${message}`);
			}
			const usage = json.usage ?? {};
			return {
				text: json.result,
				wallMs: run.wallMs,
				// Not duration_api_ms: it sums the CLI's side requests too and can exceed wall time.
				apiMs: json.duration_ms ?? null,
				costUsd: json.total_cost_usd ?? null,
				inputTokens: usage.input_tokens === undefined ? null : usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
				outputTokens: usage.output_tokens ?? null,
			};
		},
	},
	deepseek: {
		label: "DeepSeek 4.1 Flash (free)",
		defaultConcurrency: 2,
		async call(prompt) {
			const run = await spawnCli(["/opt/homebrew/bin/opencode", "run", "-m", "opencode/deepseek-v4.1-flash-free", "--format", "json", "--archived", `${SYSTEM_PROMPT}\n\n${prompt}`]);
			if (QUOTA.test(run.stderr)) throw new QuotaError(run.stderr.trim().slice(0, 300));
			let text = "";
			let costUsd: number | null = null;
			let inputTokens: number | null = null;
			let outputTokens: number | null = null;
			const times: number[] = [];
			const errors: string[] = [];
			for (const line of run.stdout.split("\n")) {
				if (line.trim() === "") continue;
				let event: { type?: string; timestamp?: number; part?: { text?: string; cost?: number; tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } } } };
				try {
					event = JSON.parse(line);
				} catch {
					errors.push(line);
					continue;
				}
				if (typeof event.timestamp === "number" && (event.type === "step_start" || event.type === "step_finish")) times.push(event.timestamp);
				if (event.type === "text") text += event.part?.text ?? "";
				else if (event.type === "step_finish") {
					costUsd = (costUsd ?? 0) + (event.part?.cost ?? 0);
					const tokens = event.part?.tokens;
					// Counted like the Claude usage: cache reads and writes are input, reasoning is output.
					inputTokens = (inputTokens ?? 0) + (tokens?.input ?? 0) + (tokens?.cache?.read ?? 0) + (tokens?.cache?.write ?? 0);
					outputTokens = (outputTokens ?? 0) + (tokens?.output ?? 0) + (tokens?.reasoning ?? 0);
				} else if (event.type !== "step_start") errors.push(line);
			}
			const problems = errors.join("\n");
			if (QUOTA.test(problems)) throw new QuotaError(problems.slice(0, 300));
			if (text === "") throw new Error(`exit ${run.code}, no text: ${(problems || run.stderr).trim().slice(0, 300)}`);
			return { text, wallMs: run.wallMs, apiMs: times.length >= 2 ? Math.max(...times) - Math.min(...times) : null, costUsd, inputTokens, outputTokens };
		},
	},
} satisfies Record<string, SystemSpec>;
type SystemId = keyof typeof SYSTEMS;

interface CacheLine {
	readonly id: string;
	readonly category: string;
	readonly ok: boolean;
	readonly text?: string;
	readonly error?: string;
	readonly wallMs: number;
	readonly apiMs: number | null;
	readonly costUsd: number | null;
	readonly inputTokens: number | null;
	readonly outputTokens: number | null;
}

const SETS = {
	holdout: { perGroup: 6 },
	pilot: { perGroup: 2 },
} as const;
type SetName = keyof typeof SETS;

const setName = (option("--set") ?? "pilot") as SetName;
if (!(setName in SETS)) throw new Error(`--set takes ${Object.keys(SETS).join(" or ")}`);
const perGroup = Number(option("--per-group") ?? SETS[setName].perGroup);
const systemIds = (option("--systems") ?? Object.keys(SYSTEMS).join(",")).split(",").filter(Boolean) as SystemId[];
for (const id of systemIds) if (!(id in SYSTEMS)) throw new Error(`unknown system ${id}. Use ${Object.keys(SYSTEMS).join(", ")}`);
const concurrencyOverride = option("--concurrency");
const limit = Number(option("--limit") ?? Infinity);
const rounds = 3;
const resultDir = `bench/llm/results/${setName}`;

const { locations } = await loadParserResources("resources/gazetteer.json");

async function loadSet(name: SetName): Promise<ChatRecord[]> {
	const loaded = name === "holdout"
		? await loadChatPool("bench", locations).then(({ records, issues }) => ({ records: records.filter(isHoldout), issues }))
		: await (async () => {
			const directory = "bench/chat/sources/spent";
			const map = locationMap(locations);
			const files = (await readdir(directory)).filter((file) => file.endsWith(".txt")).sort();
			const parts = await Promise.all(files.map((file) => loadSourceFile(join(directory, file), "bench", map)));
			return { records: parts.flatMap((part) => part.records), issues: parts.flatMap((part) => part.issues) };
		})();
	if (loaded.issues.length > 0) throw new Error(`${loaded.issues.length} source issues. Run scripts/chat/check.ts`);
	return loaded.records;
}

function sampleOf(records: readonly ChatRecord[]): ChatRecord[] {
	const groups = new Map<string, ChatRecord[]>();
	for (const record of records) {
		const key = `${record.caseType}.${holdoutOf(record.id)}`;
		groups.set(key, [...(groups.get(key) ?? []), record]);
	}
	return [...groups.keys()].sort().flatMap((key) =>
		groups.get(key)!
			.map((record) => ({ record, rank: fnv1a(`llm:${record.id}`) }))
			.sort((left, right) => left.rank - right.rank || left.record.id.localeCompare(right.record.id))
			.slice(0, perGroup)
			.map(({ record }) => record),
	);
}

const sample = sampleOf(await loadSet(setName));
await mkdir(resultDir, { recursive: true });
await Bun.write(`${resultDir}/sample.json`, `${JSON.stringify(sample.map((record) => record.id), null, 2)}\n`);

async function loadCache(id: SystemId): Promise<Map<string, CacheLine>> {
	const file = Bun.file(`${resultDir}/${id}.jsonl`);
	const cache = new Map<string, CacheLine>();
	if (!(await file.exists())) return cache;
	for (const line of (await file.text()).split("\n")) {
		if (line.trim() === "") continue;
		const entry = JSON.parse(line) as CacheLine;
		cache.set(entry.id, entry);
	}
	return cache;
}

const caches = Object.fromEntries(await Promise.all(systemIds.map(async (id) => [id, await loadCache(id)] as const))) as Record<SystemId, Map<string, CacheLine>>;
let quotaStop: string | null = null;
const newCalls: Record<string, number> = {};

async function runSystem(id: SystemId): Promise<void> {
	const system: SystemSpec = SYSTEMS[id];
	const cache = caches[id];
	const pending = sample.filter((record) => !cache.get(record.id)?.ok).slice(0, limit);
	const concurrency = Number(concurrencyOverride ?? system.defaultConcurrency);
	newCalls[id] = 0;
	let next = 0;
	const worker = async (): Promise<void> => {
		while (quotaStop === null && next < pending.length) {
			const record = pending[next++]!;
			const prompt = userPrompt(record.raw);
			let entry: CacheLine;
			for (let attempt = 0; ; attempt += 1) {
				try {
					newCalls[id]! += 1;
					entry = { id: record.id, category: record.caseType, ok: true, ...(await system.call(prompt)) };
					break;
				} catch (error) {
					if (error instanceof QuotaError) {
						quotaStop = `${id}: ${error.message}`;
						return;
					}
					if (attempt === 0) continue;
					entry = { id: record.id, category: record.caseType, ok: false, error: String((error as Error).message), wallMs: 0, apiMs: null, costUsd: null, inputTokens: null, outputTokens: null };
					break;
				}
			}
			cache.set(record.id, entry);
			await appendFile(`${resultDir}/${id}.jsonl`, `${JSON.stringify(entry)}\n`);
			console.error(`${id} ${record.id} ${entry.ok ? `ok ${entry.wallMs} ms` : "error"}`);
		}
	};
	await Promise.all(Array.from({ length: concurrency }, worker));
}

await Promise.all(systemIds.map(runSystem));

const model = (await Bun.file("resources/tagger-model.json").json()) as AnyTaggerModel;
const tagger = createTaggerParser(model, locations);

function taggerRecipients(raw: string): ExpectedAddress[] | null {
	try {
		const result = tagger.parse(raw);
		// Gold marks only what the shopper wrote, so gazetteer-filled fields are not scored here.
		return result.recipients.map(({ fields, inferred }) => ({ ...fields, ...Object.fromEntries(inferred.map((field) => [field, null])) }));
	} catch {
		return null;
	}
}

function percentile(values: readonly number[], fraction: number): number | null {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

const spread = (values: readonly number[]) => ({ median: percentile(values, 0.5), p95: percentile(values, 0.95) });

type WrongFields = Record<string, { expected: string | null; actual: string | null }>;

function wrongFields(gold: readonly ExpectedAddress[], actual: readonly ExpectedAddress[] | null): WrongFields {
	const wrong: WrongFields = {};
	for (let index = 0; index < Math.max(gold.length, actual?.length ?? 0); index += 1) {
		for (const field of FIELD_NAMES) {
			const want = gold[index]?.[field] ?? null;
			const got = actual?.[index]?.[field] ?? null;
			if (got !== want) wrong[index === 0 ? field : `${field}#${index + 1}`] = { expected: want, actual: got };
		}
	}
	return wrong;
}

function score(records: readonly ChatRecord[], answerOf: (record: ChatRecord) => ExpectedAddress[] | null) {
	const metrics = createMetrics();
	const categories = new Map<string, MetricAccumulator>();
	for (const record of records) {
		const recipients = answerOf(record);
		const group = categories.get(record.caseType) ?? createMetrics();
		categories.set(record.caseType, group);
		addRecipients(metrics, record.recipients, recipients);
		addRecipients(group, record.recipients, recipients);
	}
	return {
		...summarize(metrics),
		records: metrics.records,
		exactRecords: metrics.exactRecords,
		failures: metrics.failures,
		categories: Object.fromEntries([...categories.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([category, group]) => [category, `${group.exactRecords}/${group.records}`])),
	};
}

const taggerAnswer = (record: ChatRecord) => taggerRecipients(record.raw);

const systems = Object.fromEntries(systemIds.map((id) => {
	const cache = caches[id];
	const scored = sample.filter((record) => cache.has(record.id));
	const lines = scored.map((record) => cache.get(record.id)!).filter((line) => line.ok);
	const sum = (values: readonly (number | null)[]) => values.reduce<number>((total, value) => total + (value ?? 0), 0);
	return [id, {
		label: SYSTEMS[id].label,
		...score(scored, (record) => {
			const line = cache.get(record.id)!;
			return line.ok ? parseAnswer(line.text!) : null;
		}),
		callErrors: scored.length - lines.length,
		wallMs: spread(lines.map((line) => line.wallMs)),
		apiMs: spread(lines.flatMap((line) => (line.apiMs === null ? [] : [line.apiMs]))),
		costUsd: Number(sum(lines.map((line) => line.costUsd)).toFixed(6)),
		inputTokens: sum(lines.map((line) => line.inputTokens)),
		outputTokens: sum(lines.map((line) => line.outputTokens)),
		taggerSameIds: score(scored, taggerAnswer),
	}];
}));

for (const record of sample.slice(0, 50)) tagger.parse(record.raw);
const parseMs: number[] = [];
for (let round = 0; round < rounds; round += 1) {
	for (const record of sample) {
		const started = Bun.nanoseconds();
		tagger.parse(record.raw);
		parseMs.push((Bun.nanoseconds() - started) / 1e6);
	}
}
const modelText = await Bun.file("resources/tagger-model.json").text();
const taggerFull = score(sample, taggerAnswer);

const summary = {
	set: setName,
	sampleRecords: sample.length,
	perGroup,
	tagger: {
		label: "Jaana tagger",
		modelGzipBytes: Bun.gzipSync(modelText).length,
		...taggerFull,
		parseMs: { median: Number(percentile(parseMs, 0.5)!.toFixed(3)), p95: Number(percentile(parseMs, 0.95)!.toFixed(3)), parses: parseMs.length },
	},
	systems,
};
await Bun.write(`${resultDir}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);

if (setName === "holdout") {
	const stamp = new Date().toISOString();
	const versions = [...new Set(sample.map((record) => holdoutOf(record.id)!))].sort();
	const rows = versions.map((version) => {
		const part = score(sample.filter((record) => holdoutOf(record.id) === version), taggerAnswer);
		return [stamp, "resources/tagger-model.json", summary.tagger.modelGzipBytes, `${version}/llm-sample`, part.exactRecords, part.records].join("\t");
	});
	await appendFile(".audit/holdout-reads.tsv", `${rows.join("\n")}\n`);
}

if (setName === "pilot") {
	const llmFailures = [];
	for (const id of systemIds) {
		const cache = caches[id];
		for (const record of sample) {
			const line = cache.get(record.id);
			if (!line) continue;
			const recipients = line.ok ? parseAnswer(line.text!) : null;
			const wrong = wrongFields(record.recipients, recipients);
			if (Object.keys(wrong).length > 0) llmFailures.push({ system: id, id: record.id, category: record.caseType, raw: record.raw, answer: line.text ?? line.error ?? null, normalized: recipients, wrong });
		}
	}
	await Bun.write(`${resultDir}/failures.jsonl`, llmFailures.map((failure) => JSON.stringify(failure)).join("\n") + (llmFailures.length > 0 ? "\n" : ""));
}

const percent = (exact: number, total: number) => `${exact}/${total} (${((100 * exact) / Math.max(1, total)).toFixed(1)}%)`;
const rows = [
	["system", "records", "exact", "tagger same ids", "fails", "wall med/p95 ms", "api med/p95 ms", "cost usd", "tokens in/out"],
	["tagger", String(sample.length), percent(taggerFull.exactRecords, taggerFull.records), "", String(taggerFull.failures), `${summary.tagger.parseMs.median}/${summary.tagger.parseMs.p95}`, "", "0", ""],
	...systemIds.map((id) => {
		const system = systems[id]!;
		return [id, String(system.records), percent(system.exactRecords, system.records), percent(system.taggerSameIds.exactRecords, system.taggerSameIds.records), String(system.failures), `${system.wallMs.median}/${system.wallMs.p95}`, `${system.apiMs.median}/${system.apiMs.p95}`, String(system.costUsd), `${system.inputTokens}/${system.outputTokens}`];
	}),
];
const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)));
console.log(rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column]!)).join("  ")).join("\n"));
console.log(`new calls: ${JSON.stringify(newCalls)}. Wrote ${resultDir}/summary.json${setName === "pilot" ? ` and ${resultDir}/failures.jsonl` : ""}`);
if (quotaStop !== null) {
	const remaining = Object.fromEntries(systemIds.map((id) => [id, sample.filter((record) => !caches[id].get(record.id)?.ok).length]));
	console.log(`Stopped on quota or rate limit (${quotaStop}). Remaining per system: ${JSON.stringify(remaining)}. Rerun the same command to resume.`);
	process.exitCode = 2;
}
