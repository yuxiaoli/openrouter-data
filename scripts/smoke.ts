import assert from 'node:assert/strict';
import { XMLValidator } from 'fast-xml-parser';
import SwaggerParser from '@apidevtools/swagger-parser';
import { datasetIds } from '../src/contracts.js';
const base=(process.argv[2]??'https://openrouter-data.pages.dev').replace(/\/$/,'');
const expectedIndex=process.argv.indexOf('--expected-snapshot');
const expected=expectedIndex>=0?process.argv[expectedIndex+1]:undefined;
let checks=0;
async function get(path:string,status=200) {
  const response=await fetch(`${base}${path}`,{signal:AbortSignal.timeout(30000),headers:{'Cache-Control':'no-cache'}});
  assert.equal(response.status,status,`${path}: expected HTTP ${status}, got ${response.status}: ${response.status===status?'':await response.text()}`);
  checks++; return response;
}
async function body(path:string,status=200) { const response=await get(path,status); assert.match(response.headers.get('content-type')??'',/application\/json/); return await response.json() as any; }
const home=await body('/'); assert.equal(home.independent_service,true);
const spec=await body('/docs/api/openapi.json'); await SwaggerParser.validate(structuredClone(spec)); assert.equal(spec.info.title,'OpenRouter Data Archive API');
assert.deepEqual(await body('/openapi.json'),spec);
const health=await body('/healthz'); assert.equal(health.status,'ok'); assert.ok(health.last_success);
const snapshot=expected??health.last_success;
const select=`snapshot=${encodeURIComponent(snapshot)}`;
const history=await body('/api/v1/snapshots?limit=2'); assert.ok(history.data.some((s:any)=>s.id===snapshot));
if(history.pagination.total>1) {
  const past=await body('/api/v1/snapshots?status=success&offset=1&limit=1');
  if(past.data.length) { const historical=await body(`/api/v1/data?type=models&snapshot=${encodeURIComponent(past.data[0].id)}&limit=1`); assert.equal(historical.meta.snapshot,past.data[0].id); }
}
const manifest=await body(`/api/v1/manifest?${select}`); assert.equal(manifest.data.id,snapshot); assert.equal(manifest.data.status,'success');
const datasets=await body(`/api/v1/datasets?${select}`); assert.ok(datasets.data.some((d:any)=>d.status==='unavailable'));
for(const type of datasetIds) {
  const result=await body(`/api/v1/data?type=${type}&${select}&limit=1`);
  const report=manifest.data.datasets.find((d:any)=>d.id===type);
  assert.equal(result.meta.snapshot,snapshot); assert.equal(result.pagination.total,report.record_count); assert.ok(result.data.length<=1);
}
const modelPage=await body(`/api/v1/data?type=models&${select}&sort=context_length&order=desc&limit=2`);
assert.ok(modelPage.data.length>0);
const model=modelPage.data[0]; const author=model.id.split('/')[0]; const modality=model.architecture?.output_modalities?.[0];
const params=new URLSearchParams({type:'models',snapshot,model:model.id,author,limit:'1',min_context:String(model.context_length??0)});
if(modality) params.set('output_modality',modality);
const multidimensional=await body(`/api/v1/data?${params}`); assert.equal(multidimensional.data[0]?.id,model.id);
for(const filter of ['max_prompt_price=100','free=false']) {
  const dynamic=await body(`/api/v1/data?type=models&${select}&model=openrouter%2Fauto&${filter}`);
  assert.equal(dynamic.pagination.total,0,'A negative upstream price must not become a known numeric price.');
}
const dimension=await body(`/api/v1/dimensions?type=models&${select}&dimension=output_modality&author=${encodeURIComponent(author)}`); assert.ok(dimension.data.length>0);
const providerDim=await body(`/api/v1/dimensions?type=endpoints&${select}&dimension=provider&limit=1`); assert.ok(providerDim.data.length>0);
const provider=providerDim.data[0].value;
const providerQuery=await body(`/api/v1/data?type=endpoints&${select}&provider=${encodeURIComponent(provider)}&limit=2`); assert.ok(providerQuery.data.length>0);
const second=await body(`/api/v1/data?type=models&${select}&sort=context_length&order=desc&offset=1&limit=1`); assert.deepEqual(second.data[0],modelPage.data[1]);
const dated=await body(`/api/v1/data?type=models&date=${manifest.data.date}&limit=1`); assert.equal(dated.meta.date,manifest.data.date);
const rss=await get(`/rss.xml?type=models&${select}&author=${encodeURIComponent(author)}&limit=2`); const xml=await rss.text(); assert.match(rss.headers.get('content-type')??'',/application\/rss\+xml/); assert.equal(XMLValidator.validate(xml),true); assert.ok(xml.includes(snapshot));
for(const type of ['model_rss','blog_posts','status_incidents']) { const response=await get(`/rss.xml?type=${type}&${select}&limit=2`); assert.equal(XMLValidator.validate(await response.text()),true); }
for(const path of ['/api/v1/data?type=unknown','/api/v1/data?limit=0','/api/v1/data?limit=1&limit=2','/api/v1/data?date=2026-02-30','/api/v1/data?type=models&provider=OpenAI','/api/v1/dimensions?type=models','/api/v1/data?dimension=author']) assert.ok((await body(path,400)).error.code);
await body('/api/v1/data?date=1900-01-01',404);
await body('/missing',404);
console.log(JSON.stringify({base,snapshot,checks,counts:manifest.data.counts,multidimensional_model:model.id,status:'passed'},null,2));
