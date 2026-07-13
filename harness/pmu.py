#!/usr/bin/env python3
"""GravitonKV PMU pass: hardware-counter evidence for the mechanism story.

Runs llama-completion under `perf stat` for chosen (config, context) cells,
split into a prefill-heavy workload (-n 1 over a full-context fill prompt)
and a decode-heavy workload (-n 256 over the same prompt), so counter deltas
attribute to the phase that moves.

Virtualized Graviton4 (c8g/m8g) exposes ~2 programmable counters per vCPU, so
events run in fixed 2-event groups with NO multiplexing (results/week1-gates):

  cycles+instructions   -> IPC
  r23+r24               -> frontend / backend stall cycles
  l1d/l2d_cache_refill  -> cache pressure

Bandwidth events (r37/r36), SPE, and slots-based topdown are DEAD on
virtualized instances; that evidence comes from the metal session only.
Counters include process startup and model load; load cost is identical
across KV configs at a given context, so per-config deltas remain meaningful
and are labeled accordingly.

  ./pmu.py --config sweeps/qwen3-4b-full.yaml --contexts 2048,32768 \
           --kv-configs f16,q8_0,q4_0

Requires perf_event_paranoid <= 2 and runs natively, never inside Docker.
"""

import argparse
import json
import pathlib
import subprocess
import sys

import yaml

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from sweep import CONFIG_TYPES, _make_text, count_tokens, run, utc_now  # noqa: E402

EVENT_GROUPS = [
    ("cycles", "instructions"),
    ("r23", "r24"),
    ("l1d_cache_refill", "l2d_cache_refill"),
]


def build_fill_prompt(tok_bin, model, context, n_answer=300):
    target = context - n_answer
    probe = _make_text(50)
    tps = count_tokens(tok_bin, model, probe) / 50.0
    n = max(20, int(target / tps))
    text = _make_text(n)
    t = count_tokens(tok_bin, model, text)
    n = max(20, int(n * target / max(t, 1)))
    return _make_text(n)


def parse_perf_csv(stderr_text):
    """perf stat -x, writes CSV lines to stderr: value,unit,event,runtime,pct,..."""
    out = {}
    for line in stderr_text.splitlines():
        parts = line.split(",")
        if len(parts) >= 3 and parts[0].strip().replace(".", "").isdigit():
            try:
                out[parts[2].strip()] = int(float(parts[0]))
            except ValueError:
                pass
    return out


def pmu_timeout(context):
    return 1800 if context <= 16384 else 7200


def measure(bin_dir, cfg, prompt_file, context, type_k, type_v, n_gen, events):
    cmd = ["perf", "stat", "-x", ",", "-e", ",".join(events), "--",
           str(bin_dir / "llama-completion"), "-m", cfg["model"]["file"],
           "-c", str(context), "-n", str(n_gen), "--ignore-eos",
           "--temp", "0", "--seed", str(cfg["seed"]), "-t", str(cfg["threads"]),
           "-ctk", type_k, "-ctv", type_v, "-fa", "on",
           "-f", str(prompt_file), "-no-cnv", "--no-display-prompt"]
    try:
        r = run(cmd, timeout=pmu_timeout(context))
    except subprocess.TimeoutExpired:
        return None, f"pmu timeout after {pmu_timeout(context)}s"
    if r.returncode != 0:
        return None, f"pmu rc={r.returncode}: {r.stderr[-160:]}"
    counts = parse_perf_csv(r.stderr)
    missing = [e for e in events if e not in counts]
    if missing:
        return None, f"events missing from perf output: {missing}"
    return counts, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--kv-configs", default="f16,q8_0,q4_0")
    ap.add_argument("--contexts", default="2048,32768")
    args = ap.parse_args()
    cfg = yaml.safe_load(pathlib.Path(args.config).read_text())

    bin_dir = pathlib.Path(cfg["llama_cpp_dir"]) / "build" / "bin"
    out_dir = pathlib.Path(cfg["output_dir"]) / "pmu"
    out_dir.mkdir(parents=True, exist_ok=True)
    tok_bin = bin_dir / "llama-tokenize"
    results_path = out_dir / f"{cfg['sweep']}-pmu.json"
    doc = {"sweep": cfg["sweep"], "model": cfg["model"]["name"],
           "note": ("whole-process counters incl. model load; load is identical "
                    "across KV configs at a given context, deltas attribute to KV type"),
           "cells": []}
    if results_path.exists():
        doc = json.loads(results_path.read_text())

    bucket = cfg.get("s3_bucket")

    def persist():
        results_path.write_text(json.dumps(doc, indent=1))
        if bucket:
            try:
                run(["aws", "s3", "cp", str(results_path),
                     f"s3://{bucket}/{cfg['sweep']}/pmu/{results_path.name}"])
            except OSError:
                pass

    kv_configs = [c.strip() for c in args.kv_configs.split(",")]
    contexts = [int(c) for c in args.contexts.split(",")]
    workloads = {"prefill": 1, "decode": 256}

    for ctx in contexts:
        pf = out_dir / f"fill_{ctx}.txt"
        if not pf.exists():
            pf.write_text(build_fill_prompt(tok_bin, cfg["model"]["file"], ctx))
            print(f"[pmu] built fill_{ctx}.txt", flush=True)
        for config_name in kv_configs:
            tk, tv = CONFIG_TYPES[config_name]
            for wl_name, n_gen in workloads.items():
                if any(c["config"] == config_name and c["context"] == ctx
                       and c["workload"] == wl_name for c in doc["cells"]):
                    continue
                events_all, err_all = {}, []
                for group in EVENT_GROUPS:
                    print(f"[pmu] {config_name} @ {ctx} {wl_name} {group} ({utc_now()})", flush=True)
                    counts, err = measure(bin_dir, cfg, pf, ctx, tk, tv, n_gen, group)
                    if err:
                        err_all.append(err)
                        print(f"  {err}", flush=True)
                    else:
                        events_all.update(counts)
                cell = {"config": config_name, "context": ctx, "workload": wl_name,
                        "events": events_all, "errors": err_all}
                if "cycles" in events_all and "instructions" in events_all and events_all["cycles"]:
                    cell["ipc"] = round(events_all["instructions"] / events_all["cycles"], 4)
                doc["cells"].append(cell)
                persist()
                print(f"  saved ({len(events_all)} events)", flush=True)

    print(f"pmu pass merged into {results_path}", flush=True)


if __name__ == "__main__":
    main()
