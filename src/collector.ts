import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { ArchiveIndex, Manifest, type DatasetReport, type Row } from './contracts.js';

interface CollectOptions {
  output: string;
  fetcher?: typeof fetch;
  retries?: number;
  concurrency?: number;
  timeoutMs?: number;
  progress?: (message: string) => void;
}
type Source = {id:string;url:string;kind:'list'|'count'|'rss'|'openapi'|'text';coverage:string;allowEmpty?:boolean};
const origin = 'https://openrouter.ai';
export const sources: Source[] = [
  {id:'models',url:`${origin}/api/v1/models?output_modalities=all`,kind:'list',coverage:'All output modalities explicitly requested; public currently listed models, not retired or private models.'},
  {id:'providers',url:`${origin}/api/v1/providers`,kind:'list',coverage:'Public provider directory; null policy, headquarters and datacenter values remain null.'},
  {id:'embedding_models',url:`${origin}/api/v1/embeddings/models`,kind:'list',coverage:'Dedicated embeddings catalogue; can differ from the all-modality catalogue.'},
  {id:'image_models',url:`${origin}/api/v1/images/models`,kind:'list',coverage:'Dedicated image catalogue including structured parameter capabilities and endpoint links.'},
  {id:'video_models',url:`${origin}/api/v1/videos/models`,kind:'list',coverage:'Dedicated video catalogue including supported durations, resolutions and SKU prices.'},
  {id:'eu_models',url:'https://eu.openrouter.ai/api/v1/models?output_modalities=all',kind:'list',coverage:'EU hostname public catalogue, not proof of each endpoint compliance or all EU usage.'},
  {id:'zdr_endpoints',url:`${origin}/api/v1/endpoints/zdr`,kind:'list',coverage:'Public zero-data-retention endpoint listing as reported by OpenRouter.'},
  {id:'model_count',url:`${origin}/api/v1/models/count?output_modalities=all`,kind:'count',coverage:'All-modality model count at its own request time; requests are not an atomic upstream transaction.'},
  {id:'model_rss',url:`${origin}/api/v1/models?use_rss=true&output_modalities=all`,kind:'rss',coverage:'Official current model feed window. Item publication time is upstream time, not collection time.'},
  {id:'blog_posts',url:`${origin}/blog/feed.xml`,kind:'rss',coverage:'Official blog RSS feed window, not a reconstruction of every historical blog version.'},
  {id:'status_incidents',url:'https://status.openrouter.ai/history.rss',kind:'rss',coverage:'Official incident RSS bounded window. Absence of an item does not prove absence of an incident.',allowEmpty:true},
  {id:'upstream_openapi',url:`${origin}/openapi.json`,kind:'openapi',coverage:'Original official OpenAPI document, including authenticated operations that this collector does not execute.'},
  {id:'docs_index',url:`${origin}/docs/llms.txt`,kind:'text',coverage:'Official documentation index; linked full documentation pages are not recursively downloaded.'},
  {id:'site_index',url:`${origin}/llms.txt`,kind:'text',coverage:'Official site language-model index; not every linked page or asset is archived.'},
];

const hash = (bytes:Uint8Array|string):string => createHash('sha256').update(bytes).digest('hex');
const credentialRedaction = {
  rule: 'sk-or-v1-[A-Za-z0-9_-]+',
  reason: 'Credential-shaped upstream examples are removed before public publication.',
  replacement: 'REDACTED_OPENROUTER_CREDENTIAL_EXAMPLE',
};
type Redactions = typeof credentialRedaction & {count:number};
function redactForPublication(bytes:Uint8Array):{bytes:Uint8Array;original_sha256?:string;redactions?:Redactions} {
  let count=0;
  const text=new TextDecoder().decode(bytes).replace(new RegExp(credentialRedaction.rule,'g'),()=>{
    count++;
    return credentialRedaction.replacement;
  });
  if(count===0)return {bytes};
  return {bytes:new TextEncoder().encode(text),original_sha256:hash(bytes),redactions:{...credentialRedaction,count}};
}
const message = (error:unknown):string => error instanceof Error ? error.message : String(error);
const object = (value:unknown):value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);
const asRows = (value:unknown):Row[] => {
  if (!Array.isArray(value) || !value.every(object)) throw new Error('Expected an array of JSON objects');
  return value;
};
const sleep = (ms:number) => new Promise(resolve=>setTimeout(resolve,ms));

