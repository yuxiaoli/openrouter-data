#!/usr/bin/env bash
# Command reference only. Copy and run individual commands as needed.
# Run commands from the project root unless stated otherwise.

# Existing TypeScript collector/API project (Node 24 and npm lockfile).
npm ci
npm run check
npm run typecheck
npm test
npm run validate:openapi
npm run build
# Preview the existing API artifact locally after npm run build.
npm run dev

# Source archive: keep all data in its independent data branch/checkout.
# Clone once into a new data/ directory. Do not overwrite an existing checkout.
git clone --branch data --single-branch https://github.com/yuxiaoli/openrouter-data.git data
# Real collection, when intentionally requested; charts do not require this step.
npm run sync -- --output data
npm run sync -- --output data --concurrency 2
# Read-only archive verification: complete history or bounded newest attempt.
npm run verify:archive -- data
npm run verify:archive -- data --latest-only
npm run verify:archive -- data --require-packed-latest --latest-only
# Maintenance for an explicitly selected new run, never edit old published runs.
# Replace this sample ID with the actual new local run before using these commands.
npx tsx scripts/pack-archive.ts --output data --snapshot 2026-11-10T093020Z-eb9b8257a8
npx tsx scripts/prepare-archive-views.ts --output data --snapshot 2026-11-10T093020Z-eb9b8257a8
# Alternative: prepare views only for the newest local attempt selected by index.json.
npx tsx scripts/prepare-archive-views.ts data
# API schema regeneration (writes docs/api/openapi.json), optionally with real examples.
npx tsx scripts/update-openapi.ts
npx tsx scripts/update-openapi.ts --sample 2026-11-10T093020Z-eb9b8257a8
npm run validate:openapi
# Service checks: current public service, a pinned run, or a local archive handler.
npm run smoke -- https://openrouter-data.pages.dev
npm run smoke -- https://openrouter-data.pages.dev --expected-snapshot 2026-11-10T093020Z-eb9b8257a8
npm run smoke -- https://openrouter-data.pages.dev --archive data --expected-snapshot 2026-11-10T093020Z-eb9b8257a8
# Existing API deployment, only when explicitly deploying the API (not the chart site).
npm run deploy
# Existing source workflow: inspect runs; manually collect only when explicitly intended.
gh run list --repo yuxiaoli/openrouter-data --workflow sync.yml
gh workflow run sync.yml --repo yuxiaoli/openrouter-data --ref main

# Install exact dependencies (Python 3.11+, uv, Node for JS syntax check).
uv sync --frozen
# Ubuntu/Linux renderer font dependency.
sudo apt-get install fonts-noto-cjk
# Unit tests, JSON Schema example validation, JavaScript syntax and UI tests.
uv run python -m unittest discover -s tests -v
# Focused chart CLI safety/provenance tests.
uv run python -m unittest discover -s tests -p 'test_chart_cli.py' -v
uv run python scripts/check_contracts.py
node --check scripts/legacy_chart_gallery/web/app.js
node --test tests/test_legacy_chart_ui.cjs
# Syntax-check this reference. Do not execute/source the whole catalogue.
bash --noprofile --norc -n scripts/commands.sh

# Pin the existing public archive and verify downloaded chart datasets.
# Probe before fetch. Fetch reuses that exact pinned revision and snapshot.
uv run python scripts/fetch_snapshot.py probe
uv run python scripts/fetch_snapshot.py fetch
# Alternative: use a separate cache and compare with the existing gallery.
uv run python scripts/fetch_snapshot.py probe --root .cache/archive-review --deployed-url https://yuxiaoli.github.io/openrouter-charts
uv run python scripts/fetch_snapshot.py fetch --root .cache/archive-review
# Alternative: force the probe's changed=true signal; this does not recollect upstream.
uv run python scripts/fetch_snapshot.py probe --root .cache/archive-review --deployed-url https://yuxiaoli.github.io/openrouter-charts --force

