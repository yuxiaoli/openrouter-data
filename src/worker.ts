import { z } from 'zod';
import { ArchiveIndex, Manifest, DatasetId, type ArchiveStore, type Result, type Row } from './contracts.js';
import { parseQuery, queryRows, dimensions, rowId, sourceOf, sourceValues, type QueryInput } from './query.js';
import { catalogRows, definitionFor, attributionFor, reportSummary } from './catalog.js';
// Imported at build time so the deployed contract is exactly the checked-in contract.
import openapi from '../docs/api/openapi.json';

export interface Env { ARCHIVE_BASE?: string }
const DEFAULT_BASE = 'https://raw.githubusercontent.com/yuxiaoli/openrouter-data/data';
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Cache-Control':status===200?'public, max-age=60':'no-store','X-Content-Type-Options':'nosniff'}});
const error = (code:string,message:string,status:number) => json({error:{code,message}},status);
export class HttpArchiveStore implements ArchiveStore {
  constructor(private base=DEFAULT_BASE) {}
  private storageIndexes=new Map<string,Promise<Record<string,unknown>|null>>();
  private async physicalPath(path:string):Promise<string> {
    const match=/^runs\/(\d{4}-\d{2}-\d{2}T\d{6}Z-[a-z0-9]+)\/(.+)$/.exec(path);
    if(!match||path.endsWith('.gz')||['manifest.json','query-manifest.json','storage.json'].includes(match[2]!))return path;
    const snapshot=match[1]!,logical=match[2]!;
    let pending=this.storageIndexes.get(snapshot);
    if(!pending){pending=(async()=>{try{const r=await fetch(`${this.base}/runs/${snapshot}/storage.json`,{signal:AbortSignal.timeout(20000)});if(!r.ok)return null;const json=asObject(await r.json());return json.snapshot===snapshot?asObject(json.files):null;}catch{return null;}})();this.storageIndexes.set(snapshot,pending);}
    const files=await pending,entry=asObject(files?.[logical]);
    return entry.physical_path===`${logical}.gz`?`runs/${snapshot}/${logical}.gz`:path;
  }
  async read(path:string):Promise<Result<unknown>> {
    try {
      const suffix=path==='index.json'?`?window=${Math.floor(Date.now()/60000)}`:'';
      const candidate=path==='index.json'?'public-index.json':await this.physicalPath(path);
      let response=await fetch(`${this.base}/${candidate}${suffix}`,{signal:AbortSignal.timeout(20000)});
      if(response.status===404&&path==='index.json'&&candidate!==path)response=await fetch(`${this.base}/${path}${suffix}`,{signal:AbortSignal.timeout(20000)});
      let compressed=candidate.endsWith('.gz');
      if(response.status===404&&!compressed){response=await fetch(`${this.base}/${path}.gz${suffix}`,{signal:AbortSignal.timeout(20000)});compressed=true;}
      if(!response.ok) return {ok:false,error:{code:'ARCHIVE_UNAVAILABLE',message:`Archive returned HTTP ${response.status}`,status:502}};
      const decoded=compressed?new Response(response.body!.pipeThrough(new DecompressionStream('gzip'))):response;
      return {ok:true,value:await decoded.json()};
    } catch { return {ok:false,error:{code:'ARCHIVE_UNAVAILABLE',message:'Archive request failed or returned invalid JSON.',status:502}}; }
  }
}
const validDate = (s:string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s;
const validId = (s:string) => /^\d{4}-\d{2}-\d{2}T\d{6}Z-[a-z0-9]+$/.test(s);
const queryError = (message:string)=>error('INVALID_QUERY',message,400);
function strictParams(p:URLSearchParams, allowed:string[]) {
  return [...p.keys()].every(k=>allowed.includes(k) && p.getAll(k).length===1);
}
function applicability(query:QueryInput, type:string):string|undefined {
  const models=['models','embedding_models','eu_models','image_models','video_models'];
  const endpointTypes=['endpoints','image_endpoints','zdr_endpoints'];
  const publicTypes=DatasetId.options.filter(id=>id.startsWith('public_'));
  const publicModels=['public_model_rankings','public_performance','public_model_activity','public_model_apps','public_model_observations'];
  const allowed:Record<string,string[]>={
    provider:[...endpointTypes,'providers','public_performance','public_discovery'], author:[...models,...endpointTypes,...publicModels], model:[...models,...endpointTypes,...publicModels],app:['public_app_rankings'],
    input_modality:['models','embedding_models','eu_models','image_models'], output_modality:['models','embedding_models','eu_models','image_models'],
    parameter:['models','embedding_models','eu_models','endpoints','zdr_endpoints','image_models','image_endpoints'],
    min_context:['models','embedding_models','eu_models','endpoints','zdr_endpoints'],
    max_prompt_price:['models','embedding_models','eu_models','endpoints','zdr_endpoints'],free:['models','embedding_models','eu_models','endpoints','zdr_endpoints'],
    ...Object.fromEntries(['window','metric','view','kind','section','group','subcategory','modality'].map(k=>[k,publicTypes])),
  };
  for(const [key,types] of Object.entries(allowed)) if(query[key as keyof QueryInput]!==undefined && !types.includes(type)) return `${key} is not supported for type=${type}.`;
  if(query.dimension && !allowed[query.dimension]?.includes(type)) return `dimension=${query.dimension} is not supported for type=${type}.`;
}
function xml(s:unknown):string { return String(s??'').replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu,'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!)); }
const asObject=(x:unknown):Record<string,unknown>=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:{};
function preview(value:unknown,depth=0):unknown {
  if(value===null||typeof value!=='object')return typeof value==='string'&&value.length>700?value.slice(0,700)+' [summary shortened]':value;
  if(Array.isArray(value))return {items:value.length,sample:depth<3?value.slice(0,2).map(v=>preview(v,depth+1)):[]};
  const entries=Object.entries(value as Record<string,unknown>);
  if(depth>=3)return {fields:entries.map(([key])=>key)};
  return {...Object.fromEntries(entries.slice(0,24).map(([key,v])=>[key,preview(v,depth+1)])),...(entries.length>24?{additional_fields:entries.length-24}:{})};
}
const rowFile=z.object({data:z.array(z.record(z.string(),z.unknown()))});
async function readRows(store:ArchiveStore,dataPath:string,report:Record<string,unknown>,query:QueryInput,allowPage:boolean):Promise<Result<{rows:Row[];complete:boolean;baseOffset:number;paged:boolean}>> {
  const root=dataPath.slice(0,dataPath.lastIndexOf('/')+1);
  const chunks=Array.isArray(report.chunks)&&report.chunks.every(x=>typeof x==='string')?report.chunks as string[]:[];
  const modelChunks=asObject(report.model_chunks),shards=asObject(report.shards),counts=asObject(report.chunk_counts);
  let paths:string[]=chunks.length?[...chunks]:[dataPath.slice(root.length)],complete=true,baseOffset=0,paged=false;
  if(query.model) {
    const ids=query.model.split(',').map(s=>s.trim());
    if(ids.every(id=>Array.isArray(modelChunks[id])&&(modelChunks[id] as unknown[]).every(x=>typeof x==='string'))) {
      paths=[...new Set(ids.flatMap(id=>modelChunks[id] as string[]))];complete=false;
    } else if(ids.every(id=>typeof shards[id]==='string')) {paths=[...new Set(ids.map(id=>String(shards[id])))];complete=false;}
  } else if(allowPage&&chunks.length&&report.default_order==='id_asc'&&query.sort==='id'&&query.order==='asc'&&
    !['q','author','provider','input_modality','output_modality','parameter','min_context','max_prompt_price','free','window','metric','view','kind','section','group','subcategory','modality','app','since','until'].some(k=>query[k as keyof QueryInput]!==undefined)&&chunks.every(p=>Number.isInteger(counts[p])&&Number(counts[p])>=0)) {
    paths=[];let start=0;
    for(const path of chunks){const count=Number(counts[path]);if(start+count>query.offset&&start<query.offset+query.limit){if(paths.length===0)baseOffset=start;paths.push(path);}start+=count;}
    if(start!==report.record_count)return {ok:false,error:{code:'INVALID_ARCHIVE',message:'Chunk counts do not equal the dataset count.',status:502}};
    complete=false;paged=true;
  }
  if(paths.some(p=>p.includes('..')||!(/^(?:[a-z0-9_]+\.json|(?:chunks|shards)\/[a-z0-9_%./-]+\.json)$/i.test(p))))return {ok:false,error:{code:'INVALID_ARCHIVE',message:'Invalid archive chunk path.',status:502}};
  const rows:Row[]=[];
  // Keep origin request concurrency bounded. A model filter uses its indexed chunks.
  for(let i=0;i<paths.length;i+=4) {
    const results=await Promise.all(paths.slice(i,i+4).map(async path=>({path,result:await store.read(root+path)})));
    for(const {path,result} of results){if(!result.ok)return result;const data=rowFile.safeParse(result.value);if(!data.success||typeof counts[path]==='number'&&data.data.data.length!==counts[path])return {ok:false,error:{code:'INVALID_ARCHIVE',message:'Dataset chunk failed schema or record-count validation.',status:502}};rows.push(...data.data.data);}
  }
  if(complete&&rows.length!==report.record_count)return {ok:false,error:{code:'INVALID_ARCHIVE',message:'Dataset failed record-count validation.',status:502}};
  return {ok:true,value:{rows,complete,baseOffset,paged}};
}

export async function handleRequest(request:Request,store:ArchiveStore,now=Date.now()):Promise<Response> {
  const url=new URL(request.url); const path=url.pathname; const params=new URLSearchParams(url.search);
  if(path==='/rss.xml' && !params.has('sort')) {
    const type=params.get('type')??'models';
    const chronological=['models','embedding_models','eu_models','image_models','video_models'].includes(type);
    const feed=['model_rss','blog_posts','status_incidents'].includes(type);
    params.set('sort',chronological?'created':feed?'published_at':'id');
    if(!params.has('order')) params.set('order',chronological||feed?'desc':'asc');
  }
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
  if(!['GET','HEAD'].includes(request.method)) { const r=error('METHOD_NOT_ALLOWED','Use GET or HEAD.',405); r.headers.set('Allow','GET, HEAD, OPTIONS'); return r; }
  if(request.method==='HEAD') { const response=await handleRequest(new Request(request.url,{method:'GET'}),store,now); return new Response(null,{status:response.status,headers:response.headers}); }
  if(path==='/docs/api/openapi.json'||path==='/openapi.json') return params.size?queryError('This endpoint accepts no parameters.'):json(openapi);
  if(path==='/') return params.size?queryError('This endpoint accepts no parameters.'):json({name:'OpenRouter Data Archive',independent_service:true,repository:'https://github.com/yuxiaoli/openrouter-data',openapi:`${url.origin}/docs/api/openapi.json`,data:`${url.origin}/api/v1/data?type=models`,rss:`${url.origin}/rss.xml`,catalog:`${url.origin}/api/v1/catalog`,feeds:`${url.origin}/feeds.json`,rss_overview:`${url.origin}/rss.xml?type=overview`,sources:'https://github.com/yuxiaoli/openrouter-data/blob/main/docs/sources.md',description:'Independent daily archive of publicly accessible OpenRouter catalogues, performance, rankings, usage views and content. Discover all datasets and their coverage through catalog and feeds. Not operated by OpenRouter. Official URLs identify sources, not this service.'});
  if(!['/healthz','/api/v1/snapshots','/api/v1/manifest','/api/v1/datasets','/api/v1/catalog','/feeds.json','/api/v1/data','/api/v1/dimensions','/rss.xml'].includes(path)) return error('NOT_FOUND','Endpoint not found; see /docs/api/openapi.json.',404);
  try {
    const loaded=await store.read('index.json'); if(!loaded.ok) return error(loaded.error.code,loaded.error.message,loaded.error.status);
    const parsedIndex=ArchiveIndex.safeParse(loaded.value); if(!parsedIndex.success) return error('INVALID_ARCHIVE','Archive index failed schema validation.',502);
    const index=parsedIndex.data;
    const latest=[...index.snapshots].sort((a,b)=>b.completed_at.localeCompare(a.completed_at))[0];
    const last=index.snapshots.find(s=>s.id===index.last_success);
    const usable=index.snapshots.find(s=>s.id===index.latest_snapshot)??last;
    const stale=!usable || now-Date.parse(usable.completed_at)>36*60*60*1000;
    if(path==='/healthz') {
      if(params.size) return queryError('This endpoint accepts no parameters.');
      const status=!usable?'unavailable':stale || latest?.status!=='success'?'degraded':'ok';
      return json({status,last_success:index.last_success,latest_snapshot:usable?.id??null,latest_attempt:latest??null,stale,updated_at:index.updated_at},status==='ok'?200:503);
    }
    if(path==='/api/v1/snapshots') {
      if(!strictParams(params,['from','to','status','limit','offset'])) return queryError('Unknown or duplicate snapshot parameter.');
      for(const key of ['from','to']) if(params.has(key)&&!validDate(params.get(key)!)) return queryError(`${key} must be a calendar date YYYY-MM-DD (UTC).`);
      if(params.has('from')&&params.has('to')&&params.get('from')!>params.get('to')!) return queryError('from must be on or before to.');
      if(params.has('status')&&!['success','partial','failed'].includes(params.get('status')!)) return queryError('status must be success, partial or failed.');
      const paging=parseQuery(new URLSearchParams([...params].filter(([k])=>['limit','offset'].includes(k))));
      if(!paging.ok) return error(paging.error.code,paging.error.message,400);
      const {limit,offset}=paging.value;
      const rows=[...index.snapshots].filter(s=>(!params.has('from')||s.date>=params.get('from')!)&&(!params.has('to')||s.date<=params.get('to')!)&&(!params.has('status')||s.status===params.get('status'))).sort((a,b)=>b.completed_at.localeCompare(a.completed_at));
      return json({meta:{schema_version:1,updated_at:index.updated_at,last_success:index.last_success,latest_snapshot:usable?.id??null},data:rows.slice(offset,offset+limit),pagination:{total:rows.length,limit,offset,has_more:offset+limit<rows.length}});
    }
    if(['/api/v1/manifest','/api/v1/datasets','/api/v1/catalog','/feeds.json'].includes(path) && !strictParams(params,['date','snapshot'])) return queryError('Only date or snapshot is accepted.');
    const parsedQuery=parseQuery(params); if(!parsedQuery.ok) return error(parsedQuery.error.code,parsedQuery.error.message,400);
    const query=parsedQuery.value;
    if(query.snapshot && query.date) return queryError('date and snapshot are mutually exclusive.');
    if(query.snapshot && !validId(query.snapshot)) return queryError('Invalid snapshot id.');
    if(query.date && query.date!=='latest' && !validDate(query.date)) return queryError('date must be latest or a calendar date YYYY-MM-DD (UTC).');
    const selected=query.snapshot?index.snapshots.find(s=>s.id===query.snapshot):query.date && query.date!=='latest'?[...index.snapshots].filter(s=>s.date===query.date && s.status!=='failed').sort((a,b)=>b.completed_at.localeCompare(a.completed_at))[0]:usable;
    if(!selected) return error(index.snapshots.length?'SNAPSHOT_NOT_FOUND':'NO_SUCCESSFUL_SNAPSHOT','No successful snapshot matches the selection; history starts with actual collection.',index.snapshots.length?404:503);
    let report=await store.read(`runs/${selected.id}/${path==='/api/v1/manifest'?'manifest.json':'query-manifest.json'}`);
    if(!report.ok&&path!=='/api/v1/manifest')report=await store.read(`runs/${selected.id}/manifest.json`);
    if(!report.ok) return error(report.error.code,report.error.message,report.error.status);
    const manifestResult=Manifest.safeParse(report.value); if(!manifestResult.success || manifestResult.data.id!==selected.id) return error('INVALID_ARCHIVE','Snapshot manifest failed schema validation.',502);
    const manifest=manifestResult.data;
    if(manifest.datasets.some(d=>d.access==='authenticated'&&d.status!=='unavailable'))return error('PRIVATE_ARCHIVE_BLOCKED','Authenticated datasets must be isolated from this public archive; this snapshot is not served.',503);
    const meta={schema_version:1,snapshot:selected.id,date:selected.date,collected_at:selected.completed_at,status:selected.status as string,snapshot_status:selected.status,attempt_snapshot:selected.id,attempt_completed_at:selected.completed_at,data_collected_at:null as string|null,last_success:index.last_success,latest_snapshot:usable?.id??null,latest_attempt_status:latest?.status??null,stale,coverage:null as unknown,attribution:null as unknown,manifest_url:`${url.origin}/api/v1/manifest?snapshot=${selected.id}`};
    if(path==='/api/v1/manifest') return json({meta,data:manifest});
    const discovered=catalogRows(manifest.datasets,url.origin,selected.id);
    if(path==='/api/v1/datasets') return json({meta,data:manifest.datasets.map(report=>({...reportSummary(report),...(discovered.find(d=>d.id===report.id)??{}),status:report.status}))});
    if(path==='/api/v1/catalog'||path==='/feeds.json') return json({meta,data:discovered,overview_rss:`${url.origin}/rss.xml?type=overview&snapshot=${selected.id}`,unavailable_sources:manifest.datasets.filter(d=>d.status==='unavailable')});
    if(path==='/rss.xml' && query.type==='overview') {
      if(!strictParams(url.searchParams,['type','date','snapshot','limit','offset'])) return queryError('Overview accepts type, date, snapshot, limit and offset.');
      if(query.limit>100) return queryError('RSS limit must be at most 100.');
      const items=discovered.filter(d=>d.report).slice(query.offset,query.offset+query.limit).map(d=>{
        const report=d.report!;const fallback=report.fallback;
        const text=`${d.description} Complete records: ${d.json_url}. Status: ${d.collection_status}. Records: ${fallback?.record_count??report.record_count}. Data collected at: ${d.data_collected_at}. Coverage: ${fallback?.coverage??report.coverage}. Window and units: ${JSON.stringify({window:fallback?.window??report.window??null,units:fallback?.units??report.units??null})}. Errors: ${JSON.stringify(report.errors)}. ${d.coverage_note}`;
        return `<item><title>${xml(d.title)} — ${xml(d.collection_status)}</title><link>${xml(d.json_url)}</link><guid isPermaLink="false">${xml(`${url.origin}/observations/${selected.id}/${d.id}`)}</guid><pubDate>${xml(new Date(d.data_collected_at!).toUTCString())}</pubDate><description>${xml(text)}</description><category>${xml(d.category)}</category><category>${xml(d.id)}</category></item>`;
      }).join('');
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>OpenRouter Data Archive — Dataset observations</title><link>${xml(url.origin+'/api/v1/catalog')}</link><description>Independent public dataset observations with JSON links, coverage, source time and failures. Not operated by OpenRouter.</description><lastBuildDate>${new Date(selected.completed_at).toUTCString()}</lastBuildDate><atom:link href="${xml(url.toString())}" rel="self" type="application/rss+xml"/>${items}</channel></rss>`,{headers:{'Content-Type':'application/rss+xml; charset=utf-8','Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=60'}});
    }
    if(selected.status==='failed') return error('FAILED_SNAPSHOT','This attempt failed; inspect its manifest. Query the latest usable snapshot for data.',503);
    const typeResult=DatasetId.safeParse(query.type??'models'); if(!typeResult.success) return queryError(`Unknown type. Supported values: ${DatasetId.options.join(', ')}.`);
    const type=typeResult.data;
    meta.attribution=attributionFor(type);
    if(path==='/api/v1/dimensions') { if(!query.dimension) return queryError('dimension is required.'); if(params.has('sort')||params.has('order')) return queryError('Dimensions sort by count descending, value ascending; sort/order are not accepted.'); }
    else if(query.dimension) return queryError('dimension is only accepted by /api/v1/dimensions.');
    if(path==='/rss.xml' && query.limit>100) return queryError('RSS limit must be at most 100.');
    const invalid=applicability(query,type); if(invalid) return queryError(invalid);
    let coverage=manifest.datasets.find(d=>d.id===type);
    if(!coverage) return error('DATASET_UNAVAILABLE','This dataset was not collected in this snapshot.',503);
    let dataPath=`runs/${selected.id}/${type}.json`;
    if(coverage.status!=='ok') {
      const fallback=coverage.fallback;
      if(!fallback) return error('DATASET_UNAVAILABLE','The dataset failed and has no successful fallback; inspect the manifest.',503);
      if(fallback.data_path!==`runs/${fallback.snapshot}/${type}.json`) return error('INVALID_ARCHIVE','Fallback path does not match the dataset.',502);
      dataPath=fallback.data_path;
      meta.snapshot=fallback.snapshot;meta.date=fallback.snapshot.slice(0,10);meta.collected_at=fallback.collected_at;meta.data_collected_at=fallback.collected_at;meta.stale=true;meta.status='stale';
      coverage={...coverage,...fallback,status:'failed',errors:coverage.errors,fallback,record_count:fallback.record_count};
    } else meta.data_collected_at=coverage.collected_at;
    meta.stale=meta.stale||now-Date.parse(meta.data_collected_at!)>36*60*60*1000;
    meta.coverage={...reportSummary(coverage),status:meta.status==='stale'?'stale':coverage.status,attempt_status:manifest.datasets.find(d=>d.id===type)!.status,data_snapshot:meta.snapshot,data_collected_at:meta.data_collected_at,full_report_url:meta.manifest_url};
    const loadedRows=await readRows(store,dataPath,coverage,query,path!=='/api/v1/dimensions');
    if(!loadedRows.ok)return error(loadedRows.error.code,loadedRows.error.message,loadedRows.error.status);
    const {rows,paged,baseOffset}=loadedRows.value;
    const effectiveParams=new URLSearchParams(params);
    if(paged)effectiveParams.set('offset',String(Math.max(0,query.offset-baseOffset)));
    const result=path==='/api/v1/dimensions'?dimensions(rows,query):queryRows(rows,effectiveParams);
    if(paged){result.offset=query.offset;result.total=coverage.record_count;}
    if(path==='/rss.xml') {
      const items=result.data as Row[];
      const self=url.toString();
      const body=items.map(row=>{
        const date=row.pubDate??row.published_at??(typeof row.created==='number'?new Date(row.created*1000).toISOString():meta.data_collected_at);
        const pubDate=Number.isNaN(Date.parse(String(date)))?meta.data_collected_at!:String(date);
        const src=sourceOf(row),definition=definitionFor(type);
        const linked=new URLSearchParams({type,snapshot:selected.id});
        const model=String(row.model_id??row.variant_permaslug??row.model_permaslug??row.id??row.slug??'');
        if(model&&['models','embedding_models','eu_models','image_models','video_models','endpoints','image_endpoints','zdr_endpoints','public_model_rankings','public_performance','public_model_activity','public_model_apps','public_model_observations'].includes(type))linked.set('model',model);
        if(type==='public_app_rankings'&&(row.app_id!==undefined||row.id!==undefined))linked.set('app',String(row.app_id??row.id));
        if(type.startsWith('public_'))for(const key of ['window','metric','view','kind','section','group','subcategory','modality']){const value=sourceValues(row,key)[0];if(value)linked.set(key,value);}
        const jsonLink=`${url.origin}/api/v1/data?${linked}`;
        const candidate=!type.startsWith('public_')&&typeof row.link==='string'&&/^https?:\/\//.test(row.link)?row.link:jsonLink;
        const native=Object.fromEntries(Object.entries(row).filter(([key])=>!['description','_source'].includes(key)));
        const source=Object.keys(src).length?src:{source_url:coverage.source_url,window:coverage.window??null,units:coverage.units??null};
        const summary=`${String(row.description??'').slice(0,1500)}\nNative fields (sampled summary; null means unknown): ${JSON.stringify(preview(native))}\nSource/window/units: ${JSON.stringify(source)}\nAttribution: ${JSON.stringify(attributionFor(type))}\nComplete JSON: ${jsonLink}\nData snapshot: ${meta.snapshot}; observed at: ${meta.data_collected_at}; status: ${meta.status}.`;
        const identity=type.startsWith('public_')?encodeURIComponent([rowId(row),src.source_url??'',src.metric??'',src.view??'',src.kind??'',src.section??'',src.row_index??row.source_position??row.date??''].join('|')):String(baseOffset+rows.indexOf(row));
        const guid=`${url.origin}/snapshots/${meta.snapshot}/${type}/${identity}`;
        const title=row.title??row.name??(rowId(row)||src.kind||definition.title);
        const suffix=type.startsWith('public_')?` — ${sourceValues(row,'window').join(',')||'window unspecified'}${src.metric?` / ${String(src.metric)}`:''}`:'';
        return `<item><title>${xml(title)}${xml(suffix)}</title><link>${xml(candidate)}</link><guid isPermaLink="false">${xml(guid)}</guid><pubDate>${xml(new Date(pubDate).toUTCString())}</pubDate><description>${xml(summary)}</description><category>${xml(definition.category)}</category><category>${xml(type)}</category>${sourceValues(row,'window').map(v=>`<category>${xml(v)}</category>`).join('')}</item>`;
      }).join('');
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>OpenRouter Data Archive — ${xml(type)}${meta.stale?' (stale)':''}</title><link>${xml(url.origin)}</link><description>Independent snapshot archive; source: ${xml(coverage.source_url)}; data snapshot ${xml(meta.snapshot)}; collection attempt ${xml(selected.id)}; status ${xml(meta.status)}; data collected at ${xml(meta.data_collected_at)}. Not operated by OpenRouter.</description><lastBuildDate>${xml(new Date(meta.data_collected_at!).toUTCString())}</lastBuildDate><atom:link href="${xml(self)}" rel="self" type="application/rss+xml"/>${body}</channel></rss>`,{headers:{'Content-Type':'application/rss+xml; charset=utf-8','Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=60','X-Content-Type-Options':'nosniff'}});
    }
    const {data:resultRows,...pagination}=result;
    return json({meta,data:resultRows,pagination:{...pagination,has_more:result.offset+result.limit<result.total}});
  } catch { return error('INVALID_ARCHIVE','Archive could not be processed safely.',502); }
}

export default {
  fetch(request:Request,env:Env) { return handleRequest(request,new HttpArchiveStore(env.ARCHIVE_BASE??DEFAULT_BASE)); }
};
