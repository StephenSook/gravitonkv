#!/bin/bash
# 36-run KV-cache sweep: {f16,q8_0,q4_0} x {2048,8192,16384} x 4 repeats
# (run 1 = warmup, excluded from medians per failure-mode-PDF measurement bar).
# Resumable: skips runs with an existing .done marker.
set -u
WORK="${1:?usage: sweep.sh <workdir>}"
cd "$WORK"
BIN="$WORK/llama.cpp/build/bin/llama-completion"
MODEL=$(cat model_path.txt)
FA_ARGS=$(cat fa_args.txt)
THREADS=$(nproc)

for KV in f16 q8_0 q4_0; do
  for CTX in 2048 8192 16384; do
    for RUN in 1 2 3 4; do
      LOG="logs/timing_${KV}_${CTX}_${RUN}.log"
      [ -f "$LOG.done" ] && continue
      echo "[$(date -u +%FT%TZ)] run kv=$KV ctx=$CTX rep=$RUN" | tee -a phase.log
      /usr/bin/time -v timeout 1800 "$BIN" -m "$MODEL" -c "$CTX" -n 256 --ignore-eos \
        --temp 0 --seed 42 -t "$THREADS" -ctk "$KV" -ctv "$KV" $FA_ARGS \
        -f "prompts/fill_${CTX}.txt" -no-cnv --no-display-prompt \
        > "$LOG" 2>&1
      echo $? > "$LOG.done"
    done
  done
done
exit 0
