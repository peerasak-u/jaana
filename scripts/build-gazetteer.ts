import { loadGazetteer } from "../bench/gazetteer";
import type { CompactGazetteer, CompactLocationTuple } from "../src/gazetteer";

function argument(name: string, fallback: string): string {
	const index = Bun.argv.indexOf(name);
	return (index >= 0 ? Bun.argv[index + 1] : undefined) ?? fallback;
}

const sourcePath = argument(
	"--source",
	`${process.env.HOME}/Workspace/indie/thai-address-synth-dataset/data/subdistricts.json`,
);
const outputPath = argument("--output", "resources/gazetteer.json");
const version = argument("--version", "th-gazetteer-v1");

const locations = await loadGazetteer(sourcePath);
const provinces: string[] = [];
const districts: string[] = [];
const provinceIndex = new Map<string, number>();
const districtIndex = new Map<string, number>();

function intern(table: string[], index: Map<string, number>, value: string): number {
	const existing = index.get(value);
	if (existing !== undefined) return existing;
	index.set(value, table.length);
	table.push(value);
	return table.length - 1;
}

const tuples: CompactLocationTuple[] = locations.map((location) => [
	location.subdistrict,
	intern(districts, districtIndex, location.district),
	intern(provinces, provinceIndex, location.province),
	location.zipcode,
]);
const gazetteer: CompactGazetteer = { version, provinces, districts, tuples };
const body = [
	"{",
	`"version":${JSON.stringify(version)},`,
	`"provinces":${JSON.stringify(provinces)},`,
	`"districts":${JSON.stringify(districts)},`,
	`"tuples":[`,
	gazetteer.tuples.map((tuple) => JSON.stringify(tuple)).join(",\n"),
	"]}",
].join("\n");
await Bun.write(outputPath, `${body}\n`);
console.log(
	JSON.stringify({ outputPath, version, provinces: provinces.length, districts: districts.length, tuples: tuples.length }),
);
