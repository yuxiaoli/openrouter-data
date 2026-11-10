import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { ArchiveIndex, DatasetReference, Manifest, type DatasetReport, type Row } from './contracts.js';
import { publicDatasetIds, publicGlobalRequests, publicModelRequests, parsePublicSource, isAllowedPublicSourceUrl, type ParsedPublicSource, type PublicSourceRequest } from './public-sources.js';
import { rowId } from './query.js';
import { writeArchiveViews } from './archive-views.js';

export interface PublicSourceAdapter {
  datasetIds:readonly string[];
  modelDatasetIds?:readonly string[];
  globalRequests():PublicSourceRequest[];
  modelRequests(modelId:string,permaslug?:string):PublicSourceRequest[];
  parse(request:PublicSourceRequest,payload:unknown):ParsedPublicSource;
  isAllowed(url:string):boolean;
}

interface CollectOptions {
  output: string;
  fetcher?: typeof fetch;
  retries?: number;
  concurrency?: number;
  timeoutMs?: number;
  progress?: (message: string) => void;
  publicSources?:PublicSourceAdapter|false;
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
async function download(url:string, options:CollectOptions,publicGuard?:(url:string)=>boolean):Promise<Download> {
  if(publicGuard&&!publicGuard(url))throw new Error('Public source URL is outside the anonymous statistics allowlist');
  const fetcher=options.fetcher??fetch;
  const retries=options.retries??3;
  let lastError:unknown;
  for(let attempt=0;attempt<=retries;attempt++) {
    try {
      const response=await fetcher(url,{headers:{'User-Agent':'openrouter-data/1.0 (public metadata archive; https://github.com/yuxiaoli/openrouter-data)','Accept':'application/json, application/rss+xml, text/plain, */*'},redirect:publicGuard?'manual':'follow',signal:AbortSignal.timeout(options.timeoutMs??30_000)});
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
  const requestStartedAt=new Date().toISOString();
  const report:DatasetReport={id:source.id,source_url:source.url,collected_at:requestStartedAt,request_started_at:requestStartedAt,access:'public',units:{record_count:'records'},window:{label:source.kind==='rss'?'Upstream bounded feed window; full historical coverage is not implied.':'Public values observed during this collection request.',kind:source.kind==='rss'?'bounded_feed':'point_in_time',timezone:'UTC'},status:'ok',record_count:0,coverage:source.coverage,unavailable:[],errors:[]};
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
  report.request_completed_at=new Date().toISOString();
  report.observed_at=report.collected_at;
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

/** Small query chunks avoid fetching an entire cross-model history for one request. */
async function writeQueryableRows(runDir:string,id:string,rows:Row[]):Promise<Row> {
  const chunkLimit=2*1024*1024;
  const blobLimit=90*1024*1024;
  rows.sort((a,b)=>rowId(a).localeCompare(rowId(b),'en'));
  const serialized=rows.map(row=>JSON.stringify(row));
  const sizes=serialized.map(row=>Buffer.byteLength(row));
  if(sizes.some(size=>size>blobLimit))throw new Error('One normalized row exceeds the public Git blob size limit; complete source bytes remain in the raw archive');
  const total=sizes.reduce((sum,size)=>sum+size+1,11);
  const modelChunks:Record<string,string[]>={};
  const register=(row:Row,path:string)=>{
    if(typeof row.model_id!=='string')return;
    const paths=modelChunks[row.model_id]??=[];
    if(!paths.includes(path))paths.push(path);
  };
  const chunks:string[]=[];
  const chunkCounts:Record<string,number>={},chunkHashes:Record<string,string>={};
  if(total>chunkLimit||rows.some(row=>typeof row.model_id==='string')) {
    await mkdir(join(runDir,'chunks',id),{recursive:true});
    let start=0,size=11;
    const flush=async(end:number)=>{
      const path=`chunks/${id}/part-${String(chunks.length+1).padStart(5,'0')}.json`;
      const bytes=`{"data":[${serialized.slice(start,end).join(',')}]}`;
      await writeFile(join(runDir,path),bytes);
      chunks.push(path);
      chunkCounts[path]=end-start;chunkHashes[path]=hash(bytes);
      for(let index=start;index<end;index++)register(rows[index]!,path);
      start=end;size=11;
    };
    for(let index=0;index<rows.length;index++) {
      if(index>start&&size+sizes[index]!+1>chunkLimit)await flush(index);
      size+=sizes[index]!+1;
    }
    if(start<rows.length)await flush(rows.length);
  } else for(const row of rows)register(row,`${id}.json`);
  const rootBytes=total<=blobLimit
    ?`{"data":[${serialized.join(',')}]}`
    :JSON.stringify({storage:'chunked',record_count:rows.length,chunks});
  await writeFile(join(runDir,`${id}.json`),rootBytes);
  return {row_count_actual:rows.length,default_order:'id_asc',normalized_sha256:hash(rootBytes),...(chunks.length?{chunks,chunk_counts:chunkCounts,chunk_sha256s:chunkHashes}:{}),...(Object.keys(modelChunks).length?{model_chunks:modelChunks}:{})};
}

/** Archive NDJSON in bounded files; unusually large bodies have separately hashed base64 parts. */
async function writeRawRequests(runDir:string,id:string,requests:Row[]):Promise<{pages:Row[];raw_path:string;sha256:string}> {
  const limit=50*1024*1024;
  const pages:Row[]=[];
  let lines:string[]=[],size=0;
  const flush=async()=>{
    const path=`raw/${id}${pages.length?`-part-${String(pages.length+1).padStart(5,'0')}`:''}.ndjson`;
    const bytes=lines.join('\n')+(lines.length?'\n':'');
    await writeFile(join(runDir,path),bytes);
    pages.push({raw_path:path,sha256:hash(bytes),request_count:lines.length});
    lines=[];size=0;
  };
  for(let index=0;index<requests.length;index++) {
    const request=requests[index]!;
    if(typeof request.body_base64==='string'&&Buffer.byteLength(request.body_base64)>limit/2) {
      const body=request.body_base64;
      const parts:Row[]=[];
      const partSize=16*1024*1024;
      for(let offset=0;offset<body.length;offset+=partSize) {
        const rawPath=`raw/${id}-body-${index+1}-${parts.length+1}.b64`;
        const bytes=body.slice(offset,offset+partSize);
        await writeFile(join(runDir,rawPath),bytes);
        parts.push({raw_path:rawPath,sha256:hash(bytes)});
      }
      delete request.body_base64;
      request.body_base64_chunks=parts;
    }
    const line=JSON.stringify(request);
    const length=Buffer.byteLength(line)+1;
    if(lines.length&&size+length>limit)await flush();
    if(length>90*1024*1024)throw new Error('Raw request metadata exceeds the public Git blob limit');
    lines.push(line);size+=length;
  }
  if(lines.length||pages.length===0)await flush();
  return {pages,raw_path:String(pages[0]!.raw_path),sha256:String(pages[0]!.sha256)};
}

type RequestCounts=Record<'requested'|'succeeded'|'not_found'|'failed'|'empty',number>;
type PublicState = {
  report:DatasetReport;rows:Row[];raw:Row[];urls:Set<string>;windows:Set<string>;coverage:Set<string>;
  counts:RequestCounts;byWindow:Map<string,Row>;byModel:Map<string,RequestCounts>;
};
async function collectPublicSources(models:Row[],modelCatalogueOk:boolean,runDir:string,options:CollectOptions):Promise<DatasetReport[]> {
  if(options.publicSources===false)return [];
  const adapter:PublicSourceAdapter=options.publicSources??{datasetIds:publicDatasetIds,globalRequests:publicGlobalRequests,modelRequests:publicModelRequests,parse:parsePublicSource,isAllowed:isAllowedPublicSourceUrl};
  const startedAt=new Date().toISOString();
  const states=new Map<string,PublicState>();
  for(const id of adapter.datasetIds) {
    if(!/^[a-z0-9_]+$/.test(id))throw new Error('Unsafe public dataset identifier');
    states.set(id,{report:{id,source_url:'https://openrouter.ai/api/frontend/v1',collected_at:startedAt,request_started_at:startedAt,access:'public',category:'anonymous_public_aggregate',status:'ok',record_count:0,coverage:'Anonymous public frontend observations. Exact request contexts and unmodified native fields are retained; private or authenticated account traffic is not collected.',unavailable:[],errors:[],units:{}},rows:[],raw:[],urls:new Set(),windows:new Set(),coverage:new Set(),counts:{requested:0,succeeded:0,not_found:0,failed:0,empty:0},byWindow:new Map(),byModel:new Map()});
  }
  const queue:PublicSourceRequest[]=[];
  const seen=new Set<string>();
  const requestKey=(request:PublicSourceRequest)=>`${request.dataset}:${request.url}:${request.model_id??''}`;
  const enqueue=(request:PublicSourceRequest)=>{
    const state=states.get(request.dataset);
    if(!state)throw new Error(`Undeclared public dataset ${request.dataset}`);
    const key=requestKey(request);
    if(seen.has(key))return;
    seen.add(key);
    if(request.scope!=='public'||!adapter.isAllowed(request.url)) {
      state.report.errors.push('A discovered request was refused by the anonymous public-source allowlist');state.counts.failed++;
      return;
    }
    if(queue.length>=20_000) {
      state.report.errors.push('Public source discovery exceeded the bounded 20000-request limit');state.counts.failed++;
      return;
    }
    queue.push(request);
  };
  const modelDatasetIds=new Set(adapter.modelDatasetIds??['public_model_activity','public_model_apps','public_model_observations']);
  try {for(const request of adapter.globalRequests())enqueue(request);}
  catch(error) {for(const [id,state] of states)if(!modelDatasetIds.has(id))state.report.errors.push(`Public request generation failed: ${message(error)}`);}
  if(modelCatalogueOk)for(const model of models) {
    try {for(const request of adapter.modelRequests(String(model.id),typeof model.canonical_slug==='string'?model.canonical_slug:undefined))enqueue(request);}
    catch(error) {for(const [id,state] of states)if(modelDatasetIds.has(id))state.report.errors.push(`Public request generation failed for model ${String(model.id)}: ${message(error)}`);}
  }
  let cursor=0,completed=0;
  const downloads=new Map<string,Promise<Download>>();
  await Promise.all(Array.from({length:Math.max(1,Math.min(options.concurrency??4,6))},async()=>{
    while(cursor<queue.length) {
      const request=queue[cursor++]!;
      const state=states.get(request.dataset)!;
      state.urls.add(request.url);state.windows.add(request.window);state.counts.requested++;
      if(state.urls.size===1)state.report.source_url=request.url;
      const context={window:request.window,kind:request.kind,view:request.view,metric:request.metric,group:request.group,subcategory:request.subcategory,section:request.section,routeSegment:request.routeSegment,provider:request.provider,variant:request.variant,dimension:request.dimension,category:request.category};
      const contextKey=JSON.stringify(context);
      const count=state.byWindow.get(contextKey)??{...context,requested:0,succeeded:0,not_found:0,failed:0,empty:0};
      state.byWindow.set(contextKey,count);count.requested=Number(count.requested)+1;
      const modelCount=request.model_id!==undefined?(state.byModel.get(request.model_id)??{requested:0,succeeded:0,not_found:0,failed:0,empty:0}):undefined;
      if(modelCount&&request.model_id!==undefined){state.byModel.set(request.model_id,modelCount);modelCount.requested=Number(modelCount.requested)+1;}
      const raw:Row={request,source_url:request.url,collected_at:new Date().toISOString()};
      try {
        let pending=downloads.get(request.url);
        raw.shared_http_response=pending!==undefined;
        if(pending===undefined) {
          pending=download(request.url,options,adapter.isAllowed);
          downloads.set(request.url,pending);
          state.report.network_requests=Number(state.report.network_requests??0)+1;
        }
        const result=await pending;
        const archived=redactForPublication(result.bytes);
        Object.assign(raw,{collected_at:result.collected_at,http_status:result.status,attempts:result.attempts,sha256:hash(archived.bytes),body_base64:Buffer.from(archived.bytes).toString('base64'),...(archived.redactions?{original_sha256:archived.original_sha256,redactions:archived.redactions}:{})});
        state.report.collected_at=result.collected_at;
        if(result.status===404&&request.model_id!==undefined) {
          state.counts.not_found++;count.not_found=Number(count.not_found)+1;
          if(modelCount)modelCount.not_found=Number(modelCount.not_found)+1;
          state.report.unavailable.push(`HTTP 404: public data unavailable for model ${request.model_id} at ${request.url}`);
        } else {
          if(result.status!==200)throw new Error(`HTTP ${result.status}`);
          const parsed=adapter.parse(request,JSON.parse(new TextDecoder().decode(archived.bytes)));
          raw.metadata=parsed.metadata;
          for(const [rowIndex,row] of parsed.rows.entries())state.rows.push({...row,...(request.model_id!==undefined&&row.model_id===undefined?{model_id:request.model_id}:{}),_source:{...(object(row._source)?row._source:{}),collected_at:result.collected_at,row_index:rowIndex}});
          state.coverage.add(parsed.metadata.coverage);
          for(const item of parsed.metadata.unavailable)if(!state.report.unavailable.includes(item))state.report.unavailable.push(item);
          const units=state.report.units??{};
          for(const [metric,unit] of Object.entries(parsed.metadata.units))units[metric]=units[metric]!==undefined&&units[metric]!==unit?'varies by request; inspect _source.units':unit;
          state.report.units=units;
          if(parsed.metadata.time_range) {
            const ranges=Array.isArray(state.report.time_ranges)?state.report.time_ranges:[];
            ranges.push({source_url:request.url,window:request.window,...parsed.metadata.time_range});state.report.time_ranges=ranges;
          }
          for(const discovered of parsed.metadata.discovered_requests??[])enqueue(discovered);
          if(parsed.metadata.has_next) {
            if(!parsed.metadata.next_url)throw new Error('Public source reports further pages without a retrievable next URL');
            const next=new URL(parsed.metadata.next_url,request.url);
            if(next.origin!==new URL(request.url).origin||next.pathname!==new URL(request.url).pathname)throw new Error('Unexpected public pagination origin or path');
            if(seen.has(requestKey({...request,url:next.href})))throw new Error('Repeated public pagination URL');
            enqueue({...request,id:`${request.id}:next`,url:next.href});
          }
          state.counts.succeeded++;count.succeeded=Number(count.succeeded)+1;
          if(modelCount)modelCount.succeeded=Number(modelCount.succeeded)+1;
          if(parsed.rows.length===0){state.counts.empty++;count.empty=Number(count.empty)+1;if(modelCount)modelCount.empty=Number(modelCount.empty)+1;}
        }
      } catch(error) {
        const description=`${request.url}: ${message(error)}`;
        state.report.errors.push(description);raw.error=message(error);state.counts.failed++;count.failed=Number(count.failed)+1;
        if(modelCount)modelCount.failed=Number(modelCount.failed)+1;
      }
      state.raw.push(raw);completed++;
      if(completed%100===0)options.progress?.(`public statistics: fetched ${completed}/${queue.length} requests`);
    }
  }));
  const reports:DatasetReport[]=[];
  for(const [id,state] of states) {
    const report=state.report;
    report.request_completed_at=new Date().toISOString();report.observed_at=report.collected_at;
    report.coverage_count=state.counts;report.coverage_by_window=[...state.byWindow.values()];report.source_urls=[...state.urls];
    if(state.byModel.size)report.coverage_by_model=Object.fromEntries(state.byModel);
    report.window={label:[...state.windows].join('; ')||'No request executed',kind:'upstream_public_windows',timezone:null};
    if(state.coverage.size)report.coverage+=' '+[...state.coverage].join(' ');
    if(state.counts.requested===0)report.errors.push(modelCatalogueOk?'No enabled public request could be generated for this dataset.':'Current all-modality model catalogue failed; dependent public model requests could not run.');
    const redactionCount=state.raw.reduce((sum,row)=>sum+(object(row.redactions)?Number(row.redactions.count):0),0);
    if(redactionCount>0){report.redactions={...credentialRedaction,count:redactionCount};report.coverage+=' Credential examples redacted for public publication.';}
    Object.assign(report,await writeRawRequests(runDir,id,state.raw));
    try {Object.assign(report,await writeQueryableRows(runDir,id,state.rows));report.record_count=state.rows.length;}
    catch(error){report.errors.push(message(error));report.parsed_record_count=state.rows.length;report.record_count=0;await writeFile(join(runDir,`${id}.json`),JSON.stringify({data:[]}));}
    if(report.errors.length)report.status='failed';
    options.progress?.(`${id}: ${report.status}, ${report.record_count} records (${state.counts.succeeded} responses, ${state.counts.not_found} model-specific 404s)`);
    reports.push(report);
  }
  return reports;
}

async function collectEndpoints(id:'endpoints'|'image_endpoints',models:Row[],runDir:string,options:CollectOptions):Promise<DatasetReport> {
  const isImage=id==='image_endpoints';
  const base=`${origin}/api/v1/${isImage?'images/':''}models/`;
  const report:DatasetReport={id,source_url:`${base}{model_id}/endpoints`,collected_at:new Date().toISOString(),access:'public',units:{record_count:'endpoint records'},endpoint_scope:isImage?'Dedicated image-provider endpoints for every model in the successfully collected image catalogue.':'Public provider endpoints for every model in the successfully collected all-modality catalogue.',window:{label:'Endpoints observed across individual model requests; metric windows remain as named by upstream.',kind:'request_interval',timezone:'UTC'},status:'ok',record_count:0,coverage:`Enumerated every model in this run's ${isImage?'dedicated image':'all-modality'} catalogue. Endpoint statistics/prices are observed values, not guaranteed service levels. Empty endpoint arrays are retained in raw responses.`,unavailable:[],errors:[]};
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
  report.request_completed_at=report.collected_at;
  report.observed_at=report.collected_at;
  report.window={...report.window!,start:report.request_started_at,end:report.request_completed_at};
  if(errors.length||models.length===0||rows.length===0) {
    report.status='failed';
    if(models.length===0)report.errors.push('Empty source model catalogue: endpoint collection could not run');
    else if(rows.length===0)report.errors.push('Empty aggregate endpoint dataset refused; individual empty responses remain archived.');
  }
  options.progress?.(`${id}: ${report.status}, ${rows.length} endpoints from ${models.length} models`);
  return report;
}

async function previousIndex(output:string,now:string):Promise<ArchiveIndex> {
  let text:string;
  try{text=await readFile(join(output,'index.json'),'utf8');}
  catch(error){if(object(error)&&error.code==='ENOENT')return {schema_version:1,updated_at:now,last_success:null,snapshots:[]};throw error;}
  const index=ArchiveIndex.parse(JSON.parse(text));
  if(index.dataset_last_success===undefined) {
    index.dataset_last_success={};
    if(index.last_success!==null) {
      const manifest=Manifest.parse(JSON.parse(await readFile(join(output,'runs',index.last_success,'manifest.json'),'utf8')));
      if(manifest.status!=='success'||manifest.id!==index.last_success)throw new Error('Legacy last_success does not refer to its successful manifest');
      for(const report of manifest.datasets)if(report.status==='ok')index.dataset_last_success[report.id]=datasetReference(index.last_success,report);
    }
  }
  index.latest_snapshot??=index.last_success;
  return index;
}

function datasetReference(snapshot:string,report:DatasetReport):DatasetReference {
  const {id,status:_status,errors:_errors,unavailable:_unavailable,fallback:_fallback,...metadata}=report;
  return DatasetReference.parse({...metadata,snapshot,data_path:`runs/${snapshot}/${id}.json`});
}

/** Collect immutable independent attempts; failed datasets reference their last successful source. */
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
  datasets.push(...await collectPublicSources(models?.rows??[],models?.report.status==='ok',runDir,options));
  const count=collected.find(result=>result.report.id==='model_count')?.rows[0]?.count;
  const countReport=datasets.find(dataset=>dataset.id==='model_count');
  if(countReport) {
    countReport.catalogue_count=models?.rows.length??0;
    countReport.catalogue_status=models?.report.status??'failed';
    countReport.count_matches_catalogue=models?.report.status==='ok'&&count===models.rows.length;
    if(models?.report.status!=='ok')countReport.unavailable.push('The current model catalogue failed validation; its partial rows do not provide a complete catalogue for cross-checking the independent count.');
    else if(count!==models.rows.length) countReport.unavailable.push('Count and model catalogue differ at their separate request times; no model rows were invented to reconcile the difference.');
  }
  datasets.push({id:'authenticated_data',source_url:`${origin}/api/v1/datasets/`,documentation_url:`${origin}/docs/cookbook/administration/data-api`,collected_at:new Date().toISOString(),access:'authenticated',status:'unavailable',record_count:0,coverage:'Anonymous public aggregates are collected separately where publicly exposed. Authenticated Data API exports, account credits, keys, individual generations, private/provider-preference data and account usage records are not collected.',unavailable:['Requires authorized OpenRouter credentials and appropriate data usage rights. No credentials are requested or stored; no private/account values are synthesized.','Public aggregates and bounded public charts do not expose every individual generation, complete lifetime histories, private applications or all private/ZDR traffic.','status.openrouter.ai/api/v2/summary.json returned HTTP 403 during the initial source audit; only the public incident RSS window is collected.'],errors:[]});
  const datasetLastSuccess={...previous.dataset_last_success};
  for(const report of datasets) {
    if(report.status==='ok')datasetLastSuccess[report.id]=datasetReference(id,report);
    else if(report.status==='failed'&&datasetLastSuccess[report.id])report.fallback=datasetLastSuccess[report.id];
  }
  const errors=datasets.filter(dataset=>dataset.status==='failed').flatMap(dataset=>dataset.errors.map(error=>`${dataset.id}: ${error}`));
  const freshCount=datasets.filter(dataset=>dataset.status==='ok'&&dataset.access!=='authenticated').length;
  const failedCount=datasets.filter(dataset=>dataset.status==='failed'&&dataset.access!=='authenticated').length;
  const status=freshCount===0?'failed':failedCount>0?'partial':'success';
  const completedAt=new Date().toISOString();
  const manifest=Manifest.parse({schema_version:1,id,date:startedAt.slice(0,10),started_at:startedAt,completed_at:completedAt,status,counts:Object.fromEntries(datasets.map(dataset=>[dataset.id,dataset.record_count])),errors,datasets});
  await writeFile(join(runDir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  const {schema_version:_version,datasets:_datasets,...summary}=manifest;
  const index=ArchiveIndex.parse({schema_version:1,updated_at:completedAt,last_success:manifest.status==='success'?id:previous.last_success,latest_snapshot:freshCount>0?id:previous.latest_snapshot??previous.last_success,dataset_last_success:datasetLastSuccess,snapshots:[summary,...previous.snapshots]});
  const temporaryIndex=join(options.output,`index-${id}.tmp`);
  await writeFile(temporaryIndex,JSON.stringify(index,null,2)+'\n',{flag:'wx'});
  await rename(temporaryIndex,join(options.output,'index.json'));
  await writeArchiveViews(options.output,index,manifest);
  return manifest;
}
