/** A note piece as UTF-16 offsets into the raw message. */
export interface NoteRange {
	readonly start: number;
	readonly end: number;
}

/** Particles and softeners GUIDE v3 keeps outside a delivery note. */
export const NOTE_EDGE = /(?:ค่ะ|คะ|ครับ|นะ|จ้า|จ๊ะ|เด้อ|ได้เลย|ได้มั้ย|ด้วย|(?<!ไม่)ได้)$|(?:^|\s)(?:ka|na|krub)$|^(?:ค่ะ|คะ|ครับ|นะ)(?![ก-๛])/iu;

/** Spaces, edge punctuation and emoji, in any mix. */
const EDGE = /^[\s.,!?:;~"'()\-–—…\p{Extended_Pictographic}\u{FE0F}\u{200D}]+|[\s.,!?:;~"'()\-–—…\p{Extended_Pictographic}\u{FE0F}\u{200D}]+$/gu;
const LETTER = /\p{L}/u;
/** A piece that is nothing but a particle or softener. */
const ONLY_PARTICLE = /^(?:ค่ะ|คะ|ค่า|ครับ|คับ|ค้าบ|นะ|นะคะ|นะครับ|จ้า|จ้ะ|จ๊ะ|เด้อ|ได้|ได้เลย|ได้มั้ย|ได้ไหม|ด้วย|เลย|na|ka|krub|ok|okay)$/iu;

/** A polite particle glued between two clauses: `ไม่ต้องโทรค่ะวางหน้าบ้าน`. */
const GLUED_PARTICLE = /(?<=[ก-๛])(?:นะคะ|นะครับ|ค่ะ|ครับ|ได้ไหม|ได้มั้ย|จ้า)(?=[ก-ฮเ-ไ])/gu;

function stripEdges(raw: string, range: NoteRange): NoteRange | null {
	const text = raw.slice(range.start, range.end);
	const stripped = text.replace(EDGE, "");
	if (stripped === "") return null;
	const start = range.start + text.indexOf(stripped);
	return { start, end: start + stripped.length };
}

/** Trims a piece the GUIDE v3 way: particles, emoji and edge punctuation stay outside. */
export function trimNote(raw: string, range: NoteRange): NoteRange | null {
	let { start, end } = range;
	for (let guard = 0; guard < 8; guard += 1) {
		const text = raw.slice(start, end);
		const stripped = text.replace(EDGE, "");
		start += text.indexOf(stripped);
		end = start + stripped.length;
		const edge = NOTE_EDGE.exec(raw.slice(start, end));
		if (!edge || edge[0].length === 0) break;
		if (edge.index === 0) start += edge[0].length;
		else end -= edge[0].trimStart().length;
	}
	return end > start && LETTER.test(raw.slice(start, end)) ? { start, end } : null;
}

/**
 * Cuts note ranges at whitespace, trims each word group the GUIDE way, drops
 * groups that are only a particle, and joins back neighbours that only
 * spaces separate. A run that held a particle mid-way comes out as two
 * pieces, as the GUIDE marks them.
 */
export function tidyNotes(raw: string, ranges: readonly NoteRange[]): NoteRange[] {
	const pieces: NoteRange[] = [];
	const cuts = new Uint8Array(raw.length + 1);
	for (const match of raw.matchAll(GLUED_PARTICLE)) {
		// The particle ends one clause and the next starts right after it, with no space.
		cuts.fill(1, match.index, match.index + match[0].length);
	}
	for (const range of ranges) {
		let start = range.start;
		for (let index = range.start; index <= range.end; index += 1) {
			if (index < range.end && !/\s/u.test(raw[index]!) && !cuts[index]) continue;
			if (index > start) {
				const digits = /[0-9๐-๙]/u.test(raw.slice(start, index)) ? stripEdges(raw, { start, end: index }) : null;
				const trimmed = trimNote(raw, { start, end: index }) ?? digits;
				if (trimmed && !ONLY_PARTICLE.test(raw.slice(trimmed.start, trimmed.end))) pieces.push(trimmed);
			}
			start = index + 1;
		}
	}
	// Words of one clause rejoin: neighbouring pieces split only by spaces merge back.
	const merged: NoteRange[] = [];
	for (const piece of pieces) {
		const last = merged[merged.length - 1];
		if (last && /^[ \t]+$/u.test(raw.slice(last.end, piece.start))) merged[merged.length - 1] = { start: last.start, end: piece.end };
		else merged.push(piece);
	}
	return merged.filter((piece) => LETTER.test(raw.slice(piece.start, piece.end)));
}
