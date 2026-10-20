"""Start only the app-owned Ollama process, reusing an existing local service."""
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.error import URLError
from urllib.request import urlopen


def ollama_ready():
    try:
        with urlopen('http://127.0.0.1:11434/api/tags', timeout=2) as response:
            return isinstance(json.load(response).get('models'), list)
    except (URLError, OSError, ValueError):
        return False


def start_ollama(root):
    """Return an owned child or None. Never stop an existing external service."""
    if ollama_ready():
        return None
    root = Path(root)
    binary = root / 'runtime/ollama/bin/ollama'
    if not binary.is_file():
        return None
    (root / 'logs').mkdir(exist_ok=True)
    environment = dict(os.environ, OLLAMA_HOST='127.0.0.1:11434',
                       OLLAMA_MODELS=str(root / 'runtime/ollama-models'))
    with (root / 'logs/ollama.log').open('ab') as log:
        child = subprocess.Popen([str(binary), 'serve'], env=environment,
                                 stdout=log, stderr=subprocess.STDOUT)
    try:
        for _ in range(60):
            if child.poll() is not None:
                # Another launcher may have won the port race.
                if ollama_ready():
                    return None
                raise RuntimeError('Text engine stopped. See logs/ollama.log.')
            if ollama_ready():
                return child
            time.sleep(.5)
        raise RuntimeError('Text engine did not start. See logs/ollama.log.')
    except BaseException:
        stop_process(child)
        raise


def stop_process(child):
    if child is not None and child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=15)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
