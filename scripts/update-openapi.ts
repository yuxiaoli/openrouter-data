import { readFile, writeFile } from 'node:fs/promises';
import { datasetIds } from '../src/contracts.js';
import { gunzipSync } from 'node:zlib';

// Incremental contract updater: retain existing source-row documentation and real historical examples.
// Run again after handler changes; --sample RUN_ID captures only real locally archived records.
type Schema = Record<string, any>;
const path = 'docs/api/openapi.json';
const spec: Schema = JSON.parse(await readFile(path, 'utf8'));
const schemas: Schema = spec.components.schemas;
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const string = (description?: string): Schema => ({ type: 'string', ...(description ? { description } : {}) });
const timestamp: Schema = { type: 'string', format: 'date-time' };
const count: Schema = { type: 'integer', minimum: 0 };
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: 'null' }] });
const array = (items: Schema): Schema => ({ type: 'array', items });
const object = (properties: Schema, required = Object.keys(properties), additionalProperties = false): Schema => ({ type: 'object', properties, required, additionalProperties });
const param = (name: string, schema: Schema, description: string): Schema => ({ name, in: 'query', required: false, schema, description });
const statuses = ['success', 'partial', 'failed'];
const sourceProperties: Schema = {
  category: string('Source category; not necessarily the display catalogue category.'),
  units: { type: 'object', additionalProperties: { type: 'string' }, description: 'Native units by field. unspecified/unknown means not established; no conversion is inferred from a field name.' },
  window: ref('SourceWindow'), access: { type: 'string', enum: ['public', 'authenticated'] },
  endpoint_scope: string('For frontend statistics: anonymous public aggregates with an undocumented, unstable upstream schema.'),
  observed_at: timestamp, request_started_at: timestamp, request_completed_at: timestamp,
};
schemas.DatasetId.enum = [...datasetIds];
schemas.SourceWindow = object({ label: string(), start: nullable(string()), end: nullable(string()), timezone: nullable(string()), kind: string() }, ['label'], true);
schemas.DatasetReference = object({
  snapshot: ref('SnapshotId'), collected_at: timestamp, record_count: count,
  source_url: { type: 'string', format: 'uri' }, data_path: string('Exact retained successful dataset file under runs/{snapshot}/{type}.json.'),
  documentation_url: string(), raw_path: string(), sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' }, original_sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  coverage: string(), chunks: array(string()), model_chunks: { type: 'object', additionalProperties: array(string()) }, ...sourceProperties,
}, ['snapshot', 'collected_at', 'record_count', 'source_url', 'data_path'], true);
Object.assign(schemas.DatasetReport.properties, {
  ...sourceProperties, fallback: ref('DatasetReference'), chunks: array(string('Archive-relative query chunk path.')),
  model_chunks: { type: 'object', additionalProperties: array(string()), description: 'Model identity to query chunk paths. Used for exact model-filtered reads without loading an entire cross-model archive.' },
  shards: { type: 'object', additionalProperties: string(), description: 'Legacy/model identity to archive-relative shard file mapping.' },
  chunk_counts: { type: 'object', additionalProperties: count }, default_order: string('When id_asc, the archive can page indexed chunks without reading the entire dataset.'),
  row_count_actual: count, requests_total: count, requests_succeeded: count, requests_failed: count,
});
schemas.DatasetReport.description = 'Actual source provenance and collection result for one attempt. status=failed/unavailable never means a successful empty collection. An optional fallback points to a separately retained successful dataset, with its real snapshot/time/coverage. Native source metadata, query chunk indexes and explicitly declared redactions are preserved.';
schemas.Attribution = object({ publisher: string(), source_page: { type: 'string', format: 'uri' }, license_url: nullable({ type: 'string', format: 'uri' }), license_scope: string(), modifications: string() });
schemas.Attribution.description = 'Dataset-specific attribution. CC BY 4.0 is stated only for OpenRouter rankings data labelled that way by its source; third-party benchmarks and other content retain their own terms. A null license_url does not imply a new licence.';
const summaryProperties: Schema = { summary: { const: true }, chunk_count: count, indexed_model_contexts: count, full_report_url: { type: 'string', format: 'uri' }, chunks: false, chunk_counts: false, chunk_sha256s: false, model_chunks: false, shards: false };
schemas.DatasetReferenceSummary = { ...schemas.DatasetReference, properties: { ...schemas.DatasetReference.properties, ...summaryProperties }, description: 'Successful fallback reference summary. Physical chunk/model-index mappings are omitted; logical counts, actual source time and identity are preserved.' };
schemas.DatasetReportSummary = { ...schemas.DatasetReport, properties: { ...schemas.DatasetReport.properties, ...summaryProperties, fallback: ref('DatasetReferenceSummary') }, required: [...schemas.DatasetReport.required, 'summary', 'chunk_count', 'indexed_model_contexts'], description: 'Explicit report summary for data coverage/catalogue/dataset discovery. Physical chunk/model-index maps are omitted for delivery; summary=true is not an empty collection. Consult manifest_url/full_report_url for the complete original report.' };
schemas.QueryCoverage = {
  ...schemas.DatasetReportSummary,
  properties: { ...schemas.DatasetReportSummary.properties, status: { type: 'string', enum: ['ok', 'failed', 'unavailable', 'stale'] }, attempt_status: { type: 'string', enum: ['ok', 'failed', 'unavailable'] }, data_snapshot: ref('SnapshotId'), data_collected_at: timestamp },
  description: 'Dataset report used to serve this query. stale identifies a successful historical fallback, while attempt_status and fallback retain the latest attempt failure. No freshness is manufactured.',
};
schemas.SnapshotSummary.properties.status.enum = statuses;
schemas.Manifest.properties.status.enum = statuses;
schemas.ArchiveIndex = object({ schema_version: { const: 1 }, updated_at: timestamp, last_success: nullable(ref('SnapshotId')), latest_snapshot: nullable(ref('SnapshotId')), dataset_last_success: { type: 'object', additionalProperties: ref('DatasetReference') }, snapshots: array(ref('SnapshotSummary')) }, ['schema_version', 'updated_at', 'last_success', 'snapshots']);
Object.assign(schemas.Meta.properties, {
  status: { type: 'string', enum: [...statuses, 'stale'] }, snapshot_status: { type: 'string', enum: statuses },
  attempt_snapshot: ref('SnapshotId'), attempt_completed_at: timestamp, data_collected_at: nullable(timestamp),
  latest_snapshot: nullable(ref('SnapshotId')), latest_attempt_status: { type: ['string', 'null'], enum: [...statuses, null] },
  coverage: nullable(ref('QueryCoverage')), attribution: nullable(ref('Attribution')), manifest_url: { type: 'string', format: 'uri', description: 'Complete original selected-attempt manifest, including physical chunk indexes and source-level provenance omitted from delivery summaries.' },
});
schemas.Meta.properties.snapshot.description = 'Actual snapshot providing the returned data; can be older than attempt_snapshot when a failed dataset uses its retained successful fallback.';
schemas.Meta.properties.collected_at.description = 'Selected attempt completion time for ordinary responses; actual retained source collection time for fallback data. Use data_collected_at for row-source freshness.';
schemas.Meta.properties.data_collected_at.description = 'Real dataset collection time, including historical fallback time; null for responses that describe an attempt/catalogue rather than one dataset.';
schemas.Meta.properties.stale.description = 'True for retained fallback data or data/usable snapshot older than 36 hours. A fresh partial attempt can still make health degraded without stale=true for its successful datasets.';
schemas.Meta.description = 'schema_version remains 1 for historical archive compatibility. attempt_snapshot/snapshot_status describe the selected attempt; snapshot/data_collected_at describe the actual data being served. Never substitute the attempt timestamp for fallback data time.';
schemas.Meta.required = Object.keys(schemas.Meta.properties);
schemas.DatasetReport.properties.record_count.description = 'Number of query rows preserved for this source. A whole native payload is one actual row even if its nested analytics is empty; this is not a claim of zero requests/tokens or an invented empty record.';
schemas.SnapshotsEnvelope.properties.meta.properties.latest_snapshot = nullable(ref('SnapshotId'));
schemas.Health.properties.latest_snapshot = nullable(ref('SnapshotId'));
schemas.CatalogRow = object({
  id: ref('DatasetId'), title: string(), category: { type: 'string', enum: ['catalog', 'performance', 'usage', 'rankings', 'content', 'documentation'] },
  description: string(), fields: array(string()), coverage_note: string(), access: { const: 'public' },
  collection_status: { type: 'string', enum: ['ok', 'failed', 'unavailable', 'stale', 'not_collected'] },
  data_snapshot: nullable(ref('SnapshotId')), data_collected_at: nullable(timestamp), report: nullable(ref('DatasetReport')),
  attribution: ref('Attribution'), json_url: { type: 'string', format: 'uri' }, rss_url: { type: 'string', format: 'uri' }, manifest_url: { type: 'string', format: 'uri' },
});
schemas.CatalogRow.properties.report = nullable(ref('DatasetReportSummary'));
schemas.EnrichedDatasetReport = { ...schemas.DatasetReportSummary, properties: { ...schemas.DatasetReportSummary.properties, ...schemas.CatalogRow.properties, id: string(), status: schemas.DatasetReport.properties.status }, required: schemas.DatasetReportSummary.required, additionalProperties: true };
schemas.EnrichedDatasetReport.properties.access = { type: 'string', enum: ['public', 'authenticated'], description: 'Catalogue rows are public. Extra unavailable authentication-required source reports retain their original access classification.' };
schemas.EnrichedDatasetReport.properties.category = string('Display catalogue category when a definition exists; otherwise the original source category is preserved.');
schemas.CatalogRow.properties.collection_status.description = 'stale means this attempt uses a retained successful dataset fallback. not_collected means the definition exists but no report exists in the selected historical attempt; age freshness is separately exposed in meta/source times.';
schemas.DatasetsEnvelope.properties.data.items = ref('EnrichedDatasetReport');
schemas.CatalogEnvelope = object({ meta: ref('Meta'), data: array(ref('CatalogRow')), overview_rss: { type: 'string', format: 'uri' }, unavailable_sources: array(ref('DatasetReport')) });
schemas.PublicSource = object({
  source_url: { type: 'string', format: 'uri' }, scope: { const: 'public' }, kind: string(), window: string('Native source window label, not an arbitrary date-backfill parameter.'),
  units: { type: 'object', additionalProperties: { type: 'string' } }, metric: string(), view: string(), group: string(), subcategory: string(), section: string(), routeSegment: string(),
  model_id: string(), model_id_origin: string(), variant: string(), provider: string(),
  time_range: object({ from: string(), to: string() }),
}, ['source_url', 'scope', 'kind', 'window', 'units'], true);
schemas.PublicNativeRow = { type: 'object', properties: { _source: ref('PublicSource') }, required: ['_source'], additionalProperties: true, description: 'Original anonymous public aggregate row plus archive _source provenance. Native count strings, fractional sampled values, nulls, source ordering and original fields remain unchanged. Undocumented frontend interfaces are unstable and bounded; these records do not represent all private/platform traffic.' };
schemas.PublicPayloadRow = object({ model_id: string('Catalogue request identity, including variant; native canonical identity remains inside payload/source.'), payload: {}, _source: ref('PublicSource') }, ['payload', '_source'], true);
schemas.PublicActivityPayload = { type: 'object', properties: { analytics: array({ type: 'object', additionalProperties: true }), cachedAt: { type: 'number' } }, required: ['analytics'], additionalProperties: true };
schemas.PublicModelAppsPayload = { type: 'object', properties: { top_apps: array({ type: 'object', additionalProperties: true }), top_apps_chart: array({ type: 'object', additionalProperties: true }), model_chart: array({ type: 'object', additionalProperties: true }), cachedAt: { type: 'number' } }, required: ['top_apps', 'top_apps_chart', 'model_chart'], additionalProperties: true };
const nativeNumber: Schema = { type: ['number', 'string', 'null'], description: 'Unconverted native numeric value/string; null remains unknown.' };
const analyticsProperties: Schema = {
  date: string('Upstream statistic date, distinct from archive collection date; window aggregates are not necessarily a daily series.'),
  model_permaslug: string('Native canonical model identity.'), variant: string(), variant_permaslug: string(),
};
for (const field of ['total_prompt_tokens', 'total_completion_tokens', 'total_native_tokens_reasoning', 'count', 'num_media_prompt', 'num_media_completion', 'image_output_requests', 'num_video_prompt', 'video_output_seconds', 'rerank_documents', 'stt_transcript_characters', 'num_audio_prompt', 'total_native_tokens_cached', 'total_tool_calls', 'requests_with_tool_call_errors', 'total_byok_prompt_tokens', 'total_byok_completion_tokens']) analyticsProperties[field] = nativeNumber;
schemas.PublicAnalyticsRow = object(analyticsProperties, [], true);
schemas.PublicModelRankingRow = object({ ...analyticsProperties, change: nativeNumber, rankingMetricValue: nativeNumber, _source: ref('PublicSource') }, ['model_permaslug', 'date', '_source'], true);
schemas.PublicPerformanceRow = object({ id: string(), slug: string(), name: string(), author: string(), request_count: nativeNumber, p50_latency: nativeNumber, p50_throughput: nativeNumber, best_latency_provider: nullable(string()), best_latency_price: nativeNumber, best_throughput_provider: nullable(string()), best_throughput_price: nativeNumber, provider_count: nativeNumber, _source: ref('PublicSource') }, ['_source'], true);
schemas.PublicPerformanceRow.description = 'Native public performance summary. The source does not declare latency/throughput/price units or its observation window; _source.units and coverage explicitly retain that uncertainty.';
schemas.PublicApp = object({ id: { type: ['integer', 'string'] }, title: nullable(string()), description: nullable(string()), created_at: string(), main_url: nullable(string()), origin_url: nullable(string()), slug: nullable(string()), source_code_url: nullable(string()), icon_class_name: nullable(string()), favicon_url: nullable(string()), categories: array(string()), related_apps: array({ type: ['integer', 'string'] }) }, [], true);
schemas.PublicAppAnalyticsRow = object({ app_id: { type: ['integer', 'string'] }, total_tokens: { type: ['string', 'number'], description: 'Native token-count strings are preserved without float conversion.' }, total_requests: nativeNumber, rank: nativeNumber, app: ref('PublicApp') }, [], true);
schemas.PublicAppRankingRow = object({ ...schemas.PublicAppAnalyticsRow.properties, _source: ref('PublicSource') }, ['_source'], true);
schemas.PublicActivityPayload.properties.analytics.items = ref('PublicAnalyticsRow');
schemas.PublicModelAppsPayload.properties.top_apps.items = ref('PublicAppAnalyticsRow');
schemas.PublicModelAppsPayload.properties.top_apps_chart.items = ref('PublicAnalyticsRow');
schemas.PublicModelAppsPayload.properties.model_chart.items = ref('PublicAnalyticsRow');
schemas.PublicModelAppsPayload.description = 'Original per-model top_apps and two date-based daily analytics arrays. These charts are native date/model/token/etc rows, not an invented x/ys series.';
schemas.PublicSeriesPoint = object({ x: { type: ['string', 'number'] }, ys: { type: 'object', additionalProperties: nativeNumber } }, ['x', 'ys'], true);
schemas.PublicHistoryPayload = { anyOf: [array(ref('PublicSeriesPoint')), object({ data: array(ref('PublicSeriesPoint')), cachedAt: { type: 'number', description: 'Native upstream millisecond cache timestamp, distinct from collection time.' } }, ['data'], true), { type: 'object', additionalProperties: true, description: 'Whole public benchmark object: aaData, daData, valsIndex, weightedInputPrices and costPerRequest are preserved without forced series normalization.' }] };
schemas.PublicMarketplacePayload = object({ popular: array(ref('PublicAppAnalyticsRow')), trending: array(ref('PublicAppAnalyticsRow')), leaderboards: { type: 'object', additionalProperties: array(ref('PublicAppAnalyticsRow')) }, globalRankingMap: { type: 'object', properties: { day: array(ref('PublicAppAnalyticsRow')), week: array(ref('PublicAppAnalyticsRow')), month: array(ref('PublicAppAnalyticsRow')) }, additionalProperties: true } }, ['popular', 'trending', 'leaderboards', 'globalRankingMap'], true);
schemas.PublicSessionCostPayload = object({ windowDays: { type: 'number' }, windowEnd: string(), harnesses: array(object({ appId: { type: ['integer', 'string'] }, label: string(), icon: {}, models: array(object({ model: string(), points: array(object({ bucket: string('Native published session-length bucket; missing buckets are not filled.'), medianUsd: { type: 'number', description: 'Published median cost in USD.' } }, ['bucket', 'medianUsd'], true)) }, ['model', 'points'], true)) }, ['appId', 'label', 'models'], true)) }, ['windowDays', 'windowEnd', 'harnesses'], true);
schemas.PublicTaskMixPayload = object({ spend: { type: 'object', properties: { windowDays: { type: 'number' }, macroCategories: array({ type: 'object', additionalProperties: true }), tasks: array({ type: 'object', additionalProperties: true }) }, additionalProperties: true }, tokens: { type: 'object', additionalProperties: true } }, ['spend', 'tokens'], true);
schemas.PublicTaskMixPayload.description = 'Published task/category fractions and deltaPp percentage-point changes, retaining native windows and model lists; fractions are not absolute spend/token counts.';
schemas.PublicNativePayload = { description: 'Entire native public payload, whose shape depends on _source.kind. Includes native cache/window metadata and complete nested arrays/dictionaries.', anyOf: [ref('PublicActivityPayload'), ref('PublicModelAppsPayload'), ref('PublicHistoryPayload'), ref('PublicMarketplacePayload'), ref('PublicSessionCostPayload'), ref('PublicTaskMixPayload'), { type: 'object', additionalProperties: true }, array({})] };
schemas.PublicPayloadRow.properties.payload = ref('PublicNativePayload');
schemas.PublicModalityRow = { anyOf: [ref('PublicModelRankingRow'), ref('PublicPayloadRow')], description: 'modality_models retains native model rows; modality options/charts/category shares/rankings retain their complete native payloads. _source.routeSegment/kind/view/dimension/category identify the source context.' };
schemas.RawRow.description = 'Original fields and null values are retained. Public statistic rows append _source; aggregate/chart/per-model responses retain their entire upstream object under payload rather than manufacturing one empty record per nested point. Public source date windows and cachedAt are distinct from collection time. Query chunks are a storage optimization; API data remains actual complete rows.';
const map = schemas.DataEnvelope['x-dataset-schemas'] ?? {};
for (const id of datasetIds.filter(id => id.startsWith('public_'))) map[id] = id === 'public_model_rankings' ? 'PublicModelRankingRow' : id === 'public_performance' ? 'PublicPerformanceRow' : id === 'public_app_rankings' ? 'PublicAppRankingRow' : id === 'public_modality_statistics' ? 'PublicModalityRow' : 'PublicPayloadRow';
schemas.DataEnvelope['x-dataset-schemas'] = map;
schemas.DataEnvelope.properties.data.items = { anyOf: [...new Set<string>(Object.values(map) as string[])].map(ref), description: 'Row shape depends on type. Whole native payloads remain nested where applicable; filters do not recursively rewrite chart contents.' };
Object.assign(schemas.ServiceInfo.properties, { catalog: { type: 'string', format: 'uri' }, feeds: { type: 'string', format: 'uri' }, rss_overview: { type: 'string', format: 'uri' } });
const dimensions = ['author', 'provider', 'input_modality', 'output_modality', 'parameter', 'window', 'metric', 'view', 'kind', 'section', 'group', 'subcategory', 'modality'];
const sorts = ['id', 'name', 'created', 'published_at', 'date', 'context_length', 'pricing.prompt', 'rankingMetricValue', 'count', 'tokens', 'total_tokens', 'p50_latency', 'p50_throughput', 'uptime_last_30m', 'uptime_last_1d'];
const statisticalParameters = [
  param('window', { type: 'string', minLength: 1, maxLength: 300 }, 'Exact _source.window label(s), comma-separated. This filters already captured source variants; it does not ask upstream for an arbitrary historical window.'),
  param('metric', { type: 'string', minLength: 1, maxLength: 300 }, 'Exact captured source metric(s), for example tokens, tokens_excl_byok, requests or spend. Units remain in _source.units; spend values without a declared unit are not renamed USD.'),
  param('view', { type: 'string', minLength: 1, maxLength: 300 }, 'Exact captured view(s), commonly day/week/month. A view label is not a promise that every nested chart has that grain; inspect _source and payload.'),
  param('kind', { type: 'string', minLength: 1, maxLength: 300 }, 'Exact _source.kind value(s), for example model_activity, listed-pricing or modality_chart. Discover actual values through dimensions/catalogue and records.'),
  param('section', { type: 'string', minLength: 1, maxLength: 300 }, 'Exact _source.section value(s), such as globalRankingMap or a history source section; different sections can overlap.'),
  param('group', { type: 'string', minLength: 1, maxLength: 300 }, 'Exact app group(s), commonly coding, creative, productivity or entertainment; source rank lists remain bounded.'),
  param('subcategory', { type: 'string', minLength: 1, maxLength: 300 }, 'Exact captured app subcategory value(s); include low-count categories when present, without inventing records for empty results.'),
  param('modality', { type: 'string', minLength: 1, maxLength: 300 }, 'Exact _source.routeSegment/modality value(s), commonly text,image,embeddings,rerank,video,speech,decisions,transcription. This filters source rows, not nested payload models.'),
  param('app', { type: 'string', minLength: 1, maxLength: 300 }, 'Exact public application ID(s) present on scalar app rows. Does not recursively slice a per-model top_apps payload.'),
  param('since', { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}(?:T.*(?:Z|[+-]\\d\\d:\\d\\d))?$' }, 'Inclusive record-time lower bound: real UTC date or ISO timestamp with timezone. Uses scalar date, then published_at, pubDate, then numeric Unix created. Rows without a scalar timestamp are excluded. Nested charts/analytics are not trimmed; this cannot backfill history.'),
  param('until', { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}(?:T.*(?:Z|[+-]\\d\\d:\\d\\d))?$' }, 'Inclusive record-time upper bound; a YYYY-MM-DD value includes that entire UTC day. Same scalar timestamp rules as since; must be on/after since. No recursive chart filtering or upstream historical fetch.'),
];
const statisticalExamples: Record<string, string> = { window: 'week', metric: 'tokens', view: 'week', kind: 'model_activity', section: 'globalRankingMap', group: 'coding', subcategory: 'cli-agent', modality: 'text', app: '3067167', since: '2026-11-09', until: '2026-11-10' };
for (const p of statisticalParameters) p.example = statisticalExamples[p.name];
const selectors: Schema[] = spec.paths['/api/v1/manifest'].get.parameters;
selectors.find(p => p.name === 'date')!.description = 'UTC collection date or latest. latest chooses index.latest_snapshot (usable success/partial), with legacy last_success fallback. An exact date chooses the latest success/partial run on that date, never nearest-date substitution. Mutually exclusive with snapshot; history begins with actual collection.';
selectors.find(p => p.name === 'snapshot')!.description = 'Exact attempt run ID. Mutually exclusive with date. Failed attempts can be inspected through manifest/datasets/catalogue; row queries reject failed snapshots. A partial run can serve successful datasets and explicitly stale per-dataset fallbacks.';
for (const [route, pathItem] of Object.entries<Schema>(spec.paths)) for (const op of Object.values<Schema>(pathItem)) {
  for (const p of op.parameters ?? []) {
    if (p.name === 'date' || p.name === 'snapshot') Object.assign(p, selectors.find(s => s.name === p.name));
    if (p.name === 'type') { p.schema.enum = [...datasetIds]; p.description = 'One archived dataset, discovered through /api/v1/catalog or /feeds.json. All 28 catalogue/statistic/content/document datasets are queryable when collected. Missing historical datasets return 503, never an invented empty success.'; }
    if (p.name === 'sort') { p.schema.enum = sorts; if (!p.description.includes('Statistical numeric sorts')) p.description += ' Statistical numeric sorts address only the named scalar row field; nested payload values are not flattened or guessed. date uses the same scalar timestamp precedence as since/until. Native unit meanings vary; _source.units=unspecified remains unknown.'; }
    if (p.name === 'dimension') p.schema.enum = dimensions;
    if (route === '/api/v1/snapshots' && p.name === 'status') { p.schema.enum = statuses; p.description = 'Filter attempt status: success, partial (some datasets failed), or failed. Omitted includes all attempts.'; }
  }
}
for (const route of ['/api/v1/data', '/api/v1/dimensions', '/rss.xml']) {
  const op = spec.paths[route].get;
  op.parameters = [...op.parameters.filter((p: Schema) => !statisticalParameters.some(s => s.name === p.name)), ...statisticalParameters];
  if (!op.description.includes('API v1.1 can select')) op.description += ' API v1.1 can select a partial attempt. Successful datasets are served from that attempt; a failed dataset with a retained successful fallback returns HTTP 200 with meta.status=stale, the old actual meta.snapshot/data_collected_at, and the current attempt_snapshot/snapshot_status. No fallback means 503. Large source datasets can be stored in complete raw archives plus query chunks/model_chunks; model-filtered requests load matching chunks and preserve complete matching row payloads.';
}
const publicTypes = datasetIds.filter(id => id.startsWith('public_'));
const modelTypes = ['models', 'embedding_models', 'eu_models', 'image_models', 'video_models', 'endpoints', 'image_endpoints', 'zdr_endpoints', 'public_model_rankings', 'public_performance', 'public_model_activity', 'public_model_apps', 'public_model_observations'];
const providerTypes = ['providers', 'endpoints', 'image_endpoints', 'zdr_endpoints', 'public_performance', 'public_discovery'];
const applicable: Record<string, readonly string[]> = {
  model: modelTypes, author: modelTypes, provider: providerTypes, app: ['public_app_rankings'],
  input_modality: ['models', 'embedding_models', 'eu_models', 'image_models'], output_modality: ['models', 'embedding_models', 'eu_models', 'image_models'],
  parameter: ['models', 'embedding_models', 'eu_models', 'image_models', 'endpoints', 'image_endpoints', 'zdr_endpoints'],
  min_context: ['models', 'embedding_models', 'eu_models', 'endpoints', 'zdr_endpoints'], max_prompt_price: ['models', 'embedding_models', 'eu_models', 'endpoints', 'zdr_endpoints'], free: ['models', 'embedding_models', 'eu_models', 'endpoints', 'zdr_endpoints'],
  ...Object.fromEntries(['window', 'metric', 'view', 'kind', 'section', 'group', 'subcategory', 'modality'].map(key => [key, publicTypes])),
};
for (const route of ['/api/v1/data', '/api/v1/dimensions', '/rss.xml']) for (const p of spec.paths[route].get.parameters) {
  if (applicable[p.name]) p['x-applicable-types'] = applicable[p.name];
  if (p.name === 'model' || p.name === 'author') p.description = `Comma-separated exact, case-insensitive ${p.name === 'model' ? 'scalar model identities' : 'author prefixes before / in row identity'}. Applicable types are listed in x-applicable-types; unsupported types return 400. Model identity can be a native id/model_permaslug/variant_permaslug or catalogue-request model_id, depending on the row. Whole nested payloads are not recursively filtered.`;
  if (p.name === 'provider') p.description = 'Comma-separated exact provider names/slugs/tags present on the row or _source.provider. Uses actual provider fields, never an invented catalogue author-to-provider relationship. Applicable types are listed in x-applicable-types; unsupported types return 400.';
  if (p.name === 'dimension') p['x-applicable-types-by-dimension'] = Object.fromEntries(dimensions.map(dimension => [dimension, applicable[dimension]]));
}
const errors = spec.paths['/api/v1/data'].get.responses;
for (const route of ['/api/v1/manifest', '/api/v1/datasets', '/api/v1/data', '/api/v1/dimensions', '/rss.xml']) {
  const response = spec.paths[route].get.responses[503];
  response.description = 'NO_SUCCESSFUL_SNAPSHOT, FAILED_SNAPSHOT or DATASET_UNAVAILABLE when no usable data/fallback exists. PRIVATE_ARCHIVE_BLOCKED when the selected manifest contains an authenticated report with status other than unavailable: selected source details, records and discovery are not exposed. Unavailable authentication-required placeholders remain valid public archive metadata.';
  response.content['application/json'].examples = { unavailableDataset: { value: { error: { code: 'DATASET_UNAVAILABLE', message: 'The dataset failed and has no successful fallback; inspect the manifest.' } } }, privateArchiveBlocked: { summary: 'Authenticated data cannot be re-served as public archive data', value: { error: { code: 'PRIVATE_ARCHIVE_BLOCKED', message: 'Authenticated datasets must be isolated from this public archive; this snapshot is not served.' } } } };
  delete response.content['application/json'].example;
}
const catalogueOperation = (operationId: string, summary: string): Schema => ({ operationId, summary, description: 'Discover all 28 dataset definitions and per-type JSON/RSS/manifest links for a selected attempt. Historical attempts still show newer definitions with collection_status=not_collected and null source time/report. Reports retain real failure/fallback provenance. overview_rss links to a combined status feed; unavailable_sources lists explicit unavailable source reports. Only date or snapshot is accepted, with mutual exclusion and duplicate/unknown parameter rejection. Selected manifests containing actually collected authenticated data are blocked with PRIVATE_ARCHIVE_BLOCKED; index-only health does not inspect or expose those source details.', parameters: selectors.map(s => ({ ...s })), responses: { 200: { description: 'Complete dataset/feed catalogue, including definitions not collected in an old snapshot.', content: { 'application/json': { schema: ref('CatalogEnvelope') } } }, 400: errors[400], 404: errors[404], 405: errors[405], 502: errors[502], 503: errors[503] } });
spec.paths['/api/v1/catalog'] = { get: catalogueOperation('getCatalog', 'Discover every dataset, coverage and query/feed link') };
spec.paths['/feeds.json'] = { get: catalogueOperation('getFeeds', 'Discover per-dataset feeds and combined status RSS') };
spec.paths['/healthz'].get.description = 'No query parameters. Reads the archive index. A usable latest_snapshot can be success or partial; legacy archives fall back to last_success. 200 ok requires a fresh usable snapshot within 36 hours and the latest attempt success; partial/failed latest attempts or age degradation return 503 with Health body. Dataset-specific fallback age/failure remains visible in row metadata even if another dataset is fresh.';
spec.paths['/api/v1/datasets'].get.description = 'Explicit summaries of actual dataset/source reports for the selected attempt, preserving source/collection/status/errors/fallback/raw metadata and adding catalogue labels, attribution and per-type JSON/RSS/manifest links when a definition exists. summary=true omits physical chunks/model_chunks/shard maps and exposes chunk_count/indexed_model_contexts instead; the complete original report remains at manifest_url. No pagination. Unlike catalog/feeds, this list does not manufacture reports for definitions absent from a historical attempt.';
spec.paths['/api/v1/snapshots'].get.description = 'List actual success, partial and failed attempts newest completed_at first, with inclusive UTC collection-date bounds and pagination. Partial results preserve successful datasets and explicit failed dataset reports/fallbacks. last_success identifies the last fully successful run; latest_snapshot identifies the latest usable success/partial run. Unknown/duplicate/invalid parameters return 400.';
const rss = spec.paths['/rss.xml'].get;
rss.parameters.find((p: Schema) => p.name === 'type').schema.enum = [...datasetIds, 'overview'];
rss.parameters.find((p: Schema) => p.name === 'type').description += ' RSS additionally accepts overview, which emits dataset observation/status items linking to complete JSON records. overview accepts only type/date/snapshot/limit/offset; other filters/sort parameters return 400.';
spec.paths['/api/v1/dimensions'].get.description = 'Count distinct scalar/source dimension values after filtering actual archived rows. dimension is required and must be applicable to the type; sort/order are rejected. Buckets sort count descending then value ascending. Values deduplicate within a row. Provider catalogues/endpoints use one canonical slug/name per row rather than duplicate aliases. Public performance can contribute its distinct native best_latency_provider and best_throughput_provider values, so one record may count in two provider buckets. Other multi-valued dimensions can also sum above matched_records. The filter/provider aliases never create a synthetic author-to-provider relationship. Metadata filters group captured source variants; they do not recursively flatten native payloads or trim charts. Partial/fallback selection and actual data/attempt timestamps follow /api/v1/data.';
schemas.DimensionPagination.properties.missing_count.description = 'Filtered rows lacking values for this dimension. Modality/parameter dimensions and distinct native best-performance providers can contribute more than one bucket per row. Canonical provider catalogue/endpoint aliases do not double-count.';
rss.description = 'Independent XML-escaped RSS 2.0 over archived records. All dataset query selectors, applicable filters and statistical scalar sorts are available, with limit capped at 100; dimension is rejected. For omitted sort: five model catalogues use created desc; model_rss/blog_posts/status_incidents use published_at desc; other types use id asc. Explicit order overrides that direction; explicit sort without order defaults asc. type=overview accepts only type/date/snapshot/limit/offset and emits one dataset observation/status item per actual report, linking to complete JSON plus native unit/window summaries, source time, coverage, failure/stale state and dataset/category labels. Per-dataset items provide a sampled structured native-field summary, _source/window/units and a Complete JSON link, not a claim that RSS contains every nested field. Public statistic GUIDs use the real data snapshot and stable source/model/metric/view/kind/section/row identity context rather than the current chunk position. Old fallback data keeps its actual old lastBuildDate/data-snapshot GUID and stale labels; a new attempt does not make old data new. pubDate uses original RSS pubDate/published_at when present, otherwise numeric Unix created, otherwise the real dataset collection time; invalid values fall back to that source time. A statistical row.date remains a native metric date and does not replace RSS observation publication time. since/until filter scalar record timestamps only; nested history payloads are never cut or backfilled.';
spec.info.version = '1.1.0';
spec.info.description = 'Independent, unofficial daily public OpenRouter archive and read-only JSON/RSS API. Discover all 28 catalogue, performance, public usage/ranking, content and documentation datasets through catalog/feeds. Official URLs are source attribution, not this deployment. New public statistics use anonymous page-backed frontend interfaces whose undocumented schemas, selected top rows, sampled/fractional estimates, windows and unknown units are explicitly preserved. They are not private/account data, complete traffic or infinite history. Partial attempts and dataset-specific retained successful fallbacks expose real source snapshot/time, attempt identity, errors and stale status. schema_version remains 1 for old archive compatibility. Raw source bodies and complete payloads are retained with query chunk indexes where needed; credential-shaped official examples are explicitly redacted with original/published hashes. HEAD mirrors GET status/headers; OPTIONS returns 204. All query parameters are strict.';
spec.info.description += ' Dataset-specific attribution identifies the applicable source and licence scope without assigning one licence to all third-party data. Coverage/discovery report summaries omit physical indexes, expose summary/chunk counts, and link to the complete manifest. Delivery may use lossless public-index/query-manifest projections and logical-path .gz transport fallbacks; compression does not change source timestamps, row counts or logical decoded-byte hashes. storage.json records delivery/compression information, while legacy plain files remain supported. Authenticated Data API/account data is not enabled.';
for (const route of ['/api/v1/catalog', '/feeds.json']) spec.paths[route].get['x-codeSamples'] = [{ lang: 'Shell', label: 'Discover every archived data type', source: `curl "https://openrouter-data.pages.dev${route}"` }];
spec.paths['/api/v1/data'].get['x-codeSamples'] = [
  { lang: 'Shell', label: 'Public model window ranking', source: 'curl "https://openrouter-data.pages.dev/api/v1/data?type=public_model_rankings&view=week&metric=tokens&sort=rankingMetricValue&order=desc&limit=20"' },
  { lang: 'Shell', label: 'App category ranking', source: 'curl "https://openrouter-data.pages.dev/api/v1/data?type=public_app_rankings&group=coding&subcategory=cli-agent&window=week&sort=total_tokens&order=desc&limit=20"' },
  { lang: 'Shell', label: 'Entire model analytics payload, no nested trimming', source: 'curl "https://openrouter-data.pages.dev/api/v1/data?type=public_model_activity&model=openai%2Fgpt-4o&limit=1"' },
  { lang: 'Shell', label: 'Scalar dates within a collected ranking snapshot', source: 'curl "https://openrouter-data.pages.dev/api/v1/data?type=public_model_rankings&view=day&since=2026-11-09&until=2026-11-10&limit=20"' },
];
spec.paths['/api/v1/dimensions'].get['x-codeSamples'] = [{ lang: 'Shell', label: 'Discover captured statistic windows', source: 'curl "https://openrouter-data.pages.dev/api/v1/dimensions?type=public_model_rankings&dimension=view"' }, { lang: 'Shell', label: 'Discover model observation kinds', source: 'curl "https://openrouter-data.pages.dev/api/v1/dimensions?type=public_model_observations&dimension=kind"' }];
rss['x-codeSamples'] = [{ lang: 'Shell', label: 'Combined dataset status feed', source: 'curl "https://openrouter-data.pages.dev/rss.xml?type=overview&limit=50"' }, { lang: 'Shell', label: 'Public model ranking feed', source: 'curl "https://openrouter-data.pages.dev/rss.xml?type=public_model_rankings&view=week&metric=tokens&sort=rankingMetricValue&order=desc&limit=20"' }];
const sampleIndex = process.argv.indexOf('--sample');
if (sampleIndex !== -1) {
  const sample = process.argv[sampleIndex + 1];
  if (!sample || !/^\d{4}-\d{2}-\d{2}T\d{6}Z-[a-z0-9]+$/.test(sample)) throw new Error('Supply an actual locally archived snapshot ID after --sample.');
  const { handleRequest } = await import('../src/worker.js');
  const localJson = async (p: string): Promise<any> => {
    try { return JSON.parse(await readFile(`data/${p}`, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return JSON.parse(gunzipSync(await readFile(`data/${p}.gz`)).toString('utf8')); }
  };
  const store = { async read(p: string) { try { let value; if (p === 'index.json') { try { value = await localJson('public-index.json'); } catch { value = await localJson(p); } } else value = await localJson(p); return { ok: true as const, value }; } catch { return { ok: false as const, error: { code: 'ARCHIVE_UNAVAILABLE', message: 'Local archive file absent.', status: 502 } }; } } };
  const requests: Record<string, string> = {
    '/': '/', '/api/v1/snapshots': '/api/v1/snapshots?limit=1', '/api/v1/manifest': `/api/v1/manifest?snapshot=${sample}`,
    '/api/v1/datasets': `/api/v1/datasets?snapshot=${sample}`, '/api/v1/catalog': `/api/v1/catalog?snapshot=${sample}`, '/feeds.json': `/feeds.json?snapshot=${sample}`,
    '/api/v1/data': `/api/v1/data?type=models&snapshot=${sample}&model=openai%2Fgpt-4o&limit=1`,
    '/api/v1/dimensions': `/api/v1/dimensions?type=models&snapshot=${sample}&dimension=output_modality&limit=10`,
    '/rss.xml': `/rss.xml?type=overview&snapshot=${sample}&limit=2`,
  };
  for (const [route, requestPath] of Object.entries(requests)) {
    const response = await handleRequest(new Request(`https://openrouter-data.pages.dev${requestPath}`), store);
    if (response.status !== 200) throw new Error(`Refused to manufacture ${route} example: ${response.status} ${await response.text()}`);
    const media = route === '/rss.xml' ? 'application/rss+xml' : 'application/json';
    const value = route === '/rss.xml' ? await response.text() : await response.json();
    const example = { summary: `Actual locally archived ${sample}`, description: `Current handler over real archive files; request ${requestPath}. This is an exact snapshot example, not a claim that it is the latest data.`, ...(JSON.stringify(value).length > 25000 ? { externalValue: `https://openrouter-data.pages.dev${requestPath}` } : { value }) };
    spec.paths[route].get.responses[200].content[media].examples = { actualArchivedData: example };
  }
  const manifest = await localJson(`runs/${sample}/manifest.json`);
  for (const dataset of manifest.datasets.filter((r: Schema) => r.id.startsWith('public_') && (r.status === 'ok' || r.fallback))) {
    const requestPath = `/api/v1/data?type=${dataset.id}&snapshot=${sample}&limit=1`;
    const response = await handleRequest(new Request(`https://openrouter-data.pages.dev${requestPath}`), store);
    if (response.status !== 200) throw new Error(`Cannot capture real public example: ${requestPath} ${response.status}`);
    const value = await response.json();
    spec.paths['/api/v1/data'].get.responses[200].content['application/json'].examples[dataset.id] = { summary: `Actual ${dataset.id} from ${sample}`, description: `Complete first query row from real archive files, with native data/source and fallback metadata retained. Request ${requestPath}.`, ...(JSON.stringify(value).length > 25000 ? { externalValue: `https://openrouter-data.pages.dev${requestPath}` } : { value }) };
  }
  for (const [name, requestPath] of Object.entries({ globalRankingTwoRows: `/api/v1/data?type=public_model_rankings&snapshot=${sample}&view=week&metric=tokens&sort=rankingMetricValue&order=desc&limit=2`, modelActivityNativeWindow: `/api/v1/data?type=public_model_activity&snapshot=${sample}&model=openai%2Fgpt-4o&limit=1` })) {
    const response = await handleRequest(new Request(`https://openrouter-data.pages.dev${requestPath}`), store);
    if (response.status !== 200) throw new Error(`Actual query example failed: ${requestPath} ${response.status}`);
    const value = await response.json();
    spec.paths['/api/v1/data'].get.responses[200].content['application/json'].examples[name] = { summary: `Actual captured query: ${name}`, description: `Complete response for ${requestPath}; native payloads and summary metadata are not manually truncated.`, ...(JSON.stringify(value).length > 25000 ? { externalValue: `https://openrouter-data.pages.dev${requestPath}` } : { value }) };
  }
  const rankingFeedPath = `/rss.xml?type=public_model_rankings&snapshot=${sample}&view=week&metric=tokens&sort=rankingMetricValue&order=desc&limit=2`;
  const rankingFeed = await handleRequest(new Request(`https://openrouter-data.pages.dev${rankingFeedPath}`), store);
  if (rankingFeed.status !== 200) throw new Error('Actual public ranking RSS example failed.');
  spec.paths['/rss.xml'].get.responses[200].content['application/rss+xml'].examples.publicRankingFeed = { summary: 'Actual public statistic feed with sampled summaries and complete JSON links', description: `Request ${rankingFeedPath}. RSS labels its sampled summary; the full JSON/raw archive retains complete records.`, value: await rankingFeed.text() };
  const index = await localJson('index.json');
  const partial = index.snapshots.find((s: Schema) => s.status === 'partial');
  if (partial) {
    const requestPath = `/api/v1/manifest?snapshot=${partial.id}`;
    const response = await handleRequest(new Request(`https://openrouter-data.pages.dev${requestPath}`), store);
    if (response.status !== 200) throw new Error('Retained partial-attempt manifest could not be read.');
    const value = await response.json();
    if (value.meta.snapshot_status !== 'partial') throw new Error('Refused to label a non-partial attempt as partial.');
    spec.paths['/api/v1/manifest'].get.responses[200].content['application/json'].examples.retainedPartialAttempt = { summary: `Actual retained partial attempt ${partial.id}`, description: 'Complete immutable attempt evidence; failed dataset reports are not relabelled as successful data.', externalValue: `https://openrouter-data.pages.dev${requestPath}` };
  }
  const health = await handleRequest(new Request('https://openrouter-data.pages.dev/healthz'), store);
  spec.paths['/healthz'].get.responses[health.status].content['application/json'].examples = { actualArchiveHealth: { summary: 'Actual local archive health at example capture time', value: await health.json() } };
}
await writeFile(path, `${JSON.stringify(spec, null, 2)}\n`);
console.log(`Updated OpenAPI ${spec.info.version}: ${Object.keys(spec.paths).length} paths, ${datasetIds.length} datasets.`);
