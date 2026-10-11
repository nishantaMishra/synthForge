"""Local owner settings for the hosted cloud workspace link."""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit


SETTINGS = Path(__file__).resolve().parents[1] / 'runtime' / 'cloud-settings.json'


def validate_workspace_url(value):
    if not isinstance(value, str):
        return None
    value = value.strip().rstrip('/')
    if not value or len(value) > 2048:
        return None
    parsed = urlsplit(value)
    local = parsed.hostname in ('localhost', '127.0.0.1')
    if parsed.scheme != 'https' and not (local and parsed.scheme == 'http'):
        return None
    if not parsed.netloc or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        return None
    return value


def workspace_url():
    try:
        settings = json.loads(SETTINGS.read_text())
        if settings.get('disabled'):
            return None
        configured = settings.get('url', '')
    except (OSError, ValueError, AttributeError):
        configured = ''
    return validate_workspace_url(configured) or validate_workspace_url(os.environ.get('SYNTH_CLOUD_URL', ''))


def save_workspace_url(value):
    url = validate_workspace_url(value)
    if not url:
        raise ValueError('Enter the HTTPS origin of the hosted workspace.')
    SETTINGS.parent.mkdir(parents=True, exist_ok=True)
    temporary = SETTINGS.with_suffix('.tmp')
    temporary.write_text(json.dumps({'url': url}))
    temporary.replace(SETTINGS)
    return url


def clear_workspace_url():
    SETTINGS.parent.mkdir(parents=True, exist_ok=True)
    temporary = SETTINGS.with_suffix('.tmp')
    temporary.write_text(json.dumps({'disabled': True}))
    temporary.replace(SETTINGS)
