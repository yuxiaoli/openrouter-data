# Dynamic OpenRouter charts

Fourteen browser-rendered SVG charts from one compact, validated public snapshot. The white/blue/gold layout, Chinese titles, units and statistical caveats follow the original Python charts. No production PNGs, remote CDN dependencies, Cloudflare resources or browser-side upstream collection are required.

## Portable build and test

From this directory (`charts/` in the integrated repository):

```sh
npm ci
npm test
npm run build
```

Node 22+ is recommended. The build produces `site-dist/` with HTML, CSS, a bundled ECharts 6.0.0 browser module, bundled font and license notices. The font asset is committed under `assets/fonts/`, so the runner needs no system fonts or Python to build the frontend. Generated artifacts, installed dependencies, fixture archives and QA images are ignored.

The publishing pipeline separately compiles and validates a compact `snapshot.json` and writes it to `site-dist/snapshot.json`. It also supplies `version.json`. The frontend build neither collects nor invents data. All paths are relative for GitHub Pages project subpaths; the default endpoint is `./snapshot.json`, configurable through the `snapshot-url` meta tag.

Do not publish the prototype's local `dist/` directory: local numerical research may place large raw fixtures there. Publish only `site-dist/` after the data pipeline's validation completes.

## Data contract

`src/compile-all.mjs` exports `compileGallery(envelope)`. The envelope contains `manifest`, arrays under `datasets` keyed by original public dataset names, and optional `archive_revision`, `source_commit`, `latest_attempt`, and `provenance`. Count-only datasets come from manifest counts. Filtered source arrays retain exactly the records and nested series required by the original scopes.

`src/contract.mjs` exports `validateSnapshot(payload)`. The compact schema is:

- `schemaVersion: 1`
- `snapshot`: complete-success snapshot ID
- `collectedAt`: ISO timestamp with timezone
- `chartIds`: ordered IDs `01` through `14`
- `charts`: fourteen reduced chart objects, each matching the same snapshot
- `coverage`: all 28 public source record counts
- `latestAttempt`: separate `{id,status,completed_at}` metadata, or null
- `archiveRevision`, `sourceCommit`, `provenance`: verified provenance, or null when unavailable

The browser validates the whole snapshot and all chart options before replacing its current view. Failed loads show an error and preserve an already-loaded complete view. Refresh closes an old snapshot modal before applying the new snapshot. SVG filenames are bound to the chart's own snapshot, not mutable page state.

Incomplete periods are calculated against each dataset's observed timestamp in UTC. Missing values remain null and time-series gaps remain gaps. Session boxes use linear-space quartiles and Matplotlib's 1.5-IQR whisker semantics on a logarithmic display; individual positive model medians remain visible. Scatter jitter is deterministic and cosmetic, but not byte-identical to NumPy's original jitter. SVG axes/font rasterization can differ slightly from Matplotlib; numerical identity is tested separately.

## Local reference verification (optional)

The portable test suite uses synthetic records and requires no private or machine-specific fixture. An independent all-fourteen-scope Python oracle can additionally verify an authorized local archived snapshot against the preserved original `scripts/archive.py` reader:

```sh
python scripts/reference_oracle.py \
  --archive-root /absolute/path/to/verified-public-archive \
  --reference-root /absolute/path/to/preserved-python-chart-repository \
  --output qa/reference.json
npm run test:reference -- /absolute/path/to/matching-compact-snapshot.json qa/reference.json
```

The optional oracle needs NumPy and Matplotlib. All paths are explicit; it makes no network requests. It checks archive checksums through the original reader. The compact payload must have been compiled from the same selected snapshot. The prototype-only `build-fixture.mjs` is not part of the production publishing workflow.

For internal SVG inspection:

```sh
npm run qa:render -- /absolute/path/to/compact-snapshot.json qa/render
```

An optional fourth argument names a local CJK font file and also creates PNGs for internal visual inspection. These images are not product assets.

## Verification status

- Portable tests cover all fourteen SVG renderers; units, reductions, nulls, ranking dates, complete/partial periods, representative selection, session statistics and deterministic jitter.
- DOM simulation covers loading, failed fetch, retry, filters, empty results/reset, repeated dialog open/close, original-size mode, stale/failed-attempt warnings, invalid-update preservation, and a refresh completing while an old modal is open.
- The real 2026-11-10 archive matched 3,661 numerical values across all fourteen scopes against independent Python/NumPy/Matplotlib calculations. Array shapes, ranking identities and nulls also matched.
- Supported cloud-browser access to the local preview returned `net::ERR_CONNECTION_REFUSED`. DOM simulation and SVG inspection do not replace actual browser acceptance. Verify the deployed GitHub Pages URL at desktop and narrow widths, including modal Escape/close/reopen, SVG download, and failed-update preservation.

## Fonts and licensing

`assets/fonts/chart-cjk.woff` is a Noto Sans CJK JP subset containing the chart/UI Chinese text, Latin letters, digits and relevant symbols. Its SIL Open Font License notice is retained as `LICENSE-Noto.txt`. Other CJK characters introduced by future upstream labels fall back to the user's installed sans-serif fonts. ECharts and transitive renderer license notices are emitted alongside `app.js`; full ECharts LICENSE/NOTICE and ZRender LICENSE are included under `site-dist/licenses/`.

