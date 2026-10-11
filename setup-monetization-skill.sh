#!/usr/bin/env bash
# Install the private beta skill without placing its registry token in this repo.
set -euo pipefail

skill_dir="${XDG_DATA_HOME:-$HOME/.local/share}/synth-monetization-beta"
mkdir -p -- "$skill_dir"
chmod 700 -- "$skill_dir"

printf 'AWS App Monetization registry token: ' >&2
IFS= read -r -s registry_token
printf '\n' >&2
if [[ -z "$registry_token" ]]; then
  printf 'No token entered.\n' >&2
  exit 1
fi

umask 077
printf '%s\n' \
  '@aws-app-monetization:registry=https://d10ia5fq6mr3er.cloudfront.net/registry/' \
  "//d10ia5fq6mr3er.cloudfront.net/registry/:_authToken=$registry_token" \
  > "$skill_dir/.npmrc"
unset registry_token
chmod 600 -- "$skill_dir/.npmrc"

npm install --prefix "$skill_dir" --userconfig "$skill_dir/.npmrc" \
  --no-audit --no-fund @aws-app-monetization/monetize-skill
(
  cd -- "$skill_dir"
  node_modules/.bin/monetize-skill install --project "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
)

printf 'AWS App Monetization skill installed. Restart your coding assistant before running /monetize.\n'
