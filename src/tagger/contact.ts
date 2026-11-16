import { TAGS } from "./model";

const OTHER = TAGS.indexOf("OTHER");
const CLEARED = new Set(["NAME", "ORG", "ADDRESS_DETAIL"].map((tag) => TAGS.indexOf(tag as (typeof TAGS)[number])));
const NAMED = new Set(["NAME", "ORG"].map((tag) => TAGS.indexOf(tag as (typeof TAGS)[number])));

/**
 * A contact channel cue: LINE, IG, FB and their Thai spellings, with an
 * optional `ID` either side, or an `@` that opens a handle.
 */
const CUE = /(?:(?:id|ไอดี)[ \t]*)?(?:(?:line|ig|fb|facebook)(?![a-z])|ไลน์|ไอจี|เฟส(?:บุ๊[คก])?)(?:[ \t]*(?:id(?![a-z])|ไอดี))?|@/giu;
const LATIN_CUE = /^[a-z@ \t]+$/iu;
const FILLER = /^[ \t]*[:：]?[ \t]*(?:(?:ชื่อ|ส่วนตัว)[ \t]*[:：]?[ \t]*)?/u;
const BRACKETED_CUE = /^(?:(?:id|ไอดี)[ \t]*)?(?:line|ig|fb|facebook|ไลน์|ไอจี|เฟส|@)/iu;

/** Whether a bracket's text, from just inside `(`, opens with a contact cue. */
export function opensWithContact(inner: string): boolean {
	const text = inner.trimStart();
	return BRACKETED_CUE.test(text) && !/^(?:line|ig|fb)[a-z]|^เฟส[\s\d]*\d/iu.test(text);
}

/**
 * The end of the contact handle a cue at `start`..`end` introduces, or
 * null when the cue is a plain word: `ไลน์` inside `ออนไลน์` or a
 * department such as `หัวหน้าไลน์ 2`, or `Line` in a building name.
 */
function handleEnd(raw: string, start: number, end: number): number | null {
	const cue = raw.slice(start, end);
	const before = raw[start - 1] ?? " ";
	const glued = /[ก-๎]/u.test(before);
	if (/[\p{L}\p{N}_.]/u.test(before) && !glued) return null;
	if (cue === "@") {
		if (glued) return null;
		const handle = /^[\w.\-]+/u.exec(raw.slice(end));
		return handle ? end + handle[0].length : null;
	}
	const filler = FILLER.exec(raw.slice(end))![0];
	const from = end + filler.length;
	const handle = /^\S+/u.exec(raw.slice(from))?.[0];
	if (!handle) return null;
	const latinHandle = /^[@A-Za-z]/u.test(handle);
	if (glued && !latinHandle) return null;
	// `เฟส 2` is a housing estate phase.
	if (cue.startsWith("เฟส") && /^[0-9๐-๙]/u.test(handle)) return null;
	if (LATIN_CUE.test(cue) && !filler.includes(":") && !/id$/iu.test(cue) && !/[ก-๎]/u.test(handle[0]!) &&
		!/[._@\d]/u.test(handle)) return null;
	const lineEnd = raw.indexOf("\n", from);
	const rest = raw.slice(from, lineEnd < 0 ? raw.length : lineEnd);
	const lineStart = raw.lastIndexOf("\n", start - 1) + 1;
	if (!/[\p{L}\p{N}]/u.test(raw.slice(lineStart, start)) && !/[0-9๐-๙]/u.test(rest)) return from + rest.trimEnd().length;
	return from + handle.length;
}

/**
 * The GUIDE keeps contact handles (`ไลน์ boonruan1965`, `(IG: pattra_closet)`,
 * `@aom.phangnga`, a `FB: ...` line) out of the name and the address, but the
 * tagger often runs a name or an address over them. Clears every handle
 * from name, organisation and address runs, a bracketed one with its
 * brackets, and cuts a name run at a handle written after the name.
 */
export function clearContactHandles(raw: string, tags: Uint8Array): void {
	const clear = (from: number, to: number) => {
		while (from > 0 && /[ \t]/u.test(raw[from - 1]!)) from -= 1;
		for (let index = from; index < to; index += 1) if (CLEARED.has(tags[index]!)) tags[index] = OTHER;
	};
	for (const match of raw.matchAll(CUE)) {
		const start = match.index;
		const open = /\([ \t]*$/u.exec(raw.slice(0, start));
		if (open) {
			const close = raw.indexOf(")", start);
			const lineEnd = raw.indexOf("\n", start);
			if (close >= 0 && (lineEnd < 0 || close < lineEnd) && opensWithContact(raw.slice(start, close))) {
				clear(open.index, close + 1);
				continue;
			}
		}
		const end = handleEnd(raw, start, start + match[0].length);
		if (end === null) continue;
		const tag = tags[start - 1];
		if (tag !== undefined && NAMED.has(tag) && tags[start] === tag) {
			let from = start;
			while (from > 0 && /[ \t/,|\-]/u.test(raw[from - 1]!) && tags[from - 1] === tag) from -= 1;
			let to = start;
			while (to < raw.length && tags[to] === tag) to += 1;
			clear(from, Math.max(to, end));
			continue;
		}
		clear(start, end);
	}
}
