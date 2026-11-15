# th-address-latent

Thai address extraction that runs anywhere JavaScript runs. The library takes
one raw message and returns name, phone, address detail, subdistrict, district,
province, and postcode. It has no runtime dependencies and reads no files.

Two parsers share one gazetteer:

- **Tagger.** Two small character-level models scored together: a linear
  model with 65,536 hashed feature buckets and int8 weights, and a BiGRU-CRF
  with 104K int8 parameters. Their scores are summed, a constrained Viterbi
  pass labels every character, then a deterministic resolver maps the
  administrative spans to one gazetteer tuple. This is the learned model.
- **Candidate Engine.** Hand-written evidence rules, a pruner, and a validator.
  It is the rule-based baseline and still wins on the hand-written messy
  fixture.

## Use

```ts
import { createTaggerParser, expandGazetteer } from "./src";
import gazetteer from "./resources/gazetteer.json";
import model from "./resources/tagger-model.json";

const parser = createTaggerParser(model, expandGazetteer(gazetteer));
const { fields, spans } = parser.parse(
  "คุณสมชาย ใจดี\nโทร 089-123-4567\n99/1 หมู่ 2 ถ.นิตโย ต.ธาตุเชิงชุม อ.เมือง จ.สกลนคร 47000",
);
```

`createAddressParser({ version, locations })` builds the Candidate Engine from
the same expanded gazetteer. Pass `{ diagnostics: "full" }` to it for candidate
evidence, pruning outcomes, and abstention reasons. Full diagnostics may
contain input text, so do not log them for private data.

## What ships

| File | Raw | Gzip |
|---|---:|---:|
| `resources/tagger-model.json` (linear + neural) | 742 KB | 168 KB |
| `resources/gazetteer.json` (7,431 tuples) | 345 KB | 59 KB |
| `dist/index.js` (both parsers) | 107 KB | 27 KB |

The model file is an ensemble: the linear half holds an Int8Array and a
transition table, the neural half holds int8 tensors with one scale each.
Inference is integer addition over hashed features per character (character
n-grams, line classes, cue words, whitespace tokens, Anchor flags), plus one
BiGRU forward pass in plain typed-array arithmetic (`src/tagger/neural.ts`),
followed by a Viterbi pass that keeps run edges where the gold rules allow
them. It needs `atob`, typed arrays, and nothing else. `createTaggerParser`
also accepts the linear half alone (64 KB gzip, about 2 ms p95) when size
matters more than the last few points of accuracy.

## Chat benchmark

`bench/chat/` holds chat-style shipping messages in 14 categories, written
and reviewed by separate agents under `bench/chat/GUIDE.md`. A record counts
only when all seven fields match exactly.

Measured on 2026-11-15, one machine, shipped model:

| Set | Tagger | Candidate Engine |
|---|---:|---:|
| Sealed holdout, exact records (860) | 823 (95.7%) | 72 (8.4%) |
| Parse time, median / p95 | 8.4 ms / 14.6 ms | 3.4 ms / 6.5 ms |

Holdout fields correct out of 860: name 839, phone 859, address 843,
subdistrict 854, district 853, province 854, zipcode 860.

Read it with these limits in mind:

- Every message is synthetic: written by language-model agents to imitate
  real shopper chat, then reviewed. No real customer message is in it.
- The holdout messages were never trained on and their failures were never
  inspected, but its total, with per-category and per-field counts, was
  read about twenty times while choosing between builds, so 95.7% is mildly
  optimistic. An independent audit put the unbiased figure near 94.5 to
  95.5%, with about 1.4 points of sampling error on 860 records. A second neural seed on the same linear model scored 820.
  Seven earlier builds without the fifth data wave scored 810 to 816.
- The first bench batch (1,588 records, the old dev and test1 splits) is
  folded into the shipped model's training, so its numbers no longer measure
  anything.
- Reviewers flagged about twenty holdout records that the guide does not
  settle. The linear half alone scores 808.

Rebuild the shipped model (needs Python with PyTorch only for training):

```bash
CHAT_BENCH_FOLD=all bash scripts/chat/retrain.sh resources/experiments/final-p2.json
CHAT_BENCH_FOLD=all bash scripts/neural/build.sh <python> resources/experiments/final-p2.json 31
cp resources/experiments/neural/ensemble-gru96crf-s31.json resources/tagger-model.json
bun run bench/run-chat.ts
```

## Commands

```bash
bun install
bun test
bun run typecheck
bun run build
```

Train the tagger. Base datasets are split into train, development, and
evaluation. Extra datasets are train-only, and the loader drops every extra
record that shares a location tuple or template family with a held-out record:

