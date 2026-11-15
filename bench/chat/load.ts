import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { LocationTuple } from "../../src/types";
import { locationKey, parseSource, type ChatRecord, type Pool, type SourceIssue } from "./markup";

export const CHAT_ROOT = "bench/chat/sources";

export function locationMap(locations: readonly LocationTuple[]): Map<string, LocationTuple> {
	return new Map(locations.map((location) => [locationKey(location), location]));
}

export async function loadSourceFile(
	path: string,
	pool: Pool,
	locations: ReadonlyMap<string, LocationTuple>,
): Promise<{ records: ChatRecord[]; issues: SourceIssue[] }> {
	const stem = basename(path).replace(/\.txt$/u, "");
	const category = stem.split(".")[0]!;
	return parseSource(await Bun.file(path).text(), {
		file: path,
		category,
		idPrefix: `chat-${pool}-${stem}`,
		pool,
		locations,
	});
}

/**
 * Loads every authoring source of one pool. A file is named
 * `<category>.txt` or `<category>.<author>.txt`.
 */
export async function loadChatPool(
	pool: Pool,
	locations: readonly LocationTuple[],
	root = CHAT_ROOT,
): Promise<{ records: ChatRecord[]; issues: SourceIssue[] }> {
	const directory = join(root, pool);
	const map = locationMap(locations);
	const records: ChatRecord[] = [];
	const issues: SourceIssue[] = [];
	const seen = new Map<string, string>();
	const files = (await readdir(directory)).filter((file) => file.endsWith(".txt")).sort();
	for (const file of files) {
		const loaded = await loadSourceFile(join(directory, file), pool, map);
		issues.push(...loaded.issues);
		for (const record of loaded.records) {
			const earlier = seen.get(record.raw);
			if (earlier) {
				issues.push({ file: join(directory, file), line: record.sourceLine, message: `duplicate of ${earlier}` });
				continue;
			}
			seen.set(record.raw, record.id);
			records.push(record);
		}
	}
	return { records, issues };
}
