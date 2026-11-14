import { loadDataset } from "../bench/dataset";
import { loadParserResources } from "../bench/gazetteer";
import { FIELD_NAMES } from "../bench/metrics";
import { createAddressParser } from "../src";
import { createAnchorer } from "../src/tagger/anchor";
import { boundJoins, decodeTags, emissionScores } from "../src/tagger/decode";
import { featurize } from "../src/tagger/features";
import { compileTaggerModel, TAG_COUNT, type TaggerModel } from "../src/tagger/model";
import { createTaggerParser } from "../src/tagger/parser";

const RECORD_IDS = ["sakon-messy-001", "sakon-messy-017", "sakon-messy-010"];
const START = "/*snapshot:start*/";
const END = "/*snapshot:end*/";
const PAGE = "explainer.html";

const resources = await loadParserResources("resources/gazetteer.json");
const model = (await Bun.file("resources/tagger-model.json").json()) as TaggerModel;
const compiled = compileTaggerModel(model);
const anchor = createAnchorer(resources.locations);
const tagger = createTaggerParser(model, resources.locations);
const engine = createAddressParser(resources);
const fixture = await loadDataset("bench/fixtures/sakon-messy-v1.jsonl");

const records = RECORD_IDS.map((id) => {
	const record = fixture.find((candidate) => candidate.id === id);
	if (!record) throw new Error(`fixture record ${id} not found`);
	const anchored = anchor(record.raw);
	const features = featurize(record.raw, anchored.flags, compiled.dimension);
	const emissions = emissionScores(features, compiled.weights);
	let freeTags = "";
	for (let position = 0; position < features.length; position += 1) {
		let best = 0;
		for (let tag = 1; tag < TAG_COUNT; tag += 1) {
			if (emissions[position * TAG_COUNT + tag]! > emissions[position * TAG_COUNT + best]!) best = tag;
		}
		freeTags += best;
	}
	const fields = tagger.parse(record.raw).fields;
	const engineFields = engine.parse(record.raw).fields;
	const correct = (actual: typeof fields): number =>
		FIELD_NAMES.filter((field) => actual[field] === record.expected[field]).length;
	return {
		label: `${id.replace("sakon-messy-", "fixture ")} · ${record.caseType}`,
		raw: record.raw,
		expected: record.expected,
		anchor: anchored.tuple,
		anchorFlags: Array.from(anchored.flags, (flag) => (flag & 15).toString(16)).join(""),
		featuresPerCharacter: features[0]?.length ?? 0,
		freeTags,
		tags: decodeTags(features, compiled, boundJoins(record.raw)).join(""),
		fields,
		taggerCorrect: correct(fields),
		engineCorrect: correct(engineFields),
	};
});

const page = await Bun.file(PAGE).text();
const start = page.indexOf(START);
const end = page.indexOf(END);
if (start < 0 || end < start) throw new Error(`${PAGE} has no snapshot markers`);
const block = `${START}\n      const snapshot = ${JSON.stringify({ model: model.version, records })};\n      `;
await Bun.write(PAGE, page.slice(0, start) + block + page.slice(end));
console.log(JSON.stringify(records.map((record) => ({
	label: record.label,
	taggerCorrect: record.taggerCorrect,
	engineCorrect: record.engineCorrect,
}))));
