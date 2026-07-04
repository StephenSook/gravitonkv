# Week-1 Gate Results (2026-07-04, c8g.4xlarge, us-east-1d)

Instance: c8g.4xlarge (Graviton4 / Neoverse-V2 r0p1, 16 vCPU, 32 GiB), kernel 6.17.0-1019-aws,
Ubuntu 24.04. llama.cpp pinned `2d973636e292ee6f75fadcf08d29cb33511f509f` (build 9870),
`-DGGML_CPU_KLEIDIAI=ON`, system_info: `MATMUL_INT8 = 1 | SVE = 1 | DOTPROD = 1 | KLEIDIAI = 1`.
Model: Qwen3-4B-Instruct-2507 Q4_K_M, sha256 `3605803b...67e597` (identical to pilot).
Raw logs: `smoke.log`, `kld-full-stats.txt` in this directory.

## Gate 1: mixed-config smoke test. PASS.

Both asymmetric KV configs (q8_0/q4_0 and q4_0/q8_0) run correctly on aarch64 CPU with
`-fa on`: llama-perplexity accepts independent `-ctk`/`-ctv`, llama-bench reports both
type columns and plausible throughput, generation is coherent. No crash, no silent f16
fallback, no GPU-style refusal. **The five-config matrix is confirmed IN.**

llama-bench (pp512 / tg128, 16 threads, N=3 reps):

| config | pp512 t/s | tg128 t/s |
|---|---|---|
| K8V4 (q8_0/q4_0) | 164.35 ± 0.82 | 53.47 ± 0.78 |
| K4V8 (q4_0/q8_0) | 164.50 ± 0.46 | 50.83 ± 1.23 |

## Gate 2: KLD quality thresholds. PASS, with the asymmetry visible.

wiki.test.raw, c=512, 16 chunks, f16-KV base, `-fa on`:

| config | Mean KLD | RMS Δp | Same top p |
|---|---|---|---|
| K8V4 (q8_0 K / q4_0 V) | **0.006314 ± 0.000184** | 2.246% | 96.275% |
| K4V8 (q4_0 K / q8_0 V) | **0.031252 ± 0.002282** | 5.188% | 91.985% |

Pre-registered pass bar: K8V4 mean KLD well under 0.02. Result 0.0063: PASS.
K4V8 is 5x worse at essentially the same memory footprint: the K-cache-dominates-quality
asymmetry replicates on Qwen3-4B. Notably milder than the catastrophic q4_0-K result
reported for Qwen2.5-7B in llama.cpp discussion #23470, so sensitivity is model-dependent:
a finding the full quality battery will chart, not a bug.

## Gate 3: PMU availability on virtualized c8g. MAPPED.

- Working: `cycles`, `instructions`, `r23` (STALL_FRONTEND cycles), `r24` (STALL_BACKEND
  cycles), `l1d_cache_refill`, `l2d_cache_refill`, `r08`, `r11`, `r34`.
- Not counting on this instance: `r37` and `r36` (per-core read-demand bandwidth events;
  zero even under a 74-billion-cycle llama-bench load), `ll_cache_miss_rd`.
- **Only ~2 programmable PMU counters are exposed per vCPU.** More events than that
  multiplex (~66% coverage at 3 events). Slots-based topdown ("#slots") fails.
- SPE absent: `/sys/devices/arm_spe_0` does not exist.
- Consequence: virtualized runs support stall-cycle and cache-refill telemetry with
  2-event groups. All bandwidth evidence and full operation-mix breakdowns move to the
  budgeted metal session. perf_event_paranoid set to 0 for collection.

## Gate 4: Performix on virtualized c8g. PARTIAL, exactly as predicted.

Arm Performix CLI/daemon **1.17.0** installed from the arm64 .deb; built-in localhost
target prepared. Verified syntax: `apx recipe run <recipe> --target localhost --workload "<command>" [--deploy-tools]`.

| recipe | virtualized c8g result |
|---|---|
| code_hotspots | **SUCCESS** (run a4a6bfa226ed, profiled llama-bench K8V4) |
| instruction_mix | FAIL: "requires 3 or more PMU counters. CPU 0 on the target has only 2." |
| cpu_microarchitecture | blocked by the same counter limit |
| memory_access | FAIL at readiness: "SPE is not configured on the target... incompatible" |

Consequence: Performix evidence on virtualized instances is limited to code hotspots.
The instruction-mix, microarchitecture, and memory-access recipes require the metal
session, which was already budgeted for exactly this reason.

## Quota gate. PASS.

Account vCPU quota (L-1216C47A) now 16: c8g.4xlarge available for the full sweep.
