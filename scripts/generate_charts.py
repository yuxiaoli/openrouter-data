"""Generate the preserved fourteen PNG charts, without building or changing a website.

Inputs are an already downloaded public archive or a read-only archive checkout.
This command makes no network requests and never starts another collector.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

from archive import Archive, CHART_DATASETS, PUBLIC_DATASETS, select_snapshot

SCRIPTS = Path(__file__).resolve().parent
ORIGIN_REPOSITORY = "https://github.com/yuxiaoli/openrouter-charts"
ORIGIN_COMMIT = "928a2e7a0c02e2aaaac9723b8549fbfacfbafd56"
ARCHIVE_REPOSITORY = "https://github.com/yuxiaoli/openrouter-data"
PNG_HEADER = b"\x89PNG\r\n\x1a\n"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def archive_revision(root: Path, snapshot: str, explicit: str | None) -> str:
    state_path = root / "state.json"
    state = json.loads(state_path.read_text()) if state_path.is_file() else {}
    if state and state.get("snapshot") != snapshot:
        raise ValueError("Archive state and index disagree on the selected snapshot")
    recorded = state.get("archive_revision")
    if recorded and explicit and recorded != explicit:
        raise ValueError("Explicit archive revision conflicts with the downloaded archive state")
    revision = explicit or recorded
    if not revision:
        revision = subprocess.check_output(
            ["git", "-C", str(root), "rev-parse", "HEAD"], text=True
        ).strip()
    if not isinstance(revision, str) or not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("A full 40-character archive commit is required for provenance")
    return revision


def generate(root: Path, output: Path, revision: str | None = None) -> dict:
    root = root.resolve()
    # Never replace an existing folder, archive, website, or previous generation.
    # Lexical existence also rejects broken symlinks.
    if output.exists() or output.is_symlink():
        raise ValueError("Output already exists; choose a new output directory")
    output = output.resolve()
    if output.is_relative_to(root) or root.is_relative_to(output):
        raise ValueError("Output must be outside the read-only archive")
    index = json.loads((root / "public-index.json").read_text())
    snapshot = select_snapshot(index)
    revision = archive_revision(root, snapshot, revision)
    archive = Archive(root, snapshot)
    # The CLI is stricter than the legacy reader: checksum metadata is mandatory.
    for name in CHART_DATASETS:
        for part in archive.reports[name].get("chunks") or [name + ".json"]:
            if part not in archive.storage:
                raise ValueError(f"Chart input lacks required storage checksums: {part}")
        archive.load(name)

    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".chart-cli-", dir=output.parent))
    try:
        env = {**os.environ, "OPENROUTER_ARCHIVE_ROOT": str(root),
               "OPENROUTER_SNAPSHOT": snapshot, "OPENROUTER_OUTPUT": str(staging)}
        subprocess.run([sys.executable, str(SCRIPTS / "render_charts.py")],
                       check=True, env=env, stdout=sys.stderr)
        metadata = json.loads((staging / "sources_and_scope.json").read_text())
        charts = metadata.get("charts", [])
        names = [chart.get("file") for chart in charts]
        if (metadata.get("snapshot") != snapshot or len(charts) != 14
                or any(not isinstance(name, str) for name in names)
                or len(set(names)) != 14):
            raise ValueError("Renderer must produce fourteen unique charts for one snapshot")
        for chart in charts:
            name = chart["file"]
            if Path(name).name != name or not name.endswith(".png"):
                raise ValueError("Unsafe chart output filename")
            path = staging / name
            if path.is_symlink() or not path.is_file() or path.read_bytes()[:8] != PNG_HEADER:
                raise ValueError("Invalid chart PNG output")
            if (chart.get("snapshot") != snapshot or not chart.get("datasets")
                    or not chart.get("notes") or not chart.get("title")):
                raise ValueError("Chart is missing its original scope or source metadata")
            if not all(name in PUBLIC_DATASETS for name in chart["datasets"]):
                raise ValueError("Chart references a non-public dataset")
            urls = chart.get("source_urls", [])
            if len(urls) != len(chart["datasets"]) or not all(
                    "snapshot=" + snapshot in url for url in urls):
                raise ValueError("Chart sources must identify the selected snapshot")
            chart["sha256"] = sha256(path)
        (staging / "sources_and_scope.json").write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")
        provenance = {
            "schema_version": 1,
            "tool": "openrouter-chart-cli",
            "original_code": {"repository": ORIGIN_REPOSITORY, "commit": ORIGIN_COMMIT},
            "code_sha256": {name: sha256(SCRIPTS / name) for name in (
                "archive.py", "snapshot.py", "render_charts.py", "generate_charts.py")},
            "archive_repository": ARCHIVE_REPOSITORY,
            "archive_revision": revision,
            "snapshot": snapshot,
            "collected_at": archive.manifest["completed_at"],
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "latest_attempt": {key: index["snapshots"][0].get(key)
                               for key in ("id", "status", "completed_at")},
            "manifest_sha256": sha256(archive.root / "manifest.json"),
            "storage_sha256": sha256(archive.root / "storage.json"),
            "chart_count": len(charts),
            "verified_chart_dataset_count": len(CHART_DATASETS),
            "public_dataset_count": len(PUBLIC_DATASETS),
            "metadata_sha256": sha256(staging / "sources_and_scope.json"),
            "outputs": {chart["file"]: chart["sha256"] for chart in charts},
        }
        (staging / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
        # Recheck after rendering; an occupied target is never silently removed.
        if output.exists() or output.is_symlink():
            raise ValueError("Output appeared during rendering; choose a new output directory")
        staging.rename(output)
        return provenance
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive-root", type=Path, default=Path(".cache/archive"),
                        help="Existing verified archive cache or checkout (read-only)")
    parser.add_argument("--output", type=Path, default=Path(".cache/chart-exports/latest"),
                        help="New destination directory; existing paths are never replaced")
    parser.add_argument("--archive-revision", help="Full archive commit if no state.json or Git metadata")
    args = parser.parse_args(argv)
    try:
        result = generate(args.archive_root, args.output, args.archive_revision)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Chart generation failed: {error}\n")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
