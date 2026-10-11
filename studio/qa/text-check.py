"""Meaning-preservation and text lifecycle regressions without model downloads."""
import asyncio
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from text_pipeline import TextStudio, UnusableEdit, candidate_check, chunks, decode_file, protected


class PreservationChecks(unittest.TestCase):
    def test_encoding_round_trip(self):
        for encoding, bom in [('utf-8', b''), ('utf-8', b'\xef\xbb\xbf'), ('utf-16-le', b'\xff\xfe'), ('utf-16-be', b'\xfe\xff'), ('cp1252', b'')]:
            source = 'Maria’s schedule\r\n\r\nThe budget is $42.50.\r\n'
            data = bom + source.encode(encoding)
            text, detected, marker = decode_file(data)
            self.assertEqual(text, source)
            self.assertEqual(bytes.fromhex(marker) + text.encode(detected), data)

    def test_facts_qualifications_and_quotes_cannot_change(self):
        source = 'Maria may deliver 42 boxes in June 2025. She said "not yet". See https://example.com/report.'
        for candidate in [source.replace('42', '43'), source.replace('Maria', 'Marie'), source.replace('may', 'will'),
                          source.replace('not yet', 'ready now'), source.replace('/report', '/other')]:
            actual, reason, _ = candidate_check(source, candidate, .5, 'utf-8')
            self.assertEqual(actual, source)
            self.assertTrue(reason)
        source = "Maria can't deliver 42 boxes."
        self.assertEqual(candidate_check(source, source.replace("can't", 'can'), 1, 'utf-8')[0], source)
        source = 'The decrease was 10% and the budget was $42.'
        self.assertEqual(candidate_check(source, source.replace('10%', '10'), 1, 'utf-8')[0], source)
        self.assertEqual(candidate_check(source, source.replace('$42', '42'), 1, 'utf-8')[0], source)

    def test_small_edit_is_allowed_and_structure_is_preserved(self):
        source = 'Maria has planned to deliver 42 boxes in June 2025.\r\n'
        candidate = source.replace('planned', 'scheduled')
        actual, reason, change = candidate_check(source, candidate, .12, 'utf-8')
        self.assertEqual(actual, candidate)
        self.assertFalse(reason)
        self.assertLess(change, .12)
        original = '# Schedule\n- Maria may deliver 42 boxes.\n'
        altered = original.replace('# Schedule\n- ', 'Schedule\n')
        self.assertEqual(candidate_check(original, altered, 1, 'utf-8')[0], original)

    def test_chunks_retain_every_character_and_fenced_code(self):
        source = 'Prose sentence. '*600 + '\r\n\r\n```python\r\nvalue = 42\r\n```\r\n\r\nMore prose.\r\n'
        pieces = chunks(source)
        self.assertEqual(''.join(part for part, editable in pieces), source)
        code = next((part, editable) for part, editable in pieces if 'value = 42' in part)
        self.assertFalse(code[1])
        source = 'Intro.\n\n```python\nvalue = 42\n'
        pieces = chunks(source)
        self.assertEqual(''.join(part for part, editable in pieces), source)
        self.assertFalse(pieces[-1][1], 'An unclosed code fence must remain unchanged')

    def test_mixed_line_endings_and_markdown_hard_breaks(self):
        source = 'Maria has planned to deliver 42 boxes.  \r\nThe team may follow.\nAll records remain.\rFinal note.'
        proposed = source.replace('planned', 'scheduled').replace('\r\n', '\n').replace('\r', '\n').replace('  \n', '\n')
        actual, reason, _ = candidate_check(source, proposed, .12, 'utf-8')
        self.assertFalse(reason)
        self.assertEqual(actual, source.replace('planned', 'scheduled'))

    def test_excessive_edits_and_unencodable_edits_keep_original(self):
        source = 'The plan is clear and the team is ready.'
        self.assertEqual(candidate_check(source, 'The proposal describes a completely different approach.', .12, 'utf-8')[0], source)
        self.assertEqual(candidate_check(source, source + ' 😀', 1, 'cp1252')[0], source)


class LifecycleChecks(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        class Response:
            status = 200
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def json(self): return {'done': True}
        self.manager = TextStudio(SimpleNamespace(session=SimpleNamespace(post=lambda *args, **kwargs: Response())), self.root)
        self.source = 'Maria has planned to deliver 42 boxes in June 2025.\r\n'
        identifier = str(uuid4())
        directory = self.root / 'data/text/uploads' / identifier
        directory.mkdir(parents=True)
        (directory / 'example.txt').write_bytes(b'\xff\xfe' + self.source.encode('utf-16-le'))
        (directory / 'metadata.json').write_text(json.dumps({'id': identifier, 'filename': 'example.txt', 'encoding': 'utf-16-le', 'bom': 'fffe', 'words': 12}))
        self.report = {'id': str(uuid4()), 'prompt_id': '', 'status': 'queued', 'input_id': identifier, 'model': 'fixture', 'edit_limit': .12, 'nodes': {}}
        self.manager.save(self.report)

    async def asyncTearDown(self):
        await self.manager.close()
        self.temp.cleanup()

    async def run_fixture(self, preserved):
        async def chat(model, instruction, content, schema, tokens):
            if preserved is None:
                raise UnusableEdit('Fixture partial model response')
            if 'text' in schema['properties']:
                return {'text': self.source.replace('planned', 'scheduled')}
            return {'preserved': preserved, 'reason': 'Fixture semantic assessment'}
        self.manager.chat = chat
        class Detector:
            returncode = 0
            async def communicate(self):
                return json.dumps({'outcome': 'not_detected', 'probability': .25, 'message': 'Fixture estimate'}).encode(), b''
        async def spawn(*args, **kwargs): return Detector()
        with patch('text_pipeline.asyncio.create_subprocess_exec', spawn):
            await self.manager.run(self.report)
        filename = self.root / 'data/text/jobs' / self.report['id'] / 'example-processed.txt'
        return filename.read_bytes()

    async def test_output_preserves_bom_line_endings_and_reports_real_outcome(self):
        data = await self.run_fixture(True)
        self.assertEqual(data, b'\xff\xfe' + self.source.replace('planned', 'scheduled').encode('utf-16-le'))
        self.assertEqual(self.report['status'], 'complete')
        self.assertEqual(self.report['output']['changed_passages'], 1)
        self.assertEqual(self.report['verification']['providers'][0]['outcome'], 'not_detected')

    async def test_semantic_rejection_retains_original(self):
        data = await self.run_fixture(False)
        self.assertEqual(data, b'\xff\xfe' + self.source.encode('utf-16-le'))
        self.assertEqual(self.report['output']['changed_passages'], 0)
        self.assertEqual(len(self.report['nodes']['text-meaning']['details']['retained_passages']), 1)

    async def test_partial_model_output_cannot_truncate_the_file(self):
        data = await self.run_fixture(None)
        self.assertEqual(data, b'\xff\xfe' + self.source.encode('utf-16-le'))
        self.assertEqual(self.report['status'], 'complete')
        self.assertEqual(self.report['output']['changed_passages'], 0)

    async def test_cancellation_while_queued(self):
        self.manager.reports[self.report['id']] = self.report
        await self.manager.lock.acquire()
        self.manager.tasks[self.report['id']] = asyncio.create_task(self.manager.run(self.report))
        await asyncio.sleep(0)
        await self.manager.cancel(SimpleNamespace(match_info={'identifier': self.report['id']}))
        self.manager.lock.release()
        self.assertEqual(self.report['status'], 'cancelled')
        self.assertNotIn('output', self.report)


if __name__ == '__main__': unittest.main()
