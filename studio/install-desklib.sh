#!/usr/bin/env bash
set -euo pipefail
studio_path="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
model_path="$studio_path/models/desklib"
revision=5fdea974cd4287c61674951ec78803aa274e2fb7
mkdir -p "$model_path"
for file in config.json tokenizer.json tokenizer_config.json special_tokens_map.json added_tokens.json spm.model model.safetensors; do
  if [[ -s "$model_path/$file" ]]; then continue; fi
  curl --fail --location --retry 2 --output "$model_path/$file.part" "https://huggingface.co/desklib/ai-text-detector-v1.01/resolve/$revision/$file"
  mv -- "$model_path/$file.part" "$model_path/$file"
done
printf '%s\n' 'Desklib open detector model installed. Text files are scored locally.'
