#!/usr/bin/env python3
"""GravitonKV sweep harness v1.

Runs a config-file-driven KV-cache benchmark matrix with llama-bench, emits
canonical-schema JSON, and streams results to S3 after every cell.

Per cell (model x kv-config x context), N+1 repetitions run; the first is a
warmup and is discarded. Each kept rep is two fresh llama-bench processes:
one prefill test (pp{context}) and one decode-at-depth test (tg{n_gen} @ d{context}).
Peak RSS is taken per rep from the decode process (KV cache fully populated)
via os.wait4 child rusage. Statistics: median, mean, sample stdev, CV.

Rules honored here: pinned commit only, -fa on everywhere, N=5 floor,
anomalies recorded and never deleted, no hand-typed numbers downstream.
"""

import argparse
import datetime
import json
import os
import pathlib
import platform
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


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def run_bench_rusage(cmd):
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
    chunks_out, chunks_err = [], []
    with os.fdopen(read_out, "r", errors="replace") as fo, os.fdopen(read_err, "r", errors="replace") as fe:
        chunks_out = fo.read()
        chunks_err = fe.read()
    _, status, ru = os.wait4(pid, 0)
    rc = os.waitstatus_to_exitcode(status)
    peak_rss_mb = ru.ru_maxrss / 1024.0  # linux reports KiB
    return rc, chunks_out, chunks_err, peak_rss_mb


def bench_json(stdout, want):
    """Extract avg_ts for the wanted test kind from llama-bench -o json output.

    want: "pp" or "tg". Returns (tokens_per_sec, build_number) or raises.
    """
    data = json.loads(stdout)
    for entry in data:
        n_prompt = entry.get("n_prompt", 0)
        n_gen = entry.get("n_gen", 0)
        if want == "pp" and n_prompt > 0 and n_gen == 0:
            return float(entry["avg_ts"]), entry.get("build_number")
        if want == "tg" and n_gen > 0:
            return float(entry["avg_ts"]), entry.get("build_number")
    raise ValueError(f"no {want} entry in llama-bench json")


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
    if "KLEIDIAI = 1" not in system_info:
        sys.exit("FATAL: KLEIDIAI = 1 not present in system_info; refusing to benchmark")
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


def run_cell(cfg, bin_dir, config_name, context):
    type_k, type_v = CONFIG_TYPES[config_name]
    n_gen = cfg["n_gen"]
    threads = cfg["threads"]
    reps = cfg["reps"][context] if isinstance(cfg["reps"], dict) else cfg["reps"]
    reps = max(reps, 5)  # N=5 floor, non-negotiable
    model = cfg["model"]["file"]
    base = [str(bin_dir / "llama-bench"), "-m", model, "-fa", "1",
            "-ctk", type_k, "-ctv", type_v, "-t", str(threads), "-r", "1", "-o", "json"]
    pp_cmd = base + ["-p", str(context), "-n", "0"]
    tg_cmd = base + ["-p", "0", "-n", str(n_gen), "-d", str(context)]

    prefill, decode, rss, stamps, anomalies = [], [], [], [], []
    build_number = None
    total = reps + 1
    for rep in range(total):
        tag = "warmup" if rep == 0 else f"rep{rep}"
        stamp = utc_now()
        rc1, out1, err1, _ = run_bench_rusage(pp_cmd)
        rc2, out2, err2, peak = run_bench_rusage(tg_cmd)
        if rc1 != 0 or rc2 != 0:
            anomalies.append(f"{tag}: llama-bench rc pp={rc1} tg={rc2}; stderr tail: {err1[-200:]} | {err2[-200:]}")
            if rep == 0:
                # a failing warmup means the cell config itself fails; record and bail
                return None, anomalies
            continue
        try:
            pp_ts, bn = bench_json(out1, "pp")
            tg_ts, _ = bench_json(out2, "tg")
        except (ValueError, json.JSONDecodeError) as e:
            anomalies.append(f"{tag}: parse failure: {e}")
            continue
        if rep == 0:
            build_number = bn
            continue
        prefill.append(pp_ts)
        decode.append(tg_ts)
        rss.append(round(peak, 1))
        stamps.append(stamp)
        print(f"    {tag}: pp {pp_ts:.2f} t/s, tg {tg_ts:.2f} t/s, peak {peak:.0f} MiB", flush=True)

    if len(prefill) < 4:
        anomalies.append(f"only {len(prefill)} successful reps; cell below raw-array minimum")
        return None, anomalies

    cell = {
        "config": config_name,
        "type_k": type_k,
        "type_v": type_v,
        "context": context,
        "n_prompt": context,
        "n_gen": n_gen,
        "n_depth": context,
        "n_reps": reps,
        "warmup_discarded": True,
        "seed": cfg["seed"],
        "threads": threads,
        "flash_attn": True,
        "metrics": {
            "prefill_tok_s": metric_block(prefill),
            "decode_tok_s": metric_block(decode),
            "peak_memory_mb": metric_block(rss),
        },
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

    print(f"== GravitonKV sweep {cfg['sweep']}: {len(cells_plan)} cells ==", flush=True)
    doc = {
        "schema_version": "1.0.0",
        "environment": capture_environment(cfg),
        "model": model_block(cfg),
        "cells": [],
    }

    for i, (config_name, context) in enumerate(cells_plan, 1):
        print(f"[{i}/{len(cells_plan)}] {config_name} @ {context} ({utc_now()})", flush=True)
        cell, anomalies = run_cell(cfg, bin_dir, config_name, context)
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