interface Download {bytes:Uint8Array;status:number;collected_at:string;url:string;attempts:number}
async function download(url:string, options:CollectOptions):Promise<Download> {
  const fetcher=options.fetcher??fetch;
  const retries=options.retries??3;
  let lastError:unknown;
  for(let attempt=0;attempt<=retries;attempt++) {
    try {
      const response=await fetcher(url,{headers:{'User-Agent':'openrouter-data/1.0 (public metadata archive; https://github.com/yuxiaoli/openrouter-data)','Accept':'application/json, application/rss+xml, text/plain, */*'},signal:AbortSignal.timeout(options.timeoutMs??30_000)});
      const bytes=new Uint8Array(await response.arrayBuffer());
      if ((response.status===429 || response.status>=500) && attempt<retries) {
        const retryHeader=response.headers.get('retry-after');
        const seconds=retryHeader===null ? NaN : Number(retryHeader);
        const retryAt=retryHeader===null ? NaN : Date.parse(retryHeader);
        const delay=Number.isFinite(seconds)?seconds*1000:Number.isFinite(retryAt)?retryAt-Date.now():500*2**attempt;
        if(delay>60_000) return {bytes,status:response.status,collected_at:new Date().toISOString(),url,attempts:attempt+1};
        await sleep(Math.max(250,delay));
        continue;
      }
      return {bytes,status:response.status,collected_at:new Date().toISOString(),url,attempts:attempt+1};
    } catch(error) {
      lastError=error;
      if(attempt<retries) await sleep(500*2**attempt);
    }
  }
  throw new Error(`Request failed after ${retries+1} attempts: ${message(lastError)}`);
}

