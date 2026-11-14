import { normalizeCandidate } from "../normalize";
import type { Candidate } from "../types";
import type { CandidateSeedStore } from "./seed-store";
import type { ParseContext } from "./context";

export function scoreCandidates(
	context: ParseContext,
	store: CandidateSeedStore,
): readonly Candidate[] {
	const raw = context.raw;
	return store.values().map((seed) => {
		const text = raw.slice(seed.start, seed.end);
		return {
			label: seed.label,
			text,
			canonical:
				seed.canonical ?? normalizeCandidate(seed.label, text) ?? text,
			start: seed.start,
			end: seed.end,
			evidenceScore: seed.evidence,
			score: seed.evidence,
			source: seed.source,
			locationIds: store.locationIds(seed),
			evidence: seed.evidenceTrace ?? [],
		};
	});
}
