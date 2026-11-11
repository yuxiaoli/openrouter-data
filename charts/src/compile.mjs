/** Pure chart reduction. No network, platform APIs, secrets or Node imports. */
export const DATASETS = ['public_model_rankings', 'public_modality_statistics', 'public_session_cost'];
export const MODALITIES = { text:'文本', image:'图像', embeddings:'嵌入', rerank:'重排序', speech:'语音生成', decisions:'决策', transcription:'语音转写', video:'视频' };
export const BUCKETS = ['single','short','core','long'];
const DAY = 86400000;
export function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
export function positive(v) { return v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v)>0; }
export function timestamp(v) {
  if (typeof v !== 'string') throw new Error('Timestamp must be a string');
  const t = Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(v) ? v : v.replace(' ', 'T')+'Z');
  if (!Number.isFinite(t)) throw new Error('Invalid UTC timestamp');
  return t;
}
export function sumNullable(values) {
  const present = values.filter(v => v !== null && v !== undefined);
  if (present.some(v => !finite(v))) throw new Error('Invalid numeric series value');
  return present.length ? present.reduce((a,b)=>a+b,0) : null;
}
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const f=(sorted.length-1)*p, lo=Math.floor(f), hi=Math.ceil(f);
  return sorted[lo] + (sorted[hi]-sorted[lo])*(f-lo);
}
export function boxStats(values) {
  if (values.some(v=>!finite(v)||v<=0)) throw new Error('Box values must be finite positive numbers');
  const s=[...values].sort((a,b)=>a-b);
  if (!s.length) return null;
  const q1=percentile(s,.25), median=percentile(s,.5), q3=percentile(s,.75), iqr=q3-q1;
  const low=s.find(v=>v>=q1-1.5*iqr), high=s.findLast(v=>v<=q3+1.5*iqr);
  // Matplotlib cbook.boxplot_stats: use the quartile if no observation lies within the fence.
  return {low:low===undefined||low>q1?q1:low,q1,median,q3,high:high===undefined||high<q3?q3:high,n:s.length};
}
function base(id,title,subtitle,dataset,manifest) {
  const report=manifest.datasets.find(r=>r.id===dataset);
  if (!report || report.status!=='ok' || ![undefined,'public'].includes(report.access)) throw new Error('Dataset is not complete/public');
  return {id,title,subtitle,datasets:[dataset],snapshot:manifest.id,collectionTime:manifest.started_at+' – '+manifest.completed_at,
    observedAt:report.observed_at||report.collected_at||manifest.completed_at, window:report.window||null,
    sourceUrls:[`https://openrouter-data.pages.dev/api/v1/data?type=${dataset}&snapshot=${manifest.id}`]};
}
export function compileRankings(rows,manifest) {
  const chart=base('03','同一周窗口的模型排名','固定 view=week；四种指标分别排序，模型版本与变体不合并',DATASETS[0],manifest);
  const specs=[['tokens','Tokens 前 8','万亿 tokens',1e12,2],['tokens_excl_byok','排除 BYOK 的 tokens 前 8','万亿 tokens',1e12,2],['requests','请求数前 8','亿次请求',1e8,2],['spend','spend 指标原始值前 8','原始值：单位未声明',1,4]];
  const dates=new Set();
  chart.panels=specs.map(([metric,title,unit,divisor,decimals])=>{
    const selected=rows.filter(r=>r._source?.view==='week'&&r._source?.metric===metric&&r.model_permaslug);
    if (selected.some(r=>!finite(r.rankingMetricValue))) throw new Error('Non-finite ranking value');
    const top=selected.sort((a,b)=>b.rankingMetricValue-a.rankingMetricValue).slice(0,8);
    if (!top.length) throw new Error(`Empty ranking metric ${metric}`);
    return {metric,title,unit,divisor,decimals,rows:top.map(r=>{dates.add(r.date);return {label:r.variant_permaslug||r.model_permaslug||r.model||r.id||'',value:r.rankingMetricValue/divisor,rawValue:r.rankingMetricValue};})};
  });
  if(dates.size!==1) throw new Error('Weekly panels do not share one record date');
  chart.recordDate=[...dates][0];
  chart.notes=`入选记录 date = ${chart.recordDate}；week 的精确起止未声明，不与日榜/月榜或当前未完整周图混合。\nspend 仅展示原始排名指标，不能读成美元或直接乘 100 当作支出份额。BYOK 指自带密钥。`;
  return chart;
}
export function compileModalities(rows,manifest) {
  const chart=base('05','八类模态的公开请求趋势','各面板时间范围与纵轴独立；展示模型系列与 Others 求和，单位统一为请求数',DATASETS[1],manifest);
  const routes=Object.fromEntries(rows.filter(r=>r._source?.kind==='modality_chart').map(r=>[r._source.routeSegment,r]));
  chart.panels=Object.entries(MODALITIES).map(([route,label])=>{
    const rr=routes[route]?.payload?.metricData?.request;
    if(!Array.isArray(rr)||!rr.length) throw new Error(`Missing modality ${route}`);
    const points=rr.map(r=>({time:timestamp(r.x),value:sumNullable(Object.values(r.ys)),date:r.x}));
    if(points.some((p,i)=>i>0&&p.time<=points[i-1].time)) throw new Error('Nonincreasing modality times');
    const last=points.at(-1), incomplete=last.time+7*DAY>timestamp(chart.observedAt);
    return {route,title:`${label}  ·  ${points.length} 个周桶`,unit:'请求数',bucketDays:7,points,incomplete};
  });
  chart.notes='仅使用 metricData.request；图像请求不等于生成图像张数，不同模态的 generated 单位不可相加。\n各模态公开历史长度不同，未返回的更早日期未补零。空心末点仅标记采集时尚未结束的周，勿据此判断近期下滑。';
  return chart;
}
export function compileSessionCosts(rows,manifest) {
  const s=rows[0]?.payload;
  if(!s?.harnesses?.length) throw new Error('Session cost harnesses missing');
  const chart=base('08','公开会话成本：各模型中位数的分布',`${s.windowDays} 天窗口，windowEnd = ${s.windowEnd}；纵轴为 USD，对数刻度`,DATASETS[2],manifest);
  chart.windowDays=s.windowDays;chart.windowEnd=s.windowEnd;
  chart.panels=s.harnesses.map(h=>({title:`${h.label} · ${h.models.length} 个模型条目`,label:h.label,modelCount:h.models.length,unit:'模型会话成本中位数（USD）',scale:'log',buckets:BUCKETS.map(bucket=>{
    const values=h.models.flatMap(m=>m.points.filter(p=>p.bucket===bucket&&positive(p.medianUsd)).map(p=>Number(p.medianUsd)));
    return {bucket,values,stats:boxStats(values)};
  })}));
  chart.notes='每点是一个模型在该会话桶的 medianUsd；箱体描述这些模型中位数的分布，不是所有会话的合并成本分布。\n保留上游 single/short/core/long 名称，未猜测桶边界；样本量不同且没有会话权重，不能据此判断哪个工具更省钱。';
  return chart;
}
export function compileSnapshot({manifest,datasets,archiveRevision,sourceCommit}) {
  if(manifest.status!=='success') throw new Error('Only a complete-success snapshot is allowed');
  const charts=[compileRankings(datasets[DATASETS[0]],manifest),compileModalities(datasets[DATASETS[1]],manifest),compileSessionCosts(datasets[DATASETS[2]],manifest)];
  return {schemaVersion:1,prototype:true,snapshot:manifest.id,archiveRevision,sourceCommit,collectedAt:manifest.completed_at,chartIds:charts.map(c=>c.id),charts};
}
