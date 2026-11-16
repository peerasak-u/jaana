import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { CHAT_ROOT, loadSourceFile, locationMap } from "../../bench/chat/load";
import { fnv1a, HOLDOUT_FILE, type Pool } from "../../bench/chat/markup";
import { loadParserResources } from "../../bench/gazetteer";

/**
 * Finds exact and near-duplicate messages across every source file of both
 * pools. Prints counts and record ids only, never text, so it may read the
 * sealed holdout files.
 *
 * Near duplicate: Jaccard similarity of character 5-gram sets of at least
 * 0.8, after NFKC, lowercasing, Thai digits made ASCII, every digit masked to
 * 0, and everything but letters, marks and digits removed. Thai has no word
 * spaces, so characters rather than words are the unit, and masking digits
 * catches a record copied with only its numbers changed. Candidate pairs come
 * from MinHash with 16 bands of 4 rows, which finds a pair at 0.8 with
 * probability 0.9998, and each candidate is then scored exactly. Below 0.8
 * `--threshold` probes the distribution but misses more pairs.
 */

const thresholdIndex = Bun.argv.indexOf("--threshold");
const THRESHOLD = thresholdIndex >= 0 ? Number(Bun.argv[thresholdIndex + 1]) : 0.8;
const SHINGLE = 5;
const BANDS = 16;
const ROWS = 4;
const HASHES = BANDS * ROWS;

type Side = "train" | "bench" | "holdout";

interface Entry {
	readonly ref: string;
	readonly file: string;
	readonly side: Side;
	readonly raw: string;
	readonly shingles: ReadonlySet<string>;
}

function normalized(raw: string): string {
	return raw
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[๐-๙]/gu, "0")
		.replace(/\d/gu, "0")
		.replace(/[^\p{L}\p{M}\p{N}]/gu, "");
}

function shinglesOf(text: string): Set<string> {
	const units = Array.from(text);
	if (units.length <= SHINGLE) return new Set([text]);
	const result = new Set<string>();
	for (let index = 0; index + SHINGLE <= units.length; index += 1) result.add(units.slice(index, index + SHINGLE).join(""));
	return result;
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
	let shared = 0;
	for (const shingle of left) if (right.has(shingle)) shared += 1;
	return shared / (left.size + right.size - shared);
}

const PERMUTATIONS = Array.from({ length: HASHES }, (_, index) => [fnv1a(`a${index}`) | 1, fnv1a(`b${index}`)] as const);

function signature(shingles: ReadonlySet<string>): Uint32Array {
	const minimum = new Uint32Array(HASHES).fill(0xffffffff);
	for (const shingle of shingles) {
		const base = fnv1a(shingle);
		for (let index = 0; index < HASHES; index += 1) {
			const [a, b] = PERMUTATIONS[index]!;
			const value = (Math.imul(a, base) + b) >>> 0;
			if (value < minimum[index]!) minimum[index] = value;
		}
	}
	return minimum;
}

const { locations } = await loadParserResources("resources/gazetteer.json");
const map = locationMap(locations);
const entries: Entry[] = [];
let sourceIssues = 0;
// Spent holdouts hold bench locations and are scored as dev, so a later holdout must not echo them.
for (const [folder, pool] of [["train", "train"], ["bench", "bench"], ["spent", "bench"]] as const satisfies readonly (readonly [string, Pool])[]) {
	const directory = join(CHAT_ROOT, folder);
	for (const file of (await readdir(directory)).filter((name) => name.endsWith(".txt")).sort()) {
		const path = join(directory, file);
		const { records, issues } = await loadSourceFile(path, pool, map);
		sourceIssues += issues.length;
		const side: Side = pool === "train" ? "train" : folder === "bench" && HOLDOUT_FILE.test(file) ? "holdout" : "bench";
		for (const record of records) {
			entries.push({ ref: `${path}:${record.sourceLine}`, file: path, side, raw: record.raw, shingles: shinglesOf(normalized(record.raw)) });
		}
	}
}

const buckets = new Map<string, number[]>();
entries.forEach((entry, index) => {
	const hashes = signature(entry.shingles);
	for (let band = 0; band < BANDS; band += 1) {
		const key = `${band}:${Array.from(hashes.subarray(band * ROWS, (band + 1) * ROWS)).join(",")}`;
		const bucket = buckets.get(key) ?? [];
		bucket.push(index);
		buckets.set(key, bucket);
	}
});

const pairs = new Map<string, { left: Entry; right: Entry; similarity: number; exact: boolean }>();
for (const bucket of buckets.values()) {
	for (let i = 0; i < bucket.length; i += 1) {
		for (let j = i + 1; j < bucket.length; j += 1) {
			const key = `${bucket[i]}-${bucket[j]}`;
			if (pairs.has(key)) continue;
			const left = entries[bucket[i]!]!;
			const right = entries[bucket[j]!]!;
			const similarity = jaccard(left.shingles, right.shingles);
			if (similarity >= THRESHOLD) pairs.set(key, { left, right, similarity, exact: left.raw === right.raw });
		}
	}
}

function classOf(left: Entry, right: Entry): string {
	if (left.file === right.file) return "within-file";
	const sides = [left.side, right.side].sort().join("~");
	if (left.side === right.side) return `cross-file ${sides}`;
	return sides === "bench~holdout" ? "bench-open~holdout" : `cross-pool ${sides}`;
}

const counts: Record<string, { exact: number; near: number }> = {};
const leaks: string[] = [];
for (const { left, right, similarity, exact } of pairs.values()) {
	const name = classOf(left, right);
	const count = (counts[name] ??= { exact: 0, near: 0 });
	if (exact) count.exact += 1;
	else count.near += 1;
	if (name.startsWith("cross-pool") || name === "bench-open~holdout") {
		leaks.push(`${name} ${similarity.toFixed(3)} ${left.ref} ${right.ref}`);
	}
}
console.log(JSON.stringify({
	records: entries.length,
	sourceIssues,
	threshold: THRESHOLD,
	pairs: Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))),
}));
for (const leak of leaks) console.log(leak);
process.exit(leaks.length > 0 ? 1 : 0);
