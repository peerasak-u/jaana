"""Quantises a trained BiGRU tagger to int8 (one scale per tensor) and writes the
model file the TypeScript forward pass reads (src/tagger/neural.ts).

It also scores dev and test1 with a NumPy forward pass over the dequantised
weights, the reference the TypeScript port must match.

usage: export_model.py --run gru96-s1 --output resources/experiments/neural/gru96-s1.model.json
"""

import argparse
import base64
import json
import os
import sys

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(__file__))
from train import FEATURE_BITS, ROOT, SCALE, FLOOR, TAG_COUNT, encode, evaluate, load  # noqa: E402

TENSORS = [
    ("embed", "embed.weight"),
    ("project", "project.weight"),
    ("forwardInput", "gru.weight_ih_l0"),
    ("forwardHidden", "gru.weight_hh_l0"),
    ("backwardInput", "gru.weight_ih_l0_reverse"),
    ("backwardHidden", "gru.weight_hh_l0_reverse"),
    ("out", "out.weight"),
]
BIASES = [
    ("projectBias", "project.bias"),
    ("forwardInputBias", "gru.bias_ih_l0"),
    ("forwardHiddenBias", "gru.bias_hh_l0"),
    ("backwardInputBias", "gru.bias_ih_l0_reverse"),
    ("backwardHiddenBias", "gru.bias_hh_l0_reverse"),
    ("outBias", "out.bias"),
]


def quantise(tensor):
    scale = float(np.abs(tensor).max()) / 127 or 1.0
    q = np.clip(np.round(tensor / scale), -127, 127).astype(np.int8)
    return q, scale


def sigmoid(x):
    return 1 / (1 + np.exp(-x))


def gru(x, w_ih, w_hh, b_ih, b_hh, reverse):
    n, hidden = x.shape[0], w_hh.shape[1]
    gates_x = x @ w_ih.T + b_ih
    h = np.zeros(hidden, dtype=np.float32)
    out = np.zeros((n, hidden), dtype=np.float32)
    for t in (range(n - 1, -1, -1) if reverse else range(n)):
        gh = w_hh @ h + b_hh
        r = sigmoid(gates_x[t, :hidden] + gh[:hidden])
        z = sigmoid(gates_x[t, hidden:2 * hidden] + gh[hidden:2 * hidden])
        c = np.tanh(gates_x[t, 2 * hidden:] + r * gh[2 * hidden:])
        h = (1 - z) * c + z * h
        out[t] = h
    return out


def forward(w, item):
    bits = item["bits"]
    features = ((bits[:, None] >> np.arange(FEATURE_BITS)) & 1).astype(np.float32)
    x = np.concatenate([w["embed"][item["chars"]], features], 1)
    x = np.maximum(x @ w["project"].T + w["projectBias"], 0)
    f = gru(x, w["forwardInput"], w["forwardHidden"], w["forwardInputBias"], w["forwardHiddenBias"], False)
    b = gru(x, w["backwardInput"], w["backwardHidden"], w["backwardInputBias"], w["backwardHiddenBias"], True)
    logits = np.concatenate([f, b], 1) @ w["out"].T + w["outBias"]
    logits = logits - logits.max(1, keepdims=True)
    return logits - np.log(np.exp(logits).sum(1, keepdims=True))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--bench", default="resources/experiments/neural/data/bench.jsonl")
    parser.add_argument("--linear", help="linear tagger model to pair the neural one with in an ensemble file")
    parser.add_argument("--weight", type=float, default=0.03, help="neural score weight in the ensemble")
    parser.add_argument("--ensemble-output")
    args = parser.parse_args()
    os.chdir(ROOT)
    saved = torch.load(os.path.join("resources/experiments/neural/runs", args.run, "model.pt"), map_location="cpu")
    if saved["args"]["arch"] != "gru" or saved["args"]["crf"] or saved["args"]["stack"]:
        raise SystemExit("only the plain BiGRU tagger exports")
    state = {k: v.numpy().astype(np.float32) for k, v in saved["state"].items()}
    vocab = saved["vocab"]
    keys = sorted(vocab, key=vocab.get)
    if [vocab[k] for k in keys] != list(range(2, len(keys) + 2)):
        raise SystemExit("vocabulary ids must run from 2")
    model = {"kind": "neural-bigru", "version": f"thai-address-bigru-{args.run}", "vocabulary": "".join(keys),
             "hidden": int(state["gru.weight_hh_l0"].shape[1]), "width": int(state["project.weight"].shape[0]),
             "embedding": int(state["embed.weight"].shape[1]), "tensors": {}, "biases": {}}
    weights = {}
    for name, key in TENSORS:
        q, scale = quantise(state[key])
        model["tensors"][name] = {"shape": list(q.shape), "scale": scale, "data": base64.b64encode(q.tobytes()).decode()}
        weights[name] = q.astype(np.float32) * np.float32(scale)
    for name, key in BIASES:
        model["biases"][name] = [round(float(v), 6) for v in state[key]]
        weights[name] = np.array(model["biases"][name], dtype=np.float32)
    text = json.dumps(model, separators=(",", ":"))
    with open(args.output, "w") as handle:
        handle.write(text + "\n")

    if args.ensemble_output:
        linear = json.load(open(args.linear))
        linear.pop("training", None)
        ensemble = {"kind": "ensemble", "version": f"{linear['version']}+{model['version']}@{args.weight}",
                    "linear": linear, "neural": model, "neuralWeight": args.weight}
        with open(args.ensemble_output, "w") as handle:
            handle.write(json.dumps(ensemble, separators=(",", ":")) + "\n")

    records = load(args.bench)
    items = [encode(r, vocab) for r in records]
    scores = [np.maximum(np.round(forward(weights, item) * SCALE), FLOOR) for item in items]
    path = args.output.replace(".json", ".reference-scores.json")
    result = evaluate(scores, np.zeros((TAG_COUNT, TAG_COUNT)), records, path)
    params = sum(int(np.prod(t["shape"])) for t in model["tensors"].values()) + sum(len(b) for b in model["biases"].values())
    import gzip
    print(json.dumps({"output": args.output, "params": params, "bytes": len(text), "gzipBytes": len(gzip.compress(text.encode())),
                      "dev": result["dev"]["exact"], "test1": result["test1"]["exact"]}))


if __name__ == "__main__":
    main()
