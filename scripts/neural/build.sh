#!/bin/bash
# Trains the BiGRU CRF tagger and writes the neural model and its ensemble with a
# linear model, then checks TypeScript parity and scores dev and test1.
# usage: scripts/neural/build.sh <python> <linear-model.json> [seed]
#   <python> is an interpreter with PyTorch and NumPy, used only here.
set -euo pipefail
PY="$1"
LINEAR="$2"
SEED="${3:-1}"
OUT=resources/experiments/neural
RUN="gru96crf-s$SEED"
bun run scripts/neural/export.ts --augment 16 --linear "$LINEAR"
"$PY" scripts/neural/train.py --name "$RUN" --arch gru --width 64 --hidden 96 --epochs 6 --seed "$SEED" --crf --linear "$LINEAR"
"$PY" scripts/neural/export_model.py --run "$RUN" --output "$OUT/$RUN.model.json" \
  --linear "$LINEAR" --weight 0.1 --ensemble-output "$OUT/ensemble-$RUN.json"
bun run scripts/neural/parity.ts "$OUT/$RUN.model.json"
bun run scripts/neural/eval.ts --model "$OUT/$RUN.model.json"
bun run scripts/neural/eval.ts --model "$OUT/ensemble-$RUN.json"
