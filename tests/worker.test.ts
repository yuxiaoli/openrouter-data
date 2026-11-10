import { expect, test } from 'vitest';
import { handleRequest, HttpArchiveStore } from '../src/worker.js';
import { gzipSync } from 'node:zlib';
import type { ArchiveStore, Manifest, ArchiveIndex } from '../src/contracts.js';
const id='2026-11-08T160000Z-abcd';
const summary={id,date:'2026-11-08',started_at:'2026-11-08T16:00:00Z',completed_at:'2026-11-08T16:01:00Z',status:'success' as const,counts:{models:1},errors:[]};
const manifest:Manifest={...summary,schema_version:1,datasets:[{id:'models',source_url:'https://openrouter.ai/api/v1/models?output_modalities=all',collected_at:summary.completed_at,status:'ok',record_count:1,coverage:'test-only synthetic fixture',unavailable:[],errors:[]}]};
const index:ArchiveIndex={schema_version:1,updated_at:summary.completed_at,last_success:id,snapshots:[summary]};
function store(indexValue:ArchiveIndex=index,rows=[{id:'test/one',description:'<markup>& text\u0001',name:'A & B',architecture:{input_modalities:['text'],output_modalities:['text']},pricing:{prompt:null,completion:null}}]):ArchiveStore {
  return {async read(path) {const value=path==='index.json'?indexValue:path.endsWith('manifest.json')?manifest:path.endsWith('models.json')?{data:rows}:undefined;return value?{ok:true,value}:{ok:false,error:{code:'ARCHIVE_UNAVAILABLE',message:'Missing fixture',status:502}};}};
}
test('RSS escapes upstream text and removes XML-forbidden control characters', async()=>{
  const response=await handleRequest(new Request('https://example.test/rss.xml?limit=1'),store(),Date.parse(summary.completed_at));
  expect(response.status).toBe(200);
  const xml=await response.text();
  expect(xml).toContain('A &amp; B'); expect(xml).toContain('&lt;markup&gt;&amp; text');
  expect(xml).not.toContain('\u0001');
});

test('failed latest attempt degrades health while data still uses the last successful snapshot',async()=>{
  const failed={...summary,id:'2026-11-08T160200Z-failed',completed_at:'2026-11-08T16:03:00Z',status:'failed' as const,errors:['upstream timed out']};
  const archive=store({...index,snapshots:[failed,summary]});
  const response=await handleRequest(new Request('https://example.test/api/v1/data?type=models&free=false'),archive,Date.parse(failed.completed_at));
  const body=await response.json();
  expect(response.status).toBe(200); expect(body.meta.snapshot).toBe(id); expect(body.meta.latest_attempt_status).toBe('failed');
  expect(body.data).toEqual([]); // Unknown prices must not be treated as paid or free.
  const health=await handleRequest(new Request('https://example.test/healthz'),archive,Date.parse(failed.completed_at));
  expect(health.status).toBe(503); expect((await health.json()).status).toBe('degraded');
});

test('default model RSS orders by upstream creation time so recent models are visible',async()=>{
  const rows=[{id:'test/a',name:'Old model',created:100},{id:'test/z',name:'Recent model',created:200}];
  const archive:ArchiveStore={async read(path){return {ok:true,value:path==='index.json'?index:path.endsWith('manifest.json')?{...manifest,counts:{models:2},datasets:[{...manifest.datasets[0],record_count:2}]}:{data:rows}};}};
  const response=await handleRequest(new Request('https://example.test/rss.xml?limit=1'),archive,Date.parse(summary.completed_at));
  const xml=await response.text();
  expect(xml).toContain('<title>Recent model</title>'); expect(xml).not.toContain('<title>Old model</title>');
});

test('catalog discovers every dataset with classified JSON and RSS links instead of only default models',async()=>{
  const response=await handleRequest(new Request('https://example.test/api/v1/catalog'),store(),Date.parse(summary.completed_at));
  expect(response.status).toBe(200);
  const body=await response.json();
  const endpoint=body.data.find((d:any)=>d.id==='endpoints');
  expect(endpoint.category).toBe('performance');
  expect(endpoint.json_url).toContain('type=endpoints');
  expect(endpoint.rss_url).toContain('type=endpoints');
  expect(endpoint.collection_status).toBe('not_collected');
  expect(body.data.find((d:any)=>d.id==='models').collection_status).toBe('ok');
});

