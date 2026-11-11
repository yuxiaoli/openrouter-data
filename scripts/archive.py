"""Read only the existing public archive. Never collect from OpenRouter."""
from __future__ import annotations

import gzip
import hashlib
import json
import re
from functools import lru_cache
from pathlib import Path

SNAPSHOT_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{6}Z-[a-z0-9]+")
PUBLIC_DATASETS = (
    "models", "providers", "embedding_models", "image_models", "video_models",
    "eu_models", "zdr_endpoints", "model_count", "model_rss", "blog_posts",
    "status_incidents", "upstream_openapi", "docs_index", "site_index", "endpoints",
    "image_endpoints", "public_model_rankings", "public_ranking_history",
    "public_performance", "public_apps", "public_app_rankings", "public_model_activity",
    "public_model_apps", "public_session_cost", "public_task_mix", "public_discovery",
    "public_modality_statistics", "public_model_observations",
)
# All chart inputs; specifications/indices are covered in metadata, not downloaded.
CHART_DATASETS = tuple(x for x in PUBLIC_DATASETS if x not in {
    "upstream_openapi", "docs_index", "site_index", "public_app_rankings", "model_count"
})


def safe_relative(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9_.\-/]+", value):
        raise ValueError("Unsafe archive path")
    if value.startswith("/") or any(p in {"", ".", ".."} for p in value.split("/")):
        raise ValueError("Unsafe archive path")
    return value


def select_snapshot(index: dict) -> str:
    """Use one coherent complete run; never combine fresh and fallback sources."""
    snapshot = index.get("last_success")
    if not isinstance(snapshot, str) or not SNAPSHOT_RE.fullmatch(snapshot):
        raise ValueError("Archive has no valid complete-success snapshot")
    rows = [x for x in index.get("snapshots", []) if x.get("id") == snapshot]
    if not rows or rows[0].get("status") != "success":
        raise ValueError("last_success does not identify a successful snapshot")
    return snapshot


class Archive:
    def __init__(self, root: str | Path, snapshot: str):
        if not SNAPSHOT_RE.fullmatch(snapshot):
            raise ValueError("Invalid snapshot ID")
        self.root = Path(root) / "runs" / snapshot
        self.manifest = json.loads((self.root / "manifest.json").read_text())
        if self.manifest.get("id") != snapshot or self.manifest.get("status") != "success":
            raise ValueError("Only an exact complete-success snapshot can be rendered")
        self.reports = {x["id"]: x for x in self.manifest["datasets"]}
        for name in PUBLIC_DATASETS:
            r = self.reports.get(name, {})
            if r.get("status") != "ok" or r.get("access") not in {None, "public"}:
                raise ValueError(f"Required public dataset is not complete: {name}")
        storage_path = self.root / "storage.json"
        self.storage = json.loads(storage_path.read_text()).get("files", {}) if storage_path.exists() else {}

    def read(self, relative: str) -> dict:
        relative = safe_relative(relative)
        entry = self.storage.get(relative)
        path = self.root / relative
        if entry:
            physical = self.root / safe_relative(entry["physical_path"])
            body = physical.read_bytes()
            if hashlib.sha256(body).hexdigest() != entry["physical_sha256"]:
                raise ValueError(f"Physical checksum mismatch: {relative}")
            body = gzip.decompress(body) if entry["encoding"] == "gzip" else body
            if hashlib.sha256(body).hexdigest() != entry["logical_sha256"]:
                raise ValueError(f"Logical checksum mismatch: {relative}")
        else:
            body = path.read_bytes() if path.exists() else gzip.decompress(Path(str(path) + ".gz").read_bytes())
        return json.loads(body)

    @lru_cache(maxsize=None)
    def load(self, name: str) -> list:
        if name not in PUBLIC_DATASETS:
            raise ValueError(f"Not an allowlisted public dataset: {name}")
        report = self.reports[name]
        rows = []
        for part in report.get("chunks") or [name + ".json"]:
            if report.get("chunks") and not part.startswith(f"chunks/{name}/"):
                raise ValueError("Dataset chunk points to another dataset")
            content = self.read(part)
            values = content.get("data")
            if not isinstance(values, list):
                raise ValueError(f"No row array in {part}")
            if part in report.get("chunk_counts", {}) and len(values) != report["chunk_counts"][part]:
                raise ValueError(f"Chunk count mismatch: {part}")
            rows.extend(values)
        if len(rows) != report["record_count"]:
            raise ValueError(f"Record count mismatch: {name}")
        return rows
