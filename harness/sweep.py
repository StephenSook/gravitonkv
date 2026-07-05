#!/usr/bin/env python3
"""GravitonKV sweep harness v2.

Runs a config-file-driven KV-cache benchmark matrix and emits canonical-schema
JSON, streaming results to S3 after every cell.

Measurement method (v2, pilot-proven): each repetition is ONE fresh
llama-completion process fed a deterministic fill prompt sized to the target
context. A single pass yields prefill throughput ("prompt eval time" line),
decode throughput ("eval time" line), peak RSS (child rusage via os.wait4),
and the KV buffer size log line, so the expensive deep-context prefill runs
exactly once per rep. v1 used two llama-bench processes per rep (pp test plus
tg-at-depth test), which paid every prefill twice and a model load per call:
roughly double the wall-clock for identical information. llama-bench remains
the pin-verification probe and the CI cross-check.

Rules honored here: pinned commit only, -fa on everywhere, N=5 floor, first
rep discarded as warmup, anomalies recorded never deleted, no hand-typed
numbers downstream.
"""

import argparse
import datetime
import json
import os
import pathlib
import platform
import re
import statistics
import subprocess
import sys

import yaml

PINNED_COMMIT = "2d973636e292ee6f75fadcf08d29cb33511f509f"

CONFIG_TYPES = {
    "f16": ("f16", "f16"),
    "q8_0": ("q8_0", "q8_0"),
    "q4_0": ("q4_0", "q4_0"),
    "q8_0/q4_0": ("q8_0", "q4_0"),
    "q4_0/q8_0": ("q4_0", "q8_0"),
}

PP_RE = re.compile(r"prompt eval time\s*=\s*[\d.]+\s*ms\s*/\s*(\d+)\s*tokens.*?([\d.]+)\s*tokens per second")
TG_RE = re.compile(r"\beval time\s*=\s*[\d.]+\s*ms\s*/\s*(\d+)\s*runs.*?([\d.]+)\s*tokens per second")
KVBUF_RE = re.compile(r"KV buffer size\s*=\s*([\d.]+)\s*MiB")

# --- deterministic fill-prompt generation (ported from the pilot) ---

SUBJECTS = ["The harbor authority", "A municipal survey", "The northern railway", "An archival ledger",
            "The village cooperative", "A coastal observatory", "The regional assembly", "An engineering corps",
            "The botanical society", "A cartography office"]
VERBS = ["recorded", "documented", "measured", "catalogued", "inspected", "reported", "surveyed", "audited"]
OBJECTS = ["seventeen shipments of timber", "the annual rainfall figures", "a revised boundary map",
           "the census of river traffic", "three new irrigation channels", "the inventory of grain stores",
           "a proposal for bridge repairs", "the migration of seabirds", "the yield of terraced fields",
           "a schedule of lighthouse maintenance"]
TAILS = ["before the winter session began.", "despite objections from the assembly.",
         "which was later confirmed by inspectors.", "according to the standard procedure.",
         "and filed the findings in the eastern archive.", "over a period of forty days.",
         "with assistance from neighboring districts.", "under the supervision of the registrar."]


