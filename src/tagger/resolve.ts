import { similarityRatio } from "../candidate/fuzzy-match";
import { normalizePostcode } from "../normalize";
import type { LocationTuple } from "../types";
import { latinSkeleton, thaiSkeleton } from "./romanize";

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
/** Short forms and nicknames shoppers write for a province. */
export const PROVINCE_ALIASES: ReadonlyMap<string, readonly string[]> = new Map(Object.entries({
	กรุงเทพมหานคร: ["กทม", "กทม.", "กรุงเทพ", "กรุงเทพฯ", "บางกอก", "bangkok", "bkk", "dm,"],
	นนทบุรี: ["นนท์", "นนท"],
	ปทุมธานี: ["ปทุม"],
	นครราชสีมา: ["โคราช"],
	กาญจนบุรี: ["กาญจน์", "กาญ"],
	อุบลราชธานี: ["อุบล", "อุบลฯ"],
	สมุทรสาคร: ["มหาชัย"],
	สมุทรสงคราม: ["แม่กลอง"],
	สมุทรปราการ: ["ปากน้ำ"],
	สุพรรณบุรี: ["สุพรรณ"],
	พระนครศรีอยุธยา: ["อยุธยา", "กรุงเก่า"],
	ฉะเชิงเทรา: ["แปดริ้ว"],
	นครศรีธรรมราช: ["นครศรี", "นครศรีฯ"],
	อุดรธานี: ["อุดร", "อุดรฯ"],
	ประจวบคีรีขันธ์: ["ประจวบ"],
	สุราษฎร์ธานี: ["สุราษฎร์"],
}));
const ALIASED_PROVINCE = new Map(
	[...PROVINCE_ALIASES].flatMap(([province, aliases]) => aliases.map((alias) => [alias, province] as const)),
);
const MIN_FUZZY_RATIO = 0.8;
const MIN_TRUNCATED_STEM = 4;
const FUZZY_DISCOUNT = 0.9;
const BARE_CITY_SIMILARITY = 0.9;
const POSTCODE_SCORE = 0.6;
const TRUSTED_TUPLE_SCORE = 1.8;
const MIN_STANDALONE_SIMILARITY = 0.85;
export const ROMANIZED = /^[^ก-๎]*[A-Za-z][^ก-๎]*$/u;

export type AdministrativeTexts = Partial<Record<AdministrativeField | "zipcode", string>>;
export type AdministrativeValues = Record<AdministrativeField | "zipcode", string | null>;

/** Surface forms of one tagged span with its administrative prefix removed. */
export function nameForms(field: AdministrativeField, text: string): string[] {
	const compact = text.replace(/\s+/gu, " ").trim();
	// A romanized form keeps its spaces, which mark a romanized prefix word such as `Khet`.
	const forms = new Set([ROMANIZED.test(compact) ? compact : compact.replace(/\s/gu, "")]);
	for (const prefix of PREFIXES[field]) {
		if (compact.startsWith(prefix)) {
			forms.add(compact.slice(prefix.length).replace(/[\s.]/gu, ""));
		}
	}
	if (field === "district") {
		for (const form of forms) {
			const province = form.startsWith("เมือง") ? ALIASED_PROVINCE.get(form.slice("เมือง".length)) : undefined;
			if (province) forms.add(`เมือง${province}`);
		}
	}
	return [...forms].filter((form) => form.length > 0);
}

const MIN_ABBREVIATION_STEM = 3;

/**
 * The written start of a name a shopper cut short with the abbreviation
 * mark `ฯ`, as `อุทัยฯ` for อุทัยธานี, or null when the form is not one.
 */
