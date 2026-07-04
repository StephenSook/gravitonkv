#!/usr/bin/env python3
"""Parse sweep timing logs -> results.csv + median summary + kill-threshold readout.
Usage: parse_run.py <workdir>
"""
import sys, os, re, glob, csv, statistics

WORK = sys.argv[1]
rows = []
for log in sorted(glob.glob(os.path.join(WORK, "logs", "timing_*.log"))):
    name = os.path.basename(log)
    m = re.match(r"timing_(\w+)_(\d+)_(\d+)\.log", name)
    if not m:
        continue
    kv, ctx, run = m.group(1), int(m.group(2)), int(m.group(3))
    txt = open(log, errors="replace").read()
    done = os.path.join(WORK, "logs", name + ".done")
    exit_code = open(done).read().strip() if os.path.exists(done) else "?"

    pp = re.search(r"prompt eval time\s*=\s*[\d.]+\s*ms\s*/\s*(\d+)\s*tokens.*?([\d.]+)\s*tokens per second", txt)
    tg = re.search(r"\beval time\s*=\s*[\d.]+\s*ms\s*/\s*(\d+)\s*runs.*?([\d.]+)\s*tokens per second", txt)
    rss = re.search(r"Maximum resident set size \(kbytes\):\s*(\d+)", txt)
    kvbuf = [float(x) for x in re.findall(r"KV buffer size\s*=\s*([\d.]+)\s*MiB", txt)]

    rows.append({
        "kv_type": kv, "ctx": ctx, "run": run, "exit": exit_code,
        "prompt_tokens": int(pp.group(1)) if pp else None,
        "pp_tps": float(pp.group(2)) if pp else None,
        "gen_tokens": int(tg.group(1)) if tg else None,
        "tg_tps": float(tg.group(2)) if tg else None,
        "peak_rss_kb": int(rss.group(1)) if rss else None,
        "kv_buffer_mib": round(sum(kvbuf), 1) if kvbuf else None,
    })

with open(os.path.join(WORK, "results.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["kv_type", "ctx", "run", "exit", "prompt_tokens",
                                      "pp_tps", "gen_tokens", "tg_tps", "peak_rss_kb", "kv_buffer_mib"])
    w.writeheader()
    w.writerows(rows)

WARMUP_RUN = 1  # run 1 is warmup: kept in results.csv, excluded from medians

def med(vals):
    vals = [v for v in vals if v is not None]
    return statistics.median(vals) if vals else None

def spread(vals):
    vals = [v for v in vals if v is not None]
    return (max(vals) - min(vals)) if len(vals) >= 2 else None

print("=== MEDIANS (runs 2-4; run 1 = discarded warmup) ===")
print(f"{'kv':6} {'ctx':6} {'pp_tps':>9} {'tg_tps':>9} {'tg_spread':>9} {'peakRSS_MiB':>12} {'rss_spread':>10} {'KVbuf_MiB':>10}")
agg = {}
for kv in ("f16", "q8_0", "q4_0"):
    for ctx in (2048, 8192, 16384):
        grp = [r for r in rows if r["kv_type"] == kv and r["ctx"] == ctx and r["exit"] == "0"
               and r["run"] != WARMUP_RUN]
        e = {"pp": med([r["pp_tps"] for r in grp]), "tg": med([r["tg_tps"] for r in grp]),
             "tg_sp": spread([r["tg_tps"] for r in grp]),
             "rss": med([r["peak_rss_kb"] for r in grp]),
             "rss_sp": spread([r["peak_rss_kb"] for r in grp]),
             "kvb": med([r["kv_buffer_mib"] for r in grp]), "n": len(grp)}
        agg[(kv, ctx)] = e
        rss_mib = e["rss"] / 1024 if e["rss"] else None
        rss_sp_mib = e["rss_sp"] / 1024 if e["rss_sp"] else None
        fmt = lambda v, p=1: f"{v:.{p}f}" if v is not None else "FAIL"
        print(f"{kv:6} {ctx:<6} {fmt(e['pp']):>9} {fmt(e['tg']):>9} {fmt(e['tg_sp'],2):>9} "
              f"{fmt(rss_mib):>12} {fmt(rss_sp_mib):>10} {fmt(e['kvb']):>10}  (n={e['n']})")

print("\n=== DELTAS vs f16 ===")
print(f"{'kv':6} {'ctx':6} {'d_mem_%':>8} {'d_tg_%':>8} {'d_KVbuf_%':>10} {'signal>noise':>12}")
for kv in ("q8_0", "q4_0"):
    for ctx in (2048, 8192, 16384):
        b, e = agg[("f16", ctx)], agg[(kv, ctx)]
        if not (b["rss"] and e["rss"]):
            print(f"{kv:6} {ctx:<6} {'FAIL':>8}")
            continue
        dmem = (b["rss"] - e["rss"]) / b["rss"] * 100
        dtg = (e["tg"] - b["tg"]) / b["tg"] * 100 if (b["tg"] and e["tg"]) else None
        dkv = (b["kvb"] - e["kvb"]) / b["kvb"] * 100 if (b["kvb"] and e["kvb"]) else None
        # signal>noise: |mem delta| must exceed combined run-to-run spread
        noise = max(x for x in [b["rss_sp"] or 0, e["rss_sp"] or 0])
        sig = "YES" if abs(b["rss"] - e["rss"]) > noise else "NO"
        f = lambda v: f"{v:+.1f}" if v is not None else "n/a"
        print(f"{kv:6} {ctx:<6} {f(dmem):>8} {f(dtg):>8} {f(dkv):>10} {sig:>12}")

print("\n=== KILL-THRESHOLD READOUT (runbook) ===")
b, q8 = agg[("f16", 8192)], agg[("q8_0", 8192)]
if b["rss"] and q8["rss"]:
    dmem8k = (b["rss"] - q8["rss"]) / b["rss"] * 100
    noise = max(b["rss_sp"] or 0, q8["rss_sp"] or 0)
    signal = abs(b["rss"] - q8["rss"]) > noise
    print(f"q8_0 @8k peak-mem saving: {dmem8k:.1f}% (threshold >=5%) | mem signal exceeds spread: {signal}")
    verdict = "PASS-leaning" if (dmem8k >= 5 and signal) else "KILL-leaning"
    print(f"runbook verdict: {verdict} (final call needs needle probe + human read)")
else:
    print("q8_0 or f16 @8k failed to run: inspect logs (KV flags broken on aarch64 is itself a kill criterion)")
