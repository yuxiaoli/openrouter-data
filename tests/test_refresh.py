import contextlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from fetch_snapshot import fetch, probe

ID = "2026-11-10T093020Z-example"
SHA = "a" * 40
INDEX = {"last_success": ID, "snapshots": [{"id": ID, "status": "success", "completed_at": "2026-11-10T09:36:43Z"}]}

class RefreshTests(unittest.TestCase):
    def run_probe(self, published, force=False, index=None):
        index = index or INDEX
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            outputs = root / "outputs"
            def responses(url):
                return json.dumps(index if url.endswith("public-index.json") else published).encode()
            with patch('fetch_snapshot.resolve_revision', return_value=SHA), patch('fetch_snapshot.get', side_effect=responses), patch.dict(os.environ, {'GITHUB_SHA':'b'*40, 'GITHUB_OUTPUT':str(outputs)}), contextlib.redirect_stdout(io.StringIO()):
                state = probe(root, 'https://example.invalid/charts', force)
            return state, outputs.read_text()
    def published(self):
        return {'archive_revision':SHA, 'snapshot':ID, 'source_commit':'b'*40, 'latest_attempt':INDEX['snapshots'][0]}
    def test_unchanged_skips_regeneration(self):
        _, output = self.run_probe(self.published())
        self.assertIn('changed=false', output)
    def test_code_change_rebuilds(self):
        published = self.published(); published['source_commit'] = 'c'*40
        _, output = self.run_probe(published)
        self.assertIn('changed=true', output)
    def test_new_failed_attempt_updates_warning_not_data(self):
        index = {'last_success': ID, 'snapshots': [{'id':'2026-11-11T000000Z-failed','status':'failed','completed_at':'2026-11-11T00:01:00Z'}, *INDEX['snapshots']]}
        state, output = self.run_probe(self.published(), index=index)
        self.assertEqual(state['snapshot'], ID)
        self.assertEqual(state['latest_attempt']['status'], 'failed')
        self.assertIn('changed=true', output)
    def test_manual_force_rebuilds(self):
        _, output = self.run_probe(self.published(), force=True)
        self.assertIn('changed=true', output)
    def test_snapshot_mismatch_fails_before_fetch(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root/'state.json').write_text(json.dumps({'archive_revision':SHA,'snapshot':'../../bad'}))
            (root/'public-index.json').write_text(json.dumps(INDEX))
            with patch('fetch_snapshot.get') as get, self.assertRaises(ValueError):
                fetch(root)
            get.assert_not_called()
    def test_production_fetch_requires_storage_checksums(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root/'state.json').write_text(json.dumps({'archive_revision':SHA,'snapshot':ID}))
            (root/'public-index.json').write_text(json.dumps(INDEX))
            archive = SimpleNamespace(reports={'models':{}},storage={})
            with patch('fetch_snapshot.get', return_value=b'{}'), patch('fetch_snapshot.Archive',return_value=archive), self.assertRaisesRegex(ValueError,'required storage checksums'):
                fetch(root)

if __name__ == '__main__':
    unittest.main()
