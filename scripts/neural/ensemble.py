"""Scores a weighted sum of linear and neural emissions through scripts/neural/eval.ts.

usage: ensemble.py --linear-weight 1 --runs a,b --weight 0.5 [--weight 0.25 ...]
Each run's saved scores.json is summed with the same weight, divided by the run count.
"""

import argparse
import json
import os
import subprocess

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RUNS = "resources/experiments/neural/runs"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", required=True)
    parser.add_argument("--weight", type=float, action="append", required=True)
    parser.add_argument("--linear-weight", type=float, default=1.0)
    parser.add_argument("--linear", default="resources/experiments/neural/linear-scores.json")
    args = parser.parse_args()
    os.chdir(ROOT)
    linear = json.load(open(args.linear))
    runs = [json.load(open(os.path.join(RUNS, name, "scores.json"))) for name in args.runs.split(",")]
    ids = list(linear["scores"])
    for weight in args.weight:
        share = weight / len(runs)
        scores = {}
        for key in ids:
            total = args.linear_weight * np.array(linear["scores"][key], dtype=np.float64)
            for run in runs:
                total += share * np.array(run["scores"][key], dtype=np.float64)
            scores[key] = [int(v) for v in np.round(total)]
        transitions = args.linear_weight * np.array(linear["transitions"], dtype=np.float64)
        for run in runs:
            transitions += share * np.array(run["transitions"], dtype=np.float64)
        path = os.path.join(RUNS, "ensemble-tmp.json")
        json.dump({"transitions": [int(v) for v in np.round(transitions)], "scores": scores}, open(path, "w"))
        out = subprocess.run(["bun", "run", "scripts/neural/eval.ts", "--scores", path], check=True, capture_output=True, text=True).stdout
        result = json.loads(out.strip().splitlines()[-1])
        print(json.dumps({"runs": args.runs, "linear": args.linear_weight, "weight": weight,
                          "dev": result["dev"]["exact"], "test1": result["test1"]["exact"],
                          "test1_name": result["test1"]["fields"]["name"], "test1_address": result["test1"]["fields"]["address"]}), flush=True)


if __name__ == "__main__":
    main()