test('partial snapshots expose fresh datasets and explicitly dated stale fallback independently',async()=>{
  const partialId='2026-11-08T161000Z-partial';
  const partial={...summary,id:partialId,completed_at:'2026-11-08T16:11:00Z',status:'partial' as const,counts:{models:1,providers:0},errors:['providers: HTTP 503']};
  const failed={...manifest.datasets[0]!,id:'providers',status:'failed' as const,record_count:0,errors:['HTTP 503'],collected_at:partial.completed_at,fallback:{snapshot:id,collected_at:summary.completed_at,record_count:1,source_url:'https://openrouter.ai/api/v1/providers',data_path:`runs/${id}/providers.json`}};
  const values:Record<string,unknown>={
    'index.json':{...index,latest_snapshot:partialId,snapshots:[partial,summary]},
    [`runs/${partialId}/manifest.json`]:{...partial,schema_version:1,datasets:[{...manifest.datasets[0]!,collected_at:partial.completed_at},failed]},
    [`runs/${partialId}/models.json`]:{data:[{id:'test/fresh'}]},
    [`runs/${id}/providers.json`]:{data:[{slug:'old-provider'}]},
  };
  const archive:ArchiveStore={async read(path){return values[path]?{ok:true,value:values[path]}:{ok:false,error:{code:'MISSING',message:path,status:502}};}};
  const fresh=await handleRequest(new Request('https://example.test/api/v1/data?type=models'),archive,Date.parse(partial.completed_at));
  expect(fresh.status).toBe(200); expect((await fresh.json()).data[0].id).toBe('test/fresh');
  const stale=await handleRequest(new Request('https://example.test/api/v1/data?type=providers'),archive,Date.parse(partial.completed_at));
  expect(stale.status).toBe(200);
  const body=await stale.json();
  expect(body.data[0].slug).toBe('old-provider'); expect(body.meta.snapshot).toBe(id);
  expect(body.meta.attempt_snapshot).toBe(partialId); expect(body.meta.stale).toBe(true);
  expect(body.meta.data_collected_at).toBe(summary.completed_at); expect(body.meta.coverage.errors).toEqual(['HTTP 503']);
  const feed=await handleRequest(new Request('https://example.test/rss.xml?type=providers&limit=1'),archive,Date.parse(partial.completed_at));
  const xml=await feed.text();
  expect(xml).toContain('stale');
  expect(xml).toContain(`<lastBuildDate>${new Date(summary.completed_at).toUTCString()}</lastBuildDate>`);
  expect(xml).toContain(`/snapshots/${id}/providers/`);
});

test('overview RSS discovers dataset categories and links to complete JSON without publishing private data',async()=>{
  const response=await handleRequest(new Request('https://example.test/rss.xml?type=overview'),store(),Date.parse(summary.completed_at));
  expect(response.status).toBe(200);
  const xml=await response.text();
  expect(xml).toContain('Dataset observations'); expect(xml).toContain('<category>catalog</category>');
  expect(xml).toContain('/api/v1/data?type=models'); expect(xml).toContain('Complete records');
  expect(xml).not.toContain('api_key');
});

test('model-filtered statistics load indexed chunks and do not require the complete large dataset',async()=>{
  const report={...manifest.datasets[0]!,id:'public_model_activity',record_count:2,chunks:['chunks/public_model_activity-1.json','chunks/public_model_activity-2.json'],model_chunks:{'test/model':['chunks/public_model_activity-2.json']}};
  const calls:string[]=[];
  const archive:ArchiveStore={async read(path){calls.push(path);if(path==='index.json')return {ok:true,value:index};if(path.endsWith('/manifest.json'))return {ok:true,value:{...manifest,counts:{public_model_activity:2},datasets:[report]}};if(path.endsWith('/chunks/public_model_activity-2.json'))return {ok:true,value:{data:[{model_id:'test/model',payload:{analytics:[]},_source:{window:'returned_native_dates'}}]}};return {ok:false,error:{code:'MISSING',message:path,status:502}};}};
  const response=await handleRequest(new Request('https://example.test/api/v1/data?type=public_model_activity&model=test%2Fmodel'),archive,Date.parse(summary.completed_at));
  expect(response.status).toBe(200);expect((await response.json()).data[0].model_id).toBe('test/model');
  expect(calls.some(path=>path.endsWith('/public_model_activity.json'))).toBe(false);
  expect(calls.some(path=>path.endsWith('-1.json'))).toBe(false);
});

