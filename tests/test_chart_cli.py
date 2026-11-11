import contextlib
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import generate_charts as cli
from archive import CHART_DATASETS, PUBLIC_DATASETS

SNAPSHOT = "2026-11-10T093020Z-example"
REVISION = "a" * 40


class ChartCliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.root = self.base / "archive"
        self.run = self.root / "runs" / SNAPSHOT
        self.run.mkdir(parents=True)
        self.output = self.base / "exports"
        self.index = {"last_success": SNAPSHOT, "snapshots": [
            {"id": SNAPSHOT, "status": "success", "completed_at": "2026-11-10T09:36:43Z"}]}
        self.save_index()
        (self.root / "state.json").write_text(json.dumps({
            "archive_revision": REVISION, "snapshot": SNAPSHOT}))
        manifest = {"id": SNAPSHOT, "status": "success", "completed_at": "2026-11-10T09:36:43Z",
                    "datasets": [{"id": name, "status": "ok", "access": "public", "record_count": 1}
                                 for name in PUBLIC_DATASETS]}
        (self.run / "manifest.json").write_text(json.dumps(manifest))
        storage = {}
        for name in CHART_DATASETS:
            data = b'{"data":[{"id":"public/example"}]}'
            path = name + ".json"
            (self.run / path).write_bytes(data)
            storage[path] = {"physical_path": path, "encoding": "identity",
                             "physical_sha256": hashlib.sha256(data).hexdigest(),
                             "logical_sha256": hashlib.sha256(data).hexdigest()}
        (self.run / "storage.json").write_text(json.dumps({"files": storage}))

    def tearDown(self):
        self.temp.cleanup()

    def save_index(self):
        (self.root / "public-index.json").write_text(json.dumps(self.index))

    def render(self, command, *, check, env, stdout):
        self.assertEqual(env["OPENROUTER_SNAPSHOT"], SNAPSHOT)
        out = Path(env["OPENROUTER_OUTPUT"])
        charts = []
        for number in range(1, 15):
            name = f"{number:02}_fixture.png"
            (out / name).write_bytes(cli.PNG_HEADER + b"unit-test-only")
            charts.append({"file": name, "title": "fixture", "notes": "scope caveat",
                           "snapshot": SNAPSHOT, "datasets": ["models"],
                           "source_urls": [f"https://example.invalid/data?snapshot={SNAPSHOT}"]})
        (out / "sources_and_scope.json").write_text(json.dumps({"snapshot": SNAPSHOT, "charts": charts}))

    def test_preserves_all_chart_provenance_and_original_inputs(self):
        before = {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        with patch("generate_charts.subprocess.run", side_effect=self.render):
            result = cli.generate(self.root, self.output)
        self.assertEqual(result["archive_revision"], REVISION)
        self.assertEqual(result["chart_count"], 14)
        self.assertEqual(result["verified_chart_dataset_count"], 23)
        self.assertEqual(result["public_dataset_count"], 28)
        self.assertEqual(len(result["outputs"]), 14)
        self.assertEqual(result["original_code"]["commit"], cli.ORIGIN_COMMIT)
        for name, digest in result["outputs"].items():
            self.assertEqual(cli.sha256(self.output / name), digest)
        self.assertEqual(before, {p.relative_to(self.root): p.read_bytes()
                                 for p in self.root.rglob("*") if p.is_file()})
        self.assertFalse((self.output / "index.html").exists())
        self.assertFalse(list(self.base.glob(".chart-cli-*")))

    def test_existing_output_preserved(self):
        self.output.mkdir()
        (self.output / "important.txt").write_text("keep")
        with patch("generate_charts.subprocess.run") as render, self.assertRaisesRegex(ValueError, "already exists"):
            cli.generate(self.root, self.output)
        render.assert_not_called()
        self.assertEqual((self.output / "important.txt").read_text(), "keep")

    def test_broken_symlink_rejected(self):
        self.output.symlink_to(self.base / "missing", target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "already exists"):
            cli.generate(self.root, self.output)

    def test_output_inside_archive_rejected(self):
        with self.assertRaisesRegex(ValueError, "outside"):
            cli.generate(self.root, self.root / "charts")

    def test_new_failed_attempt_retains_complete_snapshot(self):
        self.index["snapshots"].insert(0, {"id": "2026-11-11T000000Z-failed", "status": "failed"})
        self.save_index()
        with patch("generate_charts.subprocess.run", side_effect=self.render):
            result = cli.generate(self.root, self.output)
        self.assertEqual(result["snapshot"], SNAPSHOT)
        self.assertEqual(result["latest_attempt"]["status"], "failed")

    def test_partial_snapshot_rejected_before_renderer(self):
        self.index["snapshots"][0]["status"] = "partial"
        self.save_index()
        with patch("generate_charts.subprocess.run") as render, self.assertRaises(ValueError):
            cli.generate(self.root, self.output)
        render.assert_not_called()

    def test_corrupted_dataset_rejected_before_renderer(self):
        (self.run / "models.json").write_text("corrupted")
        with patch("generate_charts.subprocess.run") as render, self.assertRaisesRegex(ValueError, "checksum"):
            cli.generate(self.root, self.output)
        render.assert_not_called()

    def test_missing_checksum_rejected(self):
        (self.run / "storage.json").unlink()
        with self.assertRaisesRegex(ValueError, "storage checksums"):
            cli.generate(self.root, self.output)

    def test_conflicting_revision_rejected(self):
        with self.assertRaisesRegex(ValueError, "conflicts"):
            cli.generate(self.root, self.output, "b" * 40)

    def test_revision_and_state_validation(self):
        (self.root / "state.json").write_text(json.dumps({"snapshot": "other", "archive_revision": REVISION}))
        with self.assertRaisesRegex(ValueError, "disagree"):
            cli.generate(self.root, self.output)
        (self.root / "state.json").unlink()
        with self.assertRaisesRegex(ValueError, "40-character"):
            cli.generate(self.root, self.output, "unverified")
        with patch("generate_charts.subprocess.run", side_effect=self.render):
            self.assertEqual(cli.generate(self.root, self.output, REVISION)["archive_revision"], REVISION)

    def test_renderer_failure_leaves_no_partial_output(self):
        with patch("generate_charts.subprocess.run", side_effect=subprocess.CalledProcessError(1, "renderer")):
            with self.assertRaises(subprocess.CalledProcessError):
                cli.generate(self.root, self.output)
        self.assertFalse(self.output.exists())
        self.assertFalse(list(self.base.glob(".chart-cli-*")))

    def test_incomplete_render_rejected(self):
        def partial(*args, **kwargs):
            self.render(*args, **kwargs)
            target = Path(kwargs["env"]["OPENROUTER_OUTPUT"]) / "sources_and_scope.json"
            metadata = json.loads(target.read_text())
            metadata["charts"].pop()
            target.write_text(json.dumps(metadata))
        with patch("generate_charts.subprocess.run", side_effect=partial), self.assertRaisesRegex(ValueError, "fourteen"):
            cli.generate(self.root, self.output)
        self.assertFalse(self.output.exists())

    def test_output_appearing_during_render_is_preserved(self):
        def concurrent(*args, **kwargs):
            self.render(*args, **kwargs)
            self.output.mkdir()
            (self.output / "keep.txt").write_text("keep")
        with patch("generate_charts.subprocess.run", side_effect=concurrent), self.assertRaisesRegex(ValueError, "appeared"):
            cli.generate(self.root, self.output)
        self.assertEqual((self.output / "keep.txt").read_text(), "keep")

    def test_invalid_output_metadata_is_rejected(self):
        mutations = [
            lambda metadata: metadata["charts"][0].update(file="../outside.png"),
            lambda metadata: metadata["charts"][0].update(file=metadata["charts"][1]["file"]),
            lambda metadata: metadata["charts"][0].update(snapshot="wrong"),
            lambda metadata: metadata["charts"][0].update(datasets=["authenticated_data"]),
            lambda metadata: metadata["charts"][0].update(source_urls=[]),
        ]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                def invalid(*args, **kwargs):
                    self.render(*args, **kwargs)
                    target = Path(kwargs["env"]["OPENROUTER_OUTPUT"]) / "sources_and_scope.json"
                    metadata = json.loads(target.read_text())
                    mutate(metadata)
                    target.write_text(json.dumps(metadata))
                with patch("generate_charts.subprocess.run", side_effect=invalid), self.assertRaises(ValueError):
                    cli.generate(self.root, self.output)
                self.assertFalse(self.output.exists())
                self.assertFalse(list(self.base.glob(".chart-cli-*")))

    def test_invalid_png_rejected(self):
        def invalid(*args, **kwargs):
            self.render(*args, **kwargs)
            (Path(kwargs["env"]["OPENROUTER_OUTPUT"]) / "01_fixture.png").write_bytes(b"not a PNG")
        with patch("generate_charts.subprocess.run", side_effect=invalid), self.assertRaisesRegex(ValueError, "PNG"):
            cli.generate(self.root, self.output)
        self.assertFalse(self.output.exists())

    def test_command_failure_is_nonzero_and_readable(self):
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr), self.assertRaises(SystemExit) as result:
            cli.main(["--archive-root", str(self.base / "missing"), "--output", str(self.output)])
        self.assertEqual(result.exception.code, 1)
        self.assertIn("Chart generation failed", stderr.getvalue())
        self.assertFalse(self.output.exists())

    def test_main_prints_machine_readable_provenance(self):
        stdout = io.StringIO()
        with patch("generate_charts.subprocess.run", side_effect=self.render), contextlib.redirect_stdout(stdout):
            code = cli.main(["--archive-root", str(self.root), "--output", str(self.output)])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(stdout.getvalue())["snapshot"], SNAPSHOT)


if __name__ == "__main__":
    unittest.main()
