"""Trains a small character tagger on the exported sequences and scores dev and
test1 through the TypeScript pipeline (scripts/neural/eval.ts).

Training-time tool only. The parser never needs Python.
"""

import argparse
import json
import math
import os
import random
import subprocess
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

TAG_COUNT = 9
FEATURE_BITS = 24
SCALE = 100
FLOOR = -3000
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def fold(character):
    if "0" <= character <= "9" or "๐" <= character <= "๙":
        return "0"
    lower = character.lower()
    return lower if len(lower) == 1 else character


def units(raw):
    """The UTF-16 units of `raw`, as the TypeScript pipeline indexes text. A surrogate half becomes one shared key."""
    data = raw.encode("utf-16-le")
    codes = [data[i] | (data[i + 1] << 8) for i in range(0, len(data), 2)]
    return ["\ufffd" if 0xD800 <= code <= 0xDFFF else fold(chr(code)) for code in codes]


def load(path, limit=None):
    records = []
    with open(path, encoding="utf-8") as handle:
        for index, line in enumerate(handle):
            if limit and index >= limit:
                break
            records.append(json.loads(line))
    return records


def build_vocab(records):
    counts = {}
    for record in records:
        for key in units(record["raw"]):
            counts[key] = counts.get(key, 0) + 1
    keys = sorted(key for key, count in counts.items() if count >= 2)
    return {key: index + 2 for index, key in enumerate(keys)}


def encode(record, vocab):
    chars = np.array([vocab.get(key, 1) for key in units(record["raw"])], dtype=np.int64)
    flags = np.array(record["flags"], dtype=np.int64)
    cues = np.array(record["cues"], dtype=np.int64)
    bits = (flags & 63) | (cues << 6)
    tags = np.array([int(t) for t in record["tags"]], dtype=np.int64)
    item = {"chars": chars, "bits": bits, "tags": tags}
    if "linear" in record:
        item["linear"] = np.array(record["linear"], dtype=np.float32).reshape(-1, TAG_COUNT)
    return item


def batches(items, size, shuffle, rng):
    order = sorted(range(len(items)), key=lambda i: len(items[i]["chars"]))
    groups = [order[i:i + size] for i in range(0, len(order), size)]
    if shuffle:
        rng.shuffle(groups)
    return groups


def collate(items, group, device, stack):
    length = max(len(items[i]["chars"]) for i in group)
    chars = np.zeros((len(group), length), dtype=np.int64)
    bits = np.zeros((len(group), length), dtype=np.int64)
    tags = np.zeros((len(group), length), dtype=np.int64)
    mask = np.zeros((len(group), length), dtype=bool)
    linear = np.zeros((len(group), length, TAG_COUNT), dtype=np.float32) if stack else None
    for row, index in enumerate(group):
        n = len(items[index]["chars"])
        chars[row, :n] = items[index]["chars"]
        bits[row, :n] = items[index]["bits"]
        tags[row, :n] = items[index]["tags"]
        mask[row, :n] = True
        if stack:
            linear[row, :n] = items[index]["linear"]
    shifts = torch.arange(FEATURE_BITS)
    features = ((torch.from_numpy(bits)[..., None] >> shifts) & 1).float()
    out = {
        "chars": torch.from_numpy(chars).to(device),
        "features": features.to(device),
        "tags": torch.from_numpy(tags).to(device),
        "mask": torch.from_numpy(mask).to(device),
    }
    if stack:
        out["linear"] = torch.from_numpy(linear).to(device)
    return out