test('ranking RSS includes native usage values, window, category and a complete JSON link',async()=>{
  const row={model_permaslug:'test/model',rankingMetricValue:12345,prompt:10000,completion:2345,description:'Model description',_source:{window:'week',view:'week',metric:'tokens',units:{rankingMetricValue:'tokens'},source_url:'https://openrouter.ai/api/frontend/v1/rankings/models?view=week'}};
  const report={...manifest.datasets[0]!,id:'public_model_rankings'};
  const archive:ArchiveStore={async read(path){return {ok:true,value:path==='index.json'?index:path.endsWith('manifest.json')?{...manifest,datasets:[report]}:{data:[row]}};}};
  const response=await handleRequest(new Request('https://example.test/rss.xml?type=public_model_rankings&metric=tokens&view=week&limit=1'),archive,Date.parse(summary.completed_at));
  expect(response.status).toBe(200);const xml=await response.text();
  expect(xml).toContain('12345');expect(xml).toContain('week');expect(xml).toContain('tokens');expect(xml).toContain('<category>rankings</category>');expect(xml).toContain('Complete JSON:');
});

test('public API and RSS refuse an authenticated-data archive even if a dataset name is public',async()=>{
  const privateReport={...manifest.datasets[0]!,access:'authenticated' as const};
  const calls:string[]=[];
  const archive:ArchiveStore={async read(path){calls.push(path);return {ok:true,value:path==='index.json'?index:path.endsWith('manifest.json')?{...manifest,datasets:[privateReport]}:{data:[{id:'private/account',tokens:999}]}};}};
  for(const path of ['/api/v1/data?type=models','/api/v1/manifest','/rss.xml?type=overview']) {
    const response=await handleRequest(new Request('https://example.test'+path),archive,Date.parse(summary.completed_at));
    expect(response.status).toBe(503);expect((await response.json()).error.code).toBe('PRIVATE_ARCHIVE_BLOCKED');
  }
  expect(calls.some(p=>p.endsWith('/models.json'))).toBe(false);
});

test('archive transport reads a lossless gzip sibling when a logical JSON path is absent',async()=>{
  const original=globalThis.fetch;const requested:string[]=[];
  globalThis.fetch=async(input)=>{const url=String(input);requested.push(url);return url.endsWith('.json.gz')?new Response(new Uint8Array(gzipSync(JSON.stringify({data:[{native_value:null,tokens:'1234567890123'}]})))):new Response('Not found',{status:404});};
  try {
    const result=await new HttpArchiveStore('https://raw.githubusercontent.com/test/archive/data').read(`runs/${id}/models.json`);
    expect(result).toEqual({ok:true,value:{data:[{native_value:null,tokens:'1234567890123'}]}});
    expect(requested).toHaveLength(3); // Missing storage map, logical file, then its gzip sibling.
  } finally {globalThis.fetch=original;}
});

test('packed storage index avoids repeated missing logical requests and is cached within an API request',async()=>{
  const original=globalThis.fetch;const requested:string[]=[];
  globalThis.fetch=async(input)=>{const url=String(input);requested.push(url);if(url.endsWith('/storage.json'))return Response.json({snapshot:id,files:{'models.json':{physical_path:'models.json.gz'},'providers.json':{physical_path:'providers.json.gz'}}});if(url.endsWith('.gz'))return new Response(new Uint8Array(gzipSync('{"data":[]}')));return new Response('Missing',{status:404});};
  try {
    const store=new HttpArchiveStore('https://raw.githubusercontent.com/test/archive/data');
    expect((await store.read(`runs/${id}/models.json`)).ok).toBe(true);
    expect((await store.read(`runs/${id}/providers.json`)).ok).toBe(true);
    expect(requested).toHaveLength(3);
    expect(requested.filter(url=>url.endsWith('/storage.json'))).toHaveLength(1);
    expect(requested.some(url=>url.endsWith('/models.json'))).toBe(false);
  } finally {globalThis.fetch=original;}
});
