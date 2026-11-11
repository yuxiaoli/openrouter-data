"""Render the fourteen original Chinese chart scopes from one complete archive snapshot.

Requires the Noto Sans CJK font. Incompatible upstream structures fail the build;
publication is performed only after this process and site validation succeed.
"""
import os,json,math,re,datetime,collections,textwrap,csv
os.environ['MPLCONFIGDIR']='/tmp/mpl-openrouter'
import numpy as np
import matplotlib;matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib import font_manager as fm
from matplotlib.ticker import FuncFormatter,MaxNLocator
from matplotlib.patches import Patch
from snapshot import load, reports, manifest
from pathlib import Path
OUT=Path(os.environ.get('OPENROUTER_OUTPUT', 'dist/charts'));OUT.mkdir(parents=True, exist_ok=True)
FONT='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc';fm.fontManager.addfont(FONT)
plt.rcParams.update({'font.family':fm.FontProperties(fname=FONT).get_name(),'font.size':12,'axes.unicode_minus':False,'axes.spines.top':False,'axes.spines.right':False,'axes.edgecolor':'#A3AAB4','axes.labelcolor':'#404852','text.color':'#1C2736','xtick.color':'#505A66','ytick.color':'#505A66','axes.titleweight':'bold','axes.titlesize':15,'figure.facecolor':'white','axes.facecolor':'white','savefig.facecolor':'white'})
BLUE='#3167AC';GOLD='#B88920';ORANGE='#CA713D';OLIVE='#73813F';PINK='#BB6183';GRAY='#ABB3BE';DARK='#283E54';COLORS=[BLUE,GOLD,ORANGE,OLIVE,PINK]
SNAP=manifest['id'];TIME=manifest['started_at']+' – '+manifest['completed_at'];BASE='https://openrouter-data.pages.dev/api/v1/data'
META=[]
def dt(s):
 value=datetime.datetime.fromisoformat(s.replace('Z','+00:00'))
 return value.astimezone(datetime.timezone.utc).replace(tzinfo=None) if value.tzinfo else value
OBSERVED=dt(manifest['completed_at'])
def observed(dataset):
 r=reports[dataset]
 return dt(r.get('observed_at') or r.get('collected_at') or manifest['completed_at'])
def incomplete(xs, days=7, dataset=None):
 return bool(xs) and xs[-1]+datetime.timedelta(days=days) > (observed(dataset) if dataset else OBSERVED)
def bucket_note(xs, days=7, dataset=None):
 return ('末桶 '+xs[-1].strftime('%Y-%m-%d')+' 尚未完整；不能将下降直接解释为需求下滑。') if incomplete(xs,days,dataset) else '返回的末桶周期在采集前已结束。'
def positive(x):
 try:return x is not None and math.isfinite(float(x)) and float(x)>0
 except (ValueError,TypeError):return False
def representative(rows, field, kind=None):
 candidates=[r for r in rows if r.get('payload',{}).get(field) and (kind is None or r.get('_source',{}).get('kind')==kind)]
 if not candidates:raise ValueError(f'No usable representative for {field} / {kind}')
 return min(candidates,key=lambda r:(r['model_id']!='openai/gpt-4o',r['model_id']))
def series_sum(values):
 valid=[v for v in values if v is not None]
 return sum(valid) if valid else np.nan

def source_url(ds):return f'{BASE}?type={ds}&snapshot={SNAP}'
def compact(v,pos=None):
 if abs(v)>=1e12:return f'{v/1e12:g}万亿'
 if abs(v)>=1e8:return f'{v/1e8:g}亿'
 if abs(v)>=1e4:return f'{v/1e4:g}万'
 return f'{v:g}'
def nice(v):
 if v>=1e12:return f'{v/1e12:.2f}万亿'
 if v>=1e8:return f'{v/1e8:.2f}亿'
 if v>=1e4:return f'{v/1e4:.1f}万'
 return f'{v:,.0f}'
def header(fig,num,title,sub):
 fig._chart_title=title;fig._chart_subtitle=sub
 fig.text(.045,.965,f'{num:02d}  {title}',fontsize=24,weight='bold',va='top')
 fig.text(.045,.921,sub,fontsize=12.5,color='#556171',va='top')
 fig.add_artist(plt.Line2D([.045,.955],[.897,.897],transform=fig.transFigure,color=BLUE,lw=2))
def finish(fig,num,slug,datasets,note):
 fig.text(.045,.095,note,fontsize=10.5,color='#495563',va='top',linespacing=1.55)
 fig.text(.045,.020,'来源：OpenRouter 公开数据 / openrouter-data.pages.dev   |   采集：'+TIME,fontsize=10,color='#66727E',va='bottom')
 path=OUT/f'{num:02d}_{slug}.png';fig.savefig(path,dpi=165);plt.close(fig)
 META.append({'file':path.name,'title':fig._chart_title,'subtitle':fig._chart_subtitle,'datasets':datasets,'source_urls':[source_url(x) for x in datasets],'snapshot':SNAP,'collection_time':TIME,'observed_at':{name:reports[name].get('observed_at',reports[name].get('collected_at')) for name in datasets},'windows':{name:reports[name].get('window') for name in datasets},'notes':note})