function abbreviationStem(form: string): string | null {
	if (!form.endsWith("ฯ")) return null;
	const stem = form.slice(0, -1);
	return stem.length >= MIN_ABBREVIATION_STEM ? stem : null;
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
		if (field === "province" && ALIASED_PROVINCE.get(form.toLowerCase()) === name) return 1;
		const stem = abbreviationStem(form);
		if (stem && name.length > stem.length && name.startsWith(stem)) {
			best = Math.max(best, FUZZY_DISCOUNT);
			continue;
		}
		if (field === "district" && form === "เมือง" && name.startsWith("เมือง")) {
			best = Math.max(best, BARE_CITY_SIMILARITY);
			continue;
		}
		const ratio = ROMANIZED.test(form)
			? similarityRatio(latinSkeleton(form), thaiSkeleton(name))
			: similarityRatio(form, name);
		best = Math.max(best, ratio / 100);
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
			const aliased = field === "province" ? ALIASED_PROVINCE.get(form) : undefined;
			if (aliased) raise(aliased, 1);
			if (field === "district" && form === "เมือง") {
				for (const name of names.district) {
					if (name.startsWith("เมือง")) raise(name, BARE_CITY_SIMILARITY);
				}
			}
			const stem = abbreviationStem(form);
			if (stem) {
				const longer = names[field].filter((name) => name.length > stem.length && name.startsWith(stem));
				if (longer.length === 1) raise(longer[0]!, 1);
			}
		}
		if (result.size > 0) return result;
		if (field !== "province") {
			for (const form of forms) {
				// A shopper cuts a long name short, often closing it with a karan: `อ.จตุรพักตร์` for จตุรพักตรพิมาน.
				const stem = form.replace(/.์$/u, "");
				if (stem.length < MIN_TRUNCATED_STEM) continue;
				const longer = names[field].filter((name) => name.length > stem.length && name.startsWith(stem));
				if (longer.length === 1) raise(longer[0]!, FUZZY_DISCOUNT);
			}
			if (result.size > 0) return result;
		}
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

export interface FilledLocation {
	readonly values: AdministrativeValues;
	readonly inferred: readonly (AdministrativeField | "zipcode")[];
	readonly ambiguous: boolean;
}

const LOCATION_FIELDS = [...ADMINISTRATIVE_FIELDS, "zipcode"] as const;

/**
 * Fills the administrative fields a message left out when the ones it wrote
 * agree on them across every gazetteer tuple they match. A postcode alone
 * fills nothing, since shoppers write one for a whole district or more. An
 * open subdistrict is not flagged: the district and postcode still route the
 * parcel, and most messages omit it.
 */
export function createLocationFiller(
	locations: readonly LocationTuple[],
): (values: AdministrativeValues) => FilledLocation {
	const byName = ADMINISTRATIVE_FIELDS.map((field) => {
		const index = new Map<string, LocationTuple[]>();
		for (const location of locations) {
			const tuples = index.get(location[field]) ?? [];
			tuples.push(location);
			index.set(location[field], tuples);
		}
		return index;
	});

	return (values) => {
		const missing = LOCATION_FIELDS.filter((field) => values[field] === null);
		let pool: readonly LocationTuple[] | undefined;
		ADMINISTRATIVE_FIELDS.forEach((field, index) => {
			const name = values[field];
			if (name === null) return;
			const tuples = byName[index]!.get(name) ?? [];
			if (!pool || tuples.length < pool.length) pool = tuples;
		});
		if (!pool || missing.length === 0) return { values, inferred: [], ambiguous: false };
		const matches = pool.filter((location) =>
			LOCATION_FIELDS.every((field) => values[field] === null || location[field] === values[field]));
		if (matches.length === 0) return { values, inferred: [], ambiguous: false };
		const filled = { ...values };
		const inferred: (AdministrativeField | "zipcode")[] = [];
		let ambiguous = false;
		for (const field of missing) {
			const value = matches[0]![field];
			if (matches.every((location) => location[field] === value)) {
				filled[field] = value;
				inferred.push(field);
			} else if (field !== "subdistrict") ambiguous = true;
		}
		return { values: filled, inferred, ambiguous };
	};
}
