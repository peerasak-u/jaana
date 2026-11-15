import { expandGazetteer, createTaggerParser, type CompactGazetteer } from "../src";
import { EXAMPLES } from "../src/site/examples";
import gazetteer from "../resources/gazetteer.json";
import model from "../resources/tagger-model.json";

const parser = createTaggerParser(model as never, expandGazetteer(gazetteer as unknown as CompactGazetteer));

for (const example of EXAMPLES) {
	const start = performance.now();
	const { fields, spans } = parser.parse(example.text);
	const ms = performance.now() - start;
	console.log(`== ${example.id} (${ms.toFixed(2)} ms)`);
	for (const [field, value] of Object.entries(fields)) console.log(`  ${field}: ${value}`);
	console.log(`  spans: ${spans.map((span) => `${span.label}[${span.text}]`).join(" ")}`);
}
