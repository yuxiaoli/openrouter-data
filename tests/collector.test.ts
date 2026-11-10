import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectSnapshot, type PublicSourceAdapter } from '../src/collector.js';
import type { PublicSourceRequest } from '../src/public-sources.js';

const fixtureFetch: typeof fetch = async (input) => {
  const url = String(input);
  if (url.includes('use_rss') || url.endsWith('.rss') || url.endsWith('feed.xml')) return new Response('<rss version="2.0"><channel><title>Test</title><item><guid>a</guid><title>One</title><link>https://openrouter.ai/one</link></item></channel></rss>');
  if (url.endsWith('openapi.json')) return new Response('{"openapi":"3.1.0","paths":{"/test":{}}}');
  if (url.endsWith('llms.txt')) return new Response('# OpenRouter\nOfficial documentation');
  if (url.includes('/models/count')) return Response.json({data:{count:1}});
  if (url.includes('/images/models/') && url.endsWith('/endpoints')) return Response.json({id:'test/model',endpoints:[{provider_slug:'test',pricing:[]}]});
  if (url.endsWith('/endpoints')) return Response.json({data:{id:'test/model',endpoints:[{provider_name:'Test',unknown_field:123}]}});
  if (url.includes('providers')) return Response.json({data:[{slug:'test',name:'Test'}]});
  if (url.includes('endpoints/zdr')) return Response.json({data:[{model_id:'test/model',provider_name:'Test'}]});
  return new Response('{ "data": [{"id":"test/model", "name":"Test", "unknown_field": {"keep":true}}], "links":{"next":null} }');
};

it('honors a bounded 429 retry and records the successful request attempt count',async()=>{
  const output=await mkdtemp(join(tmpdir(),'openrouter-retry-'));let providerRequests=0;
  const result=await collectSnapshot({publicSources:false,output,retries:1,fetcher:async(input,init)=>{
    if(String(input)==='https://openrouter.ai/api/v1/providers'&&++providerRequests===1)return new Response('rate limited',{status:429,headers:{'Retry-After':'0'}});
    return fixtureFetch(input,init);
  }});
  expect(result.status).toBe('success');expect(providerRequests).toBe(2);
  const report=result.datasets.find(d=>d.id==='providers')!;
  expect((report.pages as Record<string,unknown>[])[0]!.attempts).toBe(2);
});

it('follows a complete catalogue cursor and preserves every page and native object',async()=>{
  const output=await mkdtemp(join(tmpdir(),'openrouter-pagination-'));
  const result=await collectSnapshot({publicSources:false,output,retries:0,fetcher:async(input,init)=>{
    const url=String(input);
    if(url==='https://openrouter.ai/api/v1/models?output_modalities=all')return Response.json({data:[{id:'test/a',native:{kept:'first'}}],total_count:2,links:{next:'?output_modalities=all&cursor=next'}});
    if(url==='https://openrouter.ai/api/v1/models?output_modalities=all&cursor=next')return Response.json({data:[{id:'test/b',native:{kept:'second'}}],total_count:2,links:{next:null}});
    return fixtureFetch(input,init);
  }});
  expect(result.status).toBe('success');const report=result.datasets.find(d=>d.id==='models')!;
  expect(report.record_count).toBe(2);expect(report.pages).toHaveLength(2);
  const rows=JSON.parse(await readFile(join(output,'runs',result.id,'models.json'),'utf8')).data;
  expect(rows.map((r:{id:string})=>r.id)).toEqual(['test/a','test/b']);expect(rows[1].native.kept).toBe('second');
});

