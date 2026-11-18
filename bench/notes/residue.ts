import { trimNote, type NoteRange } from "../../src/notes/trim";
import { fnv1a, type ChatRecord } from "../chat/markup";

export type { NoteRange };

/** Cache key of a message's note labels: stable across file renumbering. */
export function noteKey(raw: string): string {
	return `${fnv1a(raw).toString(36)}-${raw.length}`;
}

function coveredBy(record: Pick<ChatRecord, "raw" | "spans">): Uint8Array {
	const covered = new Uint8Array(record.raw.length);
	for (const span of record.spans) covered.fill(1, span.start, span.end);
	return covered;
}

/** Whether any letter lies outside the seven field marks. */
export function hasFreeText(record: Pick<ChatRecord, "raw" | "spans">): boolean {
	const covered = coveredBy(record);
	for (let index = 0; index < record.raw.length; index += 1) {
		if (!covered[index] && /\p{L}/u.test(record.raw[index]!)) return true;
	}
	return false;
}

/**
 * Finds each teacher piece in the message, outside the field marks, and trims
 * it. A piece that is not a verbatim substring of free text is dropped and
 * counted.
 */
export function placeNotes(
	record: Pick<ChatRecord, "raw" | "spans">,
	pieces: readonly string[],
): { notes: NoteRange[]; unplaced: number } {
	const covered = coveredBy(record);
	const used = new Uint8Array(record.raw.length);
	const notes: NoteRange[] = [];
	let unplaced = 0;
	for (const piece of pieces) {
		const wanted = piece.trim();
		if (wanted === "") continue;
		let found: NoteRange | null = null;
		for (let from = record.raw.indexOf(wanted); from >= 0; from = record.raw.indexOf(wanted, from + 1)) {
			const end = from + wanted.length;
			if (covered.subarray(from, end).some(Boolean) || used.subarray(from, end).some(Boolean)) continue;
			if (record.raw.slice(from, end).includes("\n")) continue;
			found = { start: from, end };
			break;
		}
		const trimmed = found && trimNote(record.raw, found);
		if (!trimmed) {
			unplaced += 1;
			continue;
		}
		used.fill(1, trimmed.start, trimmed.end);
		notes.push(trimmed);
	}
	return { notes: notes.sort((a, b) => a.start - b.start), unplaced };
}
