"""CPU inference for Desklib's MIT-licensed published detector architecture.

Reference: https://huggingface.co/desklib/ai-text-detector-v1.01
All input tokens are scored in windows; no silent truncation or remote code.
"""
import json
import os
from pathlib import Path
import sys


def main():
    directory, filename, encoding, bom = sys.argv[1:]
    directory = Path(directory)
    if not (directory / 'model.safetensors').exists():
        raise ValueError('The local Desklib model is not installed yet.')
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TOKENIZERS_PARALLELISM'] = 'false'
    import torch
    from safetensors.torch import load_file
    from transformers import AutoConfig, AutoModel, AutoTokenizer

    torch.set_num_threads(min(8, os.cpu_count() or 1))
    configuration = AutoConfig.from_pretrained(directory, local_files_only=True, trust_remote_code=False)
    tokenizer = AutoTokenizer.from_pretrained(directory, local_files_only=True, trust_remote_code=False)

    class Detector(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.model = AutoModel.from_config(configuration, trust_remote_code=False)
            self.classifier = torch.nn.Linear(configuration.hidden_size, 1)

        def forward(self, ids, mask):
            hidden = self.model(input_ids=ids, attention_mask=mask).last_hidden_state
            weights = mask.unsqueeze(-1).to(hidden.dtype)
            pooled = (hidden * weights).sum(dim=1) / weights.sum(dim=1).clamp(min=1)
            return self.classifier(pooled)

    model = Detector()
    model.load_state_dict(load_file(str(directory / 'model.safetensors'), device='cpu'), strict=True)
    model.eval()
    data = Path(filename).read_bytes()
    text = data[len(bytes.fromhex(bom)):].decode(encoding)
    tokens = tokenizer(text, add_special_tokens=False)['input_ids']
    if not tokens:
        print(json.dumps({'outcome': 'unavailable', 'message': 'There is no text content to score.'}))
        return
    # The published tokenizer uses [CLS] A [SEP] for single-text inputs.
    # Build this explicitly for compatibility with Transformers tokenizer APIs.
    width = 766
    scores = []
    with torch.inference_mode():
        for start in range(0, len(tokens), width):
            part = tokens[start:start + width]
            ids = torch.tensor([[tokenizer.cls_token_id, *part, tokenizer.sep_token_id]], dtype=torch.long)
            mask = torch.ones_like(ids)
            probability = float(torch.sigmoid(model(ids, mask)).item())
            scores.append({'tokens': len(part), 'probability': probability})
    probability = sum(window['tokens'] * window['probability'] for window in scores) / len(tokens)
    print(json.dumps({'outcome': 'detected' if probability >= .5 else 'not_detected', 'probability': probability,
                      'windows': scores, 'tokens_scored': len(tokens), 'threshold': .5,
                      'model': 'desklib/ai-text-detector-v1.01', 'revision': '5fdea974cd4287c61674951ec78803aa274e2fb7',
                      'message': f'Desklib’s local open model estimated AI likelihood at {probability:.1%}. '
                                 'This English-text statistical estimate is not proof of authorship and may differ from the website. '
                                 f'All {len(tokens)} tokens were scored in {len(scores)} window(s).'}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
