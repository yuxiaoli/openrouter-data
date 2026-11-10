import { expect, test } from 'vitest';
import { isAllowedPublicSourceUrl, publicGlobalRequests, publicModelRequests, publicDatasetIds, parsePublicSource } from '../src/public-sources.js';

test('only permits the known anonymous statistics host, paths and public parameters', () => {
  expect(isAllowedPublicSourceUrl('https://openrouter.ai/api/frontend/v1/rankings/models?view=week')).toBe(true);
  for (const url of [
    'https://openrouter.ai/api/v1/credits',
    'https://openrouter.ai/api/frontend/v1/auth/usage',
    'https://example.test/api/frontend/v1/rankings/models',
    'https://owner:password@openrouter.ai/api/frontend/v1/rankings/models',
    'https://openrouter.ai/api/frontend/v1/rankings/models?api_key=private',
    'https://openrouter.ai/api/frontend/v1/rankings/models?view=week&view=day',
  ]) expect(isAllowedPublicSourceUrl(url), url).toBe(false);
});

test('model ranking parsing preserves native values and marks spend units and bounded windows honestly', () => {
  const request = publicGlobalRequests().find(r => r.kind === 'model_rankings' && r.window === 'week' && r.metric === 'spend')!;
  const native = { date: '2026-11-09', model_permaslug: 'example/model-20261101', rankingMetricValue: 12.34, total_prompt_tokens: '0012', total_native_tokens_reasoning: null, extra: { retained: true } };
  const parsed = parsePublicSource(request, { data: [native] });
  expect(parsed.rows[0]).toEqual({ ...native, _source: expect.objectContaining({ window: 'week', metric: 'spend', source_url: request.url, scope: 'public' }) });
  expect(parsed.metadata.units.rankingMetricValue).toBe('unspecified');
  expect(parsed.metadata.units.total_prompt_tokens).toBe('tokens');
  expect(parsed.metadata.has_next).toBe(false);
  expect(parsed.metadata.next_url).toBeNull();
  expect(parsed.metadata.unavailable.join(' ')).toMatch(/pagination|complete/i);
  expect(parsed.metadata.record_count).toBe(1);
});

test('request definitions cover all public datasets and use canonical model slugs without credentials', () => {
  const global = publicGlobalRequests();
  const model = publicModelRequests('liquid/lfm-3-1.7b', 'liquid/lfm-3-1.7b-20261106');
  expect(new Set([...global, ...model].map(r => r.dataset))).toEqual(new Set(publicDatasetIds));
  expect(new Set(global.map(r => r.id)).size).toBe(global.length);
  expect(model).toHaveLength(7);
  for (const request of [...global, ...model]) {
    expect(request.scope).toBe('public');
    expect(isAllowedPublicSourceUrl(request.url), request.url).toBe(true);
  }
  expect(model.every(r => new URL(r.url).searchParams.get('permaslug') === 'liquid/lfm-3-1.7b-20261106')).toBe(true);
  expect(global.filter(r => r.kind === 'model_rankings')).toHaveLength(12);
  expect(global.filter(r => r.kind === 'model_rankings' && r.metric === 'spend').map(r => r.window).sort()).toEqual(['day', 'month', 'week']);
});

test('performance parsing preserves null metrics without inferring units or a measurement window', () => {
  const request = publicGlobalRequests().find(r => r.kind === 'performance')!;
  const native = { id: 'example/model', slug: 'model', request_count: 2, p50_latency: null, p50_throughput: 21.25, best_latency_provider: { name: 'Example', extra: true } };
  const parsed = parsePublicSource(request, { data: [native] });
  expect(parsed.rows[0]).toMatchObject(native);
  expect(parsed.rows[0]?.p50_latency).toBeNull();
  expect(parsed.metadata.window).toBe('unspecified');
  expect(parsed.metadata.units.p50_latency).toBe('unspecified');
  expect(parsed.metadata.units.p50_throughput).toBe('unspecified');
  expect(parsed.metadata.unavailable.join(' ')).toMatch(/unit|window/i);
});

test('history retains its parent object, fractional estimates and the observed range without inventing past dates', () => {
  const request = publicGlobalRequests().find(r => r.kind === 'ranking_history')!;
  const native = { data: [{ x: '2026-11-02', ys: { 'example/model': 0.125, Others: 0.875 } }, { x: '2026-11-09', ys: { 'example/model': 0.5, Others: null } }], cachedAt: 1234 };
  const parsed = parsePublicSource(request, { data: native });
  expect(parsed.rows).toHaveLength(1);
  expect(parsed.rows[0]?.payload).toEqual(native);
  expect(parsed.metadata.time_range).toEqual({ from: '2026-11-02', to: '2026-11-09' });
  expect(parsed.metadata.unavailable.join(' ')).toMatch(/history|displayed|sample/i);
});

