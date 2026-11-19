# ADR-0005: A delivery-note reader after the tagger

- Status: Proposed
- Date: 2026-11-19

## Context

Shoppers write instructions for the courier into the same chat message as
the address: `ฝากป้อมยาม`, `โทรก่อนส่ง`, `เก็บเงินปลายทาง`, `บ้านอยู่ตรงข้ามร้านของชำ
รั้วสีเขียว`. The parser kept none of it. Text outside the seven fields was
`OTHER`, so a landmark written as its own sentence was lost with the
greetings.

The issue #6 plan proposed a `NOTE` tag inside the tagger, and the round cut
it. A new tag changes the tag count, so both the linear model and the
BiGRU-CRF must be retrained (about an hour with PyTorch), the seven-field
holdout numbers move, and every existing record must be relabelled first.

The same words can be address detail or a note. `ตรงข้ามร้านของชำ` between the
house number and the subdistrict locates the house. Written after the
phone as `บ้านอยู่ตรงข้ามร้านของชำ`, it is directions for the courier.

## Decision

Add a second, separate model that runs after the tagger.

- **Contract.** GUIDE v3 adds the `R` mark. A note is text the courier needs
  that is not one of the seven fields: drop-off, timing and contact, how to
  find the place, COD and courier choice. Position decides landmark against
  note: a landmark inside the address run is `A`, as before; a landmark
  written as a sentence of its own is `R`.
- **Model.** An averaged structured perceptron over hashed character
  features, one int8 weight per bucket, and a two-state Viterbi pass. Its
  input is the message plus the tagger's field spans. Units inside a field
  span can never be a note, so the seven fields come out exactly as before.
  Field text reads as a placeholder (`<a>`, `<p>`), so the features see the
  layout around the fields.
- **Rules around it.** Runs never open or close inside a Thai character
  cluster. Each run grows to the whitespace around it, then splits at
  particles (`ค่ะ`, `นะคะ`, `ได้เลย`), including particles glued between two
  clauses, and drops them. The same tidying runs on the gold, so the model
  learns one boundary convention.
- **Labels.** Two hand-written sets carry `R` marks: 209 new train records
  (`notes.w7a`, `notes.w7b`, half of `w7b` landmark-or-note pairs) and the
  730 spent and dev records, marked by separate annotators. The 9,900 older
  train records were labelled by Claude Haiku 5.5 ($1.10). Haiku agreed with
  the annotators at character F1 0.84, Sonnet 5.5 at 0.91 with precision
  0.98, so Sonnet relabelled the 1,847 records where Haiku or the first
  student saw a note ($3.10). The student trains on both teachers' labels
  where both exist, so a span they disagree on counts half.
- **API.** `createTaggerParser(model, locations, { notes })` adds `notes`
  (pieces joined by one space) and `noteSpans`. Without the option the
  result is unchanged.

## Consequences

Measured on 2026-11-19, `resources/notes-model.json` (55 KB gzip):

| Set | Reader char F1 | Exact notes | Cue-word rules F1 | Rules exact |
|---|---:|---:|---:|---:|
| Dev, spent v3 + dev r4 (730, 115 with notes) | 0.869 | 697 | 0.532 | 643 |
| Sealed holdout v5 `notes` (120, 92 with notes), read once | 0.939 | 95 | 0.709 | 58 |

- The reader adds about 0.4 ms per message.
- Dev decided every choice: features, the teacher mix, the dimension. v5
  was read once against a bar written to `.audit/notes-v5.tsv` first.
- v5 scores above dev because dev is the hard issue #6 categories
  (several deliveries with routing such as `วันธรรมดาส่งออฟฟิศ`), and v5 was
  written by the same kind of writer agent, to the same GUIDE text, as the
  `notes.w7*` train files. Real chat will score lower.
- Routing notes in multi-delivery messages are the main miss. Notes belong
  to the message, not to a recipient.
- The tagger was not retrained. Its seven-field exact count on v5 is
  110/120. The new train files will join its next retrain.
