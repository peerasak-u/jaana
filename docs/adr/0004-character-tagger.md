# ADR-0004: Replace the sparse residual ranker with a character tagger

- Status: Accepted
- Date: 2026-11-14

## Context

The sparse residual ranker (ADR-0003) corrected the Candidate Engine's score
for `NAME` only. On the 259-record evaluation partition it added 6 exact
records over evidence-only (167 against 161), and its recorded private-list
result equalled evidence-only. Its artifact was 1.17 MB, most of it gazetteer
tuples as verbose JSON, plus split ids and promotion reports that the browser
never used. A build script, a promotion gate, three fitting modes, and two
legacy scoring configurations existed to produce and protect that one vector.

A ranker can only reorder spans the rules propose. Most remaining errors were
`NAME` and `ADDRESS_DETAIL` boundaries, which is a segmentation problem.

## Decision

Remove the ranker and everything that existed only for it. The Candidate
Engine stays, evidence-only, with outputs unchanged on 4,961 recorded inputs.

Add a character Tagger as the learned model:

- An averaged structured perceptron over hashed character features, quantized
  to int8. Training runs in Bun in about four seconds.
- An Anchor step finds the location tuple from exact gazetteer co-occurrence
  before tagging, and its flags are features.
- Single-run decoding keeps each field to one span, except `ADDRESS_DETAIL`.
- Administrative values come from the Anchor tuple, or from the tuple resolver
  when no Anchor exists.

A tiny convolutional tagger was prototyped against the same split and decoder.
With 44,936 parameters it scored 207 of 259 on evaluation and 14 of 20 on the
messy fixture in one run. The linear model's five-seed range is 199 to 205 and
12 to 15, so the two are level. The convolutional model would be about 45 KB
as int8, smaller than the linear model's 75 KB gzip. It trained in about 280
seconds with PyTorch, against 4 seconds in Bun. The linear model was chosen
because it trains and tests inside this repo with no second toolchain. The
convolutional model is the option to revisit if transfer size becomes the
constraint.

## Consequences

- Evaluation exact records rise from 161 to 205 of 259. Development rises from
  292 to 352 of 401.
- The messy fixture drops from 17 to 15 of 20 against the Candidate Engine,
  which was developed on that fixture.
- The private acceptance list has not been run against the Tagger. The
  Candidate Engine remains until that run decides whether it can be deleted.
- Accuracy is limited by synthetic data coverage. Two model families agreeing
  at the same score is the evidence. More varied training data is the next
  gain, not a larger model.
