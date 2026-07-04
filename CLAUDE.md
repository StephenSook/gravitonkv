# CLAUDE.md

GravitonKV is a reproducible KV-cache quantization tradeoff study on AWS Graviton4 CPU: benchmark harness, canonical results JSON, quality battery, PMU instrumentation, static dashboard, and a read-only results MCP server. These rules keep every session on rails. If a task conflicts with a rule here, stop and flag it instead of proceeding.

## Benchmark integrity (never break)

1. llama.cpp is pinned at commit `2d973636e292ee6f75fadcf08d29cb33511f509f`. Never upgrade, rebase, or pull upstream. If a build breaks, fix the environment, not the pin.
2. Every build uses `-DGGML_CPU_KLEIDIAI=ON`. Verify `KLEIDIAI = 1` in system_info after every fresh build. KleidiAI is reported as the baseline, never as our optimization.
3. Every benchmark run uses flash attention (`-fa on` / `-fa 1`), including f16 baselines. Quantized V cache requires it and comparisons must be apples-to-apples.
4. Use `llama-bench` where it supports the config, `llama-completion` otherwise. Never `llama-cli` for benchmarks; on this commit it is a chat REPL only.
5. Run standard: N=10 reps where a cell costs under 10 minutes, N=5 minimum everywhere. First rep is warmup, discarded. Report median, stdev, and CV. Seed 42. Threads pinned to physical cores.
6. Every model file gets its SHA256 recorded. Models are the six locked ones only: Qwen3-4B-Instruct-2507, Qwen3-1.7B, Qwen3-0.6B, Phi-4-mini, Granite 4.0 micro, SmolLM3-3B (all Apache 2.0 or MIT). Never add a Llama-family model (license conflicts with this repo's MIT requirement). No MoE or hybrid models in the headline sweep.
7. KV configs are the five locked ones: f16/f16, q8_0/q8_0, q4_0/q4_0, q8_0/q4_0 (K8V4), q4_0/q8_0 (K4V8). Context ladder is 2k/8k/16k/32k. No new configs or tiers without a written scope decision.
8. Never run measured benchmarks on t4g (burstable throttling corrupts numbers) or spot instances (interruption corrupts comparisons). On-demand only for measured runs.
9. Mac results are dev-only, forever. KleidiAI is disabled in macOS llama.cpp builds. No number produced on a Mac appears in any artifact.
10. GitHub Actions arm64 runners are Azure Cobalt 100 (Neoverse N2), not Graviton4. CI validates the harness and reproducibility. CI numbers never appear as findings.
11. PMU telemetry uses the composite Stalled Slots metric, never raw STALL_SLOT_* counters (Neoverse V2 errata 2446525). SPE and CMN DRAM-bandwidth counters exist only on metal instances; never claim SPE-derived evidence from virtualized runs. On virtualized instances the per-core read-demand event (r37) is a bandwidth proxy and must be labeled as one. Never run PMU measurement inside Docker.
12. Results stream to S3 after every sweep cell. Instances are terminated, never stopped, at session end.

## Data and claims discipline

13. Every number in the README, dashboard, MCP responses, video, and submission text is generated from `results/canonical.json` by script. Never hand-type a benchmark number. The pilot artifacts in `results/pilot/` are the one historical exception and are labeled as such.
14. The novelty claim is exactly: "first public reproducible KV-cache quantization tradeoff study on AWS Graviton4 CPU with PMU-level mechanism analysis." Never claim "first on Arm" or "first KV-cache study." Prior art exists on Apple Silicon (KVSplit, llama.cpp issue #8918) and aarch64 GPU (Memoriant DGX Spark).
15. Related work must cite: KVSplit, llama.cpp issue #8918, the Memoriant DGX Spark benchmark, arXiv 2503.24000 (MLSys 2025), KIVI (ICML 2024) and KVQuant (NeurIPS 2024) for algorithm lineage only, InnerQ (arXiv 2602.23200), RULER (COLM 2024), and Arm's "Running Llama 3 on Graviton4" blog. Never cite KVQuant for the prefill/decode asymmetry mechanism. Never cite any "IEEE Micro 30-run rule" paper. Get venues right: RULER is COLM 2024, KVQuant is NeurIPS 2024.
16. Mechanism statements carry one of three evidence tiers: (1) verified from PMU counters, (2) consistent with source-code reading, (3) hypothesis. Never promote a lower tier into higher-tier language.
17. The decode regression is reported as prominently as the prefill gain. Negative results, anomalies, and failed cells get documented, never deleted.

## Style

18. No em-dashes anywhere: code comments, README, dashboard copy, commit messages, captions. Use periods, commas, colons, or parentheses.
19. Plain builder voice. No marketing language. Concrete numbers over adjectives.
20. No invented personas or fictional scenarios anywhere. Real data, real runs.
21. Charts use the Okabe-Ito colorblind-safe palette (#E69F00, #56B4E9, #009E73, #F0E442, #0072B2, #D55E00, #CC79A7). Error bars and N labeled on every chart, units on every axis, f16 baseline always visible.

## Architecture (locked, do not relitigate)

- Dashboard: static Next.js export on Vercel, dark default, five-band single-scroll IA (headline hero, tradeoff surface, small multiples, cell explorer, methodology). Recharts 3.x; the Pareto frontier is a custom layer.
- Data: flat JSON in-repo, `results/canonical.json` is the single source of truth; everything else is a derived view built by `npm run build:data` (validate, gen:readme, gen:dashboard). No database, no served API, no live-demo triggers.
- MCP server: read-only, TypeScript SDK pinned to the stable v1 line, five tools (`get_headline_finding`, `query_results`, `compare_configs`, `recommend_config`, `get_methodology`), stdio via npx plus a Vercel-hosted Streamable HTTP endpoint. Read-only forever.
- Harness: config-file-driven YAML, one-command entry (`./run_sweep.sh --config sweeps/full.yaml`), full environment capture in every output, uv-pinned Python.

## Working style

- Small atomic commits, plain descriptive messages, push after every commit.
- Before writing new code, check whether a script in `/scripts` already does the job.
- When touching the harness, run the CI smoke test equivalent locally before pushing. When touching the dashboard, verify the static export builds. When touching results or schema, run schema validation before committing.
- If llama.cpp behavior seems wrong, check the pinned commit's actual source; upstream master has moved past the pin.