function parseFeed(text:string):Row[] {
  if(/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('DTD and entity declarations are not accepted in RSS');
  const validation=XMLValidator.validate(text);
  if(validation!==true) throw new Error(`Invalid RSS XML: ${validation.err.msg}`);
  const parsed=new XMLParser({ignoreAttributes:false,processEntities:true,isArray:(name)=>name==='item'||name==='entry'}).parse(text) as Row;
  if(object(parsed.rss) && object(parsed.rss.channel)) return asRows(parsed.rss.channel.item??[]);
  if(object(parsed.feed)) return asRows(parsed.feed.entry??[]);
  throw new Error('Expected RSS channel or Atom feed');
}

function parseSource(source:Source,bytes:Uint8Array):{rows:Row[];next:string|null;totalCount?:number} {
  const text=new TextDecoder().decode(bytes);
  if(source.kind==='rss') return {rows:parseFeed(text),next:null};
  if(source.kind==='text') {
    if(text.trim().length<10 || /<html[\s>]/i.test(text)) throw new Error('Empty or unexpected HTML documentation index');
    return {rows:[{text}],next:null};
  }
  const json:unknown=JSON.parse(text);
  if(!object(json)) throw new Error('Expected JSON object');
  if(source.kind==='openapi') {
    if(typeof json.openapi!=='string'||!object(json.paths)||Object.keys(json.paths).length===0) throw new Error('Invalid or empty upstream OpenAPI document');
    return {rows:[json],next:null};
  }
  if(source.kind==='count') {
    if(!object(json.data)||!Number.isInteger(json.data.count)||Number(json.data.count)<=0) throw new Error('Expected positive all-modality model count');
    return {rows:[json.data],next:null};
  }
  const rows=asRows(json.data);
  if(['models','embedding_models','image_models','video_models','eu_models'].includes(source.id) && rows.some(row=>typeof row.id!=='string'||!row.id)) throw new Error('Model row is missing a valid id');
  if(source.id==='providers' && rows.some(row=>typeof row.slug!=='string'||!row.slug)) throw new Error('Provider row is missing a valid slug');
  if(json.links!==undefined && (!object(json.links) || (json.links.next!==undefined && json.links.next!==null && typeof json.links.next!=='string'))) throw new Error('Invalid upstream pagination links');
  if(json.total_count!==undefined && (!Number.isInteger(json.total_count)||Number(json.total_count)<0)) throw new Error('Invalid upstream total_count');
  const next=object(json.links)&&typeof json.links.next==='string'?json.links.next:null;
  return {rows,next,totalCount:typeof json.total_count==='number'?json.total_count:undefined};
}

async function collectSource(source:Source,runDir:string,options:CollectOptions):Promise<{report:DatasetReport;rows:Row[]}> {
  const report:DatasetReport={id:source.id,source_url:source.url,collected_at:new Date().toISOString(),status:'ok',record_count:0,coverage:source.coverage,unavailable:[],errors:[]};
  const rows:Row[]=[];
  const pages:Row[]=[];
  let redactionCount=0;
  try {
    let url:string|null=source.url;
    let totalCount:number|undefined;
    const seen=new Set<string>();
    while(url!==null) {
      const parsedUrl=new URL(url,source.url);
      if(seen.has(parsedUrl.href)||seen.size>=100) throw new Error('Repeated or excessive upstream pagination');
      if(parsedUrl.origin!==new URL(source.url).origin) throw new Error('Cross-origin pagination refused');
      if(parsedUrl.pathname!==new URL(source.url).pathname) throw new Error('Unexpected upstream pagination path refused');
      seen.add(parsedUrl.href);
      const result=await download(parsedUrl.href,options);
      // Unredacted response bodies remain in memory only; never write or encode them for publication.
      const archived=redactForPublication(result.bytes);
      redactionCount+=archived.redactions?.count??0;
      const extension=source.kind==='rss'?'xml':source.kind==='text'?'txt':'json';
      const rawPath=`raw/${source.id}${pages.length?`_page_${pages.length+1}`:''}.${extension}`;
      await writeFile(join(runDir,rawPath),archived.bytes);
      const sha256=hash(archived.bytes);
      const redactionMetadata=archived.redactions?{original_sha256:archived.original_sha256,redactions:archived.redactions}:{};
      pages.push({source_url:result.url,collected_at:result.collected_at,http_status:result.status,attempts:result.attempts,raw_path:rawPath,sha256,...redactionMetadata});
      if(pages.length===1) Object.assign(report,{collected_at:result.collected_at,http_status:result.status,raw_path:rawPath,sha256,...redactionMetadata});
      if(result.status!==200) throw new Error(`HTTP ${result.status} from ${result.url}`);
      const parsed=parseSource(source,archived.bytes);
      if(parsed.totalCount!==undefined) {
        if(totalCount!==undefined && totalCount!==parsed.totalCount) throw new Error('Upstream total_count changed while paginating; snapshot is not complete');
        totalCount=parsed.totalCount;
      }
      rows.push(...parsed.rows);
      url=parsed.next===null?null:new URL(parsed.next,source.url).href;
    }
    if(rows.length===0&&!source.allowEmpty) throw new Error('Empty dataset refused');
    if(totalCount!==undefined && rows.length!==totalCount) throw new Error(`Collected ${rows.length} records but upstream total_count is ${totalCount}`);
    if(source.kind==='list' && rows.some(row=>typeof row.id==='string')) {
      const ids=rows.filter(row=>typeof row.id==='string').map(row=>row.id);
      if(new Set(ids).size!==ids.length) throw new Error('Duplicate model identifiers in source pages');
    }
  } catch(error) {
    report.status='failed';report.errors.push(message(error));
  }
  report.record_count=rows.length;
  report.pages=pages;
  if(redactionCount>0) {
    report.redactions={...credentialRedaction,count:redactionCount};
    report.coverage+=source.id==='upstream_openapi'?' Upstream specification credential examples redacted for public publication.':' Credential examples redacted for public publication.';
  }
  await writeFile(join(runDir,`${source.id}.json`),JSON.stringify({data:rows}));
  options.progress?.(`${source.id}: ${report.status}, ${rows.length} records`);
  return {report,rows};
}

async function pooledMap<T,U>(items:T[],concurrency:number,fn:(item:T,index:number)=>Promise<U>):Promise<U[]> {
  const results:U[]=new Array(items.length);
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(items.length,concurrency)},async()=>{
    while(cursor<items.length) {const index=cursor++;results[index]=await fn(items[index]!,index);}
  }));
  return results;
}

