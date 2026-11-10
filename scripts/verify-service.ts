import assert from 'node:assert/strict';
import { resolve,join } from 'node:path';
import { createHash } from 'node:crypto';
import { XMLValidator } from 'fast-xml-parser';
import SwaggerParser from '@apidevtools/swagger-parser';
import { datasetIds, type ArchiveStore } from '../src/contracts.js';
import { handleRequest } from '../src/worker.js';
import { readLogicalArchiveFile } from '../src/archive-storage.js';

const base=(process.argv[2]??'https://openrouter-data.pages.dev').replace(/\/$/,'');
const option=(name:string)=>{const at=process.argv.indexOf(name);return at<0?undefined:process.argv[at+1];};
const expected=option('--expected-snapshot'),archive=option('--archive');
const store:ArchiveStore={async read(path){try{return {ok:true,value:JSON.parse((await readLogicalArchiveFile(join(resolve(archive!),path))).toString('utf8'))};}catch{return {ok:false,error:{code:'ARCHIVE_UNAVAILABLE',message:'Local archive file unavailable.',status:502}};}}};
let checks=0;
async function get(path:string,status:number|number[]=200) {
  const response=archive?await handleRequest(new Request(`${base}${path}`),store):await fetch(`${base}${path}`,{signal:AbortSignal.timeout(30000),headers:{'Cache-Control':'no-cache'}});
  if(!(Array.isArray(status)?status:[status]).includes(response.status))throw new Error(`${path}: HTTP ${response.status}, expected ${status}: ${(await response.text()).slice(0,700)}`);
  checks++;return response;
}
async function body(path:string,status:number|number[]=200):Promise<any>{const response=await get(path,status);assert.match(response.headers.get('content-type')??'',/application\/json/);return response.json();}
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const home=await body('/');assert.equal(home.independent_service,true);assert.ok(home.catalog&&home.feeds&&home.rss_overview);
const spec=await body('/docs/api/openapi.json');await SwaggerParser.validate(structuredClone(spec));assert.equal(spec.info.version,'1.1.0');
assert.equal(hash(await body('/openapi.json')),hash(spec),'OpenAPI aliases differ.');
const health=await body('/healthz',[200,503]);assert.ok(['ok','degraded'].includes(health.status));
const snapshot=expected??health.latest_snapshot??health.last_success;assert.ok(snapshot);
const select=`snapshot=${encodeURIComponent(snapshot)}`;
const history=await body('/api/v1/snapshots?limit=2');assert.ok(history.data.some((s:any)=>s.id===snapshot));
const manifest=await body(`/api/v1/manifest?${select}`);assert.equal(manifest.data.id,snapshot);assert.ok(['success','partial'].includes(manifest.data.status));
const datasets=await body(`/api/v1/datasets?${select}`);assert.ok(datasets.data.some((d:any)=>d.status==='unavailable'&&d.access==='authenticated'));
const catalog=await body(`/api/v1/catalog?${select}`),feeds=await body(`/feeds.json?${select}`);
assert.equal(catalog.data.length,datasetIds.length);assert.equal(feeds.data.length,datasetIds.length);
for(const entry of catalog.data){assert.ok(entry.json_url&&entry.rss_url&&entry.category&&entry.coverage_note);}
const states:Record<string,string>={};
for(const type of datasetIds){
  const report=manifest.data.datasets.find((d:any)=>d.id===type);assert.ok(report,`No report for enabled type ${type}`);
  const unavailable=report.status!=='ok'&&!report.fallback;
  const result=await body(`/api/v1/data?type=${type}&${select}&limit=1`,unavailable?503:200);
  states[type]=unavailable?'unavailable':report.fallback?'stale':'fresh';
  if(unavailable){assert.equal(result.error.code,'DATASET_UNAVAILABLE');continue;}
  assert.equal(result.meta.attempt_snapshot,snapshot);
  assert.equal(result.pagination.total,report.fallback?.record_count??report.record_count);
  assert.equal(result.meta.snapshot,report.fallback?.snapshot??snapshot);assert.ok(result.data.length<=1);
  assert.equal(result.meta.data_collected_at,report.fallback?.collected_at??report.collected_at);
  if(report.fallback){assert.equal(result.meta.stale,true);assert.equal(result.meta.status,'stale');}
}
const modelPage=await body(`/api/v1/data?type=models&${select}&sort=context_length&order=desc&limit=2`);
assert.ok(modelPage.data.length>0);const model=modelPage.data[0],author=model.id.split('/')[0],modality=model.architecture?.output_modalities?.[0];
const params=new URLSearchParams({type:'models',snapshot,model:model.id,author,limit:'1',min_context:String(model.context_length??0)});if(modality)params.set('output_modality',modality);
assert.equal((await body(`/api/v1/data?${params}`)).data[0]?.id,model.id);
if(Number(model.pricing?.prompt)<0)for(const filter of ['max_prompt_price=100','free=false'])assert.equal((await body(`/api/v1/data?type=models&${select}&model=${encodeURIComponent(model.id)}&${filter}`)).pagination.total,0);
assert.ok((await body(`/api/v1/dimensions?type=models&${select}&dimension=output_modality&author=${encodeURIComponent(author)}`)).data.length);
const providerDim=await body(`/api/v1/dimensions?type=endpoints&${select}&dimension=provider&limit=1`);assert.ok(providerDim.data.length);
assert.ok((await body(`/api/v1/data?type=endpoints&${select}&provider=${encodeURIComponent(providerDim.data[0].value)}&limit=2`)).data.length);
assert.deepEqual((await body(`/api/v1/data?type=models&${select}&sort=context_length&order=desc&offset=1&limit=1`)).data[0],modelPage.data[1]);
assert.equal((await body(`/api/v1/data?type=models&date=${manifest.data.date}&limit=1`)).meta.date,manifest.data.date);
const old=await body('/api/v1/snapshots?status=success&offset=1&limit=1');
if(old.data.length)assert.equal((await body(`/api/v1/data?type=models&snapshot=${old.data[0].id}&limit=1`)).meta.snapshot,old.data[0].id);
const rankingReport=manifest.data.datasets.find((d:any)=>d.id==='public_model_rankings');
if(rankingReport?.status==='ok'||rankingReport?.fallback){
  const ranking=await body(`/api/v1/data?type=public_model_rankings&${select}&view=week&metric=tokens&sort=rankingMetricValue&order=desc&limit=2`);
  assert.ok(ranking.data.length);assert.ok(ranking.data.every((r:any)=>r._source.view==='week'&&r._source.metric==='tokens'&&r._source.units));
  assert.ok((await body(`/api/v1/dimensions?type=public_model_rankings&${select}&dimension=window`)).data.length);
}
const activity=manifest.data.datasets.find((d:any)=>d.id==='public_model_activity');
if(activity?.status==='ok'||activity?.fallback){const result=await body(`/api/v1/data?type=public_model_activity&${select}&model=openai%2Fgpt-4o&limit=1`);assert.ok(result.data.length);assert.ok(result.data[0].payload&&Array.isArray(result.data[0].payload.analytics));}
const apps=manifest.data.datasets.find((d:any)=>d.id==='public_app_rankings');
if(apps?.status==='ok'||apps?.fallback){const result=await body(`/api/v1/data?type=public_app_rankings&${select}&limit=1`);const id=result.data[0]?.app_id??result.data[0]?.id;if(id!==undefined)assert.ok((await body(`/api/v1/data?type=public_app_rankings&${select}&app=${encodeURIComponent(String(id))}&limit=1`)).data.length);}
for(const type of ['overview','models','model_rss','blog_posts','status_incidents',...datasetIds.filter(d=>d.startsWith('public_'))]){
  const report=manifest.data.datasets.find((d:any)=>d.id===type);if(type.startsWith('public_')&&report.status!=='ok'&&!report.fallback)continue;
  const response=await get(`/rss.xml?type=${type}&${select}&limit=2`);assert.match(response.headers.get('content-type')??'',/application\/rss\+xml/);
  const xml=await response.text();assert.equal(XMLValidator.validate(xml),true);assert.ok(xml.includes('Not operated by OpenRouter'));
  if(type==='overview')assert.ok(xml.includes('Complete records'));
  else if(xml.includes('<item>'))assert.ok(xml.includes('Complete JSON:'));
}
for(const path of ['/api/v1/data?type=authenticated_data','/api/v1/data?type=unknown','/api/v1/data?limit=0','/api/v1/data?limit=1&limit=2','/api/v1/data?date=2026-02-30','/api/v1/data?type=models&provider=OpenAI','/api/v1/dimensions?type=models','/api/v1/data?dimension=author','/api/v1/data?since=2026-11-10&until=2026-11-01'])assert.ok((await body(path,400)).error.code);
await body('/api/v1/data?date=1900-01-01',404);await body('/missing',404);
console.log(JSON.stringify({base,mode:archive?'local archive handler':'live HTTP',snapshot,checks,counts:manifest.data.counts,states,snapshot_status:manifest.data.status,status:'passed'},null,2));
