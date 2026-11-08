import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectSnapshot } from '../src/collector.js';

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

describe('snapshot promotion', () => {
  it('records a failed attempt while preserving the last successful result if core data is empty', async () => {
    const output = await mkdtemp(join(tmpdir(), 'openrouter-collector-'));
    const previous = { schema_version: 1, updated_at: '2026-11-09T00:00:00Z', last_success: '2026-11-08T000000Z-first', snapshots: [] };
    await writeFile(join(output, 'index.json'), JSON.stringify(previous));
    const result = await collectSnapshot({ output, fetcher: async () => new Response(JSON.stringify({ data: [] })), retries: 0 });
    expect(result.status).toBe('failed');
    const index = JSON.parse(await readFile(join(output, 'index.json'), 'utf8'));
    expect(index.last_success).toBe(previous.last_success);
    expect(index.snapshots).toHaveLength(1);
    expect(index.snapshots[0].errors.join(' ')).toMatch(/empty/i);
  });

  it('promotes only a validated nonempty full collection and preserves original bytes with hashes', async () => {
    const output = await mkdtemp(join(tmpdir(), 'openrouter-collector-'));
    const result = await collectSnapshot({output,fetcher:fixtureFetch,retries:0});
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

  it('refuses to promote a truncated catalogue even when upstream ends pagination early', async () => {
    const output = await mkdtemp(join(tmpdir(), 'openrouter-collector-'));
    const result=await collectSnapshot({output,retries:0,fetcher:async(input,init)=>
      String(input)==='https://openrouter.ai/api/v1/models?output_modalities=all'
        ?Response.json({data:[{id:'test/model'}],total_count:2,links:{next:null}})
        :fixtureFetch(input,init)});
    expect(result.status).toBe('failed');
    expect(result.errors.join(' ')).toMatch(/total_count/i);
    const index=JSON.parse(await readFile(join(output,'index.json'),'utf8'));
    expect(index.last_success).toBe(null);
  });

  it('rejects pagination into another official path and reports network failures without promoting', async () => {
    const output=await mkdtemp(join(tmpdir(),'openrouter-collector-'));
    const result=await collectSnapshot({output,retries:0,fetcher:async(input,init)=>{
      const url=String(input);
      if(url==='https://openrouter.ai/api/v1/models?output_modalities=all') return Response.json({data:[{id:'test/model'}],links:{next:'/unrelated'}});
      if(url==='https://openrouter.ai/api/v1/providers')throw new Error('network is unavailable');
      return fixtureFetch(input,init);
    }});
    expect(result.status).toBe('failed');
    expect(result.errors.join(' ')).toMatch(/pagination path/i);
    expect(result.errors.join(' ')).toMatch(/network is unavailable/);
    expect(JSON.parse(await readFile(join(output,'index.json'),'utf8')).last_success).toBe(null);
  });

  it('rejects an empty aggregate endpoint dataset while accepting individual empty model responses', async () => {
    const output=await mkdtemp(join(tmpdir(),'openrouter-collector-'));
    const result=await collectSnapshot({output,retries:0,fetcher:async(input,init)=>
      String(input).includes('/api/v1/models/')&&String(input).endsWith('/endpoints')
        ?Response.json({data:{id:'test/model',endpoints:[]}})
        :fixtureFetch(input,init)});
    expect(result.status).toBe('failed');
    expect(result.errors.join(' ')).toMatch(/empty aggregate endpoint/i);
    expect(result.datasets.find(dataset=>dataset.id==='endpoints')?.models_with_no_endpoints).toBe(1);
  });
});