async function collectEndpoints(id:'endpoints'|'image_endpoints',models:Row[],runDir:string,options:CollectOptions):Promise<DatasetReport> {
  const isImage=id==='image_endpoints';
  const base=`${origin}/api/v1/${isImage?'images/':''}models/`;
  const report:DatasetReport={id,source_url:`${base}{model_id}/endpoints`,collected_at:new Date().toISOString(),status:'ok',record_count:0,coverage:`Enumerated every model in this run's ${isImage?'dedicated image':'all-modality'} catalogue. Endpoint statistics/prices are observed values, not guaranteed service levels. Empty endpoint arrays are retained in raw responses.`,unavailable:[],errors:[]};
  let completed=0;
  const results=await pooledMap(models,Math.max(1,Math.min(options.concurrency??4,8)),async(model)=>{
    const modelId=String(model.id);
    const url=`${base}${modelId.split('/').map(encodeURIComponent).join('/')}/endpoints`;
    const raw:Row={model_id:modelId,source_url:url,collected_at:new Date().toISOString()};
    try {
      const result=await download(url,options);
      const archived=redactForPublication(result.bytes);
      Object.assign(raw,{collected_at:result.collected_at,http_status:result.status,attempts:result.attempts,sha256:hash(archived.bytes),body_base64:Buffer.from(archived.bytes).toString('base64'),...(archived.redactions?{original_sha256:archived.original_sha256,redactions:archived.redactions}:{})});
      if(result.status!==200) throw new Error(`HTTP ${result.status}`);
      const json:unknown=JSON.parse(new TextDecoder().decode(archived.bytes));
      if(!object(json)) throw new Error('Expected endpoint JSON object');
      const container=isImage?json:json.data;
      if(!object(container)) throw new Error('Expected endpoint response data object');
      const rows=asRows(container.endpoints).map(endpoint=>({...endpoint,model_id:modelId}));
      completed++;
      if(completed%50===0)options.progress?.(`${id}: fetched ${completed}/${models.length} models`);
      return {raw,rows,error:null};
    } catch(error) {
      raw.error=message(error);
      completed++;
      if(completed%50===0)options.progress?.(`${id}: fetched ${completed}/${models.length} models`);
      return {raw,rows:[],error:`${url}: ${message(error)}`};
    }
  });
  const rows=results.flatMap(result=>result.rows);
  const errors=results.flatMap(result=>result.error?[result.error]:[]);
  const redactionCount=results.reduce((count,result)=>count+(object(result.raw.redactions)?Number(result.raw.redactions.count):0),0);
  if(redactionCount>0) {
    report.redactions={...credentialRedaction,count:redactionCount};
    report.coverage+=' Credential examples redacted for public publication; individual original response hashes are recorded in raw request metadata.';
  }
  const rawBytes=results.map(result=>JSON.stringify(result.raw)).join('\n')+'\n';
  const rawPath=`raw/${id}.ndjson`;
  await writeFile(join(runDir,rawPath),rawBytes);
  await writeFile(join(runDir,`${id}.json`),JSON.stringify({data:rows}));
  Object.assign(report,{record_count:rows.length,errors,raw_path:rawPath,sha256:hash(rawBytes),models_requested:models.length,models_succeeded:results.length-errors.length,models_with_no_endpoints:results.filter(result=>result.error===null&&result.rows.length===0).length,request_started_at:report.collected_at,collected_at:new Date().toISOString()});
  if(errors.length||models.length===0||rows.length===0) {
    report.status='failed';
    if(models.length===0)report.errors.push('Empty source model catalogue: endpoint collection could not run');
    else if(rows.length===0)report.errors.push('Empty aggregate endpoint dataset refused; individual empty responses remain archived.');
  }
  options.progress?.(`${id}: ${report.status}, ${rows.length} endpoints from ${models.length} models`);
  return report;
}

