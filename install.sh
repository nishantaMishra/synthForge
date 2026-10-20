#!/usr/bin/env bash
# One-command setup for Debian/Ubuntu x86-64 Linux.
set -euo pipefail
forge_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
mode=auto
launch=1
for argument in "$@"; do
  case "$argument" in
    --cpu) mode=cpu ;;
    --gpu) mode=gpu ;;
    --no-launch) launch=0 ;;
    --dry-run)
      printf '%s\n' 'Setup plan (no changes or downloads):' \
        '1. Check Linux and install missing system packages (sudo if needed).' \
        '2. Download a private Python 3.11 environment using uv.' \
        '3. Install pinned ComfyUI and custom nodes, then Python dependencies.' \
        '4. Download and verify image and Desklib models (about 30 GiB).' \
        '5. Install local Ollama and download qwen2.5:7b.' \
        '6. Check the image workflow, save setup, and start Synth Forge.'
      exit 0 ;;
    --help|-h)
      printf '%s\n' 'Usage: bash install.sh [--cpu | --gpu] [--no-launch] [--dry-run]' \
        'Supports Debian/Ubuntu x86-64 Linux. Default: detect NVIDIA, otherwise CPU.' \
        'Allow at least 60 GB free disk space. Downloads can take a long time.'
      exit 0 ;;
    *) printf 'Unknown option: %s\n' "$argument" >&2; exit 2 ;;
  esac
done
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || {
  echo 'This installer currently supports x86-64 Linux only.' >&2; exit 1;
}
command -v apt-get >/dev/null || {
  echo 'Automatic setup currently requires Debian/Ubuntu (apt-get).' >&2; exit 1;
}
trap 'echo "Setup stopped. Fix the error above, then rerun: bash install.sh" >&2' ERR

# No root-owned application files: elevate only the OS package installation.
packages=(ca-certificates curl git tar zstd build-essential libgl1 libglib2.0-0 libgomp1 libportaudio2 libsm6 libxext6 libxrender1)
missing=()
for package in "${packages[@]}"; do
  if ! dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then
    # New Ubuntu versions use a t64 name, provided by the same apt dependency.
    if [[ "$package" == libglib2.0-0 ]] && dpkg-query -W -f='${Status}' libglib2.0-0t64 2>/dev/null | grep -q 'install ok installed'; then
      continue
    fi
    missing+=("$package")
  fi
done
if ((${#missing[@]})); then
  echo 'Installing missing system packages; Linux may ask for your password.'
  elevate=()
  if ((EUID != 0)); then
    command -v sudo >/dev/null || { echo 'sudo is needed to install system packages.' >&2; exit 1; }
    elevate=(sudo)
  fi
  "${elevate[@]}" apt-get update
  "${elevate[@]}" apt-get install -y "${missing[@]}"
fi

mkdir -p "$forge_dir/runtime" "$forge_dir/logs"
export LD_LIBRARY_PATH="$forge_dir/runtime/python/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export UV_PYTHON_INSTALL_DIR="$forge_dir/runtime/managed-python"
export UV_PYTHON_BIN_DIR="$forge_dir/runtime/bin"
export UV_CACHE_DIR="$forge_dir/runtime/uv-cache"
uv="$forge_dir/runtime/uv/uv"
if [[ ! -x "$uv" ]]; then
  curl --fail --location --retry 3 --output "$forge_dir/runtime/uv.tar.gz.part" \
    https://github.com/astral-sh/uv/releases/download/0.13.4/uv-x86_64-unknown-linux-gnu.tar.gz
  printf '%s  %s\n' 2b428396f12572d4429cf210ca234dd599a33b3af0958a4d5ed569d63e3f344f \
    "$forge_dir/runtime/uv.tar.gz.part" | sha256sum --check
  mkdir -p "$forge_dir/runtime/uv"
  tar -xzf "$forge_dir/runtime/uv.tar.gz.part" --strip-components=1 -C "$forge_dir/runtime/uv"
fi
"$uv" python install 3.11
python_path="$("$uv" python find --managed-python 3.11)"
"$python_path" "$forge_dir/studio/installer.py" --mode "$mode"
if ((launch)); then
  exec bash "$forge_dir/start-forge.sh" --open
fi