class Tagger(nn.Module):
    def __init__(self, vocab_size, args):
        super().__init__()
        self.arch = args.arch
        self.stack = args.stack
        self.embed = nn.Embedding(vocab_size, args.emb, padding_idx=0)
        inputs = args.emb + FEATURE_BITS + (TAG_COUNT if args.stack else 0)
        width = args.width
        self.project = nn.Linear(inputs, width)
        self.dropout = nn.Dropout(args.dropout)
        self.convs = nn.ModuleList()
        if args.arch in ("cnn", "cnngru"):
            dilations = [2 ** i for i in range(args.depth)] if args.arch == "cnn" else [1] * args.depth
            for dilation in dilations:
                self.convs.append(nn.Conv1d(width, width, 3, padding=dilation, dilation=dilation))
        self.gru = None
        if args.arch in ("gru", "cnngru"):
            self.gru = nn.GRU(width, args.hidden, batch_first=True, bidirectional=True)
            width = 2 * args.hidden
        self.out = nn.Linear(width, TAG_COUNT)
        self.transitions = nn.Parameter(torch.zeros(TAG_COUNT, TAG_COUNT)) if args.crf else None

    def forward(self, batch):
        parts = [self.embed(batch["chars"]), batch["features"]]
        if self.stack:
            parts.append(batch["linear"] / 100.0)
        x = F.relu(self.project(torch.cat(parts, -1)))
        x = x * batch["mask"][..., None]
        for conv in self.convs:
            y = conv(self.dropout(x).transpose(1, 2)).transpose(1, 2)
            x = (x + F.relu(y)) * batch["mask"][..., None]
        if self.gru is not None:
            lengths = batch["mask"].sum(1).cpu()
            packed = nn.utils.rnn.pack_padded_sequence(self.dropout(x), lengths, batch_first=True, enforce_sorted=False)
            output, _ = self.gru(packed)
            x, _ = nn.utils.rnn.pad_packed_sequence(output, batch_first=True, total_length=x.shape[1])
        return self.out(self.dropout(x))


def crf_nll(emissions, tags, mask, transitions):
    batch, length, _ = emissions.shape
    first = emissions[:, 0]
    alpha = first
    gold = first.gather(1, tags[:, :1]).squeeze(1)
    for t in range(1, length):
        step = mask[:, t]
        nxt = torch.logsumexp(alpha[:, :, None] + transitions[None] + emissions[:, t, None, :], dim=1)
        alpha = torch.where(step[:, None], nxt, alpha)
        add = emissions[:, t].gather(1, tags[:, t:t + 1]).squeeze(1) + transitions[tags[:, t - 1], tags[:, t]]
        gold = gold + add * step
    return (torch.logsumexp(alpha, 1) - gold).sum() / mask.sum()


def loss_of(model, batch):
    logits = model(batch)
    if model.transitions is not None:
        return crf_nll(logits, batch["tags"], batch["mask"], model.transitions)
    return F.cross_entropy(logits[batch["mask"]], batch["tags"][batch["mask"]])


@torch.no_grad()
def emissions_of(model, items, device, stack):
    model.eval()
    result = [None] * len(items)
    for group in batches(items, 128, False, None):
        batch = collate(items, group, device, stack)
        logits = model(batch)
        if model.transitions is None:
            logits = F.log_softmax(logits, -1)
        logits = logits.float().cpu().numpy()
        for row, index in enumerate(group):
            result[index] = logits[row, : len(items[index]["chars"])]
    model.train()
    return result


