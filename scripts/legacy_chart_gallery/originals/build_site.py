"""Build an atomic static gallery from one verified public archive snapshot."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import html
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from archive import Archive, PUBLIC_DATASETS, select_snapshot

ROOT = Path(__file__).resolve().parent.parent
CATEGORIES = ["目录与价格", "目录与价格", "排名与历史", "排名与历史", "排名与历史", "用量与应用", "用量与应用", "用量与应用", "供应与观测", "用量与应用", "供应与观测", "覆盖与内容", "排名与历史", "供应与观测"]


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def build(archive_root: Path, output: Path, revision: str | None = None) -> dict:
    index = json.loads((archive_root / "public-index.json").read_text())
    snapshot = select_snapshot(index)
    archive = Archive(archive_root, snapshot)
    state_path = archive_root / "state.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    # A local archive checkout is a read-only input and is never pushed by this project.
    if not revision and not state.get("archive_revision"):
        revision = subprocess.check_output(["git", "-C", str(archive_root), "rev-parse", "HEAD"], text=True).strip()
    latest = index["snapshots"][0]
    version = {"schema_version": 1, "archive_revision": revision or state["archive_revision"],
               "snapshot": snapshot,
               "latest_attempt": {k: latest.get(k) for k in ("id", "status", "completed_at")},
               "source_commit": os.environ.get("GITHUB_SHA", "local"),
               "collected_at": archive.manifest["completed_at"],
               "generated_at": datetime.now(timezone.utc).isoformat(), "chart_count": 14,
               "public_dataset_count": len(PUBLIC_DATASETS)}
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".charts-build-", dir=output.parent))
    try:
        charts_dir = staging / "charts"
        env = {**os.environ, "OPENROUTER_ARCHIVE_ROOT": str(archive_root.resolve()),
               "OPENROUTER_SNAPSHOT": snapshot, "OPENROUTER_OUTPUT": str(charts_dir.resolve())}
        subprocess.run([sys.executable, str(ROOT / "scripts/render_charts.py")], check=True, env=env)
        metadata = json.loads((charts_dir / "sources_and_scope.json").read_text())
        if metadata["snapshot"] != snapshot or len(metadata["charts"]) != 14:
            raise ValueError("Renderer did not produce all fourteen charts for the selected snapshot")
        cards, navigation = [], []
        for i, chart in enumerate(metadata["charts"], 1):
            image = charts_dir / chart["file"]
            if image.parent != charts_dir or not image.is_file() or image.read_bytes()[:8] != b"\x89PNG\r\n\x1a\n":
                raise ValueError("Invalid chart image output")
            chart["sha256"] = hashlib.sha256(image.read_bytes()).hexdigest()
            title = chart.get("title", chart["file"])
            category = CATEGORIES[i - 1]
            links = " · ".join(f'<a href="{esc(url)}" target="_blank" rel="noopener">{esc(ds)}</a>' for ds, url in zip(chart["datasets"], chart["source_urls"]))
            navigation.append(f'<a href="#chart-{i:02}" data-category="{esc(category)}"><span>{i:02}</span>{esc(title)}</a>')
            cards.append(f'''<article class="chart-card" id="chart-{i:02}" data-category="{esc(category)}" data-search="{esc(title + ' ' + chart['notes'])}">
              <div class="card-head"><div><span class="eyebrow">{i:02} / {esc(category)}</span><h2>{esc(title)}</h2></div><button class="zoom" data-image="charts/{esc(chart['file'])}" data-title="{esc(title)}" aria-label="放大图表：{esc(title)}">放大 ↗</button></div>
              <a class="image-link" href="charts/{esc(chart['file'])}" target="_blank" rel="noopener" aria-label="查看原图：{esc(title)}"><img src="charts/{esc(chart['file'])}" alt="{esc(title + '。' + chart['notes'])}" loading="{'eager' if i == 1 else 'lazy'}" decoding="async" width="1800" height="1300"></a>
              <div class="card-foot"><p>{esc(chart['notes']).replace(chr(10), '<br>')}</p><details><summary>数据来源与下载</summary><p>{links}</p><p>固定快照：{esc(snapshot)}</p><a href="charts/{esc(chart['file'])}" download>下载 PNG</a></details></div></article>''')
        dataset_rows = "".join(f'<tr><th scope="row">{esc(name)}</th><td>{archive.reports[name]["record_count"]:,}</td><td>{esc(archive.reports[name].get("collected_at", "未声明"))}</td></tr>' for name in PUBLIC_DATASETS)
        template = (ROOT / "web/index.html").read_text()
        replacements = {"{{CARDS}}": "\n".join(cards), "{{NAVIGATION}}": "\n".join(navigation),
                        "{{SNAPSHOT}}": esc(snapshot), "{{COLLECTED}}": esc(version["collected_at"]),
                        "{{GENERATED}}": esc(version["generated_at"]), "{{DATASET_ROWS}}": dataset_rows,
                        "{{ATTEMPT_STATUS}}": esc(latest["status"]), "{{ATTEMPT_ID}}": esc(latest["id"]),
                        "{{ARCHIVE_REVISION}}": esc(version["archive_revision"]),
                        "{{SOURCE_COMMIT}}": esc(version["source_commit"]),
                        "{{WARNING}}": "最近采集未完全成功，当前图表保留最近完整快照。" if latest["status"] != "success" else ""}
        for key, value in replacements.items():
            template = template.replace(key, value)
        (staging / "index.html").write_text(template)
        for name in ("style.css", "app.js"):
            shutil.copy2(ROOT / "web" / name, staging / name)
        (staging / ".nojekyll").touch()
        (staging / "version.json").write_text(json.dumps(version, indent=2) + "\n")
        (charts_dir / "sources_and_scope.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")
        coverage = {"snapshot": snapshot, "datasets": [{k: archive.reports[name].get(k) for k in ("id", "status", "record_count", "collected_at", "coverage", "unavailable", "units", "window", "source_url")} for name in PUBLIC_DATASETS]}
        (staging / "coverage.json").write_text(json.dumps(coverage, ensure_ascii=False, indent=2) + "\n")
        # No output is touched unless every required chart and metadata file succeeds.
        if output.exists():
            shutil.rmtree(output)
        staging.rename(output)
        return version
    finally:
        if staging.exists():
            shutil.rmtree(staging)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive-root", type=Path, default=Path(".cache/archive"))
    parser.add_argument("--output", type=Path, default=Path("dist"))
    parser.add_argument("--archive-revision")
    args = parser.parse_args()
    print(json.dumps(build(args.archive_root, args.output, args.archive_revision), indent=2))
