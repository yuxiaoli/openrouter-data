import {echarts,dimensions,FONT} from './charts.mjs';
import {chartOptions} from './charts-all.mjs';
import {validateSnapshot,freshness,filterCharts,CATEGORIES,PUBLIC_DATASETS} from './contract.mjs';
const $=id=>document.getElementById(id);
const state={snapshot:null,category:'全部',query:'',loading:false,mounts:[],currentChart:null,lastFocus:null,loadNumber:0};
function element(tag,attrs={},text=''){const el=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==='class')el.className=v;else el.setAttribute(k,v);}if(text)el.textContent=text;return el;}
const utc=value=>new Date(value).toISOString().replace('T',' ').replace(/\.\d{3}Z$/,' UTC');
function setNotice(text,kind='info'){$('notice').textContent=text;$('notice').dataset.kind=kind;$('notice').hidden=!text;}
function button(text,click){const b=element('button',{type:'button'},text);b.addEventListener('click',click);return b;}
function mountChart(host,chart,{natural=false}={}){
 const[w,h]=dimensions(chart),viewport=element('div',{class:'chart-viewport'}),stage=element('div',{class:'chart-stage',role:'img','aria-label':`${chart.id} ${chart.title}。${chart.subtitle}。详细数据见下方数据按钮。`});
 host.replaceChildren(viewport);viewport.append(stage);stage.style.width=w+'px';stage.style.height=h+'px';
 const chartInstance=echarts.init(stage,null,{renderer:'svg',width:w,height:h});
 chartInstance.setOption(chartOptions(chart));
 const resize=()=>{const width=host.clientWidth||w,scale=natural?1:Math.min(1,width/w);stage.style.transform=`scale(${scale})`;viewport.style.width=natural?w+'px':'100%';viewport.style.height=h*scale+'px';};
 const observer=new ResizeObserver(resize);observer.observe(host);resize();
 return{dispose(){observer.disconnect();chartInstance.dispose();},setNatural(value){natural=value;resize();},instance:chartInstance};
}
function downloadSvg(chart){
 const [w,h]=dimensions(chart),instance=echarts.init(null,null,{renderer:'svg',ssr:true,width:w,height:h});
 try{instance.setOption(chartOptions(chart));const svg=instance.renderToSVGString();const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'})),a=element('a',{href:url,download:`openrouter-${chart.snapshot}-${chart.id}.svg`});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}finally{instance.dispose();}
}
function updateFreshness(){if(!state.snapshot)return;const s=state.snapshot,f=freshness(s);$('freshness').textContent=f.label;$('freshness').dataset.stale=String(f.stale);$('collected').textContent=utc(s.collectedAt);$('snapshot-id').textContent=s.snapshot;const latest=s.latestAttempt;$('attempt').textContent=latest?`${latest.status} · ${latest.id}`:'未提供';$('attempt-warning').hidden=!f.attemptWarning;$('attempt-warning').textContent=f.attemptWarning?'最近采集尝试未用于此图集。当前 14 张图仍来自上方同一份完整成功快照。':'';}
function renderCoverage(s){const tbody=$('coverage-body');tbody.replaceChildren();for(const[name,n]of PUBLIC_DATASETS.map(name=>[name,s.coverage[name]])){const tr=element('tr');tr.append(element('td',{},name),element('td',{},n.toLocaleString('zh-CN')));tbody.append(tr);}const parts=[`数据快照：${s.snapshot}`,`采集完成：${utc(s.collectedAt)}`];if(s.sourceCommit)parts.push(`构建版本：${s.sourceCommit}`);if(s.provenance?.manifestSha256)parts.push(`清单 SHA-256：${s.provenance.manifestSha256}`);else if(s.provenance?.normalized_manifest_sha256)parts.push(`清单 SHA-256：${s.provenance.normalized_manifest_sha256}`);else if(s.provenance?.manifest_sha256)parts.push(`清单 SHA-256：${s.provenance.manifest_sha256}`);if(s.archiveRevision)parts.push(`归档版本：${s.archiveRevision}`);$('provenance').textContent=parts.join('\n');}
function applyFilters(){const charts=state.snapshot?.charts||[],matched=new Set(filterCharts(charts,state.query,state.category).map(c=>c.id));for(const c of charts){$(`card-${c.id}`).hidden=!matched.has(c.id);$(`nav-${c.id}`).hidden=!matched.has(c.id);}document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===state.category)));$('result-count').textContent=`${matched.size} / 14 张图表`;$('empty').hidden=matched.size!==0;}
let viewerMount=null;
function openViewer(chart){state.currentChart=chart;state.lastFocus=document.activeElement;$('viewer-title').textContent=`${chart.id} ${chart.title}`;$('viewer-notes').textContent=chart.notes;$('natural-size').checked=false;viewerMount?.dispose();$('viewer').showModal();viewerMount=mountChart($('viewer-chart'),chart);}
function closeViewer(){if($('viewer').open)$('viewer').close();}
function renderGallery(s){
 state.mounts.forEach(m=>m.dispose());state.mounts=[];$('cards').replaceChildren();$('chart-nav').replaceChildren();
 for(const chart of s.charts){const card=element('article',{id:`card-${chart.id}`,class:'chart-card'}),head=element('div',{class:'card-heading'}),h=element('h3',{},`${chart.id}  ${chart.title}`),tag=element('span',{class:'category'},CATEGORIES[chart.id]);head.append(h,tag);
  const mount=element('div',{class:'chart-host'}),foot=element('div',{class:'card-actions'}),details=element('details',{class:'chart-data'}),summary=element('summary',{},'查看数值与统计口径'),pre=element('pre');
  // Built on demand to keep initial page light; values remain text, never interpreted as HTML.
  details.addEventListener('toggle',()=>{if(details.open&&!pre.textContent)pre.textContent=JSON.stringify({snapshot:chart.snapshot,notes:chart.notes,panels:chart.panels},null,2);});details.append(summary,pre);
  foot.append(button('放大查看',()=>openViewer(chart)),button('下载 SVG',()=>downloadSvg(chart)));
  const sources=element('details',{class:'chart-sources'});sources.append(element('summary',{},'来源与窗口'));const note=element('p',{},chart.notes);note.style.whiteSpace='pre-line';sources.append(note);for(let i=0;i<chart.datasets.length;i++){sources.append(element('a',{href:chart.sourceUrls[i],target:'_blank',rel:'noopener'},chart.datasets[i]));}
  card.append(head,mount,foot,sources,details);$('cards').append(card);$('chart-nav').append(element('a',{id:`nav-${chart.id}`,href:`#card-${chart.id}`},`${chart.id} ${chart.title}`));
  state.mounts.push(mountChart(mount,chart));
 }
 applyFilters();
}
async function load(){
 if(state.loading)return;state.loading=true;const request=++state.loadNumber;$('retry').disabled=true;$('refresh').disabled=true;$('loading').hidden=false;$('error-panel').hidden=true;setNotice('');
 try{
  const endpoint=document.querySelector('meta[name="snapshot-url"]')?.content||'./snapshot.json';
  const response=await fetch(endpoint,{headers:{Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(20000)});
  if(!response.ok){const err=new Error(response.status===503?'尚无可用的完整快照。请稍后重试。':`读取快照失败（HTTP ${response.status}）。`);err.httpStatus=response.status;throw err;}
  const snapshot=validateSnapshot(await response.json());
  await document.fonts.load(`14px "${FONT}"`);if(!document.fonts.check(`14px "${FONT}"`))throw new Error('图表字体未加载，请重试。');
  if(request!==state.loadNumber)return;
  // Every panel is validated before replacing the page. A rejected update leaves this tab's current view untouched.
  snapshot.charts.forEach(c=>chartOptions(c));
  closeViewer();
  state.snapshot=snapshot;updateFreshness();renderCoverage(snapshot);renderGallery(snapshot);$('gallery').hidden=false;$('snapshot-panel').hidden=false;$('coverage').hidden=false;
  $('last-checked').textContent='本页检查：'+utc(new Date().toISOString());
 }catch(error){
  const message=error.name==='TimeoutError'?'读取超时，请稍后重试。':error.httpStatus?error.message:'无法加载或验证完整图集，请稍后重试。';
  $('error-copy').textContent=message;$('error-panel').hidden=false;
  if(state.snapshot)setNotice('更新未完成，当前页面仍显示已加载的完整快照。','warning');
 }finally{if(request===state.loadNumber){state.loading=false;$('loading').hidden=true;$('retry').disabled=false;$('refresh').disabled=false;}}
}
$('search').addEventListener('input',e=>{state.query=e.target.value;applyFilters();});
document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{state.category=b.dataset.filter;applyFilters();}));
$('clear-filters').addEventListener('click',()=>{state.query='';state.category='全部';$('search').value='';applyFilters();});
$('refresh').addEventListener('click',load);$('retry').addEventListener('click',load);$('viewer-close').addEventListener('click',closeViewer);
$('viewer').addEventListener('close',()=>{viewerMount?.dispose();viewerMount=null;$('viewer-chart').replaceChildren();state.lastFocus?.focus();state.currentChart=null;});
$('viewer').addEventListener('click',event=>{if(event.target===$('viewer')){const r=$('viewer').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeViewer();}});
$('natural-size').addEventListener('change',e=>viewerMount?.setNatural(e.target.checked));
$('viewer-download').addEventListener('click',()=>state.currentChart&&downloadSvg(state.currentChart));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateFreshness();});setInterval(updateFreshness,60000);
load();
