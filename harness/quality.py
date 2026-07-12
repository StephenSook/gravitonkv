#!/usr/bin/env python3
"""GravitonKV quality battery v1: NIAH needle recall + KLD vs the f16 baseline.

Fills the `quality` object of cells in an existing canonical results file,
in place, then re-syncs to S3. Run AFTER the throughput sweep on the same
instance and model.

  ./quality.py --config sweeps/qwen3-4b-full.yaml

- NIAH: ten codes planted at spread positions in a deterministic haystack
  sized per context (ported from the pilot). One generation per
  (config, context); score = fraction of codes recalled. The prompt is raw
  completion text (no chat template), identical across configs, so per-config
  deltas are template-independent.
- KLD: llama-perplexity --kl-divergence against an f16-KV base at c=512 over
  wiki.test.raw (16 chunks). One value per config, stored on that config's
  cells. Matches the week-1 gate methodology.

RULER-lite and full-context perplexity extend this file later.
"""

import argparse
import json
import pathlib
import re
import subprocess
import sys

import yaml

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from sweep import CONFIG_TYPES, _make_text, count_tokens, run, utc_now  # noqa: E402

CODES = [("checkpoint 1", "walnut-42"), ("checkpoint 2", "crimson-17"), ("checkpoint 3", "harbor-88"),
         ("checkpoint 4", "lantern-05"), ("checkpoint 5", "granite-63"), ("checkpoint 6", "meadow-29"),
         ("checkpoint 7", "falcon-74"), ("checkpoint 8", "copper-51"), ("checkpoint 9", "orchid-36"),
         ("checkpoint 10", "thimble-90")]

MEAN_KLD_RE = re.compile(r"Mean\s+KLD:\s*([\d.]+)")


def build_needle_prompt(tok_bin, model, context, n_answer=400):
    """Deterministic haystack with ten planted codes, sized to the context."""
    target = context - n_answer - 256  # question + answer headroom
    probe = _make_text(50)
    tps = count_tokens(tok_bin, model, probe) / 50.0
    n = max(20, int(target / tps))
    text = _make_text(n)
    t = count_tokens(tok_bin, model, text)
    n = max(20, int(n * target / max(t, 1)))
    text = _make_text(n)
    words = text.split(" ")
    chunks, prev = [], 0
    for i, (cp, code) in enumerate(CODES):
        pos = int(len(words) * (0.05 + 0.09 * i))
        chunks.append(" ".join(words[prev:pos]))
        chunks.append(f" Remember this: the secret code for {cp} is {code}. ")
        prev = pos
    chunks.append(" ".join(words[prev:]))
    haystack = "".join(chunks)
    return ("Read the following document carefully. Hidden inside it are ten secret codes, "
            "one for each checkpoint 1 through 10.\n\nDOCUMENT:\n" + haystack +
            "\n\nThe ten secret codes, in order, one per line, in the format 'checkpoint N: code':\n"
            "checkpoint 1:")


def niah_timeout(context):
    # A 32k prefill on a 3-4B model can exceed an hour on 16 vCPU. The Phi-4-mini
    # battery died here on 2026-07-09: an uncaught TimeoutExpired at 32k discarded
    # the whole run's scores.
    return 3600 if context <= 16384 else 14400


def niah_score(bin_dir, cfg, prompt_file, context, type_k, type_v):
    try:
        r = run([str(bin_dir / "llama-completion"), "-m", cfg["model"]["file"],
                 "-c", str(context), "-n", "400", "--temp", "0", "--seed", str(cfg["seed"]),
                 "-t", str(cfg["threads"]), "-ctk", type_k, "-ctv", type_v, "-fa", "on",
                 "-f", str(prompt_file), "-no-cnv", "--no-display-prompt"],
                timeout=niah_timeout(context))
    except subprocess.TimeoutExpired:
        return None, f"niah timeout after {niah_timeout(context)}s"
    if r.returncode != 0:
        return None, f"niah rc={r.returncode}: {r.stderr[-160:]}"
    text = (r.stdout + r.stderr).lower()
    found = sum(1 for _, code in CODES if code.lower() in text)
    return found / len(CODES), None


