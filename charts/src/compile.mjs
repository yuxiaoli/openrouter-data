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
/** Validate a native record-date string without normalizing or rewriting it. */
function rankingDateStatus(value) {
  if(value===null||value===undefined||(typeof value==='string'&&!value.trim()))return 'missing';
  if(typeof value!=='string')return 'invalid';
  const match=/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(value);
  if(!match)return 'invalid';
  const [,year,month,day,hour,minute,second,zone]=match;
  const y=Number(year),m=Number(month),d=Number(day);
  const leap=y%4===0&&(y%100!==0||y%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(m<1||m>12||d<1||d>days[m-1]||(hour!==undefined&&(Number(hour)>23||Number(minute)>59||Number(second)>59)))return 'invalid';
  if(zone&&zone!=='Z'){
    const offset=zone.slice(1).replace(':','');
    if(Number(offset.slice(0,2))>23||Number(offset.slice(2))>59)return 'invalid';
  }
  return 'valid';
}
function summarizeRankingDates(rows) {
  const recordDates=[...new Set(rows.filter(r=>r.dateStatus==='valid').map(r=>r.date))];
  const missingDateCount=rows.filter(r=>r.dateStatus==='missing').length;
  const invalidDateCount=rows.filter(r=>r.dateStatus==='invalid').length;
  return {recordDates,missingDateCount,invalidDateCount,mixedRecordDates:recordDates.length>1,
    recordDate:recordDates.length===1&&!missingDateCount&&!invalidDateCount?recordDates[0]:null};
}
export function compileRankings(rows,manifest) {
  const chart=base('03','公开模型周榜','同一采集快照，固定 view=week；保留逐条记录 date，模型版本与变体不合并',DATASETS[0],manifest);
  const specs=[['tokens','Tokens 前 8','万亿 tokens',1e12,2],['tokens_excl_byok','排除 BYOK 的 tokens 前 8','万亿 tokens',1e12,2],['requests','请求数前 8','亿次请求',1e8,2],['spend','spend 指标原始值前 8','原始值：单位未声明',1,4]];
  chart.panels=specs.map(([metric,title,unit,divisor,decimals])=>{
    const selected=rows.filter(r=>r._source?.view==='week'&&r._source?.metric===metric&&r.model_permaslug);
    if (selected.some(r=>!finite(r.rankingMetricValue))) throw new Error('Non-finite ranking value');
    const top=selected.sort((a,b)=>b.rankingMetricValue-a.rankingMetricValue).slice(0,8);
    if (!top.length) throw new Error(`Empty ranking metric ${metric}`);
    const rankedRows=top.map(r=>{
      const date=r.date===undefined?null:r.date,dateStatus=rankingDateStatus(date);
      const dateLabel=dateStatus==='valid'?`date = ${date}`:dateStatus==='missing'?'date 未提供':'date 无效（原值保留在数值详情）';
      return {label:r.variant_permaslug||r.model_permaslug||r.model||r.id||'',value:r.rankingMetricValue/divisor,rawValue:r.rankingMetricValue,date,dateStatus,dateLabel};
    });
    return {metric,title,unit,divisor,decimals,rows:rankedRows,...summarizeRankingDates(rankedRows)};
  });
  Object.assign(chart,summarizeRankingDates(chart.panels.flatMap(p=>p.rows)));
  const dateSummary=chart.recordDate!==null?`均为 ${chart.recordDate}`:`含 ${chart.recordDates.length} 种有效值`;
  const missing=chart.missingDateCount?`；缺失 ${chart.missingDateCount} 条`:'';
  const invalid=chart.invalidDateCount?`；无效 ${chart.invalidDateCount} 条`:'';
  chart.notes=`记录 date ${dateSummary}${missing}${invalid}；逐条见模型标签。week 精确起止未声明，不假定相同起止。\nspend 仅展示原始排名指标，不能读成美元或直接乘 100 当作支出份额。BYOK 指自带密钥。`;
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
