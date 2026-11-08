import { z } from 'zod';
import { ArchiveIndex, Manifest, DatasetId, type ArchiveStore, type Result, type Row } from './contracts.js';
import { parseQuery, queryRows, dimensions, rowId, type QueryInput } from './query.js';
// Imported at build time so the deployed contract is exactly the checked-in contract.
import openapi from '../docs/api/openapi.json';

export interface Env { ARCHIVE_BASE?: string }
const DEFAULT_BASE = 'https://raw.githubusercontent.com/yuxiaoli/openrouter-data/data';
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Cache-Control':status===200?'public, max-age=60':'no-store','X-Content-Type-Options':'nosniff'}});
const error = (code:string,message:string,status:number) => json({error:{code,message}},status);
export class HttpArchiveStore implements ArchiveStore {
  constructor(private base=DEFAULT_BASE) {}
  async read(path:string):Promise<Result<unknown>> {
    try {
      const suffix=path==='index.json'?`?window=${Math.floor(Date.now()/60000)}`:'';
      const response=await fetch(`${this.base}/${path}${suffix}`,{signal:AbortSignal.timeout(20000)});
      if(!response.ok) return {ok:false,error:{code:'ARCHIVE_UNAVAILABLE',message:`Archive returned HTTP ${response.status}`,status:502}};
      return {ok:true,value:await response.json()};
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
  const allowed:Record<string,string[]>={
    provider:[...endpointTypes,'providers'], author:[...models,...endpointTypes], model:[...models,...endpointTypes],
    input_modality:['models','embedding_models','eu_models','image_models'], output_modality:['models','embedding_models','eu_models','image_models'],
    parameter:['models','embedding_models','eu_models','endpoints','zdr_endpoints','image_models','image_endpoints'],
    min_context:['models','embedding_models','eu_models','endpoints','zdr_endpoints'],
    max_prompt_price:['models','embedding_models','eu_models','endpoints','zdr_endpoints'],free:['models','embedding_models','eu_models','endpoints','zdr_endpoints'],
  };
  for(const [key,types] of Object.entries(allowed)) if(query[key as keyof QueryInput]!==undefined && !types.includes(type)) return `${key} is not supported for type=${type}.`;
  if(query.dimension && !allowed[query.dimension]?.includes(type)) return `dimension=${query.dimension} is not supported for type=${type}.`;
}
function xml(s:unknown):string { return String(s??'').replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu,'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!)); }

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
  if(path==='/') return params.size?queryError('This endpoint accepts no parameters.'):json({name:'OpenRouter Data Archive',independent_service:true,repository:'https://github.com/yuxiaoli/openrouter-data',openapi:`${url.origin}/docs/api/openapi.json`,data:`${url.origin}/api/v1/data?type=models`,rss:`${url.origin}/rss.xml`,sources:'https://github.com/yuxiaoli/openrouter-data/blob/main/docs/sources.md',description:'Independent daily archive of publicly accessible OpenRouter data. Not operated by OpenRouter. Official source URLs are attribution, not this service.'});
  if(!['/healthz','/api/v1/snapshots','/api/v1/manifest','/api/v1/datasets','/api/v1/data','/api/v1/dimensions','/rss.xml'].includes(path)) return error('NOT_FOUND','Endpoint not found; see /docs/api/openapi.json.',404);
  try {
    const loaded=await store.read('index.json'); if(!loaded.ok) return error(loaded.error.code,loaded.error.message,loaded.error.status);
    const parsedIndex=ArchiveIndex.safeParse(loaded.value); if(!parsedIndex.success) return error('INVALID_ARCHIVE','Archive index failed schema validation.',502);
    const index=parsedIndex.data;
    const latest=[...index.snapshots].sort((a,b)=>b.completed_at.localeCompare(a.completed_at))[0];
    const last=index.snapshots.find(s=>s.id===index.last_success);
    const stale=!last || now-Date.parse(last.completed_at)>36*60*60*1000;
    if(path==='/healthz') {
      if(params.size) return queryError('This endpoint accepts no parameters.');
      const status=!last?'unavailable':stale || latest?.status!=='success'?'degraded':'ok';
      return json({status,last_success:index.last_success,latest_attempt:latest??null,stale,updated_at:index.updated_at},status==='ok'?200:503);
    }
    if(path==='/api/v1/snapshots') {
      if(!strictParams(params,['from','to','status','limit','offset'])) return queryError('Unknown or duplicate snapshot parameter.');
      for(const key of ['from','to']) if(params.has(key)&&!validDate(params.get(key)!)) return queryError(`${key} must be a calendar date YYYY-MM-DD (UTC).`);
      if(params.has('from')&&params.has('to')&&params.get('from')!>params.get('to')!) return queryError('from must be on or before to.');
      if(params.has('status')&&!['success','failed'].includes(params.get('status')!)) return queryError('status must be success or failed.');
      const paging=parseQuery(new URLSearchParams([...params].filter(([k])=>['limit','offset'].includes(k))));
      if(!paging.ok) return error(paging.error.code,paging.error.message,400);
      const {limit,offset}=paging.value;
      const rows=[...index.snapshots].filter(s=>(!params.has('from')||s.date>=params.get('from')!)&&(!params.has('to')||s.date<=params.get('to')!)&&(!params.has('status')||s.status===params.get('status'))).sort((a,b)=>b.completed_at.localeCompare(a.completed_at));
      return json({meta:{schema_version:1,updated_at:index.updated_at,last_success:index.last_success},data:rows.slice(offset,offset+limit),pagination:{total:rows.length,limit,offset,has_more:offset+limit<rows.length}});
    }
    if(['/api/v1/manifest','/api/v1/datasets'].includes(path) && !strictParams(params,['date','snapshot'])) return queryError('Only date or snapshot is accepted.');
    const parsedQuery=parseQuery(params); if(!parsedQuery.ok) return error(parsedQuery.error.code,parsedQuery.error.message,400);
    const query=parsedQuery.value;
    if(query.snapshot && query.date) return queryError('date and snapshot are mutually exclusive.');
    if(query.snapshot && !validId(query.snapshot)) return queryError('Invalid snapshot id.');
    if(query.date && query.date!=='latest' && !validDate(query.date)) return queryError('date must be latest or a calendar date YYYY-MM-DD (UTC).');
    const selected=query.snapshot?index.snapshots.find(s=>s.id===query.snapshot):query.date && query.date!=='latest'?[...index.snapshots].filter(s=>s.date===query.date && s.status==='success').sort((a,b)=>b.completed_at.localeCompare(a.completed_at))[0]:last;
    if(!selected) return error(index.snapshots.length?'SNAPSHOT_NOT_FOUND':'NO_SUCCESSFUL_SNAPSHOT','No successful snapshot matches the selection; history starts with actual collection.',index.snapshots.length?404:503);
    const report=await store.read(`runs/${selected.id}/manifest.json`); if(!report.ok) return error(report.error.code,report.error.message,report.error.status);
    const manifestResult=Manifest.safeParse(report.value); if(!manifestResult.success || manifestResult.data.id!==selected.id) return error('INVALID_ARCHIVE','Snapshot manifest failed schema validation.',502);
    const manifest=manifestResult.data;
    const meta={schema_version:1,snapshot:selected.id,date:selected.date,collected_at:selected.completed_at,status:selected.status,last_success:index.last_success,latest_attempt_status:latest?.status??null,stale,coverage:null as unknown};
    if(path==='/api/v1/manifest') return json({meta,data:manifest});
    if(path==='/api/v1/datasets') return json({meta,data:manifest.datasets});
    if(selected.status!=='success') return error('FAILED_SNAPSHOT','This attempt failed; inspect its manifest. Query the last successful snapshot for data.',503);
    const typeResult=DatasetId.safeParse(query.type??'models'); if(!typeResult.success) return queryError(`Unknown type. Supported values: ${DatasetId.options.join(', ')}.`);
    const type=typeResult.data;
    if(path==='/api/v1/dimensions') { if(!query.dimension) return queryError('dimension is required.'); if(params.has('sort')||params.has('order')) return queryError('Dimensions sort by count descending, value ascending; sort/order are not accepted.'); }
    else if(query.dimension) return queryError('dimension is only accepted by /api/v1/dimensions.');
    if(path==='/rss.xml' && query.limit>100) return queryError('RSS limit must be at most 100.');
    const invalid=applicability(query,type); if(invalid) return queryError(invalid);
    const coverage=manifest.datasets.find(d=>d.id===type); meta.coverage=coverage??null;
    if(!coverage || coverage.status!=='ok') return error('DATASET_UNAVAILABLE','This dataset was not successfully collected in this snapshot.',503);
    const dataResult=await store.read(`runs/${selected.id}/${type}.json`); if(!dataResult.ok) return error(dataResult.error.code,dataResult.error.message,dataResult.error.status);
    const dataSchema=z.object({data:z.array(z.record(z.string(),z.unknown()))});
    const data=dataSchema.safeParse(dataResult.value); if(!data.success || data.data.data.length!==coverage.record_count) return error('INVALID_ARCHIVE','Dataset failed schema or record-count validation.',502);
    const rows=data.data.data;
    const result=path==='/api/v1/dimensions'?dimensions(rows,query):queryRows(rows,params);
    if(path==='/rss.xml') {
      const items=result.data as Row[];
      const self=url.toString();
      const body=items.map(row=>{
        const date=row.pubDate??row.published_at??(typeof row.created==='number'?new Date(row.created*1000).toISOString():selected.completed_at);
        const pubDate=Number.isNaN(Date.parse(String(date)))?selected.completed_at:String(date);
        const candidate=typeof row.link==='string' && /^https?:\/\//.test(row.link)?row.link:`${url.origin}/api/v1/data?type=${type}&snapshot=${selected.id}`;
        const guid=`${url.origin}/snapshots/${selected.id}/${type}/${rows.indexOf(row)}`;
        return `<item><title>${xml(row.title??row.name??rowId(row))}</title><link>${xml(candidate)}</link><guid isPermaLink="false">${xml(guid)}</guid><pubDate>${xml(new Date(pubDate).toUTCString())}</pubDate><description>${xml(row.description??JSON.stringify(row))}</description><category>${xml(type)}</category></item>`;
      }).join('');
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>OpenRouter Data Archive — ${xml(type)}</title><link>${xml(url.origin)}</link><description>Independent snapshot archive; source: ${xml(coverage.source_url)}; snapshot ${xml(selected.id)}. Not operated by OpenRouter.</description><lastBuildDate>${xml(new Date(selected.completed_at).toUTCString())}</lastBuildDate><atom:link href="${xml(self)}" rel="self" type="application/rss+xml"/>${body}</channel></rss>`,{headers:{'Content-Type':'application/rss+xml; charset=utf-8','Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=60','X-Content-Type-Options':'nosniff'}});
    }
    const {data:resultRows,...pagination}=result;
    return json({meta,data:resultRows,pagination:{...pagination,has_more:result.offset+result.limit<result.total}});
  } catch { return error('INVALID_ARCHIVE','Archive could not be processed safely.',502); }
}

export default {
  fetch(request:Request,env:Env) { return handleRequest(request,new HttpArchiveStore(env.ARCHIVE_BASE??DEFAULT_BASE)); }
};
