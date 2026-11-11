"""Local-only numerical oracle using the preserved Python archive/NumPy semantics.

Requires explicit --archive-root and --reference-root, never network access.
No paths or source data are committed. Output belongs in ignored qa/.
"""
import argparse,collections,datetime,importlib.util,json,math,pathlib,sys,os
os.environ.setdefault("MPLCONFIGDIR", "/tmp/openrouter-reference-matplotlib")
import numpy as np
from matplotlib.cbook import boxplot_stats
p=argparse.ArgumentParser();p.add_argument('--archive-root',required=True);p.add_argument('--reference-root',required=True);p.add_argument('--output',default='qa/reference.json');a=p.parse_args()
spec=importlib.util.spec_from_file_location('reference_archive',pathlib.Path(a.reference_root)/'scripts/archive.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
root=pathlib.Path(a.archive_root);index=json.loads((root/'public-index.json').read_text());snap=mod.select_snapshot(index);archive=mod.Archive(root,snap);load=archive.load;m=archive.manifest;reports=archive.reports
positive=lambda v:v is not None and math.isfinite(float(v)) and float(v)>0
def total(d):
 v=[x for x in d.values() if x is not None];return sum(v) if v else None
def epoch(s):
 d=datetime.datetime.fromisoformat(s.replace('Z','+00:00'));d=d.replace(tzinfo=datetime.timezone.utc) if not d.tzinfo else d;return d.timestamp()*1000
def rep(rows,key,kind=None):return min((r for r in rows if r.get('payload',{}).get(key) and (kind is None or r.get('_source',{}).get('kind')==kind)),key=lambda r:(r['model_id']!='openai/gpt-4o',r['model_id']))
def sequence(rows,key,div=1):return [(key(r) if callable(key) else r.get(key))/div if (key(r) if callable(key) else r.get(key)) is not None else None for r in rows]
def counter(values):return collections.Counter(values).most_common()
M=load('models');text=[x for x in M if 'text' in (x.get('architecture') or {}).get('output_modalities',[])];E=load('endpoints');H=load('public_ranking_history');D=load('public_discovery');out={}
authors=counter(x['id'].split('/')[0] for x in M);aa=authors[:9]+[('其他作者',sum(v for _,v in authors[9:]))];bins=[0,32768,131072,262144,1048576,float('inf')]
out['01']=[[m['counts'][n] for n in ['models','eu_models','image_models','embedding_models','video_models']],[v for _,v in counter(v for x in M for v in (x.get('architecture') or {}).get('output_modalities',[]))],[v for _,v in aa],[sum(lo<(x.get('context_length') or 0)<=hi for x in text) for lo,hi in zip(bins,bins[1:])]]
paid=[x for x in text if positive((x.get('pricing') or {}).get('prompt')) and positive((x.get('pricing') or {}).get('completion'))];perf=[x for x in load('public_performance') if positive(x.get('p50_latency')) and positive(x.get('p50_throughput'))]
out['02']=[[[float(x['pricing']['prompt'])*1e6,float(x['pricing']['completion'])*1e6] for x in paid],[[x['p50_latency'],x['p50_throughput']] for x in perf]]
R=load('public_model_rankings');out['03']=[]
for metric,div in zip(['tokens','tokens_excl_byok','requests','spend'],[1e12,1e12,1e8,1]):
 rr=sorted([x for x in R if x['_source'].get('view')=='week' and x['_source'].get('metric')==metric and x.get('model_permaslug')],key=lambda x:x['rankingMetricValue'],reverse=True)[:8];out['03'].append([[x.get('variant_permaslug') or x['model_permaslug'],x['rankingMetricValue']/div] for x in rr])
rr=next(x for x in H if x['_source'].get('section') is None)['payload']['data'];mix=next(x['payload'] for x in H if x['_source'].get('section')=='open-closed');op=[x['ys']['open']/(x['ys']['open']+x['ys']['closed'])*100 if x['ys'].get('open') is not None and x['ys'].get('closed') is not None and x['ys']['open']+x['ys']['closed']>0 else None for x in mix]
out['04']=[[sequence(rr,lambda r:total(r['ys']),1e12)],[op,[100-v if v is not None else None for v in op]]]
mo={x['_source']['routeSegment']:x for x in load('public_modality_statistics') if x['_source']['kind']=='modality_chart'};observed=epoch(reports['public_modality_statistics'].get('observed_at') or reports['public_modality_statistics'].get('collected_at') or m['completed_at']);out['05']=[]
for route in ['text','image','embeddings','rerank','speech','decisions','transcription','video']:
 rr=mo[route]['payload']['metricData']['request'];out['05'].append({'points':[[epoch(r['x']),total(r['ys'])] for r in rr],'incomplete':epoch(rr[-1]['x'])+7*86400000>observed})
T=load('public_task_mix')[0]['payload'];out['06']=[[[x['spendShare']*100,next(t['spendShare'] for t in T['tokens']['macroCategories'] if t['key']==x['key'])*100] for x in T['spend']['macroCategories']],[[x['spendShareOfTotal']*100,next(t['spendShareOfTotal'] for t in T['tokens']['tasks'] if t['tag']==x['tag'])*100] for x in sorted(T['spend']['tasks'],key=lambda r:r['spendShareOfTotal'],reverse=True)]]
apps=load('public_apps')[0]['payload']['globalRankingMap']['week'];ma=rep(load('public_model_apps'),'top_apps');out['07']=[[float(x['total_tokens'])/1e12 for x in sorted(apps,key=lambda x:float(x['total_tokens']),reverse=True)[:12]],[float(x['total_tokens'])/1e9 for x in sorted(ma['payload']['top_apps'],key=lambda x:float(x['total_tokens']),reverse=True)[:12]]]
out['08']=[]
for h in load('public_session_cost')[0]['payload']['harnesses']:
 panel=[]
 for b in ['single','short','core','long']:
  vs=[p['medianUsd'] for model in h['models'] for p in model['points'] if p['bucket']==b and positive(p.get('medianUsd'))];stats=boxplot_stats(vs)[0] if vs else None
  panel.append({'values':vs,'stats':None if stats is None else {'low':stats['whislo'],'q1':stats['q1'],'median':stats['med'],'q3':stats['q3'],'high':stats['whishi'],'n':len(vs)}})
 out['08'].append(panel)
ce=counter(x['provider_name'] for x in E);cz=collections.Counter(x['provider_name'] for x in load('zdr_endpoints'));o=rep(load('public_model_observations'),'buckets','model-uptime-recent');out['09']=[[[v,cz[n]] for n,v in ce[:10]],[sequence(o['payload']['buckets'],k) for k in ['availability','availabilityWithoutRouting']]]
act=rep(load('public_model_activity'),'analytics');rr=sorted(act['payload']['analytics'],key=lambda x:x['date']);out['10']=[[sequence(rr,k) for k in ks] for ks in [['total_prompt_tokens','total_completion_tokens'],['total_native_tokens_cached',lambda r:r['total_byok_prompt_tokens']+r['total_byok_completion_tokens'] if r.get('total_byok_prompt_tokens') is not None and r.get('total_byok_completion_tokens') is not None else None],['count'],['total_tool_calls','requests_with_tool_call_errors']]]
provider=min((x for x in D if x['_source']['kind']=='provider-token-chart' and x['payload'].get('chartData')),key=lambda x:(x['_source']['provider']!='openai',x['_source']['provider']));router=next(x for x in D if x['_source']['kind']=='routers' and x['_source'].get('view')=='week');disc=next(x for x in D if x['_source']['kind']=='discovery')['payload']['modelOfWeek'];out['11']=[[sequence(provider['payload']['chartData'],lambda r:total(r['ys']),1e12)],[sequence(router['payload']['weekly'],lambda r:total(r['ys']),1e9)],[sequence(disc['dailySeries'],lambda r:r.get('tokens',r.get('y')),1e12)]]
from email.utils import parsedate_to_datetime
observed=datetime.datetime.fromisoformat(m['completed_at'].replace('Z','+00:00'));months=[f'{observed.year}-{i:02d}' for i in range(1,observed.month+1)];out['12']=[]
for n in ['model_rss','blog_posts']:
 cc=collections.Counter(parsedate_to_datetime(x['pubDate']).astimezone(datetime.timezone.utc).strftime('%Y-%m') for x in load(n));out['12'].append([cc[month] for month in months])
out['12'].append([parsedate_to_datetime(x['pubDate']).timestamp()*1000 for x in sorted(load('status_incidents'),key=lambda x:parsedate_to_datetime(x['pubDate']))])
B=next(x['payload'] for x in H if x['_source']['kind']=='benchmarks');out['13']=[[x['score'] for x in sorted([r for r in rows if r.get('score') is not None],key=lambda r:r['score'],reverse=True)[:8]] for rows in [B['aaData']['intelligence'],B['valsIndex']['models']]]
I=load('image_models');V=load('video_models');prs=next(x['payload'] for x in D if x['_source']['kind']=='all_providers');keys=['training','trainingOpenRouter','retainsPrompts','canPublish','safetyRetention','requiresUserIDs'];out['14']=[[v for _,v in counter(p for x in M for p in x.get('supported_parameters') or [])[:8]],[v for _,v in counter(p for x in I for p in x.get('supported_parameters') or {})[:8]],[v for _,v in counter(p for x in V for p in x.get('supported_resolutions') or [])],[[sum(((p.get('dataPolicy') or {}).get(k) is val if val is not None else type((p.get('dataPolicy') or {}).get(k)) is not bool) for p in prs) for val in [True,False,None]] for k in keys]]
output=pathlib.Path(a.output);output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps({'snapshot':snap,'numeric':out},ensure_ascii=False,allow_nan=False));print(f'Wrote independent numerical reference for all 14 scopes: {output}')
