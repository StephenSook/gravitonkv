# FLASH_ATTN_EXT routing at the pinned commit: source-reading notes

Evidence tier: **consistent with source-code reading (tier 2)**. Verified against llama.cpp
commit `2d973636e292ee6f75fadcf08d29cb33511f509f`, file `ggml/src/ggml-cpu/ops.cpp` plus
`ggml/src/ggml-cpu/arch/arm/quants.c` and the type-trait tables in `ggml/src/ggml-cpu/ggml-cpu.c`.
PMU counter evidence (tier 1) comes separately from instrumented runs.

## What the source shows

The CPU flash-attention kernel (`ggml_compute_forward_flash_attn_ext_f16`, ops.cpp:8945)
selects between three implementations:

1. **Tiled batch path** (`use_tiled`, ops.cpp:9051): requires Q in f32, KV in f32 or f16,
   `k->type == v->type`, and a batch of at least the Q tile size. This is the fast path for
   f16-KV prefill.
2. **Split-KV path** (`use_split_kv_path`, ops.cpp:8994): requires single-token decode
   (`neq1 == 1`), KV in f32 or f16, matching K/V types, and at least 512 KV positions. It
   parallelizes one token's attention across threads by KV chunk. This is the fast path for
   f16-KV long-context decode.
3. **Scalar-row fallback** (`_one_chunk`, ops.cpp:8347): everything else.

**Both fast paths exclude quantized KV.** Any run with `--cache-type-k`/`--cache-type-v` set
to q8_0 or q4_0 (symmetric or mixed) executes `_one_chunk` for both prefill and decode.

Inside `_one_chunk`, per-type traits decide the arithmetic (ops.cpp:8421-8424):

- **K side:** for quantized K, Q is quantized once per row to q8_0 (`quantize_row_q8_0`),
  then every K·Q dot runs `ggml_vec_dot_q8_0_q8_0` or `ggml_vec_dot_q4_0_q8_0` with
  `nrc = 1`. On aarch64 those kernels use **DOTPROD (`sdot`) integer intrinsics at
  nrc = 1**; the i8mm (`smmla`) branch inside them is compiled in but only engages at
  `nrc == 2`, which the flash-attention loop never passes (ops.cpp:8480 passes 1).
  For f16 K, the dot is `ggml_vec_dot_f16` (fp16 FMA).
- **V side:** quantized V is **dequantized per KV position** into a scratch buffer
  (`v_to_float`, ops.cpp:8526-8528) before an f32 FMA accumulate. f16 V skips that and
  accumulates directly in fp16 (ops.cpp:8511).
- **KleidiAI is orthogonal to this path.** The KleidiAI/i8mm ukernels accelerate weight
  GEMM/GEMV (projections, FFN) via the repack machinery; they do not appear in the
  flash-attention loop. Those matmuls are identical across KV configs.

## What this means for the observed asymmetry

- The earlier working hypothesis that "prefill routes quantized K through an i8mm ukernel
  inside attention" is **not supported by the source**. The integer path inside attention
  is DOTPROD, not i8mm.
- **Prefill speedup (hypothesis, tier 2/3):** quantized-KV prefill replaces the f16 tiled
  path with int8-DOTPROD K·Q dots over K data that is 2x (q8_0) to 4x (q4_0) smaller, with
  a single Q-row quantization amortized over the whole KV range. At long context, on
  Neoverse V2, this evidently outruns the f16 tiled path. Whether the win comes mainly from
  integer dot throughput or from memory-traffic relief is exactly what the PMU operation-mix
  and stall counters must decide (DP_SPEC vs VFP_SPEC, backend-stall fraction).
- **Decode regression (tier 2, strong):** with quantized KV, single-token decode loses the
  split-KV thread-parallel path entirely AND pays the per-position V dequantization tax on
  the growing KV read. Both costs scale with context length, which matches the decode
  penalty deepening from 2k to 8k in the pilot.

## Falsifiability

The PMU-instrumented runs test these predictions per KV config, prefill vs decode:
integer-dot operation share rising with quantized KV, fp16 FMA share falling, backend
stalls falling on quantized prefill relative to f16, and stalls plus cache refills rising
on quantized decode. If the counters contradict the prefill story, the mechanism section
reports what they show instead.
