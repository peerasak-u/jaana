#!/bin/bash
# Trains the tagger on the synthetic datasets plus the chat training pool,
# then runs the chat benchmark on the result.
# usage: scripts/chat/retrain.sh <model-output.json> [extra train-tagger flags]
set -euo pipefail
D="${THAI_ADDRESS_DATA:-$HOME/Workspace/indie/thai-address-synth-dataset/data/generated}"
OUT="$1"
shift
bun run scripts/train-tagger.ts \
  --dataset "$D/construction-v1.jsonl" \
  --dataset "$D/name-robust-v1-2040-r1.jsonl" \
  --extra-dataset "$D/chat-v2-scale-1500-r1.jsonl" \
  --extra-dataset "$D/address-detail-robust-v1-600-r1.jsonl" \
  --chat-train --augment 16 --output "$OUT" "$@"
bun run bench/run-chat.ts --model "$OUT" --timing-rounds 1
