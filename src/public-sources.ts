/** Pure request definitions/parsers for anonymous, public OpenRouter frontend statistics. */
const publicPaths: Record<string, readonly string[]> = {
  '/api/frontend/v1/rankings/models': ['view', 'metric'],
  '/api/frontend/v1/rankings/model-rankings-chart': [],
  '/api/frontend/v1/rankings/performance': [],
  '/api/frontend/v1/apps/marketplace/marketplace': [],
  '/api/frontend/v1/rankings/apps': [],
  '/api/frontend/v1/apps/marketplace/category': ['group', 'subcategory', 'period', 'sortBy'],
  '/api/frontend/v1/apps/marketplace/category-chart': ['group', 'subcategory'],
  '/api/frontend/v1/stats/model-activity': ['permaslug', 'variant'],
  '/api/frontend/v1/stats/top-apps-for-model': ['permaslug', 'variant'],
  '/api/frontend/v1/rankings/session-cost': [],
  '/api/frontend/v1/rankings/task-spend': [],
  '/api/frontend/v1/rankings/discovery': [],
  '/api/frontend/v1/rankings/routers': ['view'],
  '/api/frontend/v1/rankings/modality-category-options': ['routeSegment'],
  '/api/frontend/v1/rankings/modality-chart': ['routeSegment'],
  '/api/frontend/v1/rankings/modality-models': ['routeSegment', 'view'],
  '/api/frontend/v1/rankings/modality-category-rankings': ['routeSegment', 'dimension'],
  '/api/frontend/v1/rankings/modality-category-share': ['routeSegment', 'dimension', 'category'],
  '/api/frontend/v1/stats/listed-pricing': ['permaslug', 'variant'],
  '/api/frontend/v1/stats/effective-pricing': ['permaslug', 'variant'],
  '/api/frontend/v1/stats/model-uptime-recent': ['permaslug', 'variant'],
  '/api/frontend/v1/stats/uptime-recent': ['permaslug', 'variant'],
  '/api/frontend/v1/stats/top-colos-for-model': ['permaslug', 'variant'],
  '/api/frontend/v1/stats/provider-token-chart': ['provider', 'permaslug', 'variant'],
  '/api/frontend/v1/all-providers': [],
  '/api/frontend/v1/catalog/providers': [],
  '/api/frontend/v1/rankings/benchmarks': [],
};
const views = ['day', 'week', 'month'] as const;
const groups = ['coding', 'creative', 'productivity', 'entertainment'] as const;
const modalities = ['text', 'image', 'embeddings', 'rerank', 'video', 'speech', 'decisions', 'transcription'] as const;
const historySections = ['author-market-share', 'open-closed', 'tools', 'images', 'image-output', 'rerank-documents', 'natural-language', 'programming-language', 'context-length', 'stt-transcript-characters', 'video-output-hours'] as const;
for (const section of historySections) publicPaths[`/api/frontend/v1/rankings/${section}`] = [];
export const publicDatasetIds = ['public_model_rankings', 'public_ranking_history', 'public_performance', 'public_apps', 'public_app_rankings', 'public_model_activity', 'public_model_apps', 'public_session_cost', 'public_task_mix', 'public_discovery', 'public_modality_statistics', 'public_model_observations'] as const;
export type PublicDatasetId = typeof publicDatasetIds[number];
export type PublicSourceKind = 'model_rankings' | 'ranking_history' | 'performance' | 'marketplace' | 'marketplace_rankings' | 'app_rankings' | 'app_category' | 'app_category_chart' | 'model_activity' | 'model_apps' | 'session_cost' | 'task_mix' | 'discovery' | 'routers' | 'modality_options' | 'modality_chart' | 'modality_models' | 'modality_category_rankings' | 'modality_category_share' | 'listed-pricing' | 'effective-pricing' | 'model-uptime-recent' | 'uptime-recent' | 'provider-token-chart' | 'top-colos-for-model' | 'all_providers' | 'provider_catalog' | 'benchmarks';
export interface PublicSourceRequest {
  id: string;
  dataset: PublicDatasetId;
  url: string;
  scope: 'public';
  kind: PublicSourceKind;
  window: string;
  metric?: string;
  view?: string;
  group?: string;
  subcategory?: string;
  model_id?: string;
  section?: string;
  routeSegment?: string;
  provider?: string;
  variant?: string;
  dimension?: string;
  category?: string;
  model_origin?: 'catalogue_request_context' | 'public_ranking_identity';
}
export interface PublicSourceMetadata {
  source_url: string;
  scope: 'public';
  window: string;
  units: Record<string, string>;
  coverage: string;
  unavailable: string[];
  has_next: boolean;
  next_url: string | null;
  time_range?: { from: string; to: string };
  record_count: number;
  discovered_requests?: PublicSourceRequest[];
}
export interface ParsedPublicSource { rows: Record<string, unknown>[]; metadata: PublicSourceMetadata }
type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
function expectObject(value: unknown, label: string): Row {
  if (!object(value)) throw new Error(`Invalid public source: expected ${label} object.`);
  return value;
}
function expectRows(value: unknown, label: string): Row[] {
  if (!Array.isArray(value) || !value.every(object)) throw new Error(`Invalid public source: expected ${label} object array.`);
  return value;
}
function seriesRows(value: unknown, label: string): Row[] {
  const rows = expectRows(value, label);
  if (rows.some(row => !['string', 'number'].includes(typeof row.x) || !object(row.ys))) throw new Error(`Invalid ${label} series points.`);
  return rows;
}
function setTimeRange(metadata: PublicSourceMetadata, points: Row[], key = 'x'): void {
  const dates = points.map(point => point[key]).filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)).sort();
  if (dates.length) metadata.time_range = { from: dates[0]!, to: dates.at(-1)! };
}
const tokenUnits: Record<string, string> = {
  total_prompt_tokens: 'tokens', total_completion_tokens: 'tokens', total_native_tokens_reasoning: 'tokens',
  total_native_tokens_cached: 'tokens', total_byok_prompt_tokens: 'tokens', total_byok_completion_tokens: 'tokens',
  video_output_seconds: 'seconds', rerank_documents: 'documents', stt_transcript_characters: 'characters',
  image_output_requests: 'requests', total_tool_calls: 'calls', requests_with_tool_call_errors: 'requests',
};
function sourceContext(request: PublicSourceRequest, metadata: PublicSourceMetadata): Row {
  return {
    source_url: request.url, scope: 'public', kind: request.kind, window: metadata.window, units: metadata.units,
    ...(request.metric ? { metric: request.metric } : {}), ...(request.view ? { view: request.view } : {}),
    ...(request.group ? { group: request.group } : {}), ...(request.subcategory ? { subcategory: request.subcategory } : {}),
    ...(request.model_id ? { model_id: request.model_id, model_id_origin: request.model_origin ?? 'catalogue_request_context' } : {}),
    ...(request.section ? { section: request.section } : {}), ...(request.routeSegment ? { routeSegment: request.routeSegment } : {}),
    ...(request.provider ? { provider: request.provider } : {}),
    ...(request.variant ? { variant: request.variant } : {}),
    ...(request.dimension ? { dimension: request.dimension } : {}), ...(request.category ? { category: request.category } : {}),
    ...(metadata.time_range ? { time_range: metadata.time_range } : {}),
  };
}
function attachSource(row: Row, request: PublicSourceRequest, metadata: PublicSourceMetadata, extra: Row = {}): Row {
  if (Object.hasOwn(row, '_source')) throw new Error('Unexpected upstream _source field would conflict with archive provenance.');
  return { ...row, _source: { ...sourceContext(request, metadata), ...extra } };
}
export function parsePublicSource(request: PublicSourceRequest, payload: unknown): ParsedPublicSource {
  if (request.scope !== 'public' || !isAllowedPublicSourceUrl(request.url)) throw new Error('Refused a private, authenticated or unapproved source.');
  const root = expectObject(payload, 'response');
  for (const container of [root, ...(object(root.data) ? [root.data] : [])]) {
    const links = object(container.links) ? container.links : {};
    const pagination = object(container.pagination) ? container.pagination : {};
    if ([container.next, container.next_url, container.nextCursor, links.next, pagination.next, pagination.next_cursor].some(value => value !== undefined && value !== null && value !== '') ||
      [container.has_more, container.has_next, container.hasNextPage, pagination.has_more, pagination.has_next].some(value => value === true)) {
      throw new Error('Unverified upstream pagination detected; refusing to follow an unknown/private continuation or claim completeness.');
    }
  }
  const metadata: PublicSourceMetadata = {
    source_url: request.url, scope: 'public', window: request.window, units: {},
    coverage: 'Anonymous public frontend aggregate; unversioned upstream schema and bounded displayed/sample coverage.',
    unavailable: ['No verified upstream pagination; the response is not proof of complete OpenRouter traffic or all historical/private records.'],
    has_next: false, next_url: null, record_count: 0,
  };
  let rows: Row[];
  if (request.kind === 'model_rankings' || request.kind === 'modality_models') {
    const native = expectRows(root.data, 'model rankings');
    if (native.some(row => typeof row.date !== 'string' || request.kind === 'modality_models' && typeof row.model_permaslug !== 'string')) throw new Error('Invalid model ranking identity/date.');
    metadata.units = { ...tokenUnits, rankingMetricValue: request.metric === 'spend' ? 'unspecified' : request.metric === 'requests' ? 'requests' : 'tokens' };
    metadata.coverage = 'Public model/variant window aggregates in upstream order; no ranks, missing values, private traffic or daily history are inferred.';
    if (request.kind === 'modality_models') {
      metadata.units.count = 'requests';
      metadata.unavailable.push('Modality leaderboards use the upstream request metric; image_output_requests counts requests, not generated images. Other native generated metrics retain their distinct units.');
    } else {
      const requests = new Map<string, PublicSourceRequest>();
      let unidentified = 0;
      for (const row of native) {
        const permaslug = typeof row.model_permaslug === 'string' && /^~?[A-Za-z0-9._:-]+\/[A-Za-z0-9._:-]+$/.test(row.model_permaslug) ? row.model_permaslug : undefined;
        const identity = typeof row.variant_permaslug === 'string' && /^~?[A-Za-z0-9._:-]+\/[A-Za-z0-9._:-]+$/.test(row.variant_permaslug) ? row.variant_permaslug : undefined;
        const variant = typeof row.variant === 'string' && /^[A-Za-z0-9._:-]+$/.test(row.variant) ? row.variant : undefined;
        if (!permaslug || !identity && !variant) { unidentified++; continue; }
        for (const source of publicModelRequests(identity ?? permaslug, permaslug, variant)) {
          const discovered = { ...source, model_origin: 'public_ranking_identity' as const };
          requests.set(`${source.url}\n${source.model_id}`, discovered);
        }
      }
      metadata.discovered_requests = [...requests.values()];
      metadata.unavailable.push('Additional per-model requests use only native public ranking permaslug and variant identities, including models absent from the current catalogue; each fetch is a current rolling observation, not a backfilled snapshot.');
      if (unidentified) metadata.unavailable.push(`${unidentified} ranking rows lacked a usable native canonical/variant identity; no model identifiers or requests were invented for them.`);
    }
    rows = native.map(row => attachSource(row, request, metadata));
  } else if (request.kind === 'performance') {
    const native = expectRows(root.data, 'performance');
    if (native.some(row => typeof row.id !== 'string' && typeof row.slug !== 'string')) throw new Error('Invalid performance model identity.');
    metadata.units = { p50_latency: 'unspecified', p50_throughput: 'unspecified', request_count: 'requests', best_latency_price: 'unspecified', best_throughput_price: 'unspecified' };
    metadata.unavailable.push('The public performance response does not declare its measurement window or latency/throughput/price units; values are retained without conversion.');
    metadata.coverage = 'Public p50/model/provider performance summaries only; null values remain unknown and are not inferred from model prices.';
    rows = native.map(row => attachSource(row, request, metadata));
  } else if (request.kind === 'ranking_history') {
    const native = root.data;
    const points = seriesRows(Array.isArray(native) ? native : expectObject(native, 'history wrapper').data, 'history');
    setTimeRange(metadata, points);
    metadata.units = { ys: 'unspecified' };
    metadata.coverage = 'Available public chart series including its native wrapper/cache metadata; displayed series and Others are not an exhaustive model history.';
    metadata.unavailable.push('Only returned chart history is available; start/end/limit/offset are not verified history-backfill controls. Fractional or sampled estimates remain unchanged.');
    rows = [attachSource({ payload: native }, request, metadata)];
  } else if (request.kind === 'model_activity' || request.kind === 'model_apps') {
    const native = expectObject(root.data, 'model statistics');
    const points = request.kind === 'model_activity' ? expectRows(native.analytics, 'analytics') : expectRows(native.model_chart, 'model chart');
    if (request.kind === 'model_apps') { expectRows(native.top_apps, 'top apps'); expectRows(native.top_apps_chart, 'top app chart'); }
    if (points.some(point => typeof point.date !== 'string')) throw new Error('Invalid native model analytics date.');
    setTimeRange(metadata, points, 'date');
    metadata.units = { ...tokenUnits, total_tokens: 'tokens', chart_ys: 'unspecified' };
    metadata.coverage = 'Public per-model bounded activity/app samples with the entire native analytics/charts/cache object retained; model_id is catalogue request context.';
    if (!points.length) metadata.unavailable.push('The upstream result is empty; absence of a public sample is not evidence of zero usage.');
    metadata.unavailable.push('Catalogue aliases require canonical permaslug and variant; the current public window cannot reconstruct earlier or private model/app activity.');
    rows = [attachSource({ model_id: request.model_id, payload: native }, request, metadata)];
  } else if (['marketplace', 'marketplace_rankings', 'app_rankings'].includes(request.kind)) {
    const native = expectObject(root.data, 'app rankings');
    const rankingMap = request.kind === 'app_rankings' ? native : expectObject(native.globalRankingMap, 'global app rankings');
    if (request.kind !== 'app_rankings') {
      expectRows(native.popular, 'popular apps'); expectRows(native.trending, 'trending apps');
      for (const value of Object.values(expectObject(native.leaderboards, 'app leaderboards'))) expectRows(value, 'app leaderboard');
    }
    for (const view of views) expectRows(rankingMap[view], `${view} app rankings`);
    metadata.units = { total_tokens: 'tokens', total_requests: 'requests', rank: 'upstream rank' };
    metadata.coverage = 'Public marketplace selections and bounded app ranking lists; native app metadata, section membership and original count strings are retained.';
    metadata.unavailable.push('Popular/trending/category lists and top-20/top-200 sections are bounded public selections, not every app or private app traffic.');
    rows = request.kind === 'marketplace' ? [attachSource({ payload: native }, request, metadata)] : views.flatMap(window => expectRows(rankingMap[window], 'app rankings').map(row => attachSource(row, request, metadata, { window, section: request.kind === 'app_rankings' ? 'rankings/apps' : 'globalRankingMap' })));
  } else if (request.kind === 'app_category') {
    const native = expectObject(root.data, 'app category');
    const apps = expectRows(native.apps, 'category apps');
    if (native.group !== request.group) throw new Error('Upstream app category group differs from requested group.');
    const names = [native.subcategories, native.lowCountSubcategories].flatMap(value => {
      if (!Array.isArray(value) || !value.every(name => typeof name === 'string' && /^[a-z0-9-]+$/.test(name))) throw new Error('Invalid app subcategory discovery list.');
      return value as string[];
    });
    metadata.units = { total_tokens: 'tokens', total_requests: 'requests', rank: 'upstream rank' };
    metadata.coverage = 'Public category/period/sort selections with native app records and original parent classification metadata.';
    metadata.unavailable.push('Category results are bounded (observed up to 50); upstream ignores limit/offset, so no pagination or full-app coverage is claimed.');
    const { apps: _apps, ...parent } = native;
    rows = apps.map(row => attachSource(row, request, metadata, { section: 'category', parent }));
    if (!request.subcategory) metadata.discovered_requests = [...new Set(names)].flatMap(name => [categoryRequest(request.group!, request.window, request.metric!, name), categoryChartRequest(request.group!, name)]);
  } else if (['app_category_chart', 'session_cost', 'task_mix', 'discovery', 'routers', 'modality_options', 'modality_chart', 'modality_category_rankings', 'modality_category_share'].includes(request.kind)) {
    const native = expectObject(root.data, 'public aggregate');
    if (request.kind === 'app_category_chart') {
      const points = seriesRows(native.chartData, 'category chart'); expectObject(native.titleMap, 'category chart title map');
      setTimeRange(metadata, points); metadata.units = { ys: 'unspecified' };
    } else if (request.kind === 'session_cost') {
      expectRows(native.harnesses, 'session harnesses');
      if (!Number.isInteger(native.windowDays) || Number(native.windowDays) <= 0 || typeof native.windowEnd !== 'string') throw new Error('Invalid native session cost window.');
      metadata.window = `native_${native.windowDays}_days`; metadata.units = { medianUsd: 'USD', windowDays: 'days' };
      metadata.unavailable.push('Public harness/model median session buckets are samples, not this account usage or complete session records; windowEnd is preserved and a start date is not inferred.');
    } else if (request.kind === 'task_mix' || request.kind === 'modality_category_rankings') {
      for (const section of ['spend', 'tokens', ...(request.kind === 'modality_category_rankings' ? ['requests'] : [])]) {
        const view = expectObject(native[section], `task/category ${section}`);
        if (!Number.isInteger(view.windowDays) || Number(view.windowDays) <= 0) throw new Error('Invalid native task/category window.');
        if (request.kind === 'task_mix') { expectRows(view.macroCategories, 'macro categories'); expectRows(view.tasks, 'task categories'); }
        else expectRows(view.categories, 'modality categories');
      }
      const windows = [...new Set(Object.values(native).filter(object).map(value => value.windowDays).filter(value => Number.isInteger(value)))];
      metadata.window = windows.length === 1 ? `native_${windows[0]}_days` : 'mixed_native_windows';
      metadata.units = { spendShare: 'fraction', spendShareOfTotal: 'fraction', shareOfTotal: 'fraction', share: 'fraction', deltaPp: 'percentage points', windowDays: 'days' };
      metadata.unavailable.push('Shares are not absolute spend or token counts; no currency amount, population total or missing private traffic is inferred.');
    } else if (request.kind === 'discovery') {
      for (const key of ['climbing', 'breakouts', 'authors']) expectRows(native[key], `discovery ${key}`);
      if (!Object.hasOwn(native, 'totals') || !Object.hasOwn(native, 'routerTokens')) throw new Error('Invalid discovery aggregate.');
      metadata.units = { routerTokens: 'tokens', totals: 'native unspecified' };
    } else if (request.kind === 'routers') {
      const points = seriesRows(native.weekly, 'router weekly'); expectRows(native.models, 'router models');
      setTimeRange(metadata, points); metadata.units = { tokens: 'tokens', change: 'unspecified' };
    } else if (request.kind === 'modality_options') {
      const dimensions = expectRows(native.dimensions, 'modality dimensions');
      metadata.discovered_requests = [];
      for (const dimension of dimensions) {
        if (typeof dimension.dimension !== 'string' || !/^[A-Za-z0-9_.:-]+$/.test(dimension.dimension)) throw new Error('Invalid public modality dimension.');
        const categories = expectRows(dimension.categories, 'modality dimension categories');
        metadata.discovered_requests.push(modalityCategoryRequest(request, dimension.dimension));
        for (const category of categories) {
          if (typeof category.value !== 'string' || !/^[A-Za-z0-9_.:-]+$/.test(category.value)) throw new Error('Invalid public modality category.');
          metadata.discovered_requests.push(modalityCategoryRequest(request, dimension.dimension, category.value));
        }
      }
    } else if (request.kind === 'modality_chart') {
      const points = seriesRows(native.data, 'modality chart');
      for (const value of Object.values(expectObject(native.metricData, 'modality chart metrics'))) seriesRows(value, 'modality metric chart');
      seriesRows(native.marketShareData, 'modality market share');
      setTimeRange(metadata, points); metadata.units = { request: 'requests', generated: 'native modality-specific units; no conversion', marketShareData: 'fraction' };
      metadata.unavailable.push('Generated metric units differ by modality; chart values are not converted between images, tokens, documents, video hours/seconds or transcript characters.');
    } else {
      const points = seriesRows(native.marketShareData, 'modality category market share'); setTimeRange(metadata, points);
      metadata.units = { ys: 'fraction' };
      metadata.unavailable.push('Category-share filtering is an undocumented public-page query; returned series are retained even if a model appears outside the requested modality.');
    }
    metadata.coverage = 'Entire native public aggregate retained, including window fields, cache metadata, chart series, titles and sample shares; no private/account records are collected.';
    rows = [attachSource({ payload: native }, request, metadata)];
  } else if (['listed-pricing', 'effective-pricing', 'model-uptime-recent', 'uptime-recent', 'provider-token-chart', 'top-colos-for-model'].includes(request.kind)) {
    const native = expectObject(root.data, 'model/provider observation');
    metadata.units = { prices: 'native unspecified; no conversion', uptime: 'native unspecified; no percent/fraction conversion', availability: 'native unspecified; no percent/fraction conversion', judgedMinutes: 'minutes', timestamp: 'native unspecified' };
    if (request.kind === 'listed-pricing') {
      const series = expectRows(native.series, 'listed pricing series');
      const providers = [...new Set(series.map(row => row.providerSlug).filter((slug): slug is string => typeof slug === 'string' && !!slug))];
      metadata.discovered_requests = providers.map(provider => providerChartRequest(provider, request));
      const points = series.flatMap(series => ['input', 'output', 'cacheRead', 'cacheWrite', 'discount'].flatMap(key => Array.isArray(series[key]) ? expectRows(series[key], `listed ${key}`) : []));
      setTimeRange(metadata, points, 'at');
    } else if (request.kind === 'effective-pricing') {
      expectRows(native.providerSummaries, 'effective pricing provider summaries');
      if (!Array.isArray(native.providerNames)) throw new Error('Invalid effective pricing provider names.');
      for (const key of ['endpointNames', 'endpointRawNames', 'endpointProviderSlugs']) expectObject(native[key], key);
      expectRows(native.inputChartData, 'effective input chart'); expectRows(native.outputChartData, 'effective output chart');
    } else if (request.kind === 'model-uptime-recent') {
      const buckets = expectRows(native.buckets, 'model availability buckets'); expectRows(native.hourly, 'model hourly availability');
      setTimeRange(metadata, buckets, 'timestamp');
    } else if (request.kind === 'uptime-recent') {
      const points = Object.values(native).flatMap(value => expectRows(value, 'endpoint uptime history')); setTimeRange(metadata, points, 'date');
    } else if (request.kind === 'provider-token-chart') {
      const points = seriesRows(native.chartData, 'provider token chart'); setTimeRange(metadata, points);
      metadata.units = { ys: 'tokens' };
      metadata.unavailable.push('The public provider chart is a bounded displayed series (observed top models plus Others), not every model or private provider traffic.');
    } else if (!Array.isArray(native.colos) || !native.colos.every(colo => typeof colo === 'string')) throw new Error('Invalid public colocation list.');
    metadata.coverage = 'Entire native public observation retained for the requested catalogue model/provider, including nulls, interval points and original maps. No account-specific data is requested.';
    metadata.unavailable.push('Public recent/available windows only; upstream units or window boundaries not explicitly declared remain unspecified. Empty observations are not evidence of zero usage.');
    rows = [attachSource({ ...(request.model_id ? { model_id: request.model_id } : {}), payload: native }, request, metadata)];
  } else if (request.kind === 'benchmarks') {
    const native = expectObject(root.data, 'public benchmarks');
    for (const key of ['aaData', 'daData', 'valsIndex', 'weightedInputPrices', 'costPerRequest']) if (!Object.hasOwn(native, key)) throw new Error(`Missing public benchmark field: ${key}.`);
    metadata.units = { aaData: 'native benchmark scales', daData: 'native benchmark scales', weightedInputPrices: 'unspecified', costPerRequest: 'unspecified' };
    metadata.coverage = 'Entire public benchmark/chart view, preserving benchmark objects, index maps, weighted prices and cost-per-request objects without reconstructing missing scores.';
    metadata.unavailable.push('The public view does not declare a unified measurement window or all price currencies/denominators; no conversion or equivalence with authenticated benchmark datasets is claimed.');
    rows = [attachSource({ payload: native }, request, metadata)];
  } else if (request.kind === 'all_providers' || request.kind === 'provider_catalog') {
    const native = root.data;
    if (request.kind === 'all_providers') {
      const providers = expectRows(native, 'public provider details');
      if (providers.some(provider => typeof provider.slug !== 'string')) throw new Error('Missing public provider slug.');
      metadata.discovered_requests = providers.map(provider => providerChartRequest(String(provider.slug)));
    } else if (!Array.isArray(native) || !native.every(name => typeof name === 'string')) throw new Error('Invalid public provider name catalogue.');
    metadata.coverage = 'Complete returned public provider details/name list; account-specific provider preferences and credentials are excluded. Names are not used as provider slugs.';
    rows = [attachSource({ payload: native }, request, metadata)];
  } else throw new Error(`Unsupported public parser kind: ${request.kind}`);
  metadata.record_count = rows.length;
  return { rows, metadata };
}

