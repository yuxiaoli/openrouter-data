import copy
import gzip
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from archive import Archive, PUBLIC_DATASETS, safe_relative, select_snapshot

ID = "2026-11-10T093020Z-test"

class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.run = self.root / "runs" / ID
        self.run.mkdir(parents=True)
        self.manifest = {"id": ID, "status": "success", "datasets": [
            {"id": n, "status": "ok", "access": "public", "record_count": 1} for n in PUBLIC_DATASETS]}
        self.save_manifest()
    def tearDown(self):
        self.temp.cleanup()
    def save_manifest(self):
        (self.run / "manifest.json").write_text(json.dumps(self.manifest))
    def test_success_selected_without_mixing_latest_partial(self):
        self.assertEqual(select_snapshot({"last_success": ID, "snapshots": [
            {"id": "2026-11-11T000000Z-partial", "status": "partial"},
            {"id": ID, "status": "success"}]}), ID)
    def test_failed_pointer_rejected(self):
        with self.assertRaises(ValueError):
            select_snapshot({"last_success": ID, "snapshots": [{"id": ID, "status": "failed"}]})
    def test_missing_success_rejected(self):
        with self.assertRaises(ValueError):
            select_snapshot({"last_success": None, "snapshots": []})
    def test_safe_paths(self):
        self.assertEqual(safe_relative("chunks/models/part-00001.json"), "chunks/models/part-00001.json")
        for value in ("../x", "/x", "a//b", "a/../x", "a\\b", "https://evil/x", ".", ""):
            with self.subTest(value=value), self.assertRaises(ValueError):
                safe_relative(value)
    def test_public_dataset_allowlist(self):
        with self.assertRaises(ValueError):
            Archive(self.root, ID).load("authenticated_data")
    def test_partial_manifest_rejected(self):
        self.manifest["status"] = "partial"
        self.save_manifest()
        with self.assertRaises(ValueError):
            Archive(self.root, ID)
    def test_missing_required_dataset_rejected(self):
        self.manifest["datasets"].pop()
        self.save_manifest()
        with self.assertRaises(ValueError):
            Archive(self.root, ID)
    def test_failed_dataset_rejected(self):
        self.manifest["datasets"][0]["status"] = "failed"
        self.save_manifest()
        with self.assertRaises(ValueError):
            Archive(self.root, ID)
    def test_private_dataset_rejected(self):
        self.manifest["datasets"][0]["access"] = "authenticated"
        self.save_manifest()
        with self.assertRaises(ValueError):
            Archive(self.root, ID)
    def test_plain_and_legacy_gzip(self):
        data = json.dumps({"data": [{"id": "example/model"}]}).encode()
        (self.run / "models.json").write_bytes(data)
        self.assertEqual(len(Archive(self.root, ID).load("models")), 1)
        (self.run / "models.json").unlink()
        (self.run / "models.json.gz").write_bytes(gzip.compress(data))
        self.assertEqual(len(Archive(self.root, ID).load("models")), 1)
    def test_record_count_mismatch(self):
        (self.run / "models.json").write_text('{"data": []}')
        with self.assertRaises(ValueError):
            Archive(self.root, ID).load("models")
    def test_checksum_corruption_rejected(self):
        logical = b'{"data": [{"id": "example/model"}]}'
        compressed = gzip.compress(logical)
        (self.run / "models.json.gz").write_bytes(compressed)
        storage = {"files": {"models.json": {"physical_path": "models.json.gz", "encoding": "gzip", "logical_sha256": hashlib.sha256(logical).hexdigest(), "physical_sha256": hashlib.sha256(compressed).hexdigest()}}}
        (self.run / "storage.json").write_text(json.dumps(storage))
        self.assertEqual(len(Archive(self.root, ID).load("models")), 1)
        (self.run / "models.json.gz").write_bytes(compressed + b"corrupt")
        with self.assertRaisesRegex(ValueError, "Physical checksum"):
            Archive(self.root, ID).load("models")
    def test_logical_checksum_rejected(self):
        logical = b'{"data": [{"id": "example/model"}]}'
        compressed = gzip.compress(logical)
        (self.run / "models.json.gz").write_bytes(compressed)
        storage = {"files": {"models.json": {"physical_path": "models.json.gz", "encoding": "gzip", "logical_sha256": "0" * 64, "physical_sha256": hashlib.sha256(compressed).hexdigest()}}}
        (self.run / "storage.json").write_text(json.dumps(storage))
        with self.assertRaisesRegex(ValueError, "Logical checksum"):
            Archive(self.root, ID).load("models")
    def test_chunk_dataset_boundary(self):
        self.manifest["datasets"][0]["chunks"] = ["chunks/providers/part-00001.json"]
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, "another dataset"):
            Archive(self.root, ID).load("models")
    def test_chunk_count(self):
        r = self.manifest["datasets"][0]
        r["chunks"] = ["chunks/models/part-00001.json"]
        r["chunk_counts"] = {r["chunks"][0]: 2}
        self.save_manifest()
        path = self.run / r["chunks"][0]
        path.parent.mkdir(parents=True)
        path.write_text('{"data": [{"id": "a"}]}')
        with self.assertRaisesRegex(ValueError, "Chunk count"):
            Archive(self.root, ID).load("models")

if __name__ == "__main__":
    unittest.main()
