import { expect, test } from "bun:test";
import { expandGazetteer, type CompactGazetteer } from "../src";
import shipped from "../resources/gazetteer.json";

test("the shipped gazetteer expands to every Thai subdistrict tuple in source order", () => {
	const locations = expandGazetteer(shipped as unknown as CompactGazetteer);

	expect(locations).toHaveLength(7431);
	expect(locations[0]).toEqual({
		subdistrict: "คลองมหานาค",
		district: "ป้อมปราบศัตรูพ่าย",
		province: "กรุงเทพมหานคร",
		zipcode: "10100",
	});
});

test("a tuple pointing at a missing district is rejected", () => {
	expect(() =>
		expandGazetteer({
			version: "broken",
			provinces: ["กรุงเทพมหานคร"],
			districts: [],
			tuples: [["คลองมหานาค", 0, 0, "10100"]],
		}),
	).toThrow("unknown district or province index");
});
