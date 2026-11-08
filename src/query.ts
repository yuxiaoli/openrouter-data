import { z } from 'zod';
import type { Result, Row } from './contracts.js';

const number = (max: number) => z.string().regex(/^\d+(\.\d+)?$/).transform(Number).refine(n => Number.isFinite(n) && n <= max);
const integer = (min: number, max: number) => z.string().regex(/^\d+$/).transform(Number).refine(n => Number.isSafeInteger(n) && n >= min && n <= max);
export const Query = z.object({
  type: z.string().min(1).optional(), date: z.string().min(1).optional(), snapshot: z.string().min(1).optional(),
  q: z.string().min(1).max(200).optional(), model: z.string().min(1).max(200).optional(),
  author: z.string().min(1).max(200).optional(), provider: z.string().min(1).max(200).optional(),
  input_modality: z.string().min(1).max(200).optional(), output_modality: z.string().min(1).max(200).optional(), parameter: z.string().min(1).max(200).optional(),
  min_context: integer(0, 1e10).optional(), max_prompt_price: number(1e6).optional(),
  free: z.enum(['true','false']).optional(), sort: z.enum(['id','name','created','context_length','pricing.prompt']).default('id'),
  order: z.enum(['asc','desc']).default('asc'), limit: integer(1,500).default(100), offset: integer(0,10000000).default(0),
  dimension: z.enum(['author','provider','input_modality','output_modality','parameter']).optional(),
}).strict();
export type QueryInput = z.infer<typeof Query>;
export function parseQuery(params: URLSearchParams): Result<QueryInput> {
  if ([...params.keys()].some(k => params.getAll(k).length !== 1)) return {ok:false,error:{code:'INVALID_QUERY',message:'Duplicate query parameters are not supported; use comma-separated filter values.',status:400}};
  const parsed = Query.safeParse(Object.fromEntries(params));
  return parsed.success ? {ok:true,value:parsed.data} : {ok:false,error:{code:'INVALID_QUERY',message:parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '),status:400}};
}
const object = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : typeof v === 'string' ? [v] : [];
export const rowId = (r: Row): string => String(r.model_id ?? r.id ?? r.slug ?? r.name ?? (typeof r.guid==='string'?r.guid:object(r.guid)['#text']) ?? r.link ?? '');
export function dimensionValues(row: Row, dimension: string): string[] {
  const arch = object(row.architecture);
  if (dimension === 'author') { const id = rowId(row); return id.includes('/') ? [id.split('/')[0]!] : []; }
  if (dimension === 'provider') return [...new Set([row.provider_name,row.provider_slug,row.provider_tag,row.tag, ...(typeof row.provider === 'string' ? [row.provider] : []), ...(typeof row.slug==='string' && !row.model_id ? [row.slug,row.name] : [])].filter((s):s is string=>typeof s==='string' && !!s))];
  if (dimension === 'parameter') return Array.isArray(row.supported_parameters) ? strings(row.supported_parameters) : Object.keys(object(row.supported_parameters));
  const key = dimension.replace(/modality$/, 'modalities');
  return strings(arch[key] ?? row[key]);
}
const numeric = (v: unknown): number | undefined => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v)) ? Number(v) : undefined;
function isFree(row: Row): boolean | undefined {
  const p = object(row.pricing); const prompt = numeric(p.prompt); const completion = numeric(p.completion);
  return prompt === undefined || completion === undefined ? undefined : prompt === 0 && completion === 0;
}
export function filteredRows(rows: Row[], query: QueryInput): Row[] {
  const match = (values: string[], filter: string|undefined) => filter === undefined || filter.split(',').some(v=>values.some(s=>s.toLowerCase()===v.trim().toLowerCase()));
  return rows.filter(row => {
    const prompt = numeric(object(row.pricing).prompt); const context = numeric(row.context_length);
    return (!query.q || [rowId(row),row.name,row.description,row.title].some(v=>typeof v==='string' && v.toLowerCase().includes(query.q!.toLowerCase())))
      && match([String(row.model_id ?? row.id ?? '')],query.model)
      && ['author','provider','input_modality','output_modality','parameter'].every(d=>match(dimensionValues(row,d),query[d as keyof QueryInput] as string|undefined))
      && (query.min_context===undefined || context!==undefined && context>=query.min_context)
      && (query.max_prompt_price===undefined || prompt!==undefined && prompt<=query.max_prompt_price)
      && (query.free===undefined || isFree(row)===(query.free==='true'));
  });
}
export function queryRows(rows: Row[], params: URLSearchParams) {
  const query = Query.parse(Object.fromEntries(params));
  const filtered = filteredRows(rows,query);
  const value = (r: Row): string|number|undefined => query.sort==='pricing.prompt' ? numeric(object(r.pricing).prompt) : ['created','context_length'].includes(query.sort) ? numeric(r[query.sort]) : query.sort==='id' ? rowId(r) : typeof r.name==='string' ? r.name : undefined;
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
    const canonicalProvider=row.provider_slug??row.slug??row.provider_name??row.provider;
    const values = new Set(query.dimension==='provider' ? typeof canonicalProvider==='string' && canonicalProvider ? [canonicalProvider] : [] : dimensionValues(row,query.dimension!));
    if(!values.size) missing_count++;
    for(const v of values) counts.set(v,(counts.get(v)??0)+1);
  }
  const buckets = [...counts].map(([value,count])=>({value,count})).sort((a,b)=>b.count-a.count || a.value.localeCompare(b.value,'en'));
  return {data:buckets.slice(query.offset,query.offset+query.limit),total:buckets.length,matched_records:filtered.length,missing_count,limit:query.limit,offset:query.offset};
}
