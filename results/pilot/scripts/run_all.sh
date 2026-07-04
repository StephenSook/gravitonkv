#!/bin/bash
# GravitonKV week-1 kill experiment: master instance-side script.
# Runs unattended on a fresh Ubuntu 24.04 arm64 c8g instance.
# Produces: ~/gravitonkv/results.tar.gz + ~/DONE (or ~/FAILED with phase name).
set -u
cd "$HOME"
WORK="$HOME/gravitonkv"
mkdir -p "$WORK"/{logs,prompts,models}
cd "$WORK"

phase() { echo "[$(date -u +%FT%TZ)] PHASE: $1" | tee -a phase.log; }
fail() { echo "$1" > "$HOME/FAILED"; tar czf "$HOME/results-partial.tar.gz" -C "$WORK" . 2>/dev/null; exit 1; }

# Safety fuse: hard power-off in 5h no matter what (instance launched with
# terminate-on-shutdown so this also terminates it).
sudo shutdown -h +300 2>/dev/null || true

phase "deps"
sudo apt-get update -y >> logs/apt.log 2>&1
sudo apt-get install -y build-essential cmake git curl libcurl4-openssl-dev python3 time >> logs/apt.log 2>&1 || fail deps

phase "build"
if [ ! -d llama.cpp ]; then
  git clone --depth 1 https://github.com/ggml-org/llama.cpp >> logs/build.log 2>&1 || fail clone
fi
cd llama.cpp
GIT_SHA=$(git rev-parse HEAD)
# KleidiAI is a BUILD-TIME flag: enable it to match the default
# acceleration path of prebuilt binaries. Reported as BASELINE, never as "our optimization".
cmake -B build -DCMAKE_BUILD_TYPE=Release -DGGML_CPU_KLEIDIAI=ON >> ../logs/build.log 2>&1 || fail cmake_configure
cmake --build build --config Release -j"$(nproc)" >> ../logs/build.log 2>&1 || fail cmake_build
cd "$WORK"
# NOTE: current master split raw completion out of llama-cli (now a chat REPL)
# into llama-completion. All benchmark runs use llama-completion.
BIN="$WORK/llama.cpp/build/bin/llama-completion"
TOK="$WORK/llama.cpp/build/bin/llama-tokenize"
[ -x "$BIN" ] || fail no_binary

phase "model"
MODEL=""
existing=$(ls "$WORK"/models/*.gguf 2>/dev/null | head -1)
if [ -n "$existing" ]; then
  MODEL="$existing"
  [ -f model_source.txt ] || echo "reused-existing" > model_source.txt
fi
[ -z "$MODEL" ] && \
while IFS='|' read -r repo file; do
  url="https://huggingface.co/${repo}/resolve/main/${file}"
  if curl -sfIL --max-time 30 "$url" > /dev/null 2>&1; then
    echo "downloading $url" >> logs/model.log
    if curl -sfL --retry 3 -o "models/${file}" "$url" >> logs/model.log 2>&1; then
      MODEL="$WORK/models/${file}"
      echo "$url" > model_source.txt
      break
    fi
  fi
done < model_candidates.txt
[ -n "$MODEL" ] || fail model_download
echo "$MODEL" > model_path.txt
sha256sum "$MODEL" > model_sha256.txt

phase "build_info"
{
  echo "date_utc: $(date -u +%FT%TZ)"
  echo "llama_cpp_commit: $GIT_SHA"
  echo "cmake_flags: -DCMAKE_BUILD_TYPE=Release -DGGML_CPU_KLEIDIAI=ON"
  echo "model: $(cat model_source.txt)"
  echo "model_sha256: $(cat model_sha256.txt)"
  echo "instance_meta: $(curl -s --max-time 5 -H 'X-aws-ec2-metadata-token: '"$(curl -s --max-time 5 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')" http://169.254.169.254/latest/meta-data/instance-type 2>/dev/null || echo unknown)"
  echo "---- uname ----"; uname -a
  echo "---- lscpu ----"; lscpu
  echo "---- free ----"; free -h
} > build_info.txt 2>&1

phase "smoke"
# Tiny sanity generation; captures system_info (NEON/ARM_FMA/MATMUL_INT8/SVE flags)
timeout 300 "$BIN" -m "$MODEL" -c 512 -n 16 --temp 0 --seed 42 -p "The capital of France is" \
  -no-cnv --no-display-prompt > logs/smoke.out 2> logs/smoke.log || fail smoke
grep -ih "system_info" logs/smoke.log logs/smoke.out 2>/dev/null | head -5 >> build_info.txt || true
# KleidiAI-active proof line (failure-mode PDF: the single highest-probability judge kill vector)
grep -ih "KLEIDIAI" logs/smoke.log logs/smoke.out 2>/dev/null | head -5 >> build_info.txt || echo "WARN: no CPU_KLEIDIAI buffer line in smoke log" >> build_info.txt

phase "fa_probe"
# Determine flash-attention arg style; quantized V cache requires FA in most builds.
# Whatever mode q4_0 needs is applied to ALL runs (f16 included) for apples-to-apples.
fa_try() {
  timeout 300 "$BIN" -m "$MODEL" -c 512 -n 8 --temp 0 --seed 42 -ctk q4_0 -ctv q4_0 $1 \
    -p "hello world" -no-cnv --no-display-prompt > /dev/null 2> logs/fa_probe_last.log
}
if fa_try "-fa on"; then echo "-fa on" > fa_args.txt
elif fa_try "-fa"; then echo "-fa" > fa_args.txt
elif fa_try ""; then echo "" > fa_args.txt
else
  echo "" > fa_args.txt
  echo "WARN: q4_0 KV cache failed all FA modes: q4_0 runs may fail (itself a finding)" >> build_info.txt
  cp logs/fa_probe_last.log logs/fa_probe_failure.log
fi
echo "fa_args: '$(cat fa_args.txt)'" >> build_info.txt

phase "prompts"
python3 "$HOME/scripts/gen_prompts.py" "$TOK" "$MODEL" "$WORK/prompts" >> logs/prompts.log 2>&1 || fail gen_prompts

phase "sweep"
bash "$HOME/scripts/sweep.sh" "$WORK" || fail sweep

phase "needle"
FA_ARGS=$(cat fa_args.txt)
for KV in f16 q8_0 q4_0; do
  timeout 1200 "$BIN" -m "$MODEL" -c 8192 -n 400 --temp 0 --seed 42 -t "$(nproc)" \
    -ctk "$KV" -ctv "$KV" $FA_ARGS -f prompts/needle_8192.txt \
    -no-cnv --no-display-prompt > "logs/needle_${KV}.out" 2> "logs/needle_${KV}.log"
  echo "needle $KV exit=$?" >> phase.log
done

phase "parse"
python3 "$HOME/scripts/parse_run.py" "$WORK" > summary.txt 2> logs/parse.log || echo "parse had errors, raw logs preserved" >> summary.txt
python3 "$HOME/scripts/score_needle.py" "$WORK" >> summary.txt 2>> logs/parse.log || true

phase "package"
tar czf "$HOME/results.tar.gz" -C "$WORK" results.csv summary.txt build_info.txt phase.log model_source.txt fa_args.txt logs prompts/needle_codes.txt 2>/dev/null
touch "$HOME/DONE"
phase "done"
