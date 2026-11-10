import { z } from 'zod';
import type { Result, Row } from './contracts.js';

const number = (max: number) => z.string().regex(/^\d+(\.\d+)?$/).transform(Number).refine(n => Number.isFinite(n) && n <= max);
const integer = (min: number, max: number) => z.string().regex(/^\d+$/).transform(Number).refine(n => Number.isSafeInteger(n) && n >= min && n <= max);
const filterString=z.string().min(1).max(300);
const instant=z.string().refine(s=>/^\d{4}-\d{2}-\d{2}(?:T.*(?:Z|[+-]\d\d:\d\d))?$/.test(s)&&Number.isFinite(Date.parse(s))&&(!/^\d{4}-\d{2}-\d{2}$/.test(s)||new Date(s).toISOString().slice(0,10)===s),'Use a real UTC date or an ISO timestamp with timezone.');
export const Query = z.object({
  type: z.string().min(1).optional(), date: z.string().min(1).optional(), snapshot: z.string().min(1).optional(),
  q: z.string().min(1).max(200).optional(), model: z.string().min(1).max(200).optional(),
  author: z.string().min(1).max(200).optional(), provider: z.string().min(1).max(200).optional(),
  input_modality: z.string().min(1).max(200).optional(), output_modality: z.string().min(1).max(200).optional(), parameter: z.string().min(1).max(200).optional(),
  min_context: integer(0, 1e10).optional(), max_prompt_price: number(1e6).optional(),
  window:filterString.optional(),metric:filterString.optional(),view:filterString.optional(),kind:filterString.optional(),section:filterString.optional(),group:filterString.optional(),subcategory:filterString.optional(),modality:filterString.optional(),app:filterString.optional(),
  since:instant.optional(),until:instant.optional(),
  free: z.enum(['true','false']).optional(), sort: z.enum(['id','name','created','published_at','date','context_length','pricing.prompt','rankingMetricValue','count','tokens','total_tokens','p50_latency','p50_throughput','uptime_last_30m','uptime_last_1d']).default('id'),
  order: z.enum(['asc','desc']).default('asc'), limit: integer(1,500).default(100), offset: integer(0,10000000).default(0),
  dimension: z.enum(['author','provider','input_modality','output_modality','parameter','window','metric','view','kind','section','group','subcategory','modality']).optional(),
}).strict().refine(q=>!q.since||!q.until||Date.parse(q.since)<=Date.parse(q.until),'since must be on or before until.');
export type QueryInput = z.infer<typeof Query>;
export function parseQuery(params: URLSearchParams): Result<QueryInput> {
  if ([...params.keys()].some(k => params.getAll(k).length !== 1)) return {ok:false,error:{code:'INVALID_QUERY',message:'Duplicate query parameters are not supported; use comma-separated filter values.',status:400}};
  const parsed = Query.safeParse(Object.fromEntries(params));
  return parsed.success ? {ok:true,value:parsed.data} : {ok:false,error:{code:'INVALID_QUERY',message:parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '),status:400}};
}
const object = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : typeof v === 'string' ? [v] : [];
const identities=(values:unknown[]):string[]=>values.filter((v):v is string|number=>typeof v==='string'||typeof v==='number'&&Number.isFinite(v)).map(String);
export const sourceOf=(r:Row):Row=>object(r._source);
const providerDirectorySlug=(r:Row):unknown=>typeof r.slug==='string'&&!r.slug.includes('/')&&!r.model_id&&!r.model_permaslug&&!r.variant_permaslug&&!r.architecture&&!('best_latency_provider'in r)&&!('best_throughput_provider'in r)?r.slug:undefined;
export const rowId = (r: Row): string => String(r.model_id??r.variant_permaslug??r.model_permaslug??r.permaslug??r.app_id??r.id??r.slug??r.name??(typeof r.guid==='string'?r.guid:object(r.guid)['#text'])??r.link??'');
export function sourceValues(row:Row,key:string):string[] {
  const src=sourceOf(row);
  if(key==='window') { const window=src.window??row.window;return strings(typeof window==='object'?object(window).label:window); }
  if(key==='modality') return strings(src.routeSegment??src.route_segment??row.routeSegment??row.modality);
  return strings(src[key]??row[key]);
}
export function dimensionValues(row: Row, dimension: string): string[] {
  const arch = object(row.architecture);
  if (dimension === 'author') { const id = rowId(row); return id.includes('/') ? [id.split('/')[0]!] : []; }
  if (dimension === 'provider') return [...new Set([row.provider_name,row.provider_slug,row.provider_tag,row.tag,row.best_latency_provider,row.best_throughput_provider,sourceOf(row).provider, ...(typeof row.provider === 'string' ? [row.provider] : []), ...(providerDirectorySlug(row)?[row.slug,row.name]:[])].filter((s):s is string=>typeof s==='string' && !!s))];
  if (dimension === 'parameter') return Array.isArray(row.supported_parameters) ? strings(row.supported_parameters) : Object.keys(object(row.supported_parameters));
  if(['window','metric','view','kind','section','group','subcategory','modality'].includes(dimension)) return sourceValues(row,dimension);
  const key = dimension.replace(/modality$/, 'modalities');
  return strings(arch[key] ?? row[key]);
}
const numeric = (v: unknown): number | undefined => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v)) ? Number(v) : undefined;
const price = (v:unknown):number|undefined => { const n=numeric(v); return n!==undefined && n>=0?n:undefined; };
const rowTimestamp=(r:Row):number|undefined=>{
  const v=r.date??r.published_at??r.pubDate;
  if(typeof v==='string') {const n=Date.parse(v);return Number.isFinite(n)?n:undefined;}
  return typeof r.created==='number'?r.created*1000:undefined;
};
function isFree(row: Row): boolean | undefined {
  const p = object(row.pricing); const prompt = price(p.prompt); const completion = price(p.completion);
  return prompt === undefined || completion === undefined ? undefined : prompt === 0 && completion === 0;
}
export function filteredRows(rows: Row[], query: QueryInput): Row[] {
  const match = (values: string[], filter: string|undefined) => filter === undefined || filter.split(',').some(v=>values.some(s=>s.toLowerCase()===v.trim().toLowerCase()));
  return rows.filter(row => {
    const prompt = price(object(row.pricing).prompt); const context = numeric(row.context_length);
    const timestamp=rowTimestamp(row);
    const until=query.until?Date.parse(query.until)+(/^\d{4}-\d{2}-\d{2}$/.test(query.until)?86400000-1:0):undefined;
    return (!query.q || [rowId(row),row.name,row.description,row.title,row.app_name,object(row.app).name].some(v=>typeof v==='string' && v.toLowerCase().includes(query.q!.toLowerCase())))
      && match(identities([row.model_id,row.id,row.slug,row.model_permaslug,row.variant_permaslug,row.permaslug,sourceOf(row).model_id]),query.model)
      && match(identities([row.app_id,row.id,object(row.app).id]),query.app)
      && ['author','provider','input_modality','output_modality','parameter'].every(d=>match(dimensionValues(row,d),query[d as keyof QueryInput] as string|undefined))
      && ['window','metric','view','kind','section','group','subcategory','modality'].every(d=>match(sourceValues(row,d),query[d as keyof QueryInput] as string|undefined))
      && (query.since===undefined || timestamp!==undefined&&timestamp>=Date.parse(query.since))
      && (until===undefined || timestamp!==undefined&&timestamp<=until)
      && (query.min_context===undefined || context!==undefined && context>=query.min_context)
      && (query.max_prompt_price===undefined || prompt!==undefined && prompt<=query.max_prompt_price)
      && (query.free===undefined || isFree(row)===(query.free==='true'));
  });
}
export function queryRows(rows: Row[], params: URLSearchParams) {
  const query = Query.parse(Object.fromEntries(params));
  const filtered = filteredRows(rows,query);
  const value = (r: Row): string|number|undefined => query.sort==='date'?rowTimestamp(r):query.sort==='published_at' ? numeric(Date.parse(String(r.published_at??r.pubDate??''))) : query.sort==='pricing.prompt' ? price(object(r.pricing).prompt) : !['id','name'].includes(query.sort) ? numeric(r[query.sort]) : query.sort==='id' ? rowId(r) : typeof r.name==='string' ? r.name : typeof r.title==='string'?r.title:undefined;
  filtered.sort((a,b)=>{
    const av=value(a),bv=value(b);
    if(av===undefined && bv!==undefined) return 1;
    if(bv===undefined && av!==undefined) return -1;
    const cmp = typeof av==='number' && typeof bv==='number' ? av-bv : String(av??'').localeCompare(String(bv??''),'en');
    return (query.order==='desc' ? -cmp : cmp) || rowId(a).localeCompare(rowId(b),'en');
  });
  return {data:filtered.slice(query.offset,query.offset+query.limit),total:filtered.length,limit:query.limit,offset:query.offset};
}
export function dimensions(rows: Row[], query: QueryInput) {
  const filtered = filteredRows(rows,query); const counts = new Map<string,number>(); let missing_count=0;
  for(const row of filtered) {
    const canonicalProvider=row.provider_slug??providerDirectorySlug(row)??row.provider_name??row.provider??sourceOf(row).provider;
    const values = new Set(query.dimension==='provider' ? typeof canonicalProvider==='string' && canonicalProvider ? [canonicalProvider] : dimensionValues(row,'provider') : dimensionValues(row,query.dimension!));
    if(!values.size) missing_count++;
    for(const v of values) counts.set(v,(counts.get(v)??0)+1);
  }
  const buckets = [...counts].map(([value,count])=>({value,count})).sort((a,b)=>b.count-a.count || a.value.localeCompare(b.value,'en'));
  return {data:buckets.slice(query.offset,query.offset+query.limit),total:buckets.length,matched_records:filtered.length,missing_count,limit:query.limit,offset:query.offset};
}
