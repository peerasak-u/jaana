/** How well the teacher's labels agree with the hand-marked dev set: the ceiling a student trained on them faces. */
import { tidyNotes, type NoteRange } from "../../src/notes/trim";
import { loadNoteSet } from "./data";
import { noteKey } from "./residue";
import { scoreNotes } from "./score";

const teacher = new Map<string, NoteRange[]>();
for (const pool of ["dev", "spent"]) {
	for (const line of (await Bun.file(`bench/notes/teacher/${pool}${Bun.argv[3] ?? ""}.jsonl`).text()).split("\n").filter(Boolean)) {
		const entry = JSON.parse(line) as { key: string; notes: NoteRange[] };
		teacher.set(entry.key, entry.notes);
	}
}
const dev = await loadNoteSet("dev");
const score = scoreNotes(dev, (example) => tidyNotes(example.raw, teacher.get(noteKey(example.raw)) ?? []));
const { failures, ...rest } = score;
console.log(JSON.stringify(rest));
const show = Number(Bun.argv[2] ?? 0);
for (const failure of failures.slice(0, show)) console.log(`--- ${failure.id}\n  gold: ${failure.gold}\n  teacher: ${failure.predicted}`);
