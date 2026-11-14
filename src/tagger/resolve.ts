import { similarityRatio } from "../candidate/fuzzy-match";
import { normalizePostcode } from "../normalize";
import type { LocationTuple } from "../types";

export type AdministrativeField = "subdistrict" | "district" | "province";
export const ADMINISTRATIVE_FIELDS: readonly AdministrativeField[] = [
	"subdistrict",
	"district",
	"province",
];

const PREFIXES: Record<AdministrativeField, readonly string[]> = {
	subdistrict: ["ตำบล", "แขวง", "ต.", "ต"],
	district: ["อำเภอ", "เขต", "อ.", "อ"],
	province: ["จังหวัด", "จ.", "จ"],
};
const BANGKOK = /^(กทม\.?|กรุงเทพฯ?|กรุงเทพมหานคร)$/u;
const MIN_FUZZY_RATIO = 0.8;
const FUZZY_DISCOUNT = 0.9;
const BARE_CITY_SIMILARITY = 0.9;
const POSTCODE_SCORE = 0.6;
const TRUSTED_TUPLE_SCORE = 1.8;
const MIN_STANDALONE_SIMILARITY = 0.85;

export type AdministrativeTexts = Partial<Record<AdministrativeField | "zipcode", string>>;
export type AdministrativeValues = Record<AdministrativeField | "zipcode", string | null>;

/** Surface forms of one tagged span with its administrative prefix removed. */
export function nameForms(field: AdministrativeField, text: string): string[] {
	const compact = text.replace(/\s+/gu, " ").trim();
	const forms = new Set([compact.replace(/\s/gu, "")]);
	for (const prefix of PREFIXES[field]) {
		if (compact.startsWith(prefix)) {
			forms.add(compact.slice(prefix.length).replace(/[\s.]/gu, ""));
		}
	}
	return [...forms].filter((form) => form.length > 0);
}

/** Similarity in [0, 1] of the best surface form of a tagged span to one gazetteer name. */
export function formSimilarity(
	field: AdministrativeField,
	forms: readonly string[],
	name: string,
): number {
	let best = 0;
	for (const form of forms) {
		if (form === name) return 1;
		if (field === "province" && name === "กรุงเทพมหานคร" && BANGKOK.test(form)) return 1;
		if (field === "district" && form === "เมือง" && name.startsWith("เมือง")) {
			best = Math.max(best, BARE_CITY_SIMILARITY);
			continue;
		}
		best = Math.max(best, similarityRatio(form, name) / 100);
	}
	return best;
}

/**
 * Picks the tuple of a small pool whose names best match the tagged spans.
 * Ties keep the earlier tuple, so callers order the pool by preference.
 */
export function closestTuple(
	pool: readonly LocationTuple[],
	texts: AdministrativeTexts,
): LocationTuple | null {
	const forms = ADMINISTRATIVE_FIELDS.map((field) => {
		const text = texts[field];
		return text ? nameForms(field, text) : [];
	});
	const seen = ADMINISTRATIVE_FIELDS.map(() => new Map<string, number>());
	let best: LocationTuple | null = null;
	let bestScore = -1;
	for (const location of pool) {
		let score = 0;
		ADMINISTRATIVE_FIELDS.forEach((field, index) => {
			if (forms[index]!.length === 0) return;
			const name = location[field];
			let similarity = seen[index]!.get(name);
			if (similarity === undefined) {
				similarity = formSimilarity(field, forms[index]!, name);
				seen[index]!.set(name, similarity);
			}
			score += similarity;
		});
		if (score > bestScore) {
			best = location;
			bestScore = score;
		}
	}
	return best;
}

/**
 * Resolves tagged administrative spans to one gazetteer tuple by summed
 * name similarity. Used when the text holds too few exact names to anchor.
 */
export function createTupleResolver(
	locations: readonly LocationTuple[],
): (texts: AdministrativeTexts) => AdministrativeValues {
	const names = {
		subdistrict: [...new Set(locations.map((location) => location.subdistrict))],
		district: [...new Set(locations.map((location) => location.district))],
		province: [...new Set(locations.map((location) => location.province))],
	};
	const known = {
		subdistrict: new Set(names.subdistrict),
		district: new Set(names.district),
		province: new Set(names.province),
	};

	function similarities(field: AdministrativeField, text: string): Map<string, number> {
		const result = new Map<string, number>();
		const raise = (name: string, value: number): void => {
			if (value > (result.get(name) ?? 0)) result.set(name, value);
		};
		const forms = nameForms(field, text);
		for (const form of forms) {
			if (known[field].has(form)) raise(form, 1);
			if (field === "province" && BANGKOK.test(form)) raise("กรุงเทพมหานคร", 1);
			if (field === "district" && form === "เมือง") {
				for (const name of names.district) {
					if (name.startsWith("เมือง")) raise(name, BARE_CITY_SIMILARITY);
				}
			}
		}
		if (result.size > 0) return result;
		for (const form of forms) {
			for (const name of names[field]) {
				if (Math.abs(name.length - form.length) > 2) continue;
				const ratio = similarityRatio(form, name) / 100;
				if (ratio >= MIN_FUZZY_RATIO) raise(name, ratio * FUZZY_DISCOUNT);
			}
		}
		return result;
	}

	return (texts) => {
		const similarity: Partial<Record<AdministrativeField, Map<string, number>>> = {};
		for (const field of ADMINISTRATIVE_FIELDS) {
			if (texts[field]) similarity[field] = similarities(field, texts[field]);
		}
		const zipcode = texts.zipcode ? normalizePostcode(texts.zipcode) : null;
		let best: LocationTuple | null = null;
		let bestScore = 0;
		for (const location of locations) {
			let score = zipcode !== null && location.zipcode === zipcode ? POSTCODE_SCORE : 0;
			for (const field of ADMINISTRATIVE_FIELDS) {
				score += similarity[field]?.get(location[field]) ?? 0;
			}
			if (score > bestScore) {
				bestScore = score;
				best = location;
			}
		}
		const trusted = best !== null && bestScore >= TRUSTED_TUPLE_SCORE;
		const values: AdministrativeValues = {
			subdistrict: null,
			district: null,
			province: null,
			zipcode: texts.zipcode ? (trusted ? best!.zipcode : zipcode) : null,
		};
		for (const field of ADMINISTRATIVE_FIELDS) {
			const map = similarity[field];
			if (!map) continue;
			if (best && (trusted || (map.get(best[field]) ?? 0) > 0)) {
				values[field] = best[field];
				continue;
			}
			let own: string | null = null;
			let ownScore = MIN_STANDALONE_SIMILARITY;
			for (const [name, value] of map) {
				if (value >= ownScore) {
					own = name;
					ownScore = value;
				}
			}
			values[field] = own;
		}
		return values;
	};
}