describe('snapshot promotion', () => {
  it('records a failed attempt while preserving the last successful result if core data is empty', async () => {
    const output = await mkdtemp(join(tmpdir(), 'openrouter-collector-'));
    const previousRun=await collectSnapshot({publicSources:false,output,fetcher:fixtureFetch,retries:0});
    const previous = JSON.parse(await readFile(join(output,'index.json'),'utf8'));
    const originalManifest=await readFile(join(output,'runs',previousRun.id,'manifest.json'),'utf8');
    const result = await collectSnapshot({publicSources:false, output, fetcher: async (input) => new Response(String(input).endsWith('llms.txt')?'':JSON.stringify({ data: [] })), retries: 0 });
    expect(result.status).toBe('failed');
    const index = JSON.parse(await readFile(join(output, 'index.json'), 'utf8'));
    expect(index.last_success).toBe(previous.last_success);
    expect(index.latest_snapshot).toBe(previousRun.id);
    expect(index.snapshots).toHaveLength(2);
    expect(index.snapshots[0].errors.join(' ')).toMatch(/empty/i);
    expect(await readFile(join(output,'runs',previousRun.id,'manifest.json'),'utf8')).toBe(originalManifest);
  });

  it('promotes only a validated nonempty full collection and preserves original bytes with hashes', async () => {
    const output = await mkdtemp(join(tmpdir(), 'openrouter-collector-'));
    const result = await collectSnapshot({publicSources:false,output,fetcher:fixtureFetch,retries:0});
    expect(result.status).toBe('success');
    const index = JSON.parse(await readFile(join(output,'index.json'),'utf8'));
    expect(index.last_success).toBe(result.id);
    const data = JSON.parse(await readFile(join(output,'runs',result.id,'models.json'),'utf8'));
    expect(data.data[0].unknown_field.keep).toBe(true);
    const modelsReport = result.datasets.find(dataset=>dataset.id==='models');
    expect(modelsReport?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(join(output,'runs',result.id,modelsReport!.raw_path!),'utf8')).toContain('{ "data":');
    const endpoints = JSON.parse(await readFile(join(output,'runs',result.id,'endpoints.json'),'utf8'));
    expect(endpoints.data[0]).toMatchObject({model_id:'test/model',unknown_field:123});
    expect(result.datasets.find(dataset=>dataset.id==='authenticated_data')?.status).toBe('unavailable');
  });

  it('publishes a partial attempt while rejecting a truncated catalogue that ends pagination early', async () => {
    const output = await mkdtemp(join(tmpdir(), 'openrouter-collector-'));
    const result=await collectSnapshot({publicSources:false,output,retries:0,fetcher:async(input,init)=>
      String(input)==='https://openrouter.ai/api/v1/models?output_modalities=all'
        ?Response.json({data:[{id:'test/model'}],total_count:2,links:{next:null}})
        :fixtureFetch(input,init)});
    expect(result.status).toBe('partial');
    expect(result.datasets.find(dataset=>dataset.id==='models')?.status).toBe('failed');
    expect(result.datasets.find(dataset=>dataset.id==='model_count')?.count_matches_catalogue).toBe(false);
    expect(result.errors.join(' ')).toMatch(/total_count/i);
    const index=JSON.parse(await readFile(join(output,'index.json'),'utf8'));
    expect(index.last_success).toBe(null);
  });

  it('rejects unexpected pagination and preserves network failures in a partial attempt', async () => {
    const output=await mkdtemp(join(tmpdir(),'openrouter-collector-'));
    const result=await collectSnapshot({publicSources:false,output,retries:0,fetcher:async(input,init)=>{
      const url=String(input);
      if(url==='https://openrouter.ai/api/v1/models?output_modalities=all') return Response.json({data:[{id:'test/model'}],links:{next:'/unrelated'}});
      if(url==='https://openrouter.ai/api/v1/providers')throw new Error('network is unavailable');
      return fixtureFetch(input,init);
    }});
    expect(result.status).toBe('partial');
    expect(result.datasets.find(dataset=>dataset.id==='models')?.status).toBe('failed');
    expect(result.datasets.find(dataset=>dataset.id==='providers')?.status).toBe('failed');
    expect(result.errors.join(' ')).toMatch(/pagination path/i);
    expect(result.errors.join(' ')).toMatch(/network is unavailable/);
    expect(JSON.parse(await readFile(join(output,'index.json'),'utf8')).last_success).toBe(null);
  });

  it('rejects an empty aggregate endpoint dataset while accepting individual empty model responses', async () => {
    const output=await mkdtemp(join(tmpdir(),'openrouter-collector-'));
    const result=await collectSnapshot({publicSources:false,output,retries:0,fetcher:async(input,init)=>
      String(input).includes('/api/v1/models/')&&String(input).endsWith('/endpoints')
        ?Response.json({data:{id:'test/model',endpoints:[]}})
        :fixtureFetch(input,init)});
    expect(result.status).toBe('partial');
    expect(result.datasets.find(dataset=>dataset.id==='endpoints')?.status).toBe('failed');
    expect(result.errors.join(' ')).toMatch(/empty aggregate endpoint/i);
    expect(result.datasets.find(dataset=>dataset.id==='endpoints')?.models_with_no_endpoints).toBe(1);
  });

  it('redacts credential-shaped upstream examples before writing public raw or normalized archives', async () => {
    const output=await mkdtemp(join(tmpdir(),'openrouter-collector-'));
    const fakePrefix=['sk','or','v1'].join('-')+'-';
    const original=JSON.stringify({openapi:'3.1.0',paths:{'/test':{}},example:fakePrefix+'a'.repeat(64),nested:{example:fakePrefix+'b'.repeat(64)}});
    const result=await collectSnapshot({publicSources:false,output,retries:0,fetcher:async(input,init)=>
      String(input)==='https://openrouter.ai/openapi.json'?new Response(original):fixtureFetch(input,init)});
    expect(result.status).toBe('success');
    const report=result.datasets.find(dataset=>dataset.id==='upstream_openapi')!;
    expect(report.redactions).toMatchObject({count:2});
    const raw=await readFile(join(output,'runs',result.id,report.raw_path!));
    const normalized=await readFile(join(output,'runs',result.id,'upstream_openapi.json'),'utf8');
    const pattern=new RegExp(fakePrefix+'[A-Za-z0-9_-]+');
    expect(pattern.test(raw.toString('utf8'))).toBe(false);
    expect(pattern.test(normalized)).toBe(false);
    expect(report.sha256).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(report.original_sha256).toBe(createHash('sha256').update(original).digest('hex'));
    expect(report.original_sha256===report.sha256).toBe(false);
    expect(report.coverage).toMatch(/credential examples redacted for public publication/i);
    const modelsReport=result.datasets.find(dataset=>dataset.id==='models')!;
    const modelsRaw=await readFile(join(output,'runs',result.id,modelsReport.raw_path!),'utf8');
    expect(modelsRaw).toBe(await (await fixtureFetch('https://openrouter.ai/api/v1/models?output_modalities=all')).text());
  });

  it('publishes fresh datasets independently and references stale data after upgrading a legacy archive', async () => {
    const output=await mkdtemp(join(tmpdir(),'openrouter-collector-'));
    const previous=await collectSnapshot({publicSources:false,output,retries:0,fetcher:fixtureFetch});
    const oldManifest=await readFile(join(output,'runs',previous.id,'manifest.json'),'utf8');
    const legacyIndex=JSON.parse(await readFile(join(output,'index.json'),'utf8'));
    delete legacyIndex.latest_snapshot;
    delete legacyIndex.dataset_last_success;
    await writeFile(join(output,'index.json'),JSON.stringify(legacyIndex));
    const previousProvider=previous.datasets.find(dataset=>dataset.id==='providers')!;
    const result=await collectSnapshot({publicSources:false,output,retries:0,fetcher:async(input,init)=>{
      if(String(input)==='https://openrouter.ai/api/v1/providers')return Response.json({error:'temporarily unavailable'},{status:503});
      if(String(input)==='https://openrouter.ai/api/v1/models?output_modalities=all')return Response.json({data:[{id:'test/model',name:'Fresh after source failure',fresh_marker:true}]});
      return fixtureFetch(input,init);
    }});
    expect(result.status).toBe('partial');
    const index=JSON.parse(await readFile(join(output,'index.json'),'utf8'));
    expect(index.last_success).toBe(previous.id);
    expect(index.latest_snapshot).toBe(result.id);
    expect(index.dataset_last_success.models.snapshot).toBe(result.id);
    expect(index.dataset_last_success.providers.snapshot).toBe(previous.id);
    expect(index.dataset_last_success.authenticated_data).toBeUndefined();
    const providers=result.datasets.find(dataset=>dataset.id==='providers')!;
    expect(providers.status).toBe('failed');
    expect(providers.record_count).toBe(0);
    expect(providers.errors.join(' ')).toContain('HTTP 503');
    expect(providers.fallback).toMatchObject({snapshot:previous.id,collected_at:previousProvider.collected_at,record_count:previousProvider.record_count,source_url:previousProvider.source_url,sha256:previousProvider.sha256,data_path:`runs/${previous.id}/providers.json`});
    const fresh=JSON.parse(await readFile(join(output,'runs',result.id,'models.json'),'utf8'));
    expect(fresh.data[0].fresh_marker).toBe(true);
    const failedAttempt=JSON.parse(await readFile(join(output,'runs',result.id,'providers.json'),'utf8'));
    expect(failedAttempt.data).toEqual([]);
    expect(await readFile(join(output,'runs',result.id,providers.raw_path!),'utf8')).toContain('temporarily unavailable');
    const fallback=providers.fallback as {data_path:string};
    const stale=JSON.parse(await readFile(join(output,fallback.data_path),'utf8'));
    expect(stale.data[0].slug).toBe('test');
    expect(await readFile(join(output,'runs',previous.id,'manifest.json'),'utf8')).toBe(oldManifest);
  });

  it('collects discovered public requests once, preserves model payloads, and indexes complete small chunks', async () => {
    const output=await mkdtemp(join(tmpdir(),'openrouter-public-collector-'));
    const ranking:PublicSourceRequest={id:'ranking',dataset:'public_model_rankings',url:'https://openrouter.ai/api/frontend/v1/rankings/models?view=day&metric=tokens_excl_byok',kind:'model_rankings',window:'day',scope:'public'};
    const app:PublicSourceRequest={id:'apps',dataset:'public_app_rankings',url:'https://openrouter.ai/api/frontend/v1/rankings/apps',kind:'app_rankings',window:'upstream-default',scope:'public'};
    const adapter:PublicSourceAdapter={
      datasetIds:['public_model_rankings','public_app_rankings','public_model_activity','public_model_apps'],
      globalRequests:()=>[ranking],
      modelRequests:(modelId,permaslug)=>[
        {id:'activity',dataset:'public_model_activity',url:`https://openrouter.ai/api/frontend/v1/stats/model-activity?permaslug=${encodeURIComponent(permaslug??modelId)}`,kind:'model_activity',window:'upstream-default',scope:'public',model_id:modelId},
        {id:'model-apps',dataset:'public_model_apps',url:`https://openrouter.ai/api/frontend/v1/stats/top-apps-for-model?permaslug=${encodeURIComponent(permaslug??modelId)}`,kind:'model_apps',window:'upstream-default',scope:'public',model_id:modelId},
      ],
      isAllowed:url=>url.startsWith('https://openrouter.ai/api/frontend/v1/'),
      parse:(request,payload)=>({rows:request.model_id?[{model_id:request.model_id,payload}]:request.dataset==='public_model_rankings'?[{native:'first',content:'x'.repeat(1_100_000)},{native:'second',content:'y'.repeat(1_100_000)}]:[{native_app_payload:payload}],metadata:{source_url:request.url,scope:'public',window:request.window,units:{content:'original upstream values'},coverage:'Test public aggregate window',unavailable:[],has_next:false,next_url:null,record_count:request.dataset==='public_model_rankings'?2:1,discovered_requests:request.dataset==='public_model_rankings'?[app,app]:[]}}),
    };
    const fetched:string[]=[];
    const result=await collectSnapshot({output,retries:0,publicSources:adapter,fetcher:async(input,init)=>{
      const url=String(input);
      if(url==='https://openrouter.ai/api/v1/models?output_modalities=all')return Response.json({data:[{id:'test/model',canonical_slug:'shared/model'},{id:'alias/model',canonical_slug:'shared/model'}]});
      if(url==='https://openrouter.ai/api/v1/models/count?output_modalities=all')return Response.json({data:{count:2}});
      if(url.includes('/api/frontend/v1/')) {
        fetched.push(url);
        if(url.includes('top-apps-for-model'))return Response.json({error:'model has no public applications'},{status:404});
        return Response.json({opaque_native:{nested:[1,2,3]},unpublished_pagination:null});
      }
      return fixtureFetch(input,init);
    }});
    expect(result.status).toBe('success');
    expect(fetched.filter(url=>url===app.url)).toHaveLength(1);
    expect(fetched.filter(url=>url.includes('model-activity'))).toHaveLength(1);
    const rankings=result.datasets.find(report=>report.id==='public_model_rankings')!;
    expect(rankings.record_count).toBe(2);
    expect(rankings.chunks).toHaveLength(2);
    expect(Object.values(rankings.chunk_counts as Record<string,number>)).toEqual([1,1]);
    let chunkRecords=0;
    for(const path of rankings.chunks as string[])chunkRecords+=JSON.parse(await readFile(join(output,'runs',result.id,path),'utf8')).data.length;
    expect(chunkRecords).toBe(2);
    const activity=result.datasets.find(report=>report.id==='public_model_activity')!;
    const modelPaths=(activity.model_chunks as Record<string,string[]>)['test/model']!;
    const modelData=JSON.parse(await readFile(join(output,'runs',result.id,modelPaths[0]!),'utf8'));
    expect(modelData.data.find((row:{model_id:string})=>row.model_id==='test/model')).toMatchObject({model_id:'test/model',payload:{opaque_native:{nested:[1,2,3]}}});
    expect(activity.default_order).toBe('id_asc');
    expect(modelData.data[0].model_id).toBe('alias/model');
    expect(modelData.data.some((row:{model_id:string})=>row.model_id==='alias/model')).toBe(true);
    expect((activity.model_chunks as Record<string,string[]>)['alias/model']).toEqual(modelPaths);
    expect(activity.coverage_by_model).toMatchObject({'test/model':{requested:1,succeeded:1},'alias/model':{requested:1,succeeded:1}});
    const unavailable=result.datasets.find(report=>report.id==='public_model_apps')!;
    expect(unavailable.status).toBe('ok');
    expect(unavailable.record_count).toBe(0);
    expect(unavailable.coverage_count).toMatchObject({not_found:2,requested:2});
    expect(unavailable.unavailable.join(' ')).toContain('HTTP 404');
  });

  it('archives independent fresh public data when a model request factory rejects one model', async () => {
    const output=await mkdtemp(join(tmpdir(),'openrouter-public-factory-'));
    const request:PublicSourceRequest={id:'ranking',dataset:'public_model_rankings',url:'https://openrouter.ai/api/frontend/v1/rankings/models?view=day&metric=tokens_excl_byok',kind:'model_rankings',window:'day',scope:'public'};
    const adapter:PublicSourceAdapter={datasetIds:['public_model_rankings','public_model_activity'],globalRequests:()=>[request],modelRequests:()=>{throw new Error('unrecognized model reference');},isAllowed:()=>true,parse:()=>({rows:[{native_value:null}],metadata:{source_url:request.url,scope:'public',window:'day',units:{},coverage:'Public source observation',unavailable:[],has_next:false,next_url:null,record_count:1}})};
    const result=await collectSnapshot({output,retries:0,publicSources:adapter,fetcher:fixtureFetch});
    expect(result.status).toBe('partial');
    expect(result.datasets.find(report=>report.id==='public_model_rankings')?.status).toBe('ok');
    expect(result.datasets.find(report=>report.id==='public_model_activity')?.status).toBe('failed');
    expect(result.errors.join(' ')).toContain('unrecognized model reference');
    expect(JSON.parse(await readFile(join(output,'index.json'),'utf8')).latest_snapshot).toBe(result.id);
  });
});
