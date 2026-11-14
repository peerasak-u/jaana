import { similarityRatio } from "../candidate/fuzzy-match";
import { normalizeCandidate, normalizePostcode } from "../normalize";
import type { LocationTuple, OutputLabel, ParsedFields } from "../types";
import { ANCHOR_FIELDS, createAnchorer, type Anchor } from "./anchor";
import { decodeTags } from "./decode";
import { featurize } from "./features";
import { compileTaggerModel, TAGS, type TaggerModel } from "./model";
import { closestTuple, createTupleResolver, nameForms, type AdministrativeTexts } from "./resolve";

const MIN_SIBLING_RATIO = 0.7;
const DISTRICT_BIT = 1 << ANCHOR_FIELDS.indexOf("district");

export interface TaggedSpan {
	readonly label: OutputLabel;
	readonly text: string;
	readonly start: number;
	readonly end: number;
}

export interface TaggedAddress {
	readonly raw: string;
	readonly fields: ParsedFields;
	readonly spans: readonly TaggedSpan[];
}

export interface TaggerParser {
	parse(raw: string): TaggedAddress;
}

function runsOf(raw: string, tags: Uint8Array): TaggedSpan[] {
	const runs: TaggedSpan[] = [];
	let start = 0;
	for (let index = 1; index <= raw.length; index += 1) {
		if (index < raw.length && tags[index] === tags[start]) continue;
		const tag = TAGS[tags[start]!]!;
		if (tag !== "OTHER") {
			runs.push({ label: tag, text: raw.slice(start, index), start, end: index });
		}
		start = index;
	}
	return runs;
}

export function createTaggerParser(
	model: TaggerModel,
	locations: readonly LocationTuple[],
): TaggerParser {
	const compiled = compileTaggerModel(model);
	const anchor = createAnchorer(locations);
	const resolve = createTupleResolver(locations);
	const siblingTuples = new Map<string, LocationTuple[]>();
	for (const location of locations) {
		const key = `${location.province}\u0000${location.district}`;
		const siblings = siblingTuples.get(key) ?? [];
		siblings.push(location);
		siblingTuples.set(key, siblings);
	}

	/**
	 * The anchor picks the first tuple of its district when the written
	 * subdistrict is misspelled, so the tagged span chooses among the
	 * district's subdistricts by similarity, within the written postcode
	 * when it narrows them.
	 */
	function anchoredSubdistrict(tuple: LocationTuple, text: string, zipcode: string | null): string {
		const siblings = siblingTuples.get(`${tuple.province}\u0000${tuple.district}`) ?? [tuple];
		const inPostcode = siblings.filter((sibling) => sibling.zipcode === zipcode);
		const pool = inPostcode.length > 0 ? inPostcode : siblings;
		let best = tuple.subdistrict;
		let bestRatio = MIN_SIBLING_RATIO;
		for (const form of nameForms("subdistrict", text)) {
			if (form === tuple.subdistrict) return tuple.subdistrict;
			for (const sibling of siblings) {
				if (sibling.subdistrict === form) return form;
			}
			for (const sibling of pool) {
				const ratio = similarityRatio(form, sibling.subdistrict) / 100;
				if (ratio > bestRatio) {
					best = sibling.subdistrict;
					bestRatio = ratio;
				}
			}
		}
		return best;
	}

	const postcodeTuples = new Map<string, LocationTuple[]>();
	for (const location of locations) {
		const tuples = postcodeTuples.get(location.zipcode) ?? [];
		tuples.push(location);
		postcodeTuples.set(location.zipcode, tuples);
	}

	/**
	 * The Anchor fixes only the fields it found written exactly. A written
	 * postcode that contradicts it, or an unconfirmed district, leaves the
	 * choice to the tagged spans within the tuples the evidence allows.
	 */
	function resolveTuple(
		anchored: Anchor,
		texts: AdministrativeTexts,
		written: string | null,
	): LocationTuple | null {
		const tuple = anchored.tuple;
		const inPostcode = written ? postcodeTuples.get(written) : undefined;
		if (inPostcode && tuple?.zipcode !== written) return closestTuple(inPostcode, texts);
		if (!tuple || !texts.district) return tuple;
		let confirmed = 0;
		for (const flag of anchored.flags) confirmed |= flag;
		if (confirmed & DISTRICT_BIT) return tuple;
		const pool = [tuple, ...(inPostcode ?? locations).filter((location) =>
			ANCHOR_FIELDS.every((field, bit) =>
				(confirmed & (1 << bit)) === 0 || location[field] === tuple[field]),
		)];
		return closestTuple(pool, texts);
	}

	return {
		parse(raw) {
			const anchored = anchor(raw);
			const tags = decodeTags(featurize(raw, anchored.flags, compiled.dimension), compiled);
			const spans = runsOf(raw, tags);
			const text = (label: OutputLabel): string | undefined =>
				spans.find((span) => span.label === label)?.text;
			const address = spans
				.filter((span) => span.label === "ADDRESS_DETAIL")
				.map((span) => span.text)
				.join(" ");
			const subdistrict = text("SUBDISTRICT");
			const district = text("DISTRICT");
			const province = text("PROVINCE");
			const zipcode = text("POSTCODE");
			const texts = {
				...(subdistrict ? { subdistrict } : {}),
				...(district ? { district } : {}),
				...(province ? { province } : {}),
			};
			const written = zipcode ? normalizePostcode(zipcode) : null;
			const tuple = resolveTuple(anchored, texts, written);
			const administrative = tuple
				? {
					subdistrict: subdistrict
						? anchoredSubdistrict(tuple, subdistrict, written)
						: null,
					district: district ? tuple.district : null,
					province: province ? tuple.province : null,
					zipcode: zipcode ? tuple.zipcode : null,
				}
				: resolve({ ...texts, ...(zipcode ? { zipcode } : {}) });
			const name = text("NAME");
			const phone = text("PHONE");
			return {
				raw,
				fields: {
					name: name ? normalizeCandidate("NAME", name) : null,
					phone: phone ? normalizeCandidate("PHONE", phone) : null,
					address: address ? normalizeCandidate("ADDRESS_DETAIL", address) : null,
					...administrative,
				},
				spans,
			};
		},
	};
}