test('legitimate empty per-model activity and app charts remain complete native objects rather than zero usage', () => {
  const requests = publicModelRequests('openrouter/auto');
  for (const [kind, native] of [
    ['model_activity', { analytics: [], cachedAt: 123 }],
    ['model_apps', { top_apps: [], top_apps_chart: [], model_chart: [], cachedAt: 456 }],
  ] as const) {
    const parsed = parsePublicSource(requests.find(r => r.kind === kind)!, { data: native });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ model_id: 'openrouter/auto', payload: native });
    expect(parsed.metadata.unavailable.join(' ')).toMatch(/empty.*not.*zero/i);
  }
  expect(() => parsePublicSource(requests[0]!, { data: { error: 'unexpected shape' } })).toThrow(/analytics/);
});

test('marketplace preserves every native section while its ranking view retains separate day/week/month context', () => {
  const app = { app_id: 'app-1', total_tokens: '9007199254740993', total_requests: 3, rank: 1, app: { id: 'app-1', categories: ['coding'], related_apps: [] } };
  const native = { popular: [app], trending: [], leaderboards: { coding: [app] }, globalRankingMap: { day: [app], week: [app], month: [] }, extra: { retained: true } };
  const requests = publicGlobalRequests();
  const whole = parsePublicSource(requests.find(r => r.kind === 'marketplace')!, { data: native });
  expect(whole.rows[0]?.payload).toEqual(native);
  const ranks = parsePublicSource(requests.find(r => r.kind === 'marketplace_rankings')!, { data: native });
  expect(ranks.rows).toHaveLength(2);
  expect(ranks.rows[0]).toMatchObject({ ...app, _source: { window: 'day', section: 'globalRankingMap' } });
  expect(ranks.rows[1]).toMatchObject({ ...app, _source: { window: 'week', section: 'globalRankingMap' } });
  expect(ranks.rows[0]?.total_tokens).toBe('9007199254740993');
});

test('canonical model requests keep catalogue free/batch variants distinct from the default standard variant', () => {
  const free = publicModelRequests('example/model:free', 'example/model-20261101');
  const batch = publicModelRequests('example/model:batch', 'example/model-20261101');
  expect(free.every(r => new URL(r.url).searchParams.get('variant') === 'free')).toBe(true);
  expect(batch.every(r => new URL(r.url).searchParams.get('variant') === 'batch')).toBe(true);
  expect(free.map(r => r.id).some(id => batch.some(r => r.id === id))).toBe(false);
});

test('bounded app categories discover normal and low-count subcategories without inventing limit/offset pagination', () => {
  const request = publicGlobalRequests().find(r => r.kind === 'app_category' && r.group === 'coding' && r.window === 'day' && r.metric === 'tokens')!;
  const app = { app_id: 'app-1', total_tokens: '123', rank: 4, app: { title: 'Example' } };
  const parsed = parsePublicSource(request, { data: { apps: [app], group: 'coding', subcategory: null, subcategories: ['cli-agent'], lowCountSubcategories: ['new-agent'] } });
  expect(parsed.rows[0]).toMatchObject({ ...app, _source: { window: 'day', group: 'coding', metric: 'tokens' } });
  expect(parsed.metadata.unavailable.join(' ')).toMatch(/50|bounded/);
  expect(parsed.metadata.has_next).toBe(false);
  const discovered = parsed.metadata.discovered_requests!;
  expect(new Set(discovered.map(r => r.subcategory))).toEqual(new Set(['cli-agent', 'new-agent']));
  expect(discovered.filter(r => r.kind === 'app_category')).toHaveLength(2);
  expect(discovered.every(r => isAllowedPublicSourceUrl(r.url) && !r.url.includes('offset') && !r.url.includes('limit'))).toBe(true);
});

