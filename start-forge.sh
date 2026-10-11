#!/usr/bin/env bash
set -euo pipefail
forge_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$forge_dir"
export LD_LIBRARY_PATH="$forge_dir/runtime/python/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$forge_dir/ComfyUI/.venv/bin/python" studio/server.py "$@"
