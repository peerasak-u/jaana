import { describe, expect, test } from "bun:test";
import { loadParserResources } from "../bench/gazetteer";
import type { TaggerModel } from "../src/tagger/model";
import { createTaggerParser } from "../src/tagger/parser";

const { locations } = await loadParserResources("resources/gazetteer.json");
const shippedModel = (await Bun.file("resources/tagger-model.json").json()) as TaggerModel;
const parser = createTaggerParser(shippedModel, locations);

describe("issue 6: administrative fields filled from the gazetteer", () => {
	test("A1: subdistrict, district and postcode fill the province", () => {
		const result = parser.parse("ต.ในเมือง อ.เมืองขอนแก่น 40000");
		expect(result.fields).toMatchObject({
			subdistrict: "ในเมือง",
			district: "เมืองขอนแก่น",
			province: "ขอนแก่น",
			zipcode: "40000",
		});
		expect(result.inferred).toEqual(["province"]);
		expect(result.warnings).toEqual([]);
	});

	test("B1: subdistrict and postcode fill the district and province", () => {
		const result = parser.parse("ต.หนองหาร 50290");
		expect(result.fields).toMatchObject({ subdistrict: "หนองหาร", district: "สันทราย", province: "เชียงใหม่", zipcode: "50290" });
		expect([...result.inferred].sort()).toEqual(["district", "province"]);
	});

	test("B2: a subdistrict name shared across provinces is pinned by its postcode", () => {
		const result = parser.parse("ต.ในเมือง 30000");
		expect(result.fields).toMatchObject({ subdistrict: "ในเมือง", district: "เมืองนครราชสีมา", province: "นครราชสีมา" });
		expect([...result.inferred].sort()).toEqual(["district", "province"]);
	});

	test("a subdistrict name shared across provinces with nothing else is flagged, not guessed", () => {
		const result = parser.parse("คุณเอ 0812345678 12 ม.3 ต.ในเมือง");
		expect(result.fields).toMatchObject({ subdistrict: "ในเมือง", district: null, province: null, zipcode: null });
		expect(result.inferred).toEqual([]);
		expect(result.warnings).toContain("ambiguous-location");
	});

	test("a postcode alone fills nothing", () => {
		const result = parser.parse("คุณเอ 0812345678 12 ม.3 50290");
		expect(result.fields).toMatchObject({ subdistrict: null, district: null, province: null, zipcode: "50290" });
		expect(result.inferred).toEqual([]);
		expect(result.warnings).toEqual([]);
	});

	test("the first recipient repeats the top-level fields and inferred list", () => {
		const result = parser.parse("ต.หนองหาร 50290");
		expect(result.recipients[0]!.fields).toEqual(result.fields);
		expect(result.recipients[0]!.inferred).toEqual(result.inferred);
	});
});

describe("issue 6: romanized Bangkok district sharing a postcode", () => {
	for (const written of ["Bangna", "Bang Na"]) {
		test(`${written} resolves to บางนา, not the other district of 10260`, () => {
			const result = parser.parse(`Mayuree S. 081-345-6789 55/20 Bangna-Trad Road, ${written}, Bangkok 10260`);
			expect(result.fields).toMatchObject({
				address: "55/20 Bangna-Trad Road",
				subdistrict: "บางนา",
				district: "บางนา",
				province: "กรุงเทพมหานคร",
				zipcode: "10260",
			});
			expect(result.inferred).toEqual(["subdistrict"]);
		});
	}

	test("the Thai district name keeps resolving", () => {
		const fields = parser.parse("คุณบี 55/20 เขตบางนา กทม 10260").fields;
		expect(fields).toMatchObject({ district: "บางนา", province: "กรุงเทพมหานคร", zipcode: "10260" });
	});

	test("a mistyped postcode is corrected to the written subdistrict's", () => {
		const result = parser.parse("คุณเมย์ 0811112233 12/4 ต.สุเทพ อ.เมืองเชียงใหม่ จ.เชียงใหม่ 50201");
		expect(result.fields).toMatchObject({ subdistrict: "สุเทพ", district: "เมืองเชียงใหม่", province: "เชียงใหม่", zipcode: "50200" });
		expect(result.inferred).toEqual([]);
	});
});
