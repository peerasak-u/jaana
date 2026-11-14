import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { CHAT_ROOT, loadSourceFile, locationMap } from "../../bench/chat/load";
import { splitOf, type ChatRecord } from "../../bench/chat/markup";
import type { LocationTuple } from "../../src/types";

const HOLDOUT_FILE = /\.v2\.txt$/u;
const HOLDOUT_ID = /\.v2-\d+$/u;

/**
 * The first benchmark batch, split into dev and test1 as `bench/run-chat.ts`
 * splits it. The sealed holdout files are never opened.
 */
export async function loadFirstBatch(
	locations: readonly LocationTuple[],
): Promise<{ dev: ChatRecord[]; test1: ChatRecord[] }> {
	const directory = join(CHAT_ROOT, "bench");
	const map = locationMap(locations);
	const files = (await readdir(directory)).filter((file) => file.endsWith(".txt") && !HOLDOUT_FILE.test(file)).sort();
	const seen = new Set<string>();
	const records: ChatRecord[] = [];
	for (const file of files) {
		const loaded = await loadSourceFile(join(directory, file), "bench", map);
		if (loaded.issues.length > 0) throw new Error(`${loaded.issues.length} source issues in ${file}`);
		for (const record of loaded.records) {
			if (HOLDOUT_ID.test(record.id) || seen.has(record.raw)) continue;
			seen.add(record.raw);
			records.push(record);
		}
	}
	return {
		dev: records.filter((record) => splitOf(record.raw) === "dev"),
		test1: records.filter((record) => splitOf(record.raw) === "test"),
	};
}
