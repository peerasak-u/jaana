/**
 * Picks the train records worth a second, stronger teacher: those where the
 * first teacher or the current student sees a note. Haiku misses few notes
 * but invents many, so its errors sit almost all inside this set.
 * usage: bun run scripts/notes/relabel-ids.ts <student-model.json> <output.json>
 */
import { createNoteReader, type NoteModel } from "../../src/notes/model";
import { loadNoteSet } from "../../bench/notes/data";

const [modelPath, output] = Bun.argv.slice(2);
if (!modelPath || !output) throw new Error("usage: relabel-ids.ts <student-model.json> <output.json>");
const reader = createNoteReader((await Bun.file(modelPath).json()) as NoteModel);
const train = await loadNoteSet("train");
const ids = train
	.filter((example) => !example.id.includes("-notes."))
	.filter((example) => example.gold.length > 0 || reader.read(example.raw, example.spans).length > 0)
	.map((example) => example.id);
await Bun.write(output, JSON.stringify(ids));
console.log(`${ids.length} of ${train.length} train records`);