# Generate all fourteen PNGs only, independently of any static/dynamic website.
# Existing output paths are never replaced. Use a new directory for each run.
uv run python scripts/generate_charts.py
uv run python scripts/generate_charts.py --archive-root .cache/archive-review --output .cache/chart-exports/review-01
# Alternative: reuse a local public data-branch checkout (read-only, no network).
uv run python scripts/generate_charts.py --archive-root /absolute/path/to/archive --output .cache/chart-exports/local-01
# Alternative: exported archive without state.json or .git needs its known full commit.
# This example commit belongs to the preserved 2026-11-10 snapshot, not today's data.
uv run python scripts/generate_charts.py --archive-root /absolute/path/to/exported-archive --archive-revision e0b6f46bfae683cce14269bfcde632552aeffd8a --output .cache/chart-exports/exported-01
# Save machine-readable provenance printed by the CLI. Create the redirect parent;
# chart files also retain provenance.json and sources_and_scope.json.
mkdir -p .cache
uv run python scripts/generate_charts.py --output .cache/chart-exports/review-02 > .cache/chart-run.json

# Render all charts and build static website.
# This is the preserved legacy gallery builder, not the dynamic frontend.
uv run python scripts/build_site.py
uv run python scripts/check_contracts.py --site .cache/legacy-gallery
# Alternative: reuse a local public archive checkout, without recollecting.
uv run python scripts/build_site.py --archive-root /absolute/path/to/archive --output .cache/gallery-review
uv run python scripts/check_contracts.py --site .cache/gallery-review
# Alternative: explicit revision for a metadata-free exported archive.
uv run python scripts/build_site.py --archive-root /absolute/path/to/exported-archive --archive-revision e0b6f46bfae683cce14269bfcde632552aeffd8a --output .cache/gallery-exported
# Preview website locally.
uv run python -m http.server 8000 --directory .cache/legacy-gallery

# Help for each user-facing Python command; archive.py and snapshot.py are libraries.
uv run python scripts/fetch_snapshot.py --help
uv run python scripts/generate_charts.py --help
uv run python scripts/build_site.py --help
uv run python scripts/check_contracts.py --help

# Legacy renderer entry point retained for compatibility; it has no argparse CLI.
# Prefer generate_charts.py for full checksums/provenance and safe output handling.
# Requires the matching verified cache and snapshot below; output should be new.
OPENROUTER_ARCHIVE_ROOT=.cache/archive OPENROUTER_SNAPSHOT=2026-11-10T093020Z-eb9b8257a8 OPENROUTER_OUTPUT=.cache/chart-exports/legacy-01 uv run python scripts/render_charts.py

# Dynamic GitHub Pages frontend (independent of Python PNG exports and API dist/).
# Reuse the probe/fetch commands above first; no additional collection is needed.
npm ci --prefix charts --no-fund --no-audit
npm test --prefix charts
GITHUB_SHA="$(git rev-parse HEAD)" node charts/scripts/compile-current.mjs .cache/archive .cache/current-snapshot.json
npm run build --prefix charts
node charts/scripts/publish-snapshot.mjs .cache/current-snapshot.json charts/site-dist
node charts/scripts/verify-site.mjs charts/site-dist
python -m http.server 8001 --directory charts/site-dist
# Alternative: compile a separately verified cache into its own payload file.
GITHUB_SHA="$(git rev-parse HEAD)" node charts/scripts/compile-current.mjs .cache/archive-review .cache/review-snapshot.json
# Optional numerical parity check against the preserved Python/NumPy/Matplotlib reader.
# Use the same verified archive as the compact snapshot; these commands never collect.
uv run python charts/scripts/reference_oracle.py --archive-root .cache/archive --reference-root . --output charts/qa/reference.json
npm run test:reference --prefix charts -- ../.cache/current-snapshot.json qa/reference.json
# Optional internal SVG visual inspection; outputs stay under ignored charts/qa/.
npm run qa:render --prefix charts -- ../.cache/current-snapshot.json qa/render
# Alternative: also rasterize QA PNGs using an explicitly available local font.
npm run qa:render --prefix charts -- ../.cache/current-snapshot.json qa/render-with-png /usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
# Existing configured workflows: inspect or intentionally publish from integrated main.
gh run list --repo yuxiaoli/openrouter-data --workflow chart-cli.yml
gh run list --repo yuxiaoli/openrouter-data --workflow charts-pages.yml
gh workflow run charts-pages.yml --repo yuxiaoli/openrouter-data --ref main
