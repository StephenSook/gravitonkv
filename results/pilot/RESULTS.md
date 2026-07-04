# GravitonKV Week-1 Kill Experiment: RESULTS

Run: 2026-07-04, m8g.xlarge (Graviton4 / Neoverse-V2, 4 vCPU, 16 GiB), us-east-1a.
llama.cpp `2d973636e292` (KleidiAI ON, `-fa on` all runs), Qwen3-4B-Instruct-2507 Q4_K_M
(sha256 3605803b...67e597). Seed 42, temp 0, n=256 --ignore-eos, 4 reps (rep 1 = warmup).
Instance terminated after collection. Total cost ≈ $1.

## VERDICT: PASS. Proceed to the full study.

## Medians (runs 2-4)

| KV | ctx | pp t/s | tg t/s | peak RSS MiB |
|-----|------|--------|--------|--------------|
| f16 | 2048 | 18.9 | 13.4 | 5170 |
| f16 | 8192 | 5.7 | 6.8 | 6040 |
| q8_0| 2048 | 30.9 | 11.7 | 5035 |
| q8_0| 8192 | 11.6 | 5.0 | 5503 |
| q4_0| 2048 | 30.3 | 11.7 | 4964 |
| q4_0| 8192 | 11.6 | 5.1 | 5215 |

## Deltas vs f16 (all signal >> noise; run spreads ~0.2 MiB / ≤0.17 t/s)

| KV | ctx | Δ peak mem | Δ decode | Δ prefill |
|-----|------|-----------|----------|-----------|
| q8_0| 2048 | −2.6% | −12.9% | **+63%** |
| q8_0| 8192 | **−8.9%** | −25.8% | **+104%** |
| q4_0| 2048 | −4.0% | −13.1% | +60% |
| q4_0| 8192 | **−13.7%** | −25.2% | +104% |

Needle probe (10 planted codes, 8k ctx): f16 10/10, q8_0 10/10, q4_0 10/10.

## Threshold check

- Pre-registered threshold: q8_0 ≥5% peak-mem saving @8k → **8.9% ✓**. Signal exceeds
  spread → **✓** (spreads are 3 orders of magnitude below deltas). KV flags stable on
  aarch64 → ✓.
- Pre-registered flatness kill (<3% decode delta AND <0.3 quality delta) → decode delta
  is −25%: **nowhere near flat**.
- Pre-registered ambiguous clause (mem saves, decode regresses >15%): applies → PASS with
  the tradeoff surface as the product; decode penalty is a headline finding candidate.

## Headline finding (the curve nobody has published)

On Graviton4 CPU with FlashAttention, KV-cache quantization is a **three-way asymmetric
trade**: prefill gets ~2x FASTER (+104% @8k), decode gets ~25% SLOWER, memory drops
9-14% of total process RSS (≈50-75% of the KV cache itself), and retrieval quality is
INTACT through 8k (10/10 needle, all types). GPU prior art (TurboQuant #20969) showed
identical prefill and no decode change at 6k: the CPU regime behaves fundamentally
differently on BOTH speed axes. That divergence is exactly the unmapped territory the
full study charts.

## Honest caveats → full-study TODOs

1. 4 vCPU m8g.xlarge (account quota 5), not the specced c8g.4xlarge: relative deltas
   valid, absolute numbers not publishable. Re-baseline on c8g.4xlarge when the pending
   vCPU quota increase clears.
2. 16k tier dropped for time on 4 vCPU; the long-ctx region (16k/32k+) where GPU lore
   predicts quality cliffs + growing decode penalty is unmapped = core of full study.
3. `-fa on` forced everywhere (q4_0 V-cache requires FA). FA on/off is itself a study
   dimension; the prefill asymmetry may be FA-CPU-kernel-dependent.
4. Quality = needle-retrieval only at 8k; full study adds perplexity + task evals.
5. One model. Full study: six locked models (Qwen3-4B-Instruct-2507, Qwen3-1.7B,
   Qwen3-0.6B, Phi-4-mini, Granite 4.0 micro, SmolLM3-3B).
6. Parser gap: "KV buffer size" log-line regex missed this build's format: fix in
   real harness (peak RSS carried the verdict).

## Next steps

1. Repo skeleton (public, MIT, arm64 CI): kill-test artifacts imported as pilot data.
2. Watch quota case → full sweep on c8g.4xlarge (16k/32k, 5+ reps, six models, ppl).
3. Performix instrumentation layer + `--metrics` endpoint capture.
4. Ask organizers the open methodology questions (office hours July 14, 10:00 AM PDT).
