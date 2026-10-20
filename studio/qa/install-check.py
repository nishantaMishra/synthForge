"""Installer recovery and process ownership checks; no internet or model inference."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import installer
import local_runtime


class InstallChecks(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='forge install ')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / 'source.bin'
        self.data = bytes(range(256)) * 400
        self.source.write_bytes(self.data)
        self.asset = {'path': 'models/test.bin', 'url': self.source.as_uri(),
                      'size': len(self.data), 'sha256': hashlib.sha256(self.data).hexdigest()}
        self.target = self.root / self.asset['path']

    def test_download_and_rerun_skip_verified_file(self):
        installer.download(self.asset, self.root)
        self.assertEqual(self.target.read_bytes(), self.data)
        with patch('installer.subprocess.run') as run:
            installer.download(self.asset, self.root)
        run.assert_not_called()

    def test_interrupted_download_resumes_to_verified_result(self):
        partial = self.target.with_suffix('.bin.part')
        def interrupted(command):
            partial.write_bytes(self.data[:13000])
            return subprocess.CompletedProcess(command, 18)
        with patch('installer.subprocess.run', side_effect=interrupted):
            with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                installer.download(self.asset, self.root)
        self.assertFalse(self.target.exists())
        self.assertEqual(partial.stat().st_size, 13000)
        installer.download(self.asset, self.root)
        self.assertEqual(self.target.read_bytes(), self.data)
        self.assertFalse(partial.exists())

    def test_complete_partial_is_promoted_without_network(self):
        self.target.parent.mkdir()
        self.target.with_suffix('.bin.part').write_bytes(self.data)
        with patch('installer.subprocess.run') as run:
            installer.download(self.asset, self.root)
        run.assert_not_called()
        self.assertEqual(self.target.read_bytes(), self.data)

    def test_corrupt_existing_file_is_preserved_and_repaired(self):
        self.target.parent.mkdir()
        self.target.write_bytes(b'corrupt')
        installer.download(self.asset, self.root)
        self.assertEqual(self.target.with_suffix('.bin.invalid').read_bytes(), b'corrupt')
        self.assertEqual(self.target.read_bytes(), self.data)

    def test_checksum_failure_does_not_publish_a_model(self):
        def corrupt(command):
            self.target.with_suffix('.bin.part').write_bytes(b'x' * len(self.data))
            return subprocess.CompletedProcess(command, 0)
        with patch('installer.subprocess.run', side_effect=corrupt):
            with self.assertRaisesRegex(RuntimeError, 'verify'):
                installer.download(self.asset, self.root)
        self.assertFalse(self.target.exists())

    def test_git_blob_checksum_for_small_huggingface_files(self):
        self.asset.pop('sha256')
        self.asset['git_blob_sha1'] = hashlib.sha1(
            f'blob {len(self.data)}\0'.encode() + self.data).hexdigest()
        installer.download(self.asset, self.root)
        self.assertTrue(installer.valid_file(self.target, self.asset))

    def test_server_without_range_support_restarts_partial(self):
        self.target.parent.mkdir()
        partial = self.target.with_suffix('.bin.part')
        partial.write_bytes(self.data[:100])
        calls = []
        def transfer(command):
            calls.append(command)
            if len(calls) == 1:
                return subprocess.CompletedProcess(command, 33)
            self.assertFalse(partial.exists())
            partial.write_bytes(self.data)
            return subprocess.CompletedProcess(command, 0)
        with patch('installer.subprocess.run', side_effect=transfer):
            installer.download(self.asset, self.root)
        self.assertEqual(len(calls), 2)
        self.assertEqual(self.target.read_bytes(), self.data)

    def test_checkout_pins_revision_and_preserves_local_changes(self):
        upstream = self.root / 'upstream'
        subprocess.run(['git', 'init', '-q', str(upstream)], check=True)
        (upstream / 'example').write_text('original')
        subprocess.run(['git', '-C', str(upstream), 'add', 'example'], check=True)
        subprocess.run(['git', '-C', str(upstream), '-c', 'user.name=Fixture',
                        '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture'], check=True)
        revision = subprocess.check_output(['git', '-C', str(upstream), 'rev-parse', 'HEAD'], text=True).strip()
        repository = {'path': 'installed', 'url': str(upstream), 'revision': revision}
        installer.checkout(repository, self.root)
        installer.checkout(repository, self.root)
        target = self.root / 'installed/example'
        target.write_text('user edit')
        with self.assertRaisesRegex(RuntimeError, 'local edits'):
            installer.checkout(repository, self.root)
        self.assertEqual(target.read_text(), 'user edit')
        repository['revision'] = '0' * 40
        with self.assertRaisesRegex(RuntimeError, 'supported version'):
            installer.checkout(repository, self.root)

    def test_external_ollama_is_reused_without_starting_a_process(self):
        with patch('local_runtime.ollama_ready', return_value=True), patch('local_runtime.subprocess.Popen') as spawn:
            self.assertIsNone(local_runtime.start_ollama(self.root))
        spawn.assert_not_called()

    def test_owned_ollama_uses_local_model_store(self):
        binary = self.root / 'runtime/ollama/bin/ollama'
        binary.parent.mkdir(parents=True)
        binary.touch()
        child = Mock()
        child.poll.return_value = None
        with patch('local_runtime.ollama_ready', side_effect=[False, True]), patch(
                'local_runtime.subprocess.Popen', return_value=child) as spawn:
            self.assertIs(local_runtime.start_ollama(self.root), child)
        self.assertEqual(spawn.call_args.kwargs['env']['OLLAMA_HOST'], '127.0.0.1:11434')
        self.assertEqual(spawn.call_args.kwargs['env']['OLLAMA_MODELS'], str(self.root / 'runtime/ollama-models'))
        local_runtime.stop_process(child)
        child.terminate.assert_called_once()

    def test_failed_ollama_start_cleans_up_owned_process(self):
        binary = self.root / 'runtime/ollama/bin/ollama'
        binary.parent.mkdir(parents=True)
        binary.touch()
        child = Mock()
        child.poll.return_value = None
        with patch('local_runtime.ollama_ready', return_value=False), patch(
                'local_runtime.subprocess.Popen', return_value=child), patch('local_runtime.time.sleep'):
            with self.assertRaisesRegex(RuntimeError, 'did not start'):
                local_runtime.start_ollama(self.root)
        child.terminate.assert_called_once()

    def test_manifest_covers_every_workflow_model(self):
        manifest = json.loads(installer.MANIFEST.read_text())
        names = {Path(asset['path']).name for asset in manifest['files']}
        workflow = json.loads((installer.ROOT / 'studio/workflows/image-reconstruction.json').read_text())
        for node in workflow['nodes']:
            for value in node.get('widgets_values', []):
                if isinstance(value, dict):
                    value = value.get('lora', '')
                if isinstance(value, str) and value.endswith(('.gguf', '.safetensors', '.pth', '.pt')):
                    self.assertIn(Path(value).name, names)
        for asset in manifest['files']:
            self.assertGreater(asset['size'], 0)
            self.assertTrue(asset.get('sha256') or asset.get('git_blob_sha1'))
            self.assertFalse(Path(asset['path']).is_absolute())
            self.assertNotIn('..', Path(asset['path']).parts)


if __name__ == '__main__':
    unittest.main()
