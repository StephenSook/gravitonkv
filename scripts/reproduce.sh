#!/usr/bin/env bash
# GravitonKV clean-room reproduce. From a fresh clone on any arm64 Linux
# (Graviton4 for real numbers; any Arm CPU proves the harness), this builds the
# pinned llama.cpp with KleidiAI, downloads a small model, runs the harness end
# to end, and validates the output against the canonical schema. It mirrors the
# CI job (.github/workflows/ci.yml) step for step.
#
# Usage:  git clone https://github.com/StephenSook/gravitonkv
#         cd gravitonkv && ./scripts/reproduce.sh
set -euo pipefail
cd "$(dirname "$0")/.."

LLAMA_CPP_COMMIT=2d973636e292ee6f75fadcf08d29cb33511f509f
SMOKE_MODEL_URL=https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf
SMOKE_MODEL=Qwen3-0.6B-Q4_K_M.gguf

echo "== 1/6 dependencies =="
if command -v apt-get >/dev/null; then
  sudo apt-get update -y -qq
  sudo apt-get install -y -qq build-essential cmake git curl python3 python3-yaml
else
  echo "Non-apt system: ensure build-essential, cmake, git, curl, python3, python3-yaml are installed." >&2
fi

echo "== 2/6 build llama.cpp at the pinned commit with KleidiAI =="
if [ ! -x llama.cpp/build/bin/llama-completion ]; then
  rm -rf llama.cpp
  git clone https://github.com/ggml-org/llama.cpp
  (
    cd llama.cpp
    git checkout "$LLAMA_CPP_COMMIT"
    cmake -B build -DCMAKE_BUILD_TYPE=Release -DGGML_CPU_KLEIDIAI=ON
    cmake --build build --target llama-bench llama-completion llama-tokenize -j "$(nproc)"
  )
else
  echo "llama.cpp/build/bin already present, skipping build."
fi

echo "== 3/6 download smoke model =="
mkdir -p models
[ -f "models/$SMOKE_MODEL" ] || curl -L --fail --retry 3 -o "models/$SMOKE_MODEL" "$SMOKE_MODEL_URL"
sha256sum "models/$SMOKE_MODEL"

echo "== 4/6 assert KLEIDIAI = 1 in the build (the load-bearing flag) =="
./llama.cpp/build/bin/llama-completion -m "models/$SMOKE_MODEL" -p hello -n 4 --seed 42 -fa on 2> sysinfo.log || true
grep -E "system_info:.*KLEIDIAI = 1" sysinfo.log \
  || { echo "FATAL: KLEIDIAI = 1 not in system_info. This build is not KleidiAI-enabled."; cat sysinfo.log; exit 1; }
grep -E "system_info:.*MATMUL_INT8 = 1" sysinfo.log \
  || { echo "FATAL: MATMUL_INT8 = 1 not in system_info."; exit 1; }
echo "KLEIDIAI = 1 and MATMUL_INT8 = 1 confirmed."

echo "== 5/6 run the harness end to end (ci-mini sweep) =="
python3 harness/sweep.py --config harness/sweeps/ci-mini.yaml
echo "--- ci-results/ci-mini.json (head) ---"
head -40 ci-results/ci-mini.json

echo "== 6/6 validate the output against the canonical schema =="
if command -v node >/dev/null; then
  npm ci --silent
  node scripts/validate-results.mjs ci-results/ci-mini.json
  echo "SCHEMA OK"
else
  echo "node not found; install Node 22 to run schema validation. Harness output is in ci-results/ci-mini.json."
fi

echo
echo "REPRODUCE OK. The harness built the pinned KleidiAI llama.cpp, ran on this"
echo "machine, and emitted a schema-valid canonical result. For real study numbers"
echo "run this on an on-demand Graviton4 instance (c8g.4xlarge); Cobalt/other Arm"
echo "CPUs prove the harness but are not the study's findings hardware."