function defineRequest(
  dataset: PublicDatasetId, kind: PublicSourceKind, path: string,
  context: Omit<PublicSourceRequest, 'id' | 'dataset' | 'kind' | 'url' | 'scope'>,
  params: Record<string, string> = {},
): PublicSourceRequest {
  const url = new URL(path, 'https://openrouter.ai');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (!isAllowedPublicSourceUrl(url.href)) throw new Error('Refused an unapproved public source URL.');
  return {
    id: [dataset, kind, context.section, context.routeSegment, context.dimension, context.category, context.window, context.metric, context.group, context.subcategory, context.model_id, context.variant, context.provider].filter(v => v !== undefined).join(':'),
    dataset, kind, url: url.href, scope: 'public', ...context,
  };
}
function categoryRequest(group: string, window: string, metric: string, subcategory?: string): PublicSourceRequest {
  return defineRequest('public_app_rankings', 'app_category', '/api/frontend/v1/apps/marketplace/category',
    { group, window, metric, ...(subcategory ? { subcategory } : {}) },
    { group, period: window, sortBy: metric, ...(subcategory ? { subcategory } : {}) });
}
function categoryChartRequest(group: string, subcategory?: string): PublicSourceRequest {
  return defineRequest('public_app_rankings', 'app_category_chart', '/api/frontend/v1/apps/marketplace/category-chart',
    { group, window: 'available_weekly_history', ...(subcategory ? { subcategory } : {}) },
    { group, ...(subcategory ? { subcategory } : {}) });
}
function modalityCategoryRequest(source: PublicSourceRequest, dimension: string, category?: string): PublicSourceRequest {
  return defineRequest('public_modality_statistics', category ? 'modality_category_share' : 'modality_category_rankings',
    `/api/frontend/v1/rankings/${category ? 'modality-category-share' : 'modality-category-rankings'}`,
    { window: category ? 'available_series' : 'native_window', routeSegment: source.routeSegment!, dimension, ...(category ? { category } : {}) },
    { routeSegment: source.routeSegment!, dimension, ...(category ? { category } : {}) });
}
function providerChartRequest(provider: string, source?: PublicSourceRequest): PublicSourceRequest {
  const params: Record<string, string> = { provider };
  if (source?.model_id) {
    params.permaslug = new URL(source.url).searchParams.get('permaslug')!;
    if (source.variant && source.variant !== 'standard') params.variant = source.variant;
  }
  return defineRequest(source?.model_id ? 'public_model_observations' : 'public_discovery', 'provider-token-chart', '/api/frontend/v1/stats/provider-token-chart',
    { window: 'available_daily_history', provider, ...(source?.model_id ? { model_id: source.model_id } : {}), ...(source?.variant ? { variant: source.variant } : {}), ...(source?.model_origin ? { model_origin: source.model_origin } : {}) }, params);
}
export function publicGlobalRequests(): PublicSourceRequest[] {
  const result: PublicSourceRequest[] = [];
  for (const view of views) for (const metric of ['tokens', 'tokens_excl_byok', 'spend', 'requests']) {
    result.push(defineRequest('public_model_rankings', 'model_rankings', '/api/frontend/v1/rankings/models',
      { window: view, view, metric }, { view, ...(metric === 'tokens' ? {} : { metric }) }));
  }
  result.push(
    defineRequest('public_ranking_history', 'ranking_history', '/api/frontend/v1/rankings/model-rankings-chart', { window: 'available_weekly_history' }),
    defineRequest('public_ranking_history', 'benchmarks', '/api/frontend/v1/rankings/benchmarks', { window: 'unspecified', section: 'benchmarks' }),
    defineRequest('public_performance', 'performance', '/api/frontend/v1/rankings/performance', { window: 'unspecified' }),
    defineRequest('public_apps', 'marketplace', '/api/frontend/v1/apps/marketplace/marketplace', { window: 'mixed' }),
    defineRequest('public_app_rankings', 'marketplace_rankings', '/api/frontend/v1/apps/marketplace/marketplace', { window: 'mixed' }),
    defineRequest('public_app_rankings', 'app_rankings', '/api/frontend/v1/rankings/apps', { window: 'mixed' }),
    defineRequest('public_session_cost', 'session_cost', '/api/frontend/v1/rankings/session-cost', { window: 'native_window' }),
    defineRequest('public_task_mix', 'task_mix', '/api/frontend/v1/rankings/task-spend', { window: 'native_window' }),
    defineRequest('public_discovery', 'discovery', '/api/frontend/v1/rankings/discovery', { window: 'mixed', section: 'discovery' }),
    defineRequest('public_discovery', 'routers', '/api/frontend/v1/rankings/routers', { window: 'week', view: 'week', section: 'routers' }, { view: 'week' }),
    defineRequest('public_discovery', 'all_providers', '/api/frontend/v1/all-providers', { window: 'current', section: 'all-providers' }),
    defineRequest('public_discovery', 'provider_catalog', '/api/frontend/v1/catalog/providers', { window: 'current', section: 'catalog/providers' }),
  );
  for (const view of ['day', 'month']) result.push(defineRequest('public_discovery', 'routers', '/api/frontend/v1/rankings/routers', { window: view, view, section: 'routers' }, { view }));
  for (const section of historySections) result.push(defineRequest('public_ranking_history', 'ranking_history', `/api/frontend/v1/rankings/${section}`, { window: 'available_series', section }));
  for (const routeSegment of modalities) {
    result.push(
      defineRequest('public_modality_statistics', 'modality_options', '/api/frontend/v1/rankings/modality-category-options', { window: 'unspecified', routeSegment }, { routeSegment }),
      defineRequest('public_modality_statistics', 'modality_chart', '/api/frontend/v1/rankings/modality-chart', { window: 'available_series', routeSegment }, { routeSegment }),
    );
    for (const view of views) result.push(defineRequest('public_modality_statistics', 'modality_models', '/api/frontend/v1/rankings/modality-models', { window: view, view, metric: 'requests', routeSegment }, { routeSegment, view }));
  }
  for (const group of groups) {
    for (const view of views) for (const metric of ['tokens', 'requests']) result.push(categoryRequest(group, view, metric));
    result.push(categoryChartRequest(group));
  }
  return result;
}
export function publicModelRequests(modelId: string, permaslug = modelId, nativeVariant?: string): PublicSourceRequest[] {
  const variant = nativeVariant ?? (modelId.includes(':') ? modelId.slice(modelId.lastIndexOf(':') + 1) : undefined);
  const context = { window: 'available_daily_history', model_id: modelId, ...(variant ? { variant } : {}) };
  const params = { permaslug, ...(variant && variant !== 'standard' ? { variant } : {}) };
  return [
    defineRequest('public_model_activity', 'model_activity', '/api/frontend/v1/stats/model-activity', context, params),
    defineRequest('public_model_apps', 'model_apps', '/api/frontend/v1/stats/top-apps-for-model', context, params),
    ...(['listed-pricing', 'effective-pricing', 'model-uptime-recent', 'uptime-recent', 'top-colos-for-model'] as const).map(kind => defineRequest('public_model_observations', kind, `/api/frontend/v1/stats/${kind}`, { ...context, window: 'native_window' }, params)),
  ];
}
export function isAllowedPublicSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const allowed = publicPaths[url.pathname];
    if (url.origin !== 'https://openrouter.ai' || url.username || url.password || url.hash || !allowed) return false;
    for (const key of url.searchParams.keys()) if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) return false;
    const view = url.searchParams.get('view');
    const metric = url.searchParams.get('metric');
    if (view !== null && !(views as readonly string[]).includes(view)) return false;
    if (metric !== null && !['spend', 'tokens_excl_byok', 'tokens', 'requests'].includes(metric)) return false;
    const routeSegment = url.searchParams.get('routeSegment');
    if (routeSegment !== null && !(modalities as readonly string[]).includes(routeSegment)) return false;
    for (const key of ['dimension', 'category']) if (url.searchParams.has(key) && !/^[A-Za-z0-9_.:-]+$/.test(url.searchParams.get(key)!)) return false;
    if (url.pathname.includes('/marketplace/category')) {
      if (!(groups as readonly string[]).includes(url.searchParams.get('group') ?? '')) return false;
      const subcategory = url.searchParams.get('subcategory');
      if (subcategory !== null && !/^[a-z0-9-]+$/.test(subcategory)) return false;
      if (url.pathname.endsWith('/category')) {
        if (!(views as readonly string[]).includes(url.searchParams.get('period') ?? '')) return false;
        if (!['tokens', 'requests'].includes(url.searchParams.get('sortBy') ?? '')) return false;
      }
    }
    if (url.pathname.includes('/stats/')) {
      const permaslug = url.searchParams.get('permaslug');
      const providerOnly = url.pathname.endsWith('/provider-token-chart') && permaslug === null;
      if (!providerOnly && !/^~?[A-Za-z0-9._:-]+\/[A-Za-z0-9._:-]+$/.test(permaslug ?? '')) return false;
      const provider = url.searchParams.get('provider');
      if (url.pathname.endsWith('/provider-token-chart') && !/^[A-Za-z0-9._:-]+$/.test(provider ?? '')) return false;
      const variant = url.searchParams.get('variant');
      if (variant !== null && !/^[A-Za-z0-9._:-]+$/.test(variant)) return false;
    }
    return true;
  } catch { return false; }
}