## Developer-origin comparisons

The additive `/origins/` page and `origins.json` use the same verified archive bundle as the fourteen-chart gallery. `compile-current.mjs` writes `current-snapshot.json` and `current-origins.json` together; `publish-snapshot.mjs` requires both identities to agree and records each SHA-256 in `version.json`. A missing or invalid companion payload prevents deployment.

- **Daily usage:** only native `day` / `tokens` rankings with declared token units. Native `(variant_permaslug, date)` duplicates must agree. Missing identities remain in the unknown sample, including positive observed amounts. Different native dates are selectable, never silently combined. Native dates have no declared timezone.
- **Activity:** each native variant/date needs an exact `model_id === variant_permaslug` request context. Alias copies must agree on relevant values. Missing identity/date or absent canonical contexts are explicitly counted as excluded; gaps are not zero-filled. The latest returned native day is marked potentially incomplete, without claiming an exact timezone boundary. Sample membership changes over time. Activity and rankings are distinct public observations, not reconciled or added together.
- **Price:** text-output catalog only, deduplicated by explicit canonical slug plus normalized prompt/completion quote pair. Routes remain listed. Missing canonical identities are not inferred from route names. Each side has separate known/missing/free counts and unweighted arithmetic mean/median; actual zero stays free. Other modality, request and cache charges are excluded. Countries lacking text-price observations remain unavailable; regional coverage is disclosed.
- **Attribution:** `config/origin-attribution.v1.json` is dated, manually reviewed and cites primary sources. Only exact reviewed namespaces match. Country codes within Europe are grouped geographically, not as the EU. Cross-border organizations have one separate bucket. This is an organizational geography proxy, not a claim about users, serving providers, training sites or legal model nationality. Daily builds never fetch attribution sources.

```sh
# Existing archive download/pin commands are unchanged.
GITHUB_SHA="$(git rev-parse HEAD)" node charts/scripts/compile-current.mjs .cache/archive .cache/current-snapshot.json
npm --prefix charts test
npm --prefix charts run build
node charts/scripts/publish-snapshot.mjs .cache/current-snapshot.json charts/site-dist
node charts/scripts/verify-site.mjs charts/site-dist
# Optional explicit companion path for a portable build:
node charts/scripts/publish-snapshot.mjs .cache/current-snapshot.json charts/site-dist .cache/current-origins.json
```

Open `origins/` on a static preview server. Browser acceptance must cover date/group switches, price sample/unknown handling, repeated refresh, search, stale/error states, and actual 390px viewport overflow, in addition to the existing fourteen-chart gallery.

### Mobile scales, shares and catalog-price scenario

Numeric axes use fewer ticks at narrow chart widths, collision suppression and T/B/M abbreviations (10¹²/10⁹/10⁶). Resizing back to desktop restores the standard tick count. The share pie uses the selected native day’s complete known-token sample, including unknown origins and cross-border organizations. Missing amounts are excluded explicitly, not zero-filled; a zero/unknown denominator produces no artificial pie.

The estimated-value panel is a **default catalog-price scenario**, not billed spending, revenue, profit or a regional market total. Per matched model it computes `prompt_tokens × prompt_USD_per_token + completion_tokens × completion_USD_per_token`. The join requires a native `standard` variant, exact nonempty native model/variant/canonical identity, a catalog output modality exactly `["text"]` (inputs may include other modalities), and an ordinary route without `:` suffix or `~` alias. Only one unique nonnegative input/output quote pair may remain. Raw route eligibility is retained before quote-pair deduplication, so free/batch/alias/mixed-audio routes cannot supply a standard quote accidentally.

Unmatched, nonstandard, ambiguous, unavailable or incomplete observations remain excluded with visible coverage. A region with no matches has an unavailable amount, not zero. Reviewed geographic unknowns can still have an exact quote and remain included. Quotes are observed at catalog collection time and applied to the selected usage-day records; they are not historical tariffs. No extrapolation is made to the omitted volume. Conditional pricing, cache/BYOK discounts, other fees and provider differences are not reconstructed; matched rows carrying conditional tariffs are counted and disclosed.

Primary definitions: [Models API price units/default fields](https://github.com/OpenRouterTeam/docs/blob/main/guides/overview/models.mdx), [model route variants](https://github.com/OpenRouterTeam/docs/blob/main/guides/routing/model-variants/overview.mdx).

The amount-share pie sits inside the existing catalog-price scenario card, beneath its amount bar. Each selected-day country/region amount is divided by the same total matched estimated USD, including unknown and cross-border origins. Detail filters do not renormalize the pie. Excluded observations have no estimated amount and contribute neither a fabricated zero nor an extrapolated amount; true zero is shown as 0% only when the matched total is positive. A zero or unavailable total yields no pie or percentage. These shares describe the eligible scenario sample, not token shares, realized spending or market share.