```bash
D=~/Workspace/indie/thai-address-synth-dataset/data/generated
bun run train:tagger \
  --dataset $D/construction-v1.jsonl \
  --dataset $D/name-robust-v1-2040-r1.jsonl \
  --extra-dataset $D/chat-v2-scale-1500-r1.jsonl \
  --extra-dataset $D/address-detail-robust-v1-600-r1.jsonl
```

Training takes about six seconds and is deterministic for a given `--seed`.
`--dimension` and `--epochs` change the model size and the number of passes.
`--margin` (default 200) is the training bonus on wrong tags; 0 is the plain
perceptron. `--prune` (default 2) holds weights the first run left below that
many int8 steps at zero and trains a second run around them, which cuts the
gzipped model from about 145 KB to about 61 KB for about two dev records;
`--prune 0` trains once. `scripts/chat/retrain.sh <model.json>` trains with
the chat pool and runs the chat benchmark.

Compare the tagger with the Candidate Engine on the held-out split and the
messy fixture:

```bash
bun run bench:tagger \
  --dataset $D/construction-v1.jsonl \
  --dataset $D/name-robust-v1-2040-r1.jsonl
```

Other benchmarks:

```bash
bun run bench --dataset ... --legacy ~/Workspace/indie/thai-address-splitter
bun run bench:fixture
bun run bench:list --input bench/private/list.txt --min-exact-accuracy 0.95
bun run build:gazetteer
bun run explainer:snapshot
```

`explainer:snapshot` re-records the walkthrough data in `explainer.html` from
the shipped model, so run it after retraining.

`bench:list` writes aggregate-only results for a private recipient list and
exits non-zero below the threshold. `bench/private/` is gitignored.

## Synthetic benchmark verdict (earlier model)

Measured on 2026-11-14 with the earlier linear-only model, one run per
system. These numbers were not re-measured for the shipped ensemble.

| Set | Tagger | Candidate Engine |
|---|---:|---:|
| Development, exact records (401) | 352 (87.8%) | 292 (72.8%) |
| Evaluation, exact records (259) | 205 (79.2%) | 161 (62.2%) |
| Messy fixture, exact records (20) | 15 | 17 |
| Evaluation p95 per parse | 6.2 ms | 6.1 ms |

Evaluation fields correct out of 259:

| Field | Tagger | Candidate Engine |
|---|---:|---:|
| name | 247 | 216 |
| phone | 241 | 223 |
| address | 219 | 190 |
| subdistrict | 246 | 253 |
| district | 253 | 253 |
| province | 258 | 253 |
| zipcode | 258 | 247 |

Read these numbers with three limits in mind:

- Every training and evaluation record is synthetic. The tagger learned the
  generator's styles, and it makes boundary mistakes on layouts the generator
  never produced, such as a `ส่งที่` lead-in before the name.
- The Candidate Engine was developed against the messy fixture. The tagger
  never saw it. The fixture has 20 records, so one record is five points.
- The 58-record private acceptance list has not been run against the tagger.
  The engine's recorded result on it is 56 exact.

Retraining with a different shuffle seed moves the result by a few records.
The shipped model is the `--seed 20260720` run, which sits at the top of its
range. Five seeds per size, exact records as mean and range:

| `--dimension` | Model gzip | Development (401) | Evaluation (259) | Messy fixture (20) |
|---:|---:|---:|---:|---:|
| 8,192 | 34 KB | 336.2 (334-342) | 196.4 (195-200) | 12.6 (11-14) |
| 16,384 | 52 KB | 345.6 (344-347) | 197.0 (194-202) | 14.4 (13-16) |
| 32,768 (shipped) | 73 KB | 349.4 (346-352) | 202.6 (199-205) | 13.6 (12-15) |
| 65,536 | 91 KB | 349.6 (347-354) | 199.4 (190-206) | 13.8 (12-15) |

Differences inside these ranges are noise. Fourteen epochs instead of eight
changed nothing measurable.

## Evaluation policy

The loader preserves generator-declared train and evaluation provenance and the
template family. `splitForTraining` partitions the base datasets with seed
`20260720`. A complete location tuple never crosses partitions. Evaluation
template families are admitted only to evaluation.

Selection gold for `NAME` and `ADDRESS_DETAIL` is the annotated source span
after whitespace normalization. Dataset expectations that expand abbreviations
or correct typos are normalization tasks and do not count as selection
failures.

Gazetteer provenance and redistribution rights must be resolved before
publishing the generated browser resources.

See `CONTEXT.md` for the domain language and `docs/adr/` for decisions.
