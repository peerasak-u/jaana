import { loadParserResources } from "../../bench/gazetteer";
import { locationMap } from "../../bench/chat/load";
import { bracketPlace, nameBracketKind, parseSource, type Pool } from "../../bench/chat/markup";
import type { LocationTuple } from "../../src/types";

/**
 * Brings source files to GUIDE v2 mechanically: moves contact-handle and
 * place-name brackets out of `N`, moves the `เล่น` of `ชื่อเล่น` out of
 * `N`, and writes the `warn:` header the marks need. Prints counts only,
 * never record text, so it may run on sealed holdout files. Dry run unless
 * `--write`. Running it twice changes nothing the second time.
 */

const write = Bun.argv.includes("--write");
const paths = Bun.argv.slice(2).filter((argument) => argument.endsWith(".txt"));
if (paths.length === 0) throw new Error("usage: bun scripts/chat/relabel-v2.ts <source.txt>... [--write]");

const { locations } = await loadParserResources("resources/gazetteer.json");
const map = locationMap(locations);
const BANGKOK_ALIASES = new Set(["กทม", "บางกอก", "bkk", "bangkok"]);

interface Counts {
	contactHandle: number;
	placeName: number;
	placeMarked: number;
	nameLabel: number;
	nameBracketLeft: number;
	warnChanged: number;
	recordsChanged: number;
	issuesAfter: number;
}

function locationsOf(header: readonly string[]): Map<string, LocationTuple> {
	const byNumber = new Map<string, LocationTuple>();
	for (const line of header) {
		const match = /^loc(\d*):(.*)$/u.exec(line);
		const location = match && map.get(match[2]!.split("|").map((part) => part.trim()).join("|"));
		if (location) byNumber.set(match[1] === "1" ? "" : match[1]!, location);
	}
	return byNumber;
}

/** Which administrative mark a moved place bracket gets, if the record has none of that kind. */
function placeMark(inner: string, location: LocationTuple | undefined, body: string, number: string): { mark: "V" | "D"; alias: boolean } | null {
	if (!location) return null;
	const bare = bracketPlace(inner);
	const province = bare === location.province || (location.province === "กรุงเทพมหานคร" && BANGKOK_ALIASES.has(bare)) ||
		(location.province === "นครราชสีมา" && bare === "โคราช");
	const mark = province ? "V" : bare === location.district ? "D" : null;
	if (!mark || body.includes(`[[${mark}${number}:`)) return null;
	return { mark, alias: bare !== location.province && bare !== location.district };
}

function fixBody(body: string, header: string[], counts: Counts): string {
	const byNumber = locationsOf(header);
	let needsAlias = false;
	const fixed = body.replace(/\[\[N(\d*):((?:(?!\]\])[\s\S])*?)\]\]/gu, (whole, number: string, name: string, offset: number) => {
		const label = /^(เล่น(?:คือ)?\s*:?\s*)(?=\S)/u.exec(name);
		if (label && /ชื่อ\s*$/u.test(body.slice(0, offset))) {
			counts.nameLabel += 1;
			return `${label[1]}[[N${number}:${name.slice(label[1]!.length)}]]`;
		}
		const last = /^([\s\S]*?\S)(\s*)\(([^()]*)\)$/u.exec(name);
		const kind = last ? nameBracketKind(last[3]!, map) : null;
		if (!last || !kind) {
			for (const bracket of name.matchAll(/\(([^()]*)\)/gu)) if (nameBracketKind(bracket[1]!, map)) counts.nameBracketLeft += 1;
			return whole;
		}
		const [, kept, space, inner] = last as unknown as [string, string, string, string];
		if (kind === "contact-handle") {
			counts.contactHandle += 1;
			return `[[N${number}:${kept}]]${space}(${inner})`;
		}
		counts.placeName += 1;
		const place = placeMark(inner, byNumber.get(number), body, number);
		if (!place) return `[[N${number}:${kept}]]${space}(${inner})`;
		counts.placeMarked += 1;
		needsAlias ||= place.alias;
		const lead = inner.length - inner.trimStart().length;
		const trail = inner.length - inner.trimEnd().length;
		return `[[N${number}:${kept}]]${space}(${inner.slice(0, lead)}[[${place.mark}${number}:${inner.trim()}]]${inner.slice(inner.length - trail)})`;
	});
	if (needsAlias) {
		const tags = header.findIndex((line) => line.startsWith("tags:"));
		if (tags < 0) header.push("tags: alias");
		else if (!header[tags]!.slice(5).split(",").map((tag) => tag.trim()).includes("alias")) header[tags] += ", alias";
	}
	return fixed;
}

interface Block {
	readonly line: number;
	header: string[];
	body: string;
}

function splitBlocks(text: string): { preamble: string[]; blocks: Block[] } {
	const lines = text.split("\n");
	const preamble: string[] = [];
	const blocks: Block[] = [];
	let index = 0;
	while (index < lines.length && lines[index] !== "===") preamble.push(lines[index++]!);
	while (index < lines.length) {
		const line = index + 1;
		index += 1;
		const header: string[] = [];
		while (index < lines.length && lines[index] !== "---" && lines[index] !== "===") header.push(lines[index++]!);
		if (lines[index] !== "---") throw new Error(`record at line ${line} has no --- line`);
		index += 1;
		const body: string[] = [];
		while (index < lines.length && lines[index] !== "===") body.push(lines[index++]!);
		blocks.push({ line, header, body: body.join("\n") });
	}
	return { preamble, blocks };
}

function joinBlocks(preamble: readonly string[], blocks: readonly Block[]): string {
	return [...preamble, ...blocks.flatMap((block) => ["===", ...block.header, "---", block.body])].join("\n");
}

function parse(text: string, path: string) {
	const pool: Pool = path.includes("/train/") ? "train" : "bench";
	return parseSource(text, { file: path, category: "relabel", idPrefix: "relabel", pool, locations: map });
}

let failed = false;
for (const path of paths) {
	if (!path.includes("/train/") && !path.includes("/bench/")) throw new Error(`${path} is not under sources/bench or sources/train`);
	const original = await Bun.file(path).text();
	const counts: Counts = { contactHandle: 0, placeName: 0, placeMarked: 0, nameLabel: 0, nameBracketLeft: 0, warnChanged: 0, recordsChanged: 0, issuesAfter: 0 };
	const { preamble, blocks } = splitBlocks(original);
	const before = blocks.map((block) => joinBlocks([], [block]));
	for (const block of blocks) block.body = fixBody(block.body, block.header, counts);

	const needed = new Map<number, readonly string[]>();
	const rebuilt = splitBlocks(joinBlocks(preamble, blocks)).blocks;
	for (const issue of parse(joinBlocks(preamble, blocks), path).issues) {
		if (issue.warnings) needed.set(issue.line, issue.warnings);
	}
	rebuilt.forEach((block, index) => {
		const warnings = needed.get(block.line);
		if (!warnings) return;
		counts.warnChanged += 1;
		const header = blocks[index]!.header.filter((line) => !line.startsWith("warn:"));
		if (warnings.length > 0) header.push(`warn: ${warnings.join(", ")}`);
		blocks[index]!.header = header;
	});
	const result = joinBlocks(preamble, blocks);
	counts.recordsChanged = blocks.filter((block, index) => joinBlocks([], [block]) !== before[index]).length;
	counts.issuesAfter = parse(result, path).issues.length;
	if (counts.issuesAfter > 0) failed = true;
	if (write && result !== original) await Bun.write(path, result);
	console.log(JSON.stringify({ path, ...counts, written: write && result !== original }));
}
process.exit(failed ? 1 : 0);
