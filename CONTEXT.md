# Domain context

## Parser language

- **Parse context** — immutable facts scanned once from one raw message: phone and postcode ranges, field markers, separators, administrative prefixes, address hints, and the strongest province hint.
- **Candidate seed** — an unscored proposed output span with deterministic evidence and optional canonical location tuple IDs.
- **Candidate** — a scored proposal for one public output label. A candidate retains its source and the evidence-rule contributions that produced its evidence score.
- **Candidate source** — internal parser logic that proposes one class of seeds, such as structured values, location mentions, recipient text, or free-text segments.
- **Evidence rule** — a typed predicate with an explicit ID, priority, target label, and bounded score effect. Rules do not select final fields.
- **Location mention** — a surface occurrence resolved against one or more authoritative location tuples.
- **Recipient segment** — a free-text segment that may be proposed as `NAME`.
- **Address-detail segment** — delivery-location text before administrative location fields; it includes house, building, village, floor, room, alley, and road text.
- **Selection score** — the evidence score of a Candidate Engine candidate. It is used for ranking and is not a calibrated probability.
- **Pruner** — beam search that selects at most one non-overlapping candidate per output label while rewarding location coherence and common ordering.
- **Validator** — deterministic final referee for offsets, normalization, minimum score, and complete administrative tuple consistency. It never invents candidates.
- **Delivery note** — text the courier needs that is not one of the seven fields: drop-off, timing and contact, how to find the place, COD and courier choice. Marked `R` in GUIDE v3. A landmark inside the address run is address detail; the same landmark written as its own sentence is a note.
- **Note reader** — a frozen linear model that runs after the Tagger, over the message and the Tagger's field spans, and labels units outside every field span as note or not. It never changes a field.
- **Gazetteer** — the authoritative location tuples in compact columnar form. Both parsers expand it once at construction.
- **Tagger** — a frozen linear model over hashed character features that assigns one tag per UTF-16 unit. It is not a language model.
- **Tag** — one of the seven output labels or `OTHER`, assigned to a single character.
- **Single-run decoding** — the Tagger's Viterbi search, in which every tag except `OTHER` and `ADDRESS_DETAIL` may form at most one contiguous run.
- **Anchor** — the one location tuple whose names co-occur exactly in a message, found without the Tagger. A text mention counts for one field only.
- **Tuple resolver** — the fallback that maps tagged administrative spans to a tuple by summed name similarity when no Anchor exists.
- **Dataset family** — records produced for one construction objective, such as general construction or name robustness. Benchmark reports keep family results separate.
- **Selection gold** — an output label plus source offsets. Its canonical value is the surface-normalized source span, so the Candidate Engine is judged only on text it can select.
- **Normalization gold** — an optional desired rewrite such as typo correction or abbreviation expansion. It is a separate task from candidate selection.
- **Evaluation plan** — a train/development/evaluation/excluded partition that holds out both complete location tuples and generator-declared evaluation template families.

## Invariants

1. Source offsets are UTF-16 offsets and must reproduce the candidate text exactly.
2. The public output schema remains NAME, PHONE, ADDRESS_DETAIL, SUBDISTRICT, DISTRICT, PROVINCE, and POSTCODE. Delivery notes are an optional extra output from the Note reader and are not a Tag.
3. Bare `เมือง` is not a district unless province-compatible administrative or sequence context resolves it.
4. Complete location tuples never cross train, development, and evaluation; generator-declared template families stay on their declared side.
5. Extra training datasets never contribute a record that shares a location tuple or template family with development or evaluation.
6. Changing a Tagger feature key changes the meaning of trained weights, so the model is retrained in the same change.
7. Public fixtures and reports contain only synthetic, consented, or de-identified records. Private-list reports are aggregate-only.
