#!/usr/bin/env python3
"""Score needle-in-haystack outputs: how many of the 10 planted codes appear.
Usage: score_needle.py <workdir>
"""
import sys, os

WORK = sys.argv[1]
codes = []
with open(os.path.join(WORK, "prompts", "needle_codes.txt")) as f:
    for line in f:
        cp, code = line.strip().split("|")
        codes.append((cp, code))

print("\n=== NEEDLE PROBE (8k ctx, 10 planted codes) ===")
with open(os.path.join(WORK, "needle_scores.csv"), "w") as out:
    out.write("kv_type,score,found,missed\n")
    for kv in ("f16", "q8_0", "q4_0"):
        path = os.path.join(WORK, "logs", f"needle_{kv}.out")
        if not os.path.exists(path):
            print(f"{kv}: no output file")
            continue
        text = open(path, errors="replace").read().lower()
        found = [code for _, code in codes if code.lower() in text]
        missed = [code for _, code in codes if code.lower() not in text]
        print(f"{kv}: {len(found)}/10 codes recalled | missed: {', '.join(missed) if missed else 'none'}")
        out.write(f"{kv},{len(found)},{';'.join(found)},{';'.join(missed)}\n")
print("interpretation: f16 high + q4_0 crater = tradeoff story EXISTS (PASS signal); "
      "all indistinguishable AND trivial memory savings = KILL signal")