def style(ax,xgrid=False):
 ax.set_axisbelow(True);ax.grid(axis='x' if xgrid else 'y',color='#E4E8ED',lw=.7);ax.tick_params(length=0,pad=7)
 if xgrid:ax.spines['left'].set_visible(False)
def bars(ax,labels,vals,title,unit='',color=BLUE,fmt=None):

 if not vals:raise ValueError(f'No chart data: {title}')
 y=np.arange(len(vals));ax.barh(y,vals,color=color,height=.68);ax.set_yticks(y,labels);ax.invert_yaxis();style(ax,True);ax.set_title(title,loc='left',pad=16);ax.set_xlabel(unit)
 if vals:
  mx=max(vals);ax.set_xlim(0,mx*1.2 if mx else 1)
  for i,v in enumerate(vals):ax.text(v+mx*.016,i,fmt(v) if fmt else nice(v),va='center',fontsize=10.5)
 ax.xaxis.set_major_locator(MaxNLocator(4));ax.xaxis.set_major_formatter(FuncFormatter(compact))
def dates(ax,x,partial=True,monthly=False,days=7,dataset=None):
 if not x:raise ValueError('Required time series is empty')
 ticks=[x[0]]
 if len(x)>8:
  for i in [len(x)//4,len(x)//2,3*len(x)//4]:ticks.append(x[i])
 ticks.append(x[-1]);ax.set_xticks(sorted(set(ticks)));ax.xaxis.set_major_formatter(mdates.DateFormatter('%m-%d' if x[0].year==x[-1].year else '%y-%m-%d'));ax.set_xlim(x[0],x[-1]);style(ax)
 if partial and len(x)>1 and incomplete(x,days,dataset):
  step=x[-1]-x[-2]
  for ln in list(ax.lines):
   if len(ln.get_xdata())==len(x):
    yy=list(ln.get_ydata());col=ln.get_color();ln.set_data(x[:-1],yy[:-1]);ax.plot(x[-2:],yy[-2:],color=col,lw=1.6,ls=':');ax.plot(x[-1],yy[-1],marker='o',mfc='white',mec=col,ms=5,zorder=5)
  ax.axvspan(x[-1]-step*.42,x[-1]+step*.2,color=ORANGE,alpha=.10)
  ax.set_xlim(x[0],x[-1]+step*.2)
  ax.plot([],[],color=ORANGE,ls=':',marker='o',mfc='white',label='空心末点：未完整周期')
def label(s,width=30):
 return '\n'.join(textwrap.wrap(s,width=width,break_long_words=False,break_on_hyphens=True))
def model_label(row):
 s=row.get('variant_permaslug') or row.get('model_permaslug') or row.get('model') or row.get('id','')
 return label(s,36)
M=load('models');E=load('endpoints');R=load('public_model_rankings');H=load('public_ranking_history');D=load('public_discovery');MO=load('public_modality_statistics');P=load('public_performance')
# Validate structural chart inputs before writing any output.
for name, records in [('models',M),('endpoints',E),('public_model_rankings',R),('public_ranking_history',H),('public_discovery',D),('public_modality_statistics',MO),('public_performance',P)]:
 if not isinstance(records,list) or not records:raise ValueError(f'Required chart dataset is empty or malformed: {name}')
 if not all(isinstance(row,dict) for row in records):raise ValueError(f'Expected object records in {name}')
# 1 Catalogue
fig,axs=plt.subplots(2,2,figsize=(17,12));fig.subplots_adjust(left=.15,right=.945,top=.84,bottom=.16,hspace=.52,wspace=.43)
header(fig,1,'模型目录与能力覆盖','当前公开目录快照；目录条目、模型作者、输出能力与上下文长度')
ns=['models','eu_models','image_models','embedding_models','video_models'];names=['全模态目录','EU 目录','独立图像目录','独立嵌入目录','独立视频目录'];bars(axs[0,0],names,[len(load(n)) for n in ns],'各目录返回的条目','条目数')
out=collections.Counter(v for x in M for v in (x.get('architecture') or {}).get('output_modalities') or []);out=out.most_common();bars(axs[0,1],[x[0] for x in out],[x[1] for x in out],'全模态目录：输出能力','支持该输出类型的条目')
a=collections.Counter(x['id'].split('/')[0] for x in M);top=a.most_common(9);top.append(('其他作者',sum(a.values())-sum(v for k,v in top)));bars(axs[1,0],[x[0] for x in top],[x[1] for x in top],'模型作者：前 9 名与其他','条目数')
textmodels=[x for x in M if 'text' in ((x.get('architecture') or {}).get('output_modalities') or [])];ctx=[(x.get('context_length') or 0) for x in textmodels];bins=[0,32768,131072,262144,1048576,float('inf')];counts=[sum(lo<c<=hi for c in ctx) for lo,hi in zip(bins,bins[1:])];bars(axs[1,1],['≤32K','32K–128K','128K–256K','256K–1M','>1M'],counts,'文本输出模型：上下文长度','条目数（K=1,024；M=1,048,576）',color=GOLD)
finish(fig,1,'catalogue',['models','providers','embedding_models','image_models','video_models','eu_models','model_count'],'全模态目录与独立目录可重叠，不能相加；多输出模型可计入多个输出类型。\n作者来自模型 ID 前缀，非推理供应商。上下文图仅纳入文本输出模型的正值。')
# 2 prices and performance
fig,axs=plt.subplots(1,2,figsize=(17,10));fig.subplots_adjust(left=.09,right=.94,top=.81,bottom=.22,wspace=.30)
header(fig,2,'目录价格与公开性能分布','每个点是一个模型条目；双对数坐标保留较大跨度，不能据此推断模型质量')
paid=[x for x in textmodels if positive((x.get('pricing') or {}).get('prompt')) and positive((x.get('pricing') or {}).get('completion'))];px=[float(x['pricing']['prompt'])*1e6 for x in paid];py=[float(x['pricing']['completion'])*1e6 for x in paid]
ax=axs[0];ax.scatter(px,py,s=26,alpha=.45,color=BLUE,edgecolors='none');ax.set_xscale('log');ax.set_yscale('log');style(ax);ax.set_xlabel('输入价（USD / 百万 tokens）');ax.set_ylabel('输出价（USD / 百万 tokens）');ax.set_title(f'文本输出模型目录价格 · {len(paid)} 条',loc='left');ax.text(.03,.97,f'不含零价、负值和缺失价；未计缓存等费用',transform=ax.transAxes,va='top',fontsize=10)
valid=[x for x in P if positive(x.get('p50_latency')) and positive(x.get('p50_throughput'))];ax=axs[1];ax.scatter([x['p50_latency'] for x in valid],[x['p50_throughput'] for x in valid],s=28,color=GOLD,alpha=.6,edgecolors='none');ax.set_xscale('log');ax.set_yscale('log');style(ax);ax.set_xlabel('p50_latency（上游原始值）');ax.set_ylabel('p50_throughput（上游原始值）');ax.set_title(f'公开性能观测 · {len(valid)} 条',loc='left');ax.text(.03,.97,'单位与测量窗口均未声明',transform=ax.transAxes,va='top',fontsize=11,weight='bold')
finish(fig,2,'price_performance',['models','public_performance'],'左图是目录报价，不是账单或实际平均成本。右图未擅自标成毫秒、秒或 tokens/s，也不用于跨窗口结论。\n性能观测保留全部有效正值；公开样本不是整个平台或所有模型。')
# 3 weekly rankings
fig,axs=plt.subplots(2,2,figsize=(20,15));fig.subplots_adjust(left=.245,right=.94,top=.84,bottom=.15,wspace=1.10,hspace=.48)
ranking_dates=set()
header(fig,3,'同一周窗口的模型排名','固定 view=week；四种指标分别排序，模型版本与变体不合并')
for ax,metric,title,unit,div,fmt in zip(axs.flat,['tokens','tokens_excl_byok','requests','spend'],['Tokens 前 8','排除 BYOK 的 tokens 前 8','请求数前 8','spend 指标原始值前 8'],['万亿 tokens','万亿 tokens','亿次请求','原始值：单位未声明'],[1e12,1e12,1e8,1],[lambda v:f'{v:.2f}',lambda v:f'{v:.2f}',lambda v:f'{v:.2f}',lambda v:f'{v:.4f}']):
 rows=sorted([x for x in R if x['_source'].get('view')=='week' and x['_source'].get('metric')==metric and x.get('model_permaslug')],key=lambda x:x['rankingMetricValue'],reverse=True)[:8]
 ranking_dates.update(x['date'] for x in rows)
 bars(ax,[model_label(x) for x in rows],[x['rankingMetricValue']/div for x in rows],title,unit,fmt=fmt);ax.tick_params(axis='y',labelsize=10);ax.set_title(title,loc='left',pad=18)
if len(ranking_dates)!=1:raise ValueError('Weekly ranking panels do not share a single record date')
finish(fig,3,'model_rankings',['public_model_rankings'],f"入选记录 date = {next(iter(ranking_dates))}；week 的精确起止未声明，不与日榜/月榜或当前未完整周图混合。\nspend 仅展示原始排名指标，不能读成美元或直接乘 100 当作支出份额。BYOK 指自带密钥。")
# 4 history
fig,axs=plt.subplots(2,1,figsize=(17,11));fig.subplots_adjust(left=.10,right=.94,top=.83,bottom=.18,hspace=.43)
header(fig,4,'公开历史趋势与开放属性构成','使用完整返回序列；历史序列来自本次抓取，并非本项目在过去逐日采集')
x=next(x for x in H if x['_source'].get('section') is None);rows=x['payload']['data'];xs=[dt(x['x']) for x in rows];ys=[series_sum(x['ys'].values()) for x in rows]
ax=axs[0];ax.plot(xs,np.array(ys)/1e12,color=BLUE,lw=2);dates(ax,xs,dataset='public_ranking_history');ax.set_title('公开模型历史图：展示系列之和（含 Others）',loc='left');ax.set_ylabel('上游原始值 / 10¹²');ax.text(.02,.90,'ys 单位未声明，不等同于已确认的全平台 token 总量',transform=ax.transAxes,fontsize=11)
rows=next(x['payload'] for x in H if x['_source'].get('section')=='open-closed');xs=[dt(x['x']) for x in rows];op=[x['ys']['open']/(x['ys']['open']+x['ys']['closed'])*100 if x['ys'].get('open') is not None and x['ys'].get('closed') is not None and x['ys']['open']+x['ys']['closed']>0 else np.nan for x in rows];cl=[100-v for v in op]
ax=axs[1];ax.plot(xs,op,color=BLUE,lw=2,label='open');ax.plot(xs,cl,color=GOLD,lw=2,ls='--',label='closed');dates(ax,xs,dataset='public_ranking_history');ax.set_ylim(0,100);ax.set_ylabel('当期展示值占比（%）');ax.set_title('open / closed：各期原始值归一化占比',loc='left');ax.legend(loc='upper left',frameon=False,ncol=3)
finish(fig,4,'historical_trends',['public_ranking_history'],'占比由 open / (open + closed) 计算，保留上游分类，不将 open 自动解释为特定开源许可证。\n'+bucket_note(xs,7,'public_ranking_history'))
# 5 modalities
fig,axs=plt.subplots(4,2,figsize=(17,17));fig.subplots_adjust(left=.09,right=.94,top=.87,bottom=.13,hspace=.68,wspace=.25)
header(fig,5,'八类模态的公开请求趋势','各面板时间范围与纵轴独立；展示模型系列与 Others 求和，单位统一为请求数')
cn={'text':'文本','image':'图像','embeddings':'嵌入','rerank':'重排序','speech':'语音生成','decisions':'决策','transcription':'语音转写','video':'视频'}
modality_rows={x['_source']['routeSegment']:x for x in MO if x['_source']['kind']=='modality_chart'}
if not all(k in modality_rows for k in cn):raise ValueError('Required modality chart route missing')
for ax,x in zip(axs.flat,[modality_rows[k] for k in cn]):
 route=x['_source']['routeSegment'];rows=x['payload']['metricData']['request'];xs=[dt(y['x']) for y in rows];ys=[series_sum(y['ys'].values()) for y in rows]
 ax.plot(xs,ys,color=BLUE,lw=2);dates(ax,xs,dataset='public_modality_statistics');ax.yaxis.set_major_formatter(FuncFormatter(compact));ax.set_ylabel('请求数');ax.set_title(cn[route]+f'  ·  {len(rows)} 个周桶',loc='left');ax.text(.98,.94,('末点未满周' if incomplete(xs,7,'public_modality_statistics') else '末周已结束'),transform=ax.transAxes,ha='right',va='top',fontsize=10,color=ORANGE)
finish(fig,5,'modality_requests',['public_modality_statistics'],'仅使用 metricData.request；图像请求不等于生成图像张数，不同模态的 generated 单位不可相加。\n各模态公开历史长度不同，未返回的更早日期未补零。空心末点仅标记采集时尚未结束的周，勿据此判断近期下滑。')
# 6 task mix all categories + tasks
T=load('public_task_mix')[0]['payload'];fig=plt.figure(figsize=(17,16));gs=fig.add_gridspec(2,1,height_ratios=[1,3.7],left=.30,right=.91,top=.86,bottom=.14,hspace=.35);ax=fig.add_subplot(gs[0]);
header(fig,6,'任务分类：支出份额与 token 份额',f"上游窗口：支出 {T['spend']['windowDays']} 天 / tokens {T['tokens']['windowDays']} 天；{len(T['spend']['macroCategories'])} 个大类、{len(T['spend']['tasks'])} 个细分任务")
labels=[{'code':'代码 Code','data':'数据 Data','agent':'智能体 Agent','general':'通用 General'}.get(x['key'],x.get('label',x['key'])) for x in T['spend']['macroCategories']];sp=[x['spendShare']*100 for x in T['spend']['macroCategories']];to=[next(t['spendShare'] for t in T['tokens']['macroCategories'] if t['key']==x['key'])*100 for x in T['spend']['macroCategories']];y=np.arange(len(labels));ax.barh(y-.18,sp,.32,color=BLUE,label='支出份额');ax.barh(y+.18,to,.32,color=GOLD,label='token 份额');ax.set_yticks(y,labels);ax.invert_yaxis();ax.set_xlim(0,max(sp+to)*1.2);ax.set_xlabel('占对应样本总体的百分比（%）');style(ax,True);ax.legend(loc='lower left',bbox_to_anchor=(0,1.01),ncol=2,frameon=False)
for i,(s,t) in enumerate(zip(sp,to)):ax.text(s+.4,i-.18,f'{s:.1f}',va='center',fontsize=10);ax.text(t+.4,i+.18,f'{t:.1f}',va='center',fontsize=10)
ax=fig.add_subplot(gs[1]);sr={x['tag']:x['spendShareOfTotal']*100 for x in T['spend']['tasks']};tr={x['tag']:x['spendShareOfTotal']*100 for x in T['tokens']['tasks']};tags=sorted(sr,key=sr.get,reverse=True);y=np.arange(len(tags));ax.hlines(y,[sr[t] for t in tags],[tr[t] for t in tags],color='#BEC5CE',lw=2);ax.scatter([sr[t] for t in tags],y,color=BLUE,s=42,label='支出份额');ax.scatter([tr[t] for t in tags],y,color=GOLD,s=42,marker='s',label='token 份额');ax.set_yticks(y,tags);ax.invert_yaxis();ax.set_xlim(0,max(list(sr.values())+list(tr.values()))*1.2);ax.set_xlabel('占对应样本总体的百分比（%）');ax.set_title('按支出份额排序；连线仅表示两种份额之差',loc='left',pad=16);style(ax,True);ax.tick_params(axis='y',labelsize=11)
finish(fig,6,'task_mix',['public_task_mix'],'两个分母不同，份额差不能直接解释为同一任务的单位成本。tokens 对象沿用 spendShare 字段名，按父对象含义读取。\n上游只给 windowDays，未给精确起止；这里不推造绝对支出、token 总量或缺失流量。')
# 7 Apps
A=load('public_apps')[0]['payload'];apps=A['globalRankingMap']['week'];top=sorted(apps,key=lambda x:float(x['total_tokens']),reverse=True)[:12]
MA=representative(load('public_model_apps'),'top_apps');mat=sorted(MA['payload']['top_apps'],key=lambda x:float(x['total_tokens']),reverse=True)[:12]
fig,axs=plt.subplots(1,2,figsize=(18,11));fig.subplots_adjust(left=.21,right=.93,top=.83,bottom=.18,wspace=.72)
header(fig,7,'公开应用用量','全局周榜与单模型应用样本分开呈现，不混合统计窗口')
bars(axs[0],[label(x['app']['title'],28) for x in top],[float(x['total_tokens'])/1e12 for x in top],'全局返回周榜：tokens 前 12','万亿 tokens',fmt=lambda v:f'{v:.2f}')
bars(axs[1],[label(x['app']['title'],27) for x in mat],[float(x['total_tokens'])/1e9 for x in mat],f"{MA['model_id']}：{len(mat)} 个应用",'十亿 tokens',color=GOLD,fmt=lambda v:f'{v:.2f}')
finish(fig,7,'applications',['public_apps','public_app_rankings','public_model_apps'],f"左侧从 marketplace 的 {len(apps)} 条周榜记录中选取；右侧为 {MA['model_id']} 的有界 top_apps 返回，榜单聚合起止未明确声明。\n两侧不是相同分母，不作跨图大小比较；应用目录、分类榜和全局榜存在重叠，均不代表所有私人应用。")
# 8 Session costs
S=load('public_session_cost')[0]['payload'];nh=len(S['harnesses']);
if not nh:raise ValueError('Session cost harnesses missing')
fig,axs=plt.subplots(math.ceil(nh/2),2,figsize=(17,max(12,6*math.ceil(nh/2))),squeeze=False);fig.subplots_adjust(left=.09,right=.94,top=.83,bottom=.18,hspace=.42,wspace=.23)
header(fig,8,'公开会话成本：各模型中位数的分布',f"{S['windowDays']} 天窗口，windowEnd = {S['windowEnd']}；纵轴为 USD，对数刻度")
rng=np.random.default_rng(42);buckets=['single','short','core','long']
for ax,h in zip(axs.flat,S['harnesses']):
 vals=[[p['medianUsd'] for m in h['models'] for p in m['points'] if p['bucket']==b and positive(p.get('medianUsd'))] for b in buckets]
 bp=ax.boxplot(vals,positions=np.arange(4),widths=.46,showfliers=False,patch_artist=True,medianprops={'color':DARK,'linewidth':2},boxprops={'facecolor':'#DCE7F3','edgecolor':BLUE},whiskerprops={'color':BLUE},capprops={'color':BLUE})
 for i,vs in enumerate(vals):ax.scatter(i+rng.uniform(-.16,.16,len(vs)),vs,s=13,color=BLUE,alpha=.4,zorder=3)
 ax.set_yscale('log');ax.set_xticks(range(4),[f'{b}\nn={len(v)}' for b,v in zip(buckets,vals)]);ax.set_ylabel('模型会话成本中位数（USD）');ax.set_title(h['label']+f" · {len(h['models'])} 个模型条目",loc='left');style(ax)
for ax in list(axs.flat)[nh:]:ax.set_visible(False)
finish(fig,8,'session_cost',['public_session_cost'],'每点是一个模型在该会话桶的 medianUsd；箱体描述这些模型中位数的分布，不是所有会话的合并成本分布。\n保留上游 single/short/core/long 名称，未猜测桶边界；样本量不同且没有会话权重，不能据此判断哪个工具更省钱。')
# 9 Providers + observation
fig,axs=plt.subplots(2,1,figsize=(18,13));fig.subplots_adjust(left=.23,right=.94,top=.85,bottom=.18,hspace=.47)
header(fig,9,'供应商端点与可用性观测','端点目录是供给覆盖；近期可用性为单模型公开观测，不是服务保证')
ce=collections.Counter(x['provider_name'] for x in E);z=load('zdr_endpoints');cz=collections.Counter(x['provider_name'] for x in z);top=ce.most_common(10);names=[x[0] for x in top];y=np.arange(len(names));ax=axs[0];ax.barh(y-.18,[ce[n] for n in names],.32,color=BLUE,label='全模态端点目录');ax.barh(y+.18,[cz[n] for n in names],.32,color=GOLD,label='独立 ZDR 目录');ax.set_yticks(y,names);ax.invert_yaxis();ax.set_xlabel('端点记录数');ax.set_title('全模态端点数最多的 10 家供应商',loc='left');style(ax,True);ax.legend(frameon=False,ncol=2,loc='lower right')
O=load('public_model_observations');o=representative(O,'buckets','model-uptime-recent');rows=o['payload']['buckets'];xs=[dt(x['timestamp']) for x in rows];ax=axs[1];
for k,c,ls in [('availability',BLUE,'-'),('availabilityWithoutRouting',GOLD,'--')]:ax.plot(xs,[x[k] if x.get(k) is not None else np.nan for x in rows],color=c,ls=ls,lw=1.6,label=k)
ax.set_title(o['model_id']+'：近期公开桶（纵轴局部范围）',loc='left');ax.set_ylabel('上游原始值（单位未声明）');dates(ax,xs,False);ax.xaxis.set_major_formatter(mdates.DateFormatter('%m-%d\n%H:%M'));ax.legend(frameon=False,loc='lower left',ncol=2)
finish(fig,9,'providers_availability',['providers','endpoints','image_endpoints','zdr_endpoints','public_model_observations'],f"两种端点目录独立采集，不把 ZDR 数直接当作精确匹配子集。全部端点目录 {len(E):,} 条，图像专用端点 {len(load('image_endpoints')):,} 条。\n公开端点 latency/throughput 缺失值不以 0 代替；可用性原值未转换成百分比，也不推断因果。")
# 10 activity
act=representative(load('public_model_activity'),'analytics');rows=sorted(act['payload']['analytics'],key=lambda x:x['date']);xs=[dt(x['date']) for x in rows]
fig,axs=plt.subplots(2,2,figsize=(18,12));fig.subplots_adjust(left=.10,right=.95,top=.83,bottom=.18,wspace=.26,hspace=.45)
header(fig,10,'单模型活动：'+act['model_id'],f"{len(rows)} 个公开日桶：{xs[0]:%Y-%m-%d} 至 {xs[-1]:%Y-%m-%d}；保留返回模型口径")
specs=[('输入与输出 tokens',[('total_prompt_tokens','输入',BLUE,'-'),('total_completion_tokens','输出',GOLD,'--')],'tokens'),('缓存与 BYOK tokens',[('total_native_tokens_cached','缓存',BLUE,'-'),('byok','BYOK 输入+输出',GOLD,'--')],'tokens'),('请求量',[('count','请求数',BLUE,'-')],'请求数'),('工具相关计数',[('total_tool_calls','工具调用数',BLUE,'-'),('requests_with_tool_call_errors','带工具错误的请求数',GOLD,'--')],'计数（定义不同）')]
for ax,(title,ss,unit) in zip(axs.flat,specs):
 for key,lab,c,ls in ss:
  vals=[(x['total_byok_prompt_tokens']+x['total_byok_completion_tokens'] if x.get('total_byok_prompt_tokens') is not None and x.get('total_byok_completion_tokens') is not None else np.nan) if key=='byok' else (x.get(key) if x.get(key) is not None else np.nan) for x in rows];ax.plot(xs,vals,color=c,ls=ls,lw=2,label=lab)
 dates(ax,xs,days=1,dataset='public_model_activity');ax.yaxis.set_major_formatter(FuncFormatter(compact));ax.set_ylabel(unit);ax.set_title(title,loc='left');ax.legend(frameon=False,loc='upper left',fontsize=9,bbox_to_anchor=(0,1.005),ncol=1)
finish(fig,10,'model_activity',['public_model_activity','public_model_apps'],bucket_note(xs,1,'public_model_activity')+'缓存、BYOK、输入/输出存在交叉，图中不相加为“总用量”。\n工具调用数和带错误的请求数分母不同，不把两者相除作为失败率。本图是单模型实例，不外推为平台整体。')
# 11 provider, routers + discovery
fig,axs=plt.subplots(3,1,figsize=(18,14));fig.subplots_adjust(left=.10,right=.94,top=.86,bottom=.15,hspace=.44)
header(fig,11,'供应商、路由器与发现数据','不同来源分别展示；不把供应商、路由器和模型计数相加')
x=min((x for x in D if x['_source']['kind']=='provider-token-chart' and x['payload'].get('chartData')),key=lambda x:(x['_source']['provider']!='openai',x['_source']['provider']));rr=x['payload']['chartData'];xs=[dt(x['x']) for x in rr];ys=[series_sum(x['ys'].values()) for x in rr];ax=axs[0];ax.plot(xs,np.array(ys)/1e12,lw=2,color=BLUE);dates(ax,xs,days=1,dataset='public_discovery');ax.set_title(x['_source']['provider']+' 供应商：公开展示系列之和（含 Others）',loc='left');ax.set_ylabel('万亿 tokens / 日桶')
x=next(x for x in D if x['_source']['kind']=='routers' and x['_source'].get('view')=='week');rr=x['payload']['weekly'];xs=[dt(x['x']) for x in rr];ys=[series_sum(x['ys'].values()) for x in rr];ax=axs[1];ax.plot(xs,np.array(ys)/1e9,lw=2,color=GOLD);dates(ax,xs,dataset='public_discovery');ax.set_title('公开路由器系列合计',loc='left');ax.set_ylabel('十亿 tokens / 周桶')
x=next(x for x in D if x['_source']['kind']=='discovery')['payload']['modelOfWeek'];rr=x['dailySeries'];xs=[dt(y.get('date',y.get('x'))) for y in rr];ys=[y.get('tokens',y.get('y')) for y in rr];ax=axs[2];ax.plot(xs,np.array(ys)/1e12,lw=2,color=OLIVE);dates(ax,xs,days=1,dataset='public_discovery');ax.set_title('发现页 modelOfWeek：'+x['variantPermaslug'],loc='left');ax.set_ylabel('万亿 tokens / 日桶')
finish(fig,11,'provider_router_discovery',['public_discovery','public_model_observations'],'供应商图为公开有界展示序列，含 Others，不代表已核实的全部供应商流量。路由器曲线包含返回的所有系列。\n日/周末桶仅在采集时尚未结束时标为空心；发现页日序列截至实际返回日期。各图时间跨度与尺度不同。')
# 12 content and coverage
from email.utils import parsedate_to_datetime
fig=plt.figure(figsize=(18,14));gs=fig.add_gridspec(3,2,height_ratios=[1.1,1.4,1.3],left=.07,right=.95,top=.86,bottom=.15,hspace=.60,wspace=.25)
header(fig,12,'内容更新与数据覆盖核实',f"{sum(bool(manifest['counts'].get(k)) for k in reports if k!='authenticated_data')} 类公开数据有返回；公开数据不能解释为个人用量")
for j,n in enumerate(['model_rss','blog_posts']):
 rows=load(n);counts=collections.Counter(parsedate_to_datetime(x['pubDate']).astimezone(datetime.timezone.utc).strftime('%Y-%m') for x in rows);months=[f'{OBSERVED.year}-{i:02d}' for i in range(1,OBSERVED.month+1)];ax=fig.add_subplot(gs[0,j]);ax.bar(range(len(months)),[counts.get(m,0) for m in months],color=BLUE);ax.set_xticks(range(len(months)),[f'{i+1}月'+('*' if i+1==OBSERVED.month else '') for i in range(len(months))]);ax.set_title((f'{OBSERVED.year} 年：当前模型 RSS 的发布日期' if j==0 else f'{OBSERVED.year} 年：当前博客 RSS 的发布日期'),loc='left');ax.set_ylabel('当前 feed 中的条目数');style(ax)
ax=fig.add_subplot(gs[1,:]);incs=sorted(load('status_incidents'),key=lambda x:parsedate_to_datetime(x['pubDate']));ds=[parsedate_to_datetime(x['pubDate']).astimezone(datetime.timezone.utc).replace(tzinfo=None) for x in incs];labs=[label(x['title'],62) for x in incs];y=np.arange(len(incs));ax.scatter(ds,y,color=GOLD,s=65);ax.set_yticks(y,labs);ax.invert_yaxis();ax.set_title(f'状态 RSS：本次返回的 {len(incs)} 条事件',loc='left');ax.set_xticks([min(ds)+(max(ds)-min(ds))*i/3 for i in range(4)]);ax.xaxis.set_major_formatter(mdates.DateFormatter('%m-%d'));ax.grid(axis='x',color='#E4E8ED');ax.set_xlim(min(ds)-datetime.timedelta(days=2),max(ds)+datetime.timedelta(days=2));ax.tick_params(axis='y',labelsize=10);ax.set_position([.40,.395,.52,.205])
ax=fig.add_subplot(gs[2,:]);ax.axis('off')
group_specs=[
 ('目录',['models','providers','embedding_models','image_models','video_models','eu_models','model_count'],'模型、供应商、嵌入、图像、视频、EU、模型计数'),
 ('性能与观测',['endpoints','image_endpoints','zdr_endpoints','public_performance','public_model_observations'],'端点、图像端点、ZDR、公开性能、模型观测'),
 ('排名',['public_model_rankings','public_app_rankings','public_modality_statistics'],'模型榜、应用榜、多模态统计'),
 ('用量与公开聚合',['public_ranking_history','public_apps','public_model_activity','public_model_apps','public_session_cost','public_task_mix','public_discovery'],'历史、应用市场、模型活动/应用、会话成本、任务、发现'),
 ('内容与文档',['model_rss','blog_posts','status_incidents','upstream_openapi','docs_index','site_index'],'模型 RSS、博客、事件、OpenAPI、文档索引、站点索引')]
groups=[(title,f"{sum(bool(manifest['counts'].get(k)) for k in names)} / {len(names)}",desc) for title,names,desc in group_specs]
for i,(g,c,desc) in enumerate(groups):
 yy=.96-i*.2;ax.text(.02,yy,g,weight='bold',fontsize=13);ax.text(.22,yy,c,color=BLUE,weight='bold',fontsize=13);ax.text(.34,yy,desc,fontsize=11)
finish(fig,12,'content_coverage',['model_rss','blog_posts','status_incidents','upstream_openapi','docs_index','site_index'],'带 * 月份为截至采集时的部分月份；模型 RSS 只含当前可见模型，不能据此重建历史发布总数。事件 feed 是有界窗口。\n文档三类为规范/索引，不硬造业务趋势。覆盖数指数据集有记录，不表示每个字段、模型或私人流量都完整。')
# 13 Benchmarks
B=next(x['payload'] for x in H if x['_source']['kind']=='benchmarks')
fig,axs=plt.subplots(1,2,figsize=(20,12));fig.subplots_adjust(left=.28,right=.94,top=.82,bottom=.19,wspace=1.2)
header(fig,13,'公开基准评分：两种量表分别查看','保留评测名称与推理配置；只展示本次返回的对应评分前 8 项')
for ax,rows,title,name,c in [(axs[0],B['aaData']['intelligence'],'aaData / intelligence','aa_name',BLUE),(axs[1],B['valsIndex']['models'],'Vals Index · v'+B['valsIndex']['benchmark_version'],'vals_model_label',GOLD)]:
 rows=sorted([x for x in rows if x.get('score') is not None],key=lambda x:x['score'],reverse=True)[:8]
 bars(ax,[label(x[name],31) for x in rows],[x['score'] for x in rows],title,'原量表 score',color=c,fmt=lambda v:f'{v:.2f}');ax.tick_params(axis='y',labelsize=11)
finish(fig,13,'benchmarks',['public_ranking_history'],'两种评分采用不同量表，不能跨面板相减、平均或视为统一“能力分”。仅代表此基准的返回样本与配置。\n未补齐缺失评分；其他基准视图仍在归档中。基准测量日期/窗口未声明，采集时间不等于评测发生时间。')
# 14 feature coverage
fig,axs=plt.subplots(2,2,figsize=(18,13));fig.subplots_adjust(left=.20,right=.94,top=.83,bottom=.17,hspace=.52,wspace=.68)
header(fig,14,'接口能力与供应商公开政策','能力按当前目录条目计数；政策来自公开 provider 详情，并非合规审计')
c=collections.Counter(p for x in M for p in (x.get('supported_parameters') or []));top=c.most_common(8);bars(axs[0,0],[x[0] for x in top],[x[1] for x in top],'模型参数：出现最多的 8 项','支持该参数的模型条目')
I=load('image_models');c=collections.Counter(p for x in I for p in (x.get('supported_parameters') or {}));top=c.most_common(8);bars(axs[0,1],[x[0] for x in top],[x[1] for x in top],'图像专用接口：参数覆盖',f'{len(I)} 个条目中的支持数')
V=load('video_models');c=collections.Counter(p for x in V for p in (x.get('supported_resolutions') or []));pairs=sorted(c.items(),key=lambda p:p[1],reverse=True);bars(axs[1,0],[x[0] for x in pairs],[x[1] for x in pairs],'视频专用接口：分辨率覆盖',f'{len(V)} 个条目中的支持数')
prs=next(x['payload'] for x in D if x['_source']['kind']=='all_providers');keys=['training','trainingOpenRouter','retainsPrompts','canPublish','safetyRetention','requiresUserIDs'];labels=['training','trainingOpenRouter','retainsPrompts','canPublish','safetyRetention','requiresUserIDs'];ax=axs[1,1];y=np.arange(len(keys));left=np.zeros(len(keys))
for val,lab,c,hatch in [(True,'true',BLUE,None),(False,'false','#CCD9E9','//'),(None,'未知/未声明',GRAY,'..')]:
 vs=[sum(((p.get('dataPolicy') or {}).get(k) is val if val is not None else type((p.get('dataPolicy') or {}).get(k)) is not bool) for p in prs) for k in keys];ax.barh(y,vs,left=left,color=c,height=.65,label=lab,hatch=hatch,edgecolor='white',linewidth=.5)
 for i,v in enumerate(vs):
  if v>=5:ax.text(left[i]+v/2,i,str(v),ha='center',va='center',fontsize=10,color='white' if val is True else DARK)
 left+=vs
ax.set_yticks(y,labels);ax.invert_yaxis();ax.set_xlim(0,len(prs));ax.set_title(f'{len(prs)} 条公开供应商详情：政策字段',loc='left');ax.set_xlabel('供应商详情记录数');style(ax,True);ax.legend(loc='lower left',bbox_to_anchor=(0,-.30),frameon=False,ncol=3,fontsize=10)
finish(fig,14,'capabilities_policies',['models','image_models','video_models','public_discovery'],f"同一模型可支持多个参数/分辨率，不能把各条相加当作独立模型数。provider 详情 {len(prs)} 条与供应商目录 {len(load('providers'))} 条口径不同。\n政策字段保留原名与 true/false；false 只表示该字段被报告为 false，不表示全面隐私保障或特定法律认证。")

with (OUT/"sources_and_scope.json").open("w", encoding="utf-8") as f:
 json.dump({"snapshot":SNAP,"collection_time":TIME,"charts":META,"dataset_counts":manifest["counts"]},f,ensure_ascii=False,indent=2)