test('native aggregate adapters retain nested charts, sample shares and window metadata without flattening', () => {
  const requests = publicGlobalRequests();
  const fixtures = [
    ['app_category_chart', { chartData: [], titleMap: { one: 'One' } }],
    ['session_cost', { windowDays: 30, windowEnd: '2026-11-01', harnesses: [{ appId: 'one', models: [{ model: 'example/model', points: [{ bucket: 'short', medianUsd: 0.123 }] }] }] }],
    ['task_mix', { spend: { windowDays: 30, macroCategories: [], tasks: [] }, tokens: { windowDays: 30, macroCategories: [], tasks: [] } }],
    ['discovery', { modelOfWeek: null, climbing: [], breakouts: [], authors: [], totals: {}, routerTokens: { auto: 12.5 }, videoRequests: [], generatedAt: '2026-11-10' }],
    ['routers', { weekly: [], models: [] }],
    ['modality_options', { dimensions: [{ dimension: 'domain', categories: [] }], cachedAt: 1 }],
    ['modality_chart', { data: [], metricData: { request: [] }, granularity: 'week', marketShareData: [], cachedAt: 2 }],
  ] as const;
  for (const [kind, native] of fixtures) {
    const parsed = parsePublicSource(requests.find(r => r.kind === kind)!, { data: native });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.payload).toEqual(native);
    expect(parsed.rows[0]?._source).toMatchObject({ kind, scope: 'public' });
  }
  const session = parsePublicSource(requests.find(r => r.kind === 'session_cost')!, { data: fixtures[1][1] });
  expect(session.metadata.units.medianUsd).toBe('USD');
  expect(session.metadata.window).toBe('native_30_days');
  expect(session.metadata.time_range).toBeUndefined(); // No invented start date from windowEnd.
});

test('public provider discovery fans out real provider slugs and never substitutes model authors or display names', () => {
  const request = publicGlobalRequests().find(r => r.kind === 'all_providers')!;
  const native = [{ slug: 'example-provider', displayName: 'Different Display', dataPolicy: { training: false, requiresUserIDs: false } }];
  const parsed = parsePublicSource(request, { data: native });
  expect(parsed.rows[0]?.payload).toEqual(native);
  const discovered = parsed.metadata.discovered_requests!;
  expect(discovered).toHaveLength(1);
  expect(discovered[0]).toMatchObject({ dataset: 'public_discovery', kind: 'provider-token-chart', provider: 'example-provider' });
  expect(new URL(discovered[0]!.url).searchParams.get('provider')).toBe('example-provider');
  expect(new URL(discovered[0]!.url).searchParams.has('permaslug')).toBe(false);
});

test('model observations preserve provider-native objects and discover charts only from returned provider slugs', () => {
  const requests = publicModelRequests('example/model:free', 'example/model-20261101');
  const native = { series: [{ endpointId: 'one', providerName: 'Display', providerSlug: 'actual-provider', input: [{ at: '2026-11-01', value: null }], output: [], cacheRead: [], cacheWrite: [], discount: [] }] };
  const parsed = parsePublicSource(requests.find(r => r.kind === 'listed-pricing')!, { data: native });
  expect(parsed.rows[0]).toMatchObject({ model_id: 'example/model:free', payload: native, _source: { kind: 'listed-pricing', variant: 'free' } });
  expect(parsed.metadata.discovered_requests).toHaveLength(1);
  const discovered = parsed.metadata.discovered_requests![0]!;
  expect(discovered.dataset).toBe('public_model_observations');
  expect(new URL(discovered.url).searchParams.get('provider')).toBe('actual-provider');
  expect(new URL(discovered.url).searchParams.get('variant')).toBe('free');
  const chart = parsePublicSource(discovered, { data: { chartData: [{ x: '2026-11-01', ys: { one: 0.123, Others: 5 } }], cachedAt: 1 } });
  expect(chart.rows[0]).toHaveProperty('payload.chartData.0.ys.one', 0.123);
  expect(chart.metadata.time_range).toEqual({ from: '2026-11-01', to: '2026-11-01' });
  for (const [kind, payload] of [
    ['effective-pricing', { weightedInputPrice: null, weightedOutputPrice: null, weightedCacheHitRate: null, providerSummaries: [], providerNames: [], endpointNames: {}, endpointRawNames: {}, endpointProviderSlugs: {}, inputChartData: [], outputChartData: [] }],
    ['model-uptime-recent', { buckets: [], hourly: [], uptime: null, availability: null }],
    ['uptime-recent', {}],
    ['top-colos-for-model', { colos: [] }],
  ] as const) expect(parsePublicSource(requests.find(r => r.kind === kind)!, { data: payload }).rows[0]?.payload).toEqual(payload);
});

