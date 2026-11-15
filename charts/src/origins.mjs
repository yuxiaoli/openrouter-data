/** Developer-origin comparison from one already verified archive. No source collection. */
export const ORIGINS_MAX_BYTES = 3 * 1024 * 1024;
const COUNTRIES = {CN:'中国',US:'美国',FR:'法国',DE:'德国',GB:'英国',CA:'加拿大',JP:'日本'};
const REGIONS = {CN:'中国',US:'美国',EUROPE:'欧洲',OTHER:'其他已知国家',MULTI:'跨地域组织',UNKNOWN:'未知归属'};
export function nonnegative(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && value.trim() !== '')) return null;
  const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null;
}
const text = x => typeof x === 'string' && x.length ? x : null;
export function nativeDate(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:[ T]00:00:00(?:\.000)?Z?)?$/.test(value)) throw Error('Unsupported native daily date');
  const day = value.slice(0,10), parsed = new Date(day+'T00:00:00Z');
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0,10) !== day) throw Error('Invalid native daily date');
  return day;
}
export function validateAttribution(map) {
  if (map?.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(map.reviewedAt) || typeof map.definition !== 'string' || !Array.isArray(map.europeCountryCodes) || !map.organizations) throw Error('Invalid attribution map');
  for (const [namespace,org] of Object.entries(map.organizations)) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(namespace) || !text(org.name) || !Array.isArray(org.countryCodes) || !org.countryCodes.length || new Set(org.countryCodes).size !== org.countryCodes.length || !org.countryCodes.every(c=>/^[A-Z]{2}$/.test(c)) || !Array.isArray(org.sources) || !org.sources.length) throw Error('Invalid attribution organization');
    for (const source of org.sources) if (!text(source.title) || !/^https:\/\//.test(source.url) || new URL(source.url).username || new URL(source.url).password) throw Error('Invalid attribution source');
  }
  return map;
}
export function identifyOrigin(identity, map) {
  // Deliberately do not normalize ~ aliases, provider names, or model display names.
  const namespace = typeof identity === 'string' && identity.includes('/') ? identity.split('/')[0] : null;
  return {namespace, originId: namespace && Object.hasOwn(map.organizations,namespace) ? namespace : 'unknown'};
}
export function groupOrigin(originId, map, mode='region') {
  const org = map.organizations[originId];
  if (!org) return {id:'UNKNOWN',label:REGIONS.UNKNOWN};
  if (org.countryCodes.length !== 1) return {id:'MULTI',label:REGIONS.MULTI};
  const code = org.countryCodes[0];
  if (mode === 'country') return {id:code,label:COUNTRIES[code] || code};
  const id = ['CN','US'].includes(code) ? code : map.europeCountryCodes.includes(code) ? 'EUROPE' : 'OTHER';
  return {id,label:REGIONS[id]};
}
function sumKnown(values) {const known=values.filter(v=>v!==null); return known.length ? known.reduce((a,b)=>a+b,0) : null;}
function usageGroup(rows, identity) {
  return {...identity,tokens:sumKnown(rows.map(r=>r.tokens)),promptTokens:sumKnown(rows.map(r=>r.promptTokens)),completionTokens:sumKnown(rows.map(r=>r.completionTokens)),rows:rows.length,knownRows:rows.filter(r=>r.tokens!==null).length,unknownRows:rows.filter(r=>r.tokens===null).length};
}
export function aggregateUsage(rows,map,mode='region') {
  const groups=new Map();
  for(const row of rows){const group=groupOrigin(row.originId,map,mode);if(!groups.has(group.id))groups.set(group.id,{...group,items:[]});groups.get(group.id).items.push(row);}
  return [...groups.values()].map(g=>usageGroup(g.items,{id:g.id,label:g.label})).sort((a,b)=>(b.tokens??-1)-(a.tokens??-1)||a.id.localeCompare(b.id));
}
function priceStats(values) {
  const xs=values.filter(x=>x!==null).sort((a,b)=>a-b),n=xs.length;
  return {count:n,missing:values.length-n,mean:n?xs.reduce((a,b)=>a+b,0)/n:null,median:n?(xs[Math.floor((n-1)/2)]+xs[Math.floor(n/2)])/2:null,min:n?xs[0]:null,max:n?xs[n-1]:null,free:xs.filter(x=>x===0).length};
}
export function aggregatePrices(offers,map,mode='region') {
  const groups=new Map();
  for(const row of offers){const g=groupOrigin(row.originId,map,mode);if(!groups.has(g.id))groups.set(g.id,{...g,items:[]});groups.get(g.id).items.push(row);}
  return [...groups.values()].map(g=>({id:g.id,label:g.label,offers:g.items.length,prompt:priceStats(g.items.map(r=>r.promptUsdPerMillion)),completion:priceStats(g.items.map(r=>r.completionUsdPerMillion))})).sort((a,b)=>b.offers-a.offers||a.id.localeCompare(b.id));
}
function tokenFields(row,metric=false) {
  const promptTokens=nonnegative(row.total_prompt_tokens),completionTokens=nonnegative(row.total_completion_tokens);
  const combined=promptTokens!==null&&completionTokens!==null?promptTokens+completionTokens:null;
  const tokens=metric?nonnegative(row.rankingMetricValue):combined;
  if(metric && tokens!==null && combined!==null && tokens!==combined)throw Error('Token metric disagrees with native components');
  return {promptTokens,completionTokens,tokens};
}
function comparable(row) {return JSON.stringify([row.model,row.date,row.promptTokens,row.completionTokens,row.tokens]);}
function requireTokenUnits(source, fields) {
  if (!fields.every(k=>source?.units?.[k]==='tokens')) throw Error('Missing or contradictory native token units');
}
export function compileUsage(rows,map) {
  const selected=rows.filter(r=>r._source?.view==='day'&&r._source?.metric==='tokens');
  const seen=new Map(),result=[];let duplicateRows=0;
  for(const r of selected){
    requireTokenUnits(r._source,['rankingMetricValue','total_prompt_tokens','total_completion_tokens']);
    const model=text(r.model_permaslug),variant=text(r.variant_permaslug),date=nativeDate(r.date);
    const row={model,variant,date,...identifyOrigin(model,map),...tokenFields(r,true)};
    // A missing native identity is not an alias key: retain every observed row.
    const key=variant&&date?JSON.stringify([variant,date]):null;
    if(key&&seen.has(key)){if(comparable(seen.get(key))!==comparable(row))throw Error('Conflicting daily ranking duplicate');duplicateRows++;continue;}
    if(key)seen.set(key,row);result.push(row);
  }
  return {dates:[...new Set(result.map(r=>r.date))].sort((a,b)=>a===null?1:b===null?-1:a.localeCompare(b)),rows:result,rawRows:selected.length,duplicateRows,missingIdentityRows:result.filter(r=>!r.model||!r.variant).length};
}
export function compilePrices(rows,map) {
  const selected=rows.filter(r=>r.architecture?.output_modalities?.includes('text'));
  const seen=new Map(),offers=[];let aliasRoutes=0;
  for(const r of selected){
    const canonicalSlug=text(r.canonical_slug),route=text(r.id),name=text(r.name)||canonicalSlug||route||'未提供模型名称';
    const price=x=>{const n=nonnegative(x);return n!==null&&Number.isFinite(n*1e6)?n*1e6:null;};
    const promptUsdPerMillion=price(r.pricing?.prompt),completionUsdPerMillion=price(r.pricing?.completion);
    // Only an explicit canonical identity can establish aliases. Missing identity stays unknown.
    const key=canonicalSlug?JSON.stringify([canonicalSlug,promptUsdPerMillion,completionUsdPerMillion]):null;
    if(key&&seen.has(key)){const prev=seen.get(key);if(route&&!prev.routes.includes(route))prev.routes.push(route);aliasRoutes++;continue;}
    const offer={canonicalSlug,name,...identifyOrigin(canonicalSlug,map),routes:route?[route]:[],promptUsdPerMillion,completionUsdPerMillion};
    if(key)seen.set(key,offer);offers.push(offer);
  }
  return {unit:'USD / million tokens',rawRoutes:selected.length,offers,aliasRoutes};
}
export function compileActivity(contexts,map,observedAt) {
  const keys=new Map();let aliasDuplicateRows=0,excludedMissingIdentityRows=0;
  for(const context of contexts){
    if(!Array.isArray(context.payload?.analytics))continue;
    if(context.payload.analytics.length) requireTokenUnits(context._source,['total_prompt_tokens','total_completion_tokens']);
    for(const r of context.payload.analytics){
      const variant=text(r.variant_permaslug),model=text(r.model_permaslug),date=nativeDate(r.date);
      if(!variant||!date){excludedMissingIdentityRows++;continue;}
      const row={model,variant,date,...identifyOrigin(model,map),...tokenFields(r)};
      const key=JSON.stringify([variant,date]),existing=keys.get(key),canonical=context.model_id===variant;
      if(existing){if(comparable(existing.row)!==comparable(row))throw Error('Conflicting native activity alias');aliasDuplicateRows++;existing.canonical ||= canonical;}
      else keys.set(key,{row,canonical});
    }
  }
  const days=new Map();let excludedNoCanonicalRows=0;
  for(const {row,canonical} of keys.values()){
    if(!canonical){excludedNoCanonicalRows++;continue;}
    if(!days.has(row.date))days.set(row.date,new Map());const origins=days.get(row.date);
    if(!origins.has(row.originId))origins.set(row.originId,[]);origins.get(row.originId).push(row);
  }
  return {rawContexts:contexts.length,nativeRows:keys.size-excludedNoCanonicalRows,aliasDuplicateRows,excludedNoCanonicalRows,excludedMissingIdentityRows,days:[...days].sort(([a],[b])=>a.localeCompare(b)).map(([date,origins])=>({date,partial:date===[...days.keys()].sort().at(-1),origins:[...origins].map(([originId,rows])=>usageGroup(rows,{originId}))}))};
}
export function compileOrigins(bundle,map) {
  validateAttribution(map);const m=bundle.manifest,d=bundle.datasets;
  if(m?.status!=='success')throw Error('Origins require complete snapshot');
  const observedAt={};
  for(const [key,id] of Object.entries({models:'models',rankings:'public_model_rankings',activity:'public_model_activity'})){
    const report=m.datasets?.find(r=>r.id===id);
    if(!report||report.status!=='ok'||![undefined,'public'].includes(report.access)||report.data_snapshot&&report.data_snapshot!==m.id||!Array.isArray(d[id])||d[id].length!==report.record_count)throw Error('Origins require same-snapshot public dataset '+id);
    observedAt[key]=report.observed_at||report.collected_at||m.completed_at;
  }
  const result={schemaVersion:1,kind:'developer-origins',snapshot:m.id,collectedAt:m.completed_at,archiveRevision:bundle.archive_revision,sourceCommit:bundle.source_commit,latestAttempt:bundle.latest_attempt??null,provenance:bundle.provenance,observedAt,attribution:map,usage:compileUsage(d.public_model_rankings,map),pricing:compilePrices(d.models,map),activity:compileActivity(d.public_model_activity,map,observedAt.activity)};
  return validateOrigins(result);
}
export function validateOrigins(p) {
  if(p?.schemaVersion!==1||p.kind!=='developer-origins'||!/^\d{4}-\d{2}-\d{2}T\d{6}Z-[a-z0-9]+$/.test(p.snapshot)||!/^[a-f0-9]{40}$/.test(p.archiveRevision)||!/^[a-f0-9]{40}$/.test(p.sourceCommit)||!Number.isFinite(Date.parse(p.collectedAt))||p.provenance?.archiveChecksumsVerified!==true||p.provenance?.fixture_only)throw Error('Invalid origins identity');
  validateAttribution(p.attribution);
  for(const name of ['models','rankings','activity'])if(!Number.isFinite(Date.parse(p.observedAt?.[name])))throw Error('Invalid origins observation time');
  const count=x=>Number.isInteger(x)&&x>=0,number=x=>x===null||typeof x==='number'&&Number.isFinite(x)&&x>=0;
  const origin=r=>r.originId==='unknown'||Object.hasOwn(p.attribution.organizations,r.originId);
  if(!Array.isArray(p.usage?.rows)||!Array.isArray(p.usage.dates)||!count(p.usage.rawRows)||!count(p.usage.duplicateRows)||p.usage.rawRows!==p.usage.rows.length+p.usage.duplicateRows)throw Error('Invalid usage coverage');
  for(const r of p.usage.rows)if(!origin(r)||nativeDate(r.date)!==r.date||!['tokens','promptTokens','completionTokens'].every(k=>number(r[k]))||![r.model,r.variant,r.namespace].every(v=>v===null||typeof v==='string'))throw Error('Invalid usage row');
  const dates=[...new Set(p.usage.rows.map(r=>r.date))].sort((a,b)=>a===null?1:b===null?-1:a.localeCompare(b));
  if(JSON.stringify(dates)!==JSON.stringify(p.usage.dates)||p.usage.missingIdentityRows!==p.usage.rows.filter(r=>!r.model||!r.variant).length)throw Error('Invalid usage dates/identities');
  if(!Array.isArray(p.pricing?.offers)||!count(p.pricing.rawRoutes)||!count(p.pricing.aliasRoutes)||p.pricing.rawRoutes!==p.pricing.offers.length+p.pricing.aliasRoutes||p.pricing.unit!=='USD / million tokens')throw Error('Invalid price coverage');
  for(const r of p.pricing.offers)if(!origin(r)||!number(r.promptUsdPerMillion)||!number(r.completionUsdPerMillion)||!Array.isArray(r.routes)||!r.routes.every(v=>typeof v==='string')||!text(r.name))throw Error('Invalid price offer');
  if(!Array.isArray(p.activity?.days)||!['rawContexts','nativeRows','aliasDuplicateRows','excludedNoCanonicalRows','excludedMissingIdentityRows'].every(k=>count(p.activity[k])))throw Error('Invalid activity coverage');
  let previous='',nativeRows=0;
  for(const day of p.activity.days){if(!day.date||nativeDate(day.date)!==day.date||day.date<=previous||typeof day.partial!=='boolean'||!Array.isArray(day.origins))throw Error('Invalid activity day');previous=day.date;const seen=new Set();for(const r of day.origins){if(!origin(r)||seen.has(r.originId)||!['tokens','promptTokens','completionTokens'].every(k=>number(r[k]))||!['rows','knownRows','unknownRows'].every(k=>count(r[k]))||r.rows!==r.knownRows+r.unknownRows)throw Error('Invalid activity group');seen.add(r.originId);nativeRows+=r.rows;}}
  if(nativeRows!==p.activity.nativeRows)throw Error('Activity row coverage mismatch');
  return p;
}
