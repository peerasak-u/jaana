import type { LocationTuple } from "../types";

export const ANCHOR_FIELDS = [
	"subdistrict",
	"district",
	"province",
	"zipcode",
] as const;

const FIELD_WEIGHT = [1, 1, 1, 1.2];
const BARE_CITY_WEIGHT = 0.4;
const MIN_ANCHOR_SCORE = 2;
const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";

export const ANCHOR_START = 16;
export const ANCHOR_END = 32;

export interface Anchor {
	readonly tuple: LocationTuple | null;
	/**
	 * Per UTF-16 unit: bit `1 << field` when the unit lies inside the anchored
	 * tuple's mention of that field, plus ANCHOR_START / ANCHOR_END on the
	 * first and last unit of a mention.
	 */
	readonly flags: Uint8Array;
}

interface Mention {
	readonly field: number;
	readonly start: number;
	readonly end: number;
	readonly weight: number;
}

interface Hit {
	readonly id: number;
	readonly field: number;
	readonly weight: number;
}

function bestAssignment(mentions: readonly Mention[]): {
	score: number;
	length: number;
	chosen: Mention[];
} {
	let best = { score: 0, length: 0, chosen: [] as Mention[] };
	const chosen: Mention[] = [];
	const walk = (field: number, score: number, length: number): void => {
		if (field === ANCHOR_FIELDS.length) {
			if (score > best.score || (score === best.score && length > best.length)) {
				best = { score, length, chosen: [...chosen] };
			}
			return;
		}
		walk(field + 1, score, length);
		for (const mention of mentions) {
			if (mention.field !== field) continue;
			if (chosen.some((other) => mention.start < other.end && other.start < mention.end)) {
				continue;
			}
			chosen.push(mention);
			walk(field + 1, score + mention.weight, length + mention.end - mention.start);
			chosen.pop();
		}
	};
	walk(0, 0, 0);
	return best;
}

/**
 * Finds the one gazetteer tuple whose names co-occur in the text. A text
 * mention counts for a single field, so a subdistrict that shares its
 * district's name needs two mentions to claim both.
 */
export function createAnchorer(
	locations: readonly LocationTuple[],
): (raw: string) => Anchor {
	const index = new Map<string, Hit[]>();
	let longest = 0;
	const put = (name: string, id: number, field: number, weight: number): void => {
		const hits = index.get(name) ?? [];
		hits.push({ id, field, weight });
		index.set(name, hits);
		longest = Math.max(longest, name.length);
	};
	locations.forEach((location, id) => {
		ANCHOR_FIELDS.forEach((field, position) =>
			put(location[field], id, position, FIELD_WEIGHT[position]!),
		);
		if (location.district.startsWith("เมือง") && location.district !== "เมือง") {
			put("เมือง", id, 1, BARE_CITY_WEIGHT);
		}
		if (location.province === "กรุงเทพมหานคร") {
			put("กรุงเทพ", id, 2, 1);
			put("กทม", id, 2, 1);
		}
	});

	return (input) => {
		const raw = input.replace(/[๐-๙]/gu, (digit) => String(THAI_DIGITS.indexOf(digit)));
		const mentionsByTuple = new Map<number, Mention[]>();
		for (let start = 0; start < raw.length; start += 1) {
			const limit = Math.min(longest, raw.length - start);
			for (let length = 2; length <= limit; length += 1) {
				const hits = index.get(raw.slice(start, start + length));
				if (!hits) continue;
				for (const hit of hits) {
					const mentions = mentionsByTuple.get(hit.id) ?? [];
					mentions.push({ field: hit.field, start, end: start + length, weight: hit.weight });
					mentionsByTuple.set(hit.id, mentions);
				}
			}
		}
		const ranked = [...mentionsByTuple.entries()]
			.map(([id, mentions]) => {
				const bound = [0, 0, 0, 0];
				for (const mention of mentions) {
					bound[mention.field] = Math.max(bound[mention.field]!, mention.weight);
				}
				return { id, mentions, bound: bound[0]! + bound[1]! + bound[2]! + bound[3]! };
			})
			.filter((entry) => entry.bound >= MIN_ANCHOR_SCORE)
			.sort((left, right) => right.bound - left.bound || left.id - right.id);
		let bestId = -1;
		let best = { score: 0, length: 0, chosen: [] as Mention[] };
		for (const entry of ranked) {
			if (entry.bound < best.score) break;
			const assignment = bestAssignment(entry.mentions);
			if (
				assignment.score > best.score ||
				(assignment.score === best.score && assignment.length > best.length)
			) {
				best = assignment;
				bestId = entry.id;
			}
		}
		const flags = new Uint8Array(raw.length);
		if (bestId < 0 || best.score < MIN_ANCHOR_SCORE) return { tuple: null, flags };
		for (const mention of best.chosen) {
			for (let position = mention.start; position < mention.end; position += 1) {
				flags[position]! |=
					(1 << mention.field) |
					(position === mention.start ? ANCHOR_START : 0) |
					(position === mention.end - 1 ? ANCHOR_END : 0);
			}
		}
		return { tuple: locations[bestId]!, flags };
	};
}