test('unverified pagination and private source URLs are rejected instead of silently claiming a complete page', () => {
  const request = publicGlobalRequests().find(r => r.kind === 'model_rankings')!;
  const row = { model_permaslug: 'example/model', date: '2026-11-10' };
  expect(() => parsePublicSource(request, { data: [row], links: { next: 'https://openrouter.ai/api/v1/credits' } })).toThrow(/pagination/i);
  expect(() => parsePublicSource(request, { data: [row], has_more: true })).toThrow(/pagination/i);
  expect(() => parsePublicSource({ ...request, url: 'https://openrouter.ai/api/v1/credits' }, { data: [] })).toThrow(/private|unapproved/i);
  expect(() => parsePublicSource(request, { data: { error: 'not rows' } })).toThrow(/array/i);
});

test('model app charts retain the observed native daily analytics rows rather than requiring x/ys chart points', () => {
  const request = publicModelRequests('example/model').find(r => r.kind === 'model_apps')!;
  const point = { date: '2026-11-10 00:00:00', model_permaslug: 'example/model', total_prompt_tokens: 1.25, count: 2 };
  const native = { top_apps: [{ app_id: 123, total_tokens: '2', app: null }], top_apps_chart: [point], model_chart: [point], cachedAt: 123 };
  const parsed = parsePublicSource(request, { data: native });
  expect(parsed.rows[0]?.payload).toEqual(native);
  expect(parsed.metadata.time_range).toEqual({ from: point.date, to: point.date });
});

test('public benchmark view retains its complete native maps and marks undeclared price denominators unknown', () => {
  const request = publicGlobalRequests().find(r => r.kind === 'benchmarks');
  expect(request).toBeDefined();
  const native = { aaData: [], daData: {}, valsIndex: { sample: 0.125 }, weightedInputPrices: { sample: null }, costPerRequest: { sample: 0.001 } };
  const parsed = parsePublicSource(request!, { data: native });
  expect(request?.dataset).toBe('public_ranking_history');
  expect(parsed.rows[0]?.payload).toEqual(native);
  expect(parsed.metadata.units.costPerRequest).toBe('unspecified');
  expect(parsed.metadata.window).toBe('unspecified');
});

test('ranking discovery requests an observed retired canonical batch identity and invents no missing model identity', () => {
  const request = publicGlobalRequests().find(r => r.kind === 'model_rankings')!;
  const parsed = parsePublicSource(request, { data: [
    { date: '2026-11-10', model_permaslug: 'example/old-model-20240101', variant: 'batch', variant_permaslug: 'example/old-model-20240101:batch' },
    { date: '2026-11-10', label: 'Unidentified public aggregate', variant: 'standard' },
    { date: '2026-11-10', model_permaslug: 'example/variant-not-declared' },
  ] });
  const discovered = parsed.metadata.discovered_requests!;
  expect(discovered).toHaveLength(7);
  expect(discovered.every(r => r.model_id === 'example/old-model-20240101:batch')).toBe(true);
  expect(discovered.every(r => new URL(r.url).searchParams.get('permaslug') === 'example/old-model-20240101')).toBe(true);
  expect(discovered.every(r => new URL(r.url).searchParams.get('variant') === 'batch')).toBe(true);
  expect(new Set(discovered.map(r => r.id)).size).toBe(7);
  expect(parsed.rows).toHaveLength(3);
  expect(parsed.rows[1]).not.toHaveProperty('model_id');
});

test('native public tilde-author aliases pass the canonical slug guard without opening private paths', () => {
  const requests = publicModelRequests('~liquid/d1-latest', '~liquid/d1-latest');
  expect(requests).toHaveLength(7);
  expect(requests.every(r => isAllowedPublicSourceUrl(r.url) && new URL(r.url).searchParams.get('permaslug') === '~liquid/d1-latest')).toBe(true);
  const rankings = publicGlobalRequests().find(r => r.kind === 'model_rankings')!;
  const parsed = parsePublicSource(rankings, { data: [{ date: '2026-11-10', model_permaslug: '~liquid/d1-latest', variant: 'standard', variant_permaslug: '~liquid/d1-latest' }] });
  expect(parsed.metadata.discovered_requests).toHaveLength(7);
  expect(isAllowedPublicSourceUrl('https://openrouter.ai/api/v1/credits?permaslug=~liquid%2Fd1-latest')).toBe(false);
  expect(isAllowedPublicSourceUrl('https://openrouter.ai/api/frontend/v1/stats/model-activity?permaslug=~liquid%2Fd1-latest%2Fextra')).toBe(false);
});