async function previousIndex(output:string,now:string):Promise<ArchiveIndex> {
  try{return ArchiveIndex.parse(JSON.parse(await readFile(join(output,'index.json'),'utf8')));}
  catch(error){if(object(error)&&error.code==='ENOENT')return {schema_version:1,updated_at:now,last_success:null,snapshots:[]};throw error;}
}

/** Collect into a new immutable run; advance latest only after all public sources validate. */
export async function collectSnapshot(options:CollectOptions):Promise<Manifest> {
  const startedAt=new Date().toISOString();
  const previous=await previousIndex(options.output,startedAt);
  const id=`${startedAt.slice(0,10)}T${startedAt.slice(11,19).replaceAll(':','')}Z-${randomBytes(5).toString('hex')}`;
  const runDir=join(options.output,'runs',id);
  await mkdir(join(runDir,'raw'),{recursive:true});
  const collected=await pooledMap(sources,3,source=>collectSource(source,runDir,options));
  const datasets=collected.map(result=>result.report);
  const models=collected.find(result=>result.report.id==='models');
  const images=collected.find(result=>result.report.id==='image_models');
  datasets.push(await collectEndpoints('endpoints',models?.report.status==='ok'?models.rows:[],runDir,options));
  datasets.push(await collectEndpoints('image_endpoints',images?.report.status==='ok'?images.rows:[],runDir,options));
  const count=collected.find(result=>result.report.id==='model_count')?.rows[0]?.count;
  const countReport=datasets.find(dataset=>dataset.id==='model_count');
  if(countReport) {
    countReport.catalogue_count=models?.rows.length??0;
    countReport.count_matches_catalogue=count===models?.rows.length;
    if(count!==models?.rows.length) countReport.unavailable.push('Count and model catalogue differ at their separate request times; no model rows were invented to reconcile the difference.');
  }
  datasets.push({id:'authenticated_data',source_url:`${origin}/api/v1/datasets/`,documentation_url:`${origin}/docs/cookbook/administration/data-api`,collected_at:new Date().toISOString(),status:'unavailable',record_count:0,coverage:'Not collected: authenticated analytics/Data API (rankings, app rankings, benchmarks, session costs), account credits, keys, generations, private/provider-preference data, and usage records.',unavailable:['Requires authorized OpenRouter credentials and appropriate data usage rights. No credentials are requested or stored; no ranking or usage values are synthesized.','The public catalogues do not expose a complete historical record of retired models, endpoint outages, requests, revenue or private/ZDR traffic.','status.openrouter.ai/api/v2/summary.json returned HTTP 403 during source audit; only the public incident RSS window is collected.'],errors:[]});
  const errors=datasets.filter(dataset=>dataset.status==='failed').flatMap(dataset=>dataset.errors.map(error=>`${dataset.id}: ${error}`));
  const completedAt=new Date().toISOString();
  const manifest=Manifest.parse({schema_version:1,id,date:startedAt.slice(0,10),started_at:startedAt,completed_at:completedAt,status:errors.length?'failed':'success',counts:Object.fromEntries(datasets.map(dataset=>[dataset.id,dataset.record_count])),errors,datasets});
  await writeFile(join(runDir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  const {schema_version:_version,datasets:_datasets,...summary}=manifest;
  const index=ArchiveIndex.parse({schema_version:1,updated_at:completedAt,last_success:manifest.status==='success'?id:previous.last_success,snapshots:[summary,...previous.snapshots]});
  const temporaryIndex=join(options.output,`index-${id}.tmp`);
  await writeFile(temporaryIndex,JSON.stringify(index,null,2)+'\n',{flag:'wx'});
  await rename(temporaryIndex,join(options.output,'index.json'));
  return manifest;
}
