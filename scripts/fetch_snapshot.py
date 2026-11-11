"""Fetch and verify a pinned published archive, never its upstream sources."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.request

from archive import Archive, CHART_DATASETS, safe_relative, select_snapshot

REPOSITORY = "https://github.com/yuxiaoli/openrouter-data.git"
RAW = "https://raw.githubusercontent.com/yuxiaoli/openrouter-data"


def get(url: str) -> bytes:
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "openrouter-charts/1.0"})
            with urllib.request.urlopen(request, timeout=90) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)
    raise AssertionError("unreachable")


def resolve_revision() -> str:
    line = subprocess.check_output(["git", "ls-remote", REPOSITORY, "refs/heads/data"], text=True).strip()
    revision = line.split()[0] if line else ""
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("Cannot resolve the published data branch")
    return revision


def probe(root: Path, deployed_url: str | None = None, force: bool = False) -> dict:
    revision = resolve_revision()
    index_bytes = get(f"{RAW}/{revision}/public-index.json")
    index = json.loads(index_bytes)
    snapshot = select_snapshot(index)
    latest_attempt = index["snapshots"][0]
    state = {"archive_revision": revision, "snapshot": snapshot,
             "latest_attempt": {k: latest_attempt.get(k) for k in ("id", "status", "completed_at")},
             "source_commit": os.environ.get("GITHUB_SHA", "local")}
    root.mkdir(parents=True, exist_ok=True)
    (root / "public-index.json").write_bytes(index_bytes)
    (root / "state.json").write_text(json.dumps(state, indent=2) + "\n")
    changed = True
    if deployed_url and not force:
        try:
            published = json.loads(get(deployed_url.rstrip("/") + "/version.json"))
            changed = any(published.get(k) != state[k] for k in state)
        except (urllib.error.URLError, ValueError):
            changed = True
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            output.write(f"changed={str(changed).lower()}\nsnapshot={snapshot}\n")
    print(json.dumps({**state, "changed": changed}))
    return state


def fetch(root: Path) -> dict:
    state = json.loads((root / "state.json").read_text())
    revision, snapshot = state["archive_revision"], state["snapshot"]
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("Invalid pinned archive revision")
    if select_snapshot(json.loads((root / "public-index.json").read_text())) != snapshot:
        raise ValueError("Pinned state and archive index disagree on the selected snapshot")
    run = root / "runs" / snapshot
    run.mkdir(parents=True, exist_ok=True)
    base = f"{RAW}/{revision}/runs/{snapshot}"
    for name in ("manifest.json", "storage.json"):
        (run / name).write_bytes(get(f"{base}/{name}"))
    archive = Archive(root, snapshot)
    paths = set()
    for name in CHART_DATASETS:
        report = archive.reports[name]
        for part in report.get("chunks") or [name + ".json"]:
            entry = archive.storage.get(part)
            if not entry:
                raise ValueError(f"Published chart input lacks required storage checksums: {part}")
            paths.add(safe_relative(entry["physical_path"]))
    def fetch_file(relative: str) -> None:
        destination = run / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(get(f"{base}/{relative}"))
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(fetch_file, sorted(paths)))
    for name in CHART_DATASETS:
        archive.load(name)
    print(f"Verified {len(paths)} archived files; {len(CHART_DATASETS)} public chart datasets; snapshot {snapshot}")
    return state


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("probe", "fetch"))
    parser.add_argument("--root", type=Path, default=Path(".cache/archive"))
    parser.add_argument("--deployed-url")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    if args.mode == "probe":
        probe(args.root, args.deployed_url, args.force)
    else:
        fetch(args.root)
