#!/bin/bash
# Handover runner: waits for in-flight f16/8k/rep4 to finish, stops the original
# orchestrator, completes the SCOPE-CUT sweep (16k tier dropped: 4-vCPU pace made it
# a 12h job; kill thresholds live at 8k), runs needle probe, parses, packages.
# Fixes vs original: per-run timeout 3600s (8k runs take ~24 min; old 1800s cap would
# have killed q8/q4 8k runs), needle timeout 3600s (old 1200s would have killed all).
set -u
WORK="$HOME/gravitonkv"
cd "$WORK"
phase() { echo "[$(date -u +%FT%TZ)] PHASE: $1" | tee -a phase.log; }

phase "handover_wait"
for i in $(seq 1 90); do [ -f logs/timing_f16_8192_4.log.done ] && break; sleep 30; done

phase "handover_stop_old"
pkill -f 'scripts/run_all.sh' 2>/dev/null
pkill -f 'scripts/sweep.sh' 2>/dev/null
sleep 2
pkill -f llama-completion 2>/dev/null
sleep 3
rm -f "$HOME/DONE" "$HOME/FAILED"

BIN="$WORK/llama.cpp/build/bin/llama-completion"
MODEL=$(cat model_path.txt)
FA_ARGS=$(cat fa_args.txt)
THREADS=$(nproc)

phase "sweep2 (2k+8k only)"
for KV in f16 q8_0 q4_0; do
  for CTX in 2048 8192; do
    for RUN in 1 2 3 4; do
      LOG="logs/timing_${KV}_${CTX}_${RUN}.log"
      [ -f "$LOG.done" ] && continue
      echo "[$(date -u +%FT%TZ)] run kv=$KV ctx=$CTX rep=$RUN" | tee -a phase.log
      /usr/bin/time -v timeout 3600 "$BIN" -m "$MODEL" -c "$CTX" -n 256 --ignore-eos \
        --temp 0 --seed 42 -t "$THREADS" -ctk "$KV" -ctv "$KV" $FA_ARGS \
        -f "prompts/fill_${CTX}.txt" -no-cnv --no-display-prompt > "$LOG" 2>&1
      echo $? > "$LOG.done"
    done
  done
done

phase "needle"
for KV in f16 q8_0 q4_0; do
  [ -s "logs/needle_${KV}.out" ] && continue
  timeout 3600 "$BIN" -m "$MODEL" -c 8192 -n 400 --temp 0 --seed 42 -t "$THREADS" \
    -ctk "$KV" -ctv "$KV" $FA_ARGS -f prompts/needle_8192.txt \
    -no-cnv --no-display-prompt > "logs/needle_${KV}.out" 2> "logs/needle_${KV}.log"
  echo "needle $KV exit=$?" >> phase.log
done

phase "parse"
python3 "$HOME/scripts/parse_run.py" "$WORK" > summary.txt 2> logs/parse.log || echo "parse errors, raw logs kept" >> summary.txt
python3 "$HOME/scripts/score_needle.py" "$WORK" >> summary.txt 2>> logs/parse.log || true

phase "package"
tar czf "$HOME/results.tar.gz" -C "$WORK" results.csv summary.txt build_info.txt phase.log \
  model_source.txt model_sha256.txt fa_args.txt logs prompts/needle_codes.txt 2>/dev/null
touch "$HOME/DONE"
phase "done"
