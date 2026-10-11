#!/usr/bin/env bash
set -euo pipefail
studio_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$studio_dir"
export LD_LIBRARY_PATH="$studio_dir/runtime/python/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$studio_dir/ComfyUI/.venv/bin/python" studio/server.py "$@"