def evaluate(scores, transitions, records, path):
    payload = {
        "transitions": [int(v) for v in transitions.reshape(-1)],
        "scores": {r["id"]: [int(v) for v in s.reshape(-1)] for r, s in zip(records, scores)},
    }
    with open(path, "w") as handle:
        json.dump(payload, handle)
    output = subprocess.run(
        ["bun", "run", "scripts/neural/eval.ts", "--scores", path], cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout
    return json.loads(output.strip().splitlines()[-1])


def neural_ints(emission):
    return np.maximum(np.round(emission * SCALE), FLOOR)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", required=True)
    parser.add_argument("--train", default="resources/experiments/neural/data/train-a16.jsonl")
    parser.add_argument("--bench", default="resources/experiments/neural/data/bench.jsonl")
    parser.add_argument("--linear", default="resources/experiments/neural/w4-p0.json")
    parser.add_argument("--arch", default="cnn", choices=["cnn", "gru", "cnngru"])
    parser.add_argument("--emb", type=int, default=32)
    parser.add_argument("--width", type=int, default=64)
    parser.add_argument("--hidden", type=int, default=64)
    parser.add_argument("--depth", type=int, default=6)
    parser.add_argument("--dropout", type=float, default=0.1)
    parser.add_argument("--crf", action="store_true")
    parser.add_argument("--stack", action="store_true")
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--lr", type=float, default=2e-3)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--eval-every", type=int, default=1)
    args = parser.parse_args()
    os.chdir(ROOT)
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    out_dir = os.path.join("resources/experiments/neural/runs", args.name)
    os.makedirs(out_dir, exist_ok=True)

    train_records = load(args.train, args.limit)
    bench_records = load(args.bench)
    vocab = build_vocab(train_records)
    train_items = [encode(r, vocab) for r in train_records]
    bench_items = [encode(r, vocab) for r in bench_records]
    del train_records
    if args.stack:
        flat = np.fromfile(args.train.replace(".jsonl", ".linear.i16"), dtype=np.int16).astype(np.float32)
        offset = 0
        for item in train_items:
            size = len(item["chars"]) * TAG_COUNT
            item["linear"] = flat[offset:offset + size].reshape(-1, TAG_COUNT)
            offset += size
        if offset != len(flat):
            raise SystemExit("cross-fit linear scores do not match the train export")
    model = Tagger(len(vocab) + 2, args).to(device)
    params = sum(p.numel() for p in model.parameters())
    print(json.dumps({"name": args.name, "params": params, "vocab": len(vocab) + 2, "train": len(train_items)}), flush=True)

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    rng = random.Random(args.seed)
    steps = args.epochs * math.ceil(len(train_items) / args.batch)
    scheduler = torch.optim.lr_scheduler.OneCycleLR(optimizer, max_lr=args.lr, total_steps=steps, pct_start=0.05)
    linear_model = json.load(open(args.linear))
    linear_transitions = np.array(linear_model["transitions"], dtype=np.float64).reshape(TAG_COUNT, TAG_COUNT)
    linear_scores = [item["linear"] for item in bench_items]
    log = []
    started = time.time()
    for epoch in range(args.epochs):
        total, count = 0.0, 0
        for group in batches(train_items, args.batch, True, rng):
            batch = collate(train_items, group, device, args.stack)
            loss = loss_of(model, batch)
            optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            total += loss.item()
            count += 1
        entry = {"epoch": epoch + 1, "loss": total / count, "minutes": round((time.time() - started) / 60, 1)}
        if (epoch + 1) % args.eval_every == 0 or epoch + 1 == args.epochs:
            emissions = emissions_of(model, bench_items, device, args.stack)
            crf = model.transitions.detach().cpu().numpy() if model.transitions is not None else np.zeros((TAG_COUNT, TAG_COUNT))
            neural = [neural_ints(e) for e in emissions]
            path = os.path.join(out_dir, "scores.json")
            entry["neural"] = evaluate(neural, np.round(crf * SCALE), bench_records, path)
            if epoch + 1 == args.epochs:
                for weight in (0.5, 1.0, 2.0):
                    mixed = [l + weight * n for l, n in zip(linear_scores, neural)]
                    entry[f"ensemble{weight}"] = evaluate(
                        mixed, np.round(linear_transitions + weight * crf * SCALE), bench_records, os.path.join(out_dir, f"ensemble{weight}.json")
                    )
        log.append(entry)
        print(json.dumps(entry), flush=True)
    torch.save({"state": model.state_dict(), "vocab": vocab, "args": vars(args)}, os.path.join(out_dir, "model.pt"))
    summary = {"name": args.name, "params": params, "args": vars(args), "log": log}
    with open("resources/experiments/neural/runs.jsonl", "a") as handle:
        handle.write(json.dumps(summary) + "\n")


if __name__ == "__main__":
    main()
