"""Private Linux installation, invoked by install.sh after Python bootstrap."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import urlopen, Request

from local_runtime import ollama_ready, start_ollama, stop_process

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = Path(__file__).with_name('install-manifest.json')
GIB = 1024**3


def say(message):
    print(message, flush=True)


def run(arguments, **kwargs):
    subprocess.run([str(item) for item in arguments], check=True, **kwargs)


def valid_file(path, asset):
    if not path.is_file() or path.stat().st_size != asset['size']:
        return False
    algorithm = 'sha256' if 'sha256' in asset else 'sha1'
    digest = hashlib.new(algorithm)
    if algorithm == 'sha1':
        digest.update(f"blob {asset['size']}\0".encode())
    with path.open('rb') as source:
        for block in iter(lambda: source.read(8 * 1024**2), b''):
            digest.update(block)
    return digest.hexdigest() == asset.get('sha256', asset.get('git_blob_sha1'))


def download(asset, root=ROOT):
    """Only verified, complete downloads become final model filenames."""
    destination = root / asset['path']
    say(f"Checking {destination.name}")
    if valid_file(destination, asset):
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(destination.name + '.part')
    if destination.exists():
        # Preserve pre-existing files that failed verification.
        destination.replace(destination.with_name(destination.name + '.invalid'))
    if partial.exists() and partial.stat().st_size >= asset['size']:
        if valid_file(partial, asset):
            partial.replace(destination)
            return
        partial.unlink()
    say(f"Downloading {destination.name} ({asset['size'] / GIB:.2f} GiB)")
    for attempt in range(3):
        result = subprocess.run(['curl', '--fail', '--location', '--retry', '3',
                                 '--connect-timeout', '30', '--speed-limit', '1024',
                                 '--speed-time', '120', '--continue-at', '-',
                                 '--output', str(partial), asset['url']])
        if result.returncode == 33:
            # Server cannot resume: retry the private partial from the beginning.
            partial.unlink(missing_ok=True)
            continue
        if result.returncode:
            raise RuntimeError(f'Download interrupted: {destination.name}. Rerun bash install.sh to resume.')
        if valid_file(partial, asset):
            partial.replace(destination)
            return
        partial.unlink(missing_ok=True)
        say(f'Checksum mismatch for {destination.name}; retrying ({attempt + 1}/3).')
    raise RuntimeError(f'Could not verify {destination.name}; setup is incomplete.')


def checkout(repository, root=ROOT):
    destination = root / repository['path']
    if destination.exists():
        result = subprocess.run(['git', '-C', str(destination), 'rev-parse', 'HEAD'],
                                capture_output=True, text=True)
        if result.returncode or result.stdout.strip() != repository['revision']:
            raise RuntimeError(f"{destination} differs from the supported version. "
                               'Use a fresh Synth Forge folder to keep your existing installation intact.')
        changes = subprocess.check_output(['git', '-C', str(destination), 'diff', 'HEAD', '--'], text=True)
        if changes.strip():
            raise RuntimeError(f'{destination} has local edits. Use a fresh folder for setup.')
        return
    temporary = destination.with_name(destination.name + '.installing')
    temporary.mkdir(parents=True, exist_ok=True)
    run(['git', 'init', '-q', temporary])
    run(['git', '-C', temporary, 'fetch', '--depth', '1', repository['url'], repository['revision']])
    run(['git', '-C', temporary, 'checkout', '--detach', 'FETCH_HEAD'])
    temporary.rename(destination)


def copy_nodes(root=ROOT):
    source = root / 'Synthid-Bypass/custom_nodes/Comfyui-SynthidBypass'
    destination = root / 'ComfyUI/custom_nodes/Comfyui-SynthidBypass'
    for file in source.rglob('*'):
        if not file.is_file() or '__pycache__' in file.parts:
            continue
        target = destination / file.relative_to(source)
        if target.exists() and target.read_bytes() != file.read_bytes():
            raise RuntimeError(f'{target} has local edits. Use a fresh installation folder.')
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(file, target)


def install_ollama(root=ROOT):
    # An existing Ollama service already supplies its own binary and model store.
    if ollama_ready():
        return
    binary = root / 'runtime/ollama/bin/ollama'
    if binary.is_file():
        return
    archive = root / 'runtime/ollama.tar.zst'
    download({
        'path': 'runtime/ollama.tar.zst', 'size': 1438364593,
        'sha256': 'c164ab8b1b28e2a247c29719b8e404c423c5b83ae64c3ab4e59d50c7ff7fc5e0',
        'url': 'https://github.com/ollama/ollama/releases/download/v0.40.6/ollama-linux-amd64.tar.zst',
    }, root)
    temporary = root / 'runtime/ollama.installing'
    temporary.mkdir(exist_ok=True)
    run(['tar', '--zstd', '-xf', archive, '-C', temporary])
    if not (temporary / 'bin/ollama').is_file():
        raise RuntimeError('The Ollama archive did not contain the expected Linux binary.')
    temporary.rename(binary.parents[1])
    archive.unlink()


def pull_text_model(root=ROOT):
    child = start_ollama(root)
    try:
        if not ollama_ready():
            raise RuntimeError('Ollama did not start. See logs/ollama.log.')
        request = Request('http://127.0.0.1:11434/api/pull',
                          data=json.dumps({'model': 'qwen2.5:7b', 'stream': True}).encode(),
                          headers={'Content-Type': 'application/json'})
        previous = None
        succeeded = False
        with urlopen(request, timeout=600) as response:
            for line in response:
                progress = json.loads(line)
                if progress.get('error'):
                    raise RuntimeError(progress['error'])
                status = progress.get('status', '')
                total = progress.get('total', 0)
                percent = int(progress.get('completed', 0) * 100 / total) if total else None
                display = (status, percent // 10 if percent is not None else None)
                if display != previous:
                    say(f"Text model: {status}" + (f' {percent}%' if percent is not None else ''))
                    previous = display
                succeeded = status == 'success'
        if not succeeded:
            raise RuntimeError('The text model download ended before completion. Rerun setup.')
    finally:
        stop_process(child)


def verify_engine(python, root=ROOT):
    """Load all custom nodes and check workflow types and model selections."""
    from workflow import compile_workflow
    (root / 'logs/install-user').mkdir(parents=True, exist_ok=True)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    with (root / 'logs/install-engine.log').open('ab') as log:
        child = subprocess.Popen([str(python), 'main.py', '--cpu', '--listen', '127.0.0.1',
                                  '--port', str(port), '--disable-assets',
                                  '--user-directory', str(root / 'logs/install-user')], cwd=root / 'ComfyUI', stdout=log,
                                 stderr=subprocess.STDOUT)
    try:
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline:
            if child.poll() is not None:
                raise RuntimeError('Image engine startup failed. See logs/install-engine.log.')
            try:
                with urlopen(f'http://127.0.0.1:{port}/object_info', timeout=3) as response:
                    registry = json.load(response)
                break
            except (URLError, OSError):
                time.sleep(1)
        else:
            raise RuntimeError('Image engine startup timed out. See logs/install-engine.log.')
        prompt = compile_workflow(json.loads((root / 'studio/workflows/image-reconstruction.json').read_text()), registry)
        for node in prompt.values():
            if node['class_type'] == 'LoadImage':
                continue  # No user upload exists on a fresh install.
            schema = registry[node['class_type']]['input']
            for name, value in node['inputs'].items():
                spec = schema.get('required', {}).get(name, schema.get('optional', {}).get(name))
                if spec and isinstance(spec[0], list) and not isinstance(value, (list, dict)) and value not in spec[0]:
                    raise RuntimeError(f"Unavailable workflow setting: {node['class_type']}.{name}={value}")
        # rgthree's dynamic LoRA fields are not represented as enum inputs.
        say(f'Image engine checked: {len(prompt)} workflow nodes available.')
    finally:
        stop_process(child)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['auto', 'cpu', 'gpu'], default='auto')
    parser.add_argument('--desklib-only', action='store_true')
    args = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text())
    (ROOT / 'logs').mkdir(exist_ok=True)
    with (ROOT / 'logs/install.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another installer is already running in this folder.')
        if args.desklib_only:
            for asset in manifest['files']:
                if asset['path'].startswith('studio/models/desklib/'):
                    download(asset)
            say('Desklib detector models verified.')
            return
        mode = args.mode
        if mode == 'auto':
            nvidia = shutil.which('nvidia-smi')
            mode = 'gpu' if nvidia and subprocess.run([nvidia], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL).returncode == 0 else 'cpu'
        say(f'Installing Synth Forge in {ROOT} ({mode.upper()} mode).')
        remaining = 0
        for asset in manifest['files']:
            destination = ROOT / asset['path']
            partial = destination.with_name(destination.name + '.part')
            existing = max((file.stat().st_size for file in (destination, partial) if file.is_file()), default=0)
            remaining += max(0, asset['size'] - existing)
        if shutil.disk_usage(ROOT).free < remaining + 20 * GIB:
            raise RuntimeError(f'Free at least {(remaining / GIB) + 20:.0f} GiB in this folder before installing.')
        for repository in manifest['repositories']:
            say(f"Preparing {repository['path']}")
            checkout(repository)
        copy_nodes()
        python = ROOT / 'ComfyUI/.venv/bin/python'
        uv = ROOT / 'runtime/uv/uv'
        if not python.exists():
            run([uv, 'venv', '--python', sys.executable, '--seed', ROOT / 'ComfyUI/.venv'])
        constraints = ROOT / 'studio/install-constraints.txt'
        pip = [python, '-m', 'pip', 'install', '--disable-pip-version-check']
        backend = 'cu126' if mode == 'gpu' else 'cpu'
        run([*pip, f'torch==2.13.0+{backend}', f'torchvision==0.28.0+{backend}', '--index-url',
             'https://download.pytorch.org/whl/' + backend])
        # SAM2's source build uses the already-installed torch, avoiding a second
        # multi-GB build environment and optional CUDA compiler requirements.
        run([*pip, 'setuptools==84.2.1', 'wheel'])
        command = [*pip, '--no-build-isolation', '--constraint', constraints,
                   '--requirement', ROOT / 'studio/install-requirements.txt']
        run(command, env=dict(os.environ, SAM2_BUILD_CUDA='0', PIP_CONSTRAINT=str(constraints)))
        run([python, '-m', 'pip', 'check'])
        if mode == 'gpu':
            usable = subprocess.run([str(python), '-c',
                'import torch; assert torch.cuda.is_available(); torch.zeros(1, device="cuda")']).returncode == 0
            if not usable:
                if args.mode == 'gpu':
                    raise RuntimeError('NVIDIA acceleration is unavailable. Repair the driver or rerun with --cpu.')
                say('NVIDIA could not initialize. Using CPU mode (image processing will be slow).')
                mode = 'cpu'
        for asset in manifest['files']:
            download(asset)
        say('Preparing the local text engine and qwen2.5:7b model.')
        install_ollama()
        pull_text_model()
        say('Checking the installed image engine; this can take a few minutes.')
        verify_engine(python)
        configuration = ROOT / 'runtime/install.json'
        temporary = configuration.with_suffix('.tmp')
        temporary.write_text(json.dumps({'mode': mode, 'manifest_sha256':
            hashlib.sha256(MANIFEST.read_bytes()).hexdigest()}, indent=2) + '\n')
        temporary.replace(configuration)
        say('Setup complete. Start any time with: bash start-forge.sh')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, OSError, ValueError) as error:
        print(f'Setup failed: {error}\nRerun bash install.sh after fixing the error.', file=sys.stderr)
        sys.exit(1)
