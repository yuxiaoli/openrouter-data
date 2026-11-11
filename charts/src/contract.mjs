/** Stable, platform-neutral contract consumed by Actions, the Worker and browser. */
export const CHART_IDS=Object.freeze(Array.from({length:14},(_,i)=>String(i+1).padStart(2,'0')));
export const PUBLIC_DATASETS=Object.freeze(['models','providers','embedding_models','image_models','video_models','eu_models','zdr_endpoints','model_count','model_rss','blog_posts','status_incidents','upstream_openapi','docs_index','site_index','endpoints','image_endpoints','public_model_rankings','public_ranking_history','public_performance','public_apps','public_app_rankings','public_model_activity','public_model_apps','public_session_cost','public_task_mix','public_discovery','public_modality_statistics','public_model_observations']);
export const SNAPSHOT_RE=/^\d{4}-\d{2}-\d{2}T\d{6}Z-[a-z0-9]+$/;
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&/(?:Z|[+-]\d{2}:\d{2})$/.test(v);
const nonempty=v=>typeof v==='string'&&v.trim().length>0;
export function validateSnapshot(s){
 const require=(ok,msg)=>{if(!ok)throw new Error(`Invalid chart snapshot: ${msg}`);};
 require(s?.schemaVersion===1,'schemaVersion');require(SNAPSHOT_RE.test(s.snapshot),'snapshot');require(iso(s.collectedAt),'collectedAt');
 require(JSON.stringify(s.chartIds)===JSON.stringify(CHART_IDS),'chartIds');require(Array.isArray(s.charts)&&s.charts.length===14,'14 charts');
 require(PUBLIC_DATASETS.every(k=>Number.isSafeInteger(s.coverage?.[k])&&s.coverage[k]>=0),'28 coverage counts');
 for(let i=0;i<14;i++){const c=s.charts[i];require(c.id===CHART_IDS[i]&&c.snapshot===s.snapshot,'chart identity');require([c.title,c.subtitle,c.notes,c.collectionTime].every(nonempty),'chart copy');require(Array.isArray(c.panels)&&c.panels.length>0&&c.panels.length<=20,'panels');require(Array.isArray(c.datasets)&&c.datasets.every(n=>PUBLIC_DATASETS.includes(n)),'dataset names');require(Array.isArray(c.sourceUrls)&&c.sourceUrls.length===c.datasets.length&&c.sourceUrls.every((url,j)=>url===`https://openrouter-data.pages.dev/api/v1/data?type=${c.datasets[j]}&snapshot=${s.snapshot}`),'source URLs');}
 // JSON must not turn NaN/Infinity into null silently. Null itself is meaningful missing data.
 let nodes=0;const visit=(v,depth)=>{require(++nodes<=200000&&depth<30,'payload complexity');if(typeof v==='number')require(Number.isFinite(v),'finite numbers');else if(Array.isArray(v))v.forEach(x=>visit(x,depth+1));else if(v&&typeof v==='object')Object.values(v).forEach(x=>visit(x,depth+1));};visit(s,0);
 if(s.latestAttempt!==null&&s.latestAttempt!==undefined){require(SNAPSHOT_RE.test(s.latestAttempt.id)&&nonempty(s.latestAttempt.status),'latest attempt');}
 return s;
}
export function freshness(s,now=Date.now()){
 const age=now-Date.parse(s.collectedAt),stale=age>36*3600000;
 const latest=s.latestAttempt,attemptWarning=!!latest&&(latest.status!=='success'||latest.id!==s.snapshot);
 return{stale,ageHours:Math.max(0,age/3600000),attemptWarning,label:stale?'快照已超过 36 小时':'完整快照'};
}
export function filterCharts(charts,query='',category='全部'){
 const needle=query.trim().toLocaleLowerCase('zh-CN');
 return charts.filter(c=>(category==='全部'||CATEGORIES[c.id]===category)&&(!needle||[c.id,c.title,c.subtitle,c.notes,...c.datasets].join(' ').toLocaleLowerCase('zh-CN').includes(needle)));
}
export const CATEGORIES=Object.freeze({'01':'目录与价格','02':'目录与价格','03':'排名与历史','04':'排名与历史','05':'用量与应用','06':'用量与应用','07':'用量与应用','08':'用量与应用','09':'供应与观测','10':'用量与应用','11':'供应与观测','12':'覆盖与内容','13':'排名与历史','14':'覆盖与内容'});
