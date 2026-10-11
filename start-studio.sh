#!/usr/bin/env bash
set -euo pipefail
# Compatibility entry point for existing launch shortcuts.
exec "$(dirname -- "${BASH_SOURCE[0]}")/start-forge.sh" "$@"