def kld_vs_f16(bin_dir, cfg, work_dir, type_k, type_v):
    wiki = pathlib.Path(cfg.get("wiki_corpus", "/home/ubuntu/data/wikitext-2-raw/wiki.test.raw"))
    base = work_dir / "kld-base-f16.dat"
    common = [str(bin_dir / "llama-perplexity"), "-m", cfg["model"]["file"], "-f", str(wiki),
              "-c", "512", "--chunks", "16", "-fa", "on", "-t", str(cfg["threads"])]
    try:
        if not base.exists():
            r = run(common + ["--kl-divergence-base", str(base)], timeout=3600)
            if r.returncode != 0 or not base.exists():
                return None, f"kld base rc={r.returncode}: {r.stderr[-160:]}"
        r = run(common + ["--kl-divergence-base", str(base), "--kl-divergence",
                          "-ctk", type_k, "-ctv", type_v], timeout=3600)
    except subprocess.TimeoutExpired:
        return None, "kld timeout after 3600s"
    m = MEAN_KLD_RE.search(r.stdout + r.stderr)
    if not m:
        return None, f"kld parse failure rc={r.returncode}"
    return float(m.group(1)), None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--skip-niah", action="store_true")
    ap.add_argument("--skip-kld", action="store_true")
    args = ap.parse_args()
    cfg = yaml.safe_load(pathlib.Path(args.config).read_text())

    bin_dir = pathlib.Path(cfg["llama_cpp_dir"]) / "build" / "bin"
    out_dir = pathlib.Path(cfg["output_dir"])
    results_path = out_dir / f"{cfg['sweep']}.json"
    doc = json.loads(results_path.read_text())
    work_dir = out_dir / "quality" / cfg["model"]["name"]
    work_dir.mkdir(parents=True, exist_ok=True)
    tok_bin = bin_dir / "llama-tokenize"

    bucket = cfg.get("s3_bucket")

    def save(key, value, config_name, ctx=None):
        # Persist after EVERY score. A crash or timeout later in the battery
        # must never discard scores already earned (Phi-4-mini, 2026-07-09).
        for c in doc["cells"]:
            if c["config"] == config_name and (ctx is None or c["context"] == ctx):
                q = dict(c.get("quality") or {})
                q[key] = value
                c["quality"] = q
        results_path.write_text(json.dumps(doc, indent=1))
        if bucket:
            try:
                run(["aws", "s3", "cp", str(results_path), f"s3://{bucket}/{cfg['sweep']}/{results_path.name}"])
            except OSError:
                pass  # host without a usable aws CLI; the local write above is the source of truth

    # KLD once per config (f16 excluded: it IS the base)
    if not args.skip_kld:
        for config_name, (tk, tv) in CONFIG_TYPES.items():
            if config_name == "f16" or not any(c["config"] == config_name for c in doc["cells"]):
                continue
            print(f"[kld] {config_name} ({utc_now()})", flush=True)
            v, err = kld_vs_f16(bin_dir, cfg, work_dir, tk, tv)
            if err:
                print(f"  {err}", flush=True)
            else:
                save("kld", v, config_name)
                print(f"  mean KLD {v:.6f}", flush=True)

    # NIAH per (config, context)
    if not args.skip_niah:
        contexts = sorted({c["context"] for c in doc["cells"]})
        for ctx in contexts:
            pf = work_dir / f"needle_{ctx}.txt"
            if not pf.exists():
                pf.write_text(build_needle_prompt(tok_bin, cfg["model"]["file"], ctx))
                print(f"[niah] built needle_{ctx}.txt (~{count_tokens(tok_bin, cfg['model']['file'], pf.read_text())} tokens)", flush=True)
            for config_name, (tk, tv) in CONFIG_TYPES.items():
                if not any(c["config"] == config_name and c["context"] == ctx for c in doc["cells"]):
                    continue
                print(f"[niah] {config_name} @ {ctx} ({utc_now()})", flush=True)
                score, err = niah_score(bin_dir, cfg, pf, ctx, tk, tv)
                if err:
                    print(f"  {err}", flush=True)
                else:
                    save("niah", score, config_name, ctx)
                    print(f"  recall {score * 100:.0f}%", flush=True)

    print(f"quality battery merged into {results_path}", flush=True)


if __name__ == "__main__":
    main()
