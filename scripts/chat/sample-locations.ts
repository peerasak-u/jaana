import { loadParserResources } from "../../bench/gazetteer";
import { fnv1a, poolOf, type Pool } from "../../bench/chat/markup";

function option(name: string, fallback: string): string {
	const index = Bun.argv.indexOf(name);
	return index >= 0 && Bun.argv[index + 1] ? Bun.argv[index + 1]! : fallback;
}

const pool = option("--pool", "") as Pool;
if (pool !== "bench" && pool !== "train") throw new Error("--pool must be bench or train");
const count = Number(option("--n", "140"));
const metroShare = Number(option("--metro-share", "0.3"));
const seed = option("--seed", "0");

const METRO = new Set(["กรุงเทพมหานคร", "นนทบุรี", "ปทุมธานี", "สมุทรปราการ"]);

let state = fnv1a(`${pool}:${seed}`) || 1;
function random(): number {
	state = (state + 0x6d2b79f5) | 0;
	let value = Math.imul(state ^ (state >>> 15), 1 | state);
	value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
	return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

const { locations } = await loadParserResources("resources/gazetteer.json");
const eligible = locations.filter((location) => poolOf(location) === pool);
const metro = eligible.filter((location) => METRO.has(location.province));
const upcountry = eligible.filter((location) => !METRO.has(location.province));
const picked = new Set<string>();
while (picked.size < count) {
	const source = random() < metroShare ? metro : upcountry;
	const location = source[Math.floor(random() * source.length)]!;
	picked.add(`${location.subdistrict} | ${location.district} | ${location.province} | ${location.zipcode}`);
}
console.log([...picked].join("\n"));
