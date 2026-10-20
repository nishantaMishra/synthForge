#!/usr/bin/env bash
set -euo pipefail
studio_path="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
python_path="$studio_path/../ComfyUI/.venv/bin/python"
export LD_LIBRARY_PATH="$studio_path/../runtime/python/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
if [[ ! -x "$python_path" ]]; then
  echo 'Set up Synth Forge first: bash install.sh' >&2
  exit 1
fi
exec "$python_path" "$studio_path/installer.py" --desklib-only
