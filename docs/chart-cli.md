# Preserved Python chart CLI

## Source and integration

The chart scripts were migrated from the public
[`yuxiaoli/openrouter-charts` source](https://github.com/yuxiaoli/openrouter-charts/tree/928a2e7a0c02e2aaaac9723b8549fbfacfbafd56)
at commit `928a2e7a0c02e2aaaac9723b8549fbfacfbafd56` into the collector repository's
root `scripts/` directory. The source repository and all data history are retained.

`archive.py`, `snapshot.py`, `fetch_snapshot.py` and `render_charts.py` are unchanged.
`build_site.py` and `check_contracts.py` use the preserved legacy assets under
`scripts/legacy_chart_gallery/`; the legacy builder now defaults to
`.cache/legacy-gallery` rather than the API's `dist/`. Their original versions are
also retained under `scripts/legacy_chart_gallery/originals/`. The exact originals,
hashes and adaptations are listed in `chart-cli-source-provenance.json`.

The new `generate_charts.py` is a chart-only wrapper around the original renderer.
It coexists with the dynamic frontend in `charts/` without that frontend requiring
Python. The existing TypeScript collector, API code, dependencies, source archive
and daily collection schedule are unchanged by the Python migration. Python has
its own root `pyproject.toml` and `uv.lock` alongside the existing npm manifests.

## Run from the project root

Requirements: Python 3.11+, uv, the locked Python dependencies, and the existing
Noto Sans CJK font at `/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc`.
The chart-only CLI does not require Node or a running server. Other operating systems
need that font path or a separately reviewed portability change; no silent font
fallback is used because it would change the original appearance.

```sh
uv sync --frozen
uv run python scripts/fetch_snapshot.py probe
uv run python scripts/fetch_snapshot.py fetch
uv run python scripts/generate_charts.py --output .cache/chart-exports/run-01
```

The fetch commands download the existing public archive at one pinned commit. They
do not invoke an OpenRouter collector. To avoid network entirely, use an existing
verified cache or read-only data-branch checkout:

```sh
uv run python scripts/generate_charts.py \
  --archive-root /absolute/path/to/archive \
  --output .cache/chart-exports/local-01
```

The archive must contain `public-index.json`, the selected complete run's manifest
and storage metadata, and all files for the 23 datasets used in charts. All 28
public dataset reports must be successful. `state.json` from the downloader records
the archive commit. A Git checkout can supply its commit instead. For an export
without either, provide the known full commit with `--archive-revision`. An explicit
revision conflicting with recorded state is rejected.

## Output and safety

- Fourteen original PNGs, preserving all chart types, labels and statistical caveats.
- `sources_and_scope.json`, retaining original source URLs, snapshot, dataset counts,
  collection/observation times, windows and notes, plus each output's SHA-256.
- `provenance.json`, with original source repository/commit, current script hashes,
  archive repository/commit, snapshot, collection and generation timestamps, latest
  attempted collection status, manifest/storage/metadata hashes and all image hashes.
- The same provenance receipt is printed as JSON on stdout for other CLI tools.

The command reads one complete-success snapshot. It verifies checksums and row counts
before rendering, never blends partial data into a complete snapshot, and records a
newer failed/partial attempt truthfully. It does not turn null values into zero.

The output must be a new directory outside the archive. Use a new output name for
each run. Existing paths, including symlinks, are refused, so an existing website,
archive, previous chart set or unrelated folder is never removed. Rendering takes
place in a temporary sibling directory; a failure publishes no partial chart set.

The legacy `build_site.py` and renderer entry point remain supported. The gallery
uses its namespaced assets and defaults to `.cache/legacy-gallery`. The safer chart-only wrapper is recommended for exports. It
does not deploy or modify the separate GitHub Pages browser-rendered frontend.
The frontend release has its own verification; CLI tests alone do not prove a live
website. The superseded Cloudflare/KV proposal is not implemented by this migration.

## Test and command reference

`scripts/commands.sh` is the existing project's command reference. Copy individual
examples from it; do not execute or source the entire file. It includes dependency
setup, default/custom archive caches, probe/fetch modes, changed-state comparison,
chart-only output, explicit revision exports, the legacy gallery, checks, preview,
help and existing workflow operations. The voice transcript's “comments dot sh”
is interpreted as the project's already established `scripts/commands.sh`.

```sh
uv run python -m unittest discover -s tests -v
uv run python scripts/check_contracts.py
node --check scripts/legacy_chart_gallery/web/app.js
node --test tests/test_legacy_chart_ui.cjs
bash --noprofile --norc -n scripts/commands.sh
```

Runtime verification requires a real archived snapshot as well as unit tests. Do
not equate the fixture-based tests with a successful real-data render or deployment.

## Separation from the website and archive

The root TypeScript `npm run build` continues producing the existing API artifact
in `dist/`. The legacy Python gallery is an optional export in `.cache/legacy-gallery`.
The dynamic frontend has its own `charts/` source and build commands. Never use one
of these output directories as another build's destination.

No chart command dispatches an Actions run, publishes a site, edits a snapshot,
changes repository visibility, or deletes the original chart repository. The CLI
receives data only from the existing `openrouter-data` archive. No cache, generated
PNG, virtual environment, collector copy or secret is committed with these scripts.
