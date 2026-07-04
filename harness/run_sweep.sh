#!/usr/bin/env bash
# GravitonKV one-command sweep entry.
# Usage: ./run_sweep.sh --config sweeps/qwen3-4b-full.yaml
set -euo pipefail
cd "$(dirname "$0")"

command -v python3 >/dev/null || { echo "python3 missing"; exit 1; }
python3 -c "import yaml" 2>/dev/null || sudo apt-get install -y -qq python3-yaml

exec python3 sweep.py "$@"
