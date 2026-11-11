import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import build_site
import check_contracts


class ChartPreservationTests(unittest.TestCase):
    def test_all_original_modules_preserved(self):
        receipt = json.loads((ROOT / "docs/chart-cli-source-provenance.json").read_text())
        self.assertEqual(len(receipt["preserved_files"]), 6)
        for entry in receipt["preserved_files"]:
            with self.subTest(path=entry["path"]):
                body = (ROOT / entry["preserved_original_path"]).read_bytes()
                self.assertEqual(hashlib.sha256(body).hexdigest(), entry["sha256"])
                self.assertEqual(hashlib.sha1(b"blob " + str(len(body)).encode() + b"\0" + body).hexdigest(), entry["git_blob"])
                if entry.get("adapted_sha256"):
                    self.assertEqual(hashlib.sha256((ROOT / entry["path"]).read_bytes()).hexdigest(), entry["adapted_sha256"])

    def test_legacy_assets_are_namespaced(self):
        self.assertEqual(build_site.LEGACY_ASSETS, ROOT / "scripts/legacy_chart_gallery")
        self.assertEqual(check_contracts.ROOT, build_site.LEGACY_ASSETS)
        self.assertTrue((build_site.LEGACY_ASSETS / "web/index.html").is_file())
        self.assertTrue((check_contracts.ROOT / "schemas/version.schema.json").is_file())

    def test_python_addition_does_not_change_typescript_build_command(self):
        package = json.loads((ROOT / "package.json").read_text())
        self.assertEqual(package["scripts"]["build"], "tsx scripts/build.ts")
        self.assertEqual(package["scripts"]["sync"], "tsx scripts/sync.ts")


if __name__ == "__main__":
    unittest.main()
