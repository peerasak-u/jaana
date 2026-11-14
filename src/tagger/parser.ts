import { normalizeCandidate } from "../normalize";
import type { LocationTuple, OutputLabel, ParsedFields } from "../types";
import { createAnchorer } from "./anchor";
import { decodeTags, spanEdges } from "./decode";
import { featurize } from "./features";
import { compileTaggerModel, TAGS, type TaggerModel } from "./model";
import { createTupleResolver, nameForms } from "./resolve";

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
	const siblingSubdistricts = new Map<string, Set<string>>();
	for (const location of locations) {
		const key = `${location.province}\u0000${location.district}`;
		const siblings = siblingSubdistricts.get(key) ?? new Set<string>();
		siblings.add(location.subdistrict);
		siblingSubdistricts.set(key, siblings);
	}

	/**
	 * The anchor can pick a sibling subdistrict when the written one is
	 * misspelled. A tagged span naming another subdistrict of the anchored
	 * district overrides it.
	 */
	function anchoredSubdistrict(tuple: LocationTuple, text: string): string {
		const siblings = siblingSubdistricts.get(`${tuple.province}\u0000${tuple.district}`);
		for (const form of nameForms("subdistrict", text)) {
			if (form === tuple.subdistrict) return tuple.subdistrict;
		}
		for (const form of nameForms("subdistrict", text)) {
			if (siblings?.has(form)) return form;
		}
		return tuple.subdistrict;
	}

	return {
		parse(raw) {
			const anchored = anchor(raw);
			const features = featurize(raw, anchored.flags, compiled.dimension);
			const tags = decodeTags(features, compiled, spanEdges(raw));
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
			const tuple = anchored.tuple;
			const administrative = tuple
				? {
					subdistrict: subdistrict ? anchoredSubdistrict(tuple, subdistrict) : null,
					district: district ? tuple.district : null,
					province: province ? tuple.province : null,
					zipcode: zipcode ? tuple.zipcode : null,
				}
				: resolve({
					...(subdistrict ? { subdistrict } : {}),
					...(district ? { district } : {}),
					...(province ? { province } : {}),
					...(zipcode ? { zipcode } : {}),
				});
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