def _sentence(i):
    return " ".join([SUBJECTS[i % 10], VERBS[(i // 10) % 8], OBJECTS[(i // 80) % 10], TAILS[(i // 800) % 8]])


def _make_text(n):
    return " ".join(_sentence(i) for i in range(n))


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def run_with_rusage(cmd):
    """Fork+exec so the exact child's rusage is measurable via os.wait4."""
    read_out, write_out = os.pipe()
    read_err, write_err = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.close(read_out)
        os.close(read_err)
        os.dup2(write_out, 1)
        os.dup2(write_err, 2)
        try:
            os.execvp(cmd[0], cmd)
        except OSError:
            os._exit(127)
    os.close(write_out)
    os.close(write_err)
    with os.fdopen(read_out, "r", errors="replace") as fo, os.fdopen(read_err, "r", errors="replace") as fe:
        out = fo.read()
        err = fe.read()
    _, status, ru = os.wait4(pid, 0)
    rc = os.waitstatus_to_exitcode(status)
    peak_rss_mb = ru.ru_maxrss / 1024.0  # linux reports KiB
    return rc, out, err, peak_rss_mb


def count_tokens(tok_bin, model, text):
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
        f.write(text)
        path = f.name
    try:
        out = run([str(tok_bin), "-m", model, "-f", path], timeout=600)
        blob = out.stdout + out.stderr
        m = re.search(r"[Tt]otal number of tokens:\s*(\d+)", blob)
        if m:
            return int(m.group(1))
        n = len(re.findall(r"^\s*\d+\s*->", blob, re.M))
        if n > 0:
            return n
    except Exception as e:
        print(f"    WARN: tokenize failed ({e}); using length estimate", flush=True)
    finally:
        os.unlink(path)
    return int(len(text) / 3.5)


def ensure_prompts(cfg, bin_dir, prompt_dir):
    """Generate fill_{ctx}.txt sized by the model tokenizer (once per model)."""
    prompt_dir.mkdir(parents=True, exist_ok=True)
    tok_bin = bin_dir / "llama-tokenize"
    model = cfg["model"]["file"]
    for ctx in cfg["contexts"]:
        out = prompt_dir / f"fill_{ctx}.txt"
        if out.exists():
            continue
        target = ctx - cfg["n_gen"] - 128  # headroom for gen + BOS/specials
        probe = _make_text(50)
        tps = count_tokens(tok_bin, model, probe) / 50.0
        n = max(10, int(target / tps))
        text = _make_text(n)
        t = count_tokens(tok_bin, model, text)
        n = max(10, int(n * target / max(t, 1)))
        text = _make_text(n)
        t = count_tokens(tok_bin, model, text)
        while t > target and n > 10:
            n = int(n * 0.97)
            text = _make_text(n)
            t = count_tokens(tok_bin, model, text)
        out.write_text(text)
        print(f"  prompt fill_{ctx}.txt: target {target} actual {t} tokens", flush=True)


def metric_block(raw):
    mean = statistics.fmean(raw)
    stdev = statistics.stdev(raw) if len(raw) > 1 else 0.0
    return {
        "raw": raw,
        "median": statistics.median(raw),
        "mean": mean,
        "stdev": stdev,
        "cv": (stdev / mean) if mean else 0.0,
    }


def imds(path):
    try:
        token = run(["curl", "-s", "-X", "PUT", "http://169.254.169.254/latest/api/token",
                     "-H", "X-aws-ec2-metadata-token-ttl-seconds: 60", "--max-time", "2"]).stdout
        return run(["curl", "-s", f"http://169.254.169.254/latest/meta-data/{path}",
                    "-H", f"X-aws-ec2-metadata-token: {token}", "--max-time", "2"]).stdout.strip()
    except Exception:
        return "unknown"


def capture_environment(cfg):
    bin_dir = pathlib.Path(cfg["llama_cpp_dir"]) / "build" / "bin"
    # -c 512 is load-bearing: without it llama-completion defaults to the
    # model's native context (262k for Qwen3-4B) and the KV allocation OOMs.
    probe = run([str(bin_dir / "llama-completion"), "-m", cfg["model"]["file"],
                 "-p", "hi", "-n", "1", "-fa", "on", "-c", "512", "-t", str(cfg["threads"])])
    system_info = ""
    for line in (probe.stderr + probe.stdout).splitlines():
        if "system_info:" in line:
            system_info = line.split("system_info:", 1)[1].strip()
            break
    if "KLEIDIAI = 1" not in system_info:
        sys.exit("FATAL: KLEIDIAI = 1 not present in system_info; refusing to benchmark")
    # Verify the pin from the binary itself: llama-bench -o json reports
    # build_commit. A git checkout is not guaranteed to exist (CI restores
    # cached binaries without .git), and a parent repo's HEAD must never
    # masquerade as the llama.cpp commit.
    bench_probe = run([str(bin_dir / "llama-bench"), "-m", cfg["model"]["file"],
                       "-p", "8", "-n", "0", "-r", "1", "-t", "2", "-fa", "1", "-o", "json"])
    build_hash = ""
    try:
        build_hash = json.loads(bench_probe.stdout)[0].get("build_commit", "")
    except (json.JSONDecodeError, IndexError):
        pass
    if not build_hash or not PINNED_COMMIT.startswith(build_hash):
        git_head = run(["git", "-C", cfg["llama_cpp_dir"], "rev-parse", "HEAD"]).stdout.strip()
        if git_head != PINNED_COMMIT:
            sys.exit(f"FATAL: cannot verify pinned commit (build_commit {build_hash!r}, git {git_head!r}); "
                     f"expected {PINNED_COMMIT}")
    cpu_model = ""
    for line in run(["lscpu"]).stdout.splitlines():
        if line.startswith("Model name:"):
            cpu_model = line.split(":", 1)[1].strip()
    os_name = ""
    for line in pathlib.Path("/etc/os-release").read_text().splitlines():
        if line.startswith("PRETTY_NAME="):
            os_name = line.split("=", 1)[1].strip('"')
    gcc = run(["gcc", "--version"]).stdout.splitlines()[0]
    mem_kb = 0
    for line in pathlib.Path("/proc/meminfo").read_text().splitlines():
        if line.startswith("MemTotal:"):
            mem_kb = int(line.split()[1])
    return {
        "instance_type": os.environ.get("GKV_INSTANCE_TYPE") or imds("instance-type") or "unknown",
        "cpu_model": f"{cpu_model} (Graviton4)" if "Neoverse-V2" in cpu_model else cpu_model,
        "arch": platform.machine(),
        "vcpus": os.cpu_count(),
        "ram_gb": round(mem_kb / 1048576, 1),
        "kernel": platform.release(),
        "os": os_name,
        "llama_cpp_commit": PINNED_COMMIT,
        "build_flags": "-DCMAKE_BUILD_TYPE=Release -DGGML_CPU_KLEIDIAI=ON",
        "system_info": system_info,
        "backends": "CPU",
        "compiler": "gcc",
        "compiler_version": gcc.split()[-1],
        "captured_at": utc_now(),
    }


def model_block(cfg):
    m = cfg["model"]
    sha = ""
    sums = pathlib.Path(m["file"]).parent / "SHA256SUMS"
    base = pathlib.Path(m["file"]).name
    if sums.exists():
        for line in sums.read_text().splitlines():
            if line.strip().endswith(base):
                sha = line.split()[0]
    if not sha:
        sha = run(["sha256sum", m["file"]]).stdout.split()[0]
    return {
        "name": m["name"],
        "hf_repo": m["hf_repo"],
        "quant": m["quant"],
        "sha256": sha,
        "model_size_bytes": pathlib.Path(m["file"]).stat().st_size,
    }


def run_cell(cfg, bin_dir, prompt_dir, config_name, context):
    type_k, type_v = CONFIG_TYPES[config_name]
    n_gen = cfg["n_gen"]
    threads = cfg["threads"]
    reps = cfg["reps"][context] if isinstance(cfg["reps"], dict) else cfg["reps"]
    reps = max(reps, 5)  # N=5 floor, non-negotiable
    cmd = [str(bin_dir / "llama-completion"), "-m", cfg["model"]["file"],
           "-c", str(context), "-n", str(n_gen), "--ignore-eos",
           "--temp", "0", "--seed", str(cfg["seed"]), "-t", str(threads),
           "-ctk", type_k, "-ctv", type_v, "-fa", "on",
           "-f", str(prompt_dir / f"fill_{context}.txt"),
           "-no-cnv", "--no-display-prompt"]

    prefill, decode, rss, kvbuf, stamps, anomalies = [], [], [], [], [], []
    n_prompt = 0
    total = reps + 1
    for rep in range(total):
        tag = "warmup" if rep == 0 else f"rep{rep}"
        stamp = utc_now()
        rc, out, err, peak = run_with_rusage(cmd)
        blob = out + err
        if rc != 0:
            anomalies.append(f"{tag}: llama-completion rc={rc}; stderr tail: {err[-200:]}")
            if rep == 0:
                return None, anomalies
            continue
        pp = PP_RE.search(blob)
        tg = TG_RE.search(blob)
        if not pp or not tg:
            anomalies.append(f"{tag}: perf lines not found (pp={bool(pp)} tg={bool(tg)})")
            continue
        if rep == 0:
            continue
        n_prompt = int(pp.group(1))
        prefill.append(float(pp.group(2)))
        decode.append(float(tg.group(2)))
        rss.append(round(peak, 1))
        kv = [float(x) for x in KVBUF_RE.findall(blob)]
        if kv:
            kvbuf.append(round(sum(kv), 1))
        stamps.append(stamp)
        print(f"    {tag}: pp {prefill[-1]:.2f} t/s, tg {decode[-1]:.2f} t/s, "
              f"peak {peak:.0f} MiB" + (f", kv {kvbuf[-1]:.0f} MiB" if kv else ""), flush=True)

    if len(prefill) < 4:
        anomalies.append(f"only {len(prefill)} successful reps; cell below raw-array minimum")
        return None, anomalies

    metrics = {
        "prefill_tok_s": metric_block(prefill),
        "decode_tok_s": metric_block(decode),
        "peak_memory_mb": metric_block(rss),
    }
    if len(kvbuf) == len(rss):
        metrics["kv_buffer_mb"] = metric_block(kvbuf)
    elif kvbuf:
        anomalies.append(f"kv buffer parsed on only {len(kvbuf)}/{len(rss)} reps; omitted from metrics")

    cell = {
        "config": config_name,
        "type_k": type_k,
        "type_v": type_v,
        "context": context,
        "n_prompt": n_prompt,
        "n_gen": n_gen,
        "n_reps": reps,
        "warmup_discarded": True,
        "seed": cfg["seed"],
        "threads": threads,
        "flash_attn": True,
        "metrics": metrics,
        "quality": None,
        "pmu": None,
        "anomalies": anomalies,
        "raw_run_timestamps": stamps,
    }
    return cell, anomalies


def s3_sync(cfg, path):
    bucket = cfg.get("s3_bucket")
    if not bucket:
        return
    dest = f"s3://{bucket}/{cfg['sweep']}/{path.name}"
    r = run(["aws", "s3", "cp", str(path), dest])
    if r.returncode != 0:
        print(f"    WARN: s3 sync failed: {r.stderr.strip()[:200]}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--dry-run", action="store_true", help="print the cell plan and exit")
    args = ap.parse_args()
    cfg = yaml.safe_load(pathlib.Path(args.config).read_text())

    cells_plan = [(c, ctx) for c in cfg["configs"] for ctx in cfg["contexts"]]
    if args.dry_run:
        for c, ctx in cells_plan:
            print(f"{cfg['model']['name']} {c} @ {ctx}")
        return

    bin_dir = pathlib.Path(cfg["llama_cpp_dir"]) / "build" / "bin"
    out_dir = pathlib.Path(cfg["output_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{cfg['sweep']}.json"
    prompt_dir = out_dir / "prompts" / cfg["model"]["name"]

    print(f"== GravitonKV sweep {cfg['sweep']}: {len(cells_plan)} cells ==", flush=True)
    doc = {
        "schema_version": "1.0.0",
        "environment": capture_environment(cfg),
        "model": model_block(cfg),
        "cells": [],
    }
    ensure_prompts(cfg, bin_dir, prompt_dir)

    for i, (config_name, context) in enumerate(cells_plan, 1):
        print(f"[{i}/{len(cells_plan)}] {config_name} @ {context} ({utc_now()})", flush=True)
        cell, anomalies = run_cell(cfg, bin_dir, prompt_dir, config_name, context)
        if cell is None:
            print(f"    CELL FAILED (recorded): {anomalies}", flush=True)
            doc.setdefault("failed_cells", []).append(
                {"config": config_name, "context": context, "anomalies": anomalies})
        else:
            doc["cells"].append(cell)
        out_path.write_text(json.dumps(doc, indent=1))
        s3_sync(cfg, out_path)

    print(f"== sweep complete: {len(doc['cells'])} cells ok, "
          f"{len(doc.get('failed_cells', []))} failed ==", flush=True)
    if cfg.get("shutdown_on_complete"):
        s3_sync(cfg, out_path)
        subprocess.run(["sudo", "shutdown", "-h", "now"])


if __name__ == "__main__":
    main()
