#!/bin/sh
set -eu
python /app/cloud-worker/cpu_server.py &
api_pid=$!
trap 'kill "$api_pid" 2>/dev/null || true; wait "$api_pid" 2>/dev/null || true' EXIT
trap 'exit 0' TERM INT
python /app/cloud-worker/worker.py &
worker_pid=$!
trap 'kill "$worker_pid" "$api_pid" 2>/dev/null || true; wait 2>/dev/null || true' EXIT
wait "$worker_pid"
