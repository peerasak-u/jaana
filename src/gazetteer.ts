import type { LocationTuple } from "./types";

export type CompactLocationTuple = readonly [
	subdistrict: string,
	districtIndex: number,
	provinceIndex: number,
	zipcode: string,
];

export interface CompactGazetteer {
	readonly version: string;
	readonly provinces: readonly string[];
	readonly districts: readonly string[];
	readonly tuples: readonly CompactLocationTuple[];
}

export function expandGazetteer(compact: CompactGazetteer): LocationTuple[] {
	return compact.tuples.map(([subdistrict, districtIndex, provinceIndex, zipcode]) => {
		const district = compact.districts[districtIndex];
		const province = compact.provinces[provinceIndex];
		if (district === undefined || province === undefined) {
			throw new Error(`gazetteer tuple ${subdistrict} has an unknown district or province index`);
		}
		return { subdistrict, district, province, zipcode };
	});
}
