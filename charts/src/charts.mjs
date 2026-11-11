import * as echarts from 'echarts/core';
import {BarChart,LineChart,ScatterChart,CustomChart} from 'echarts/charts';
import {GridComponent,GraphicComponent,MarkAreaComponent} from 'echarts/components';
import {SVGRenderer} from 'echarts/renderers';
echarts.use([BarChart,LineChart,ScatterChart,CustomChart,GridComponent,GraphicComponent,MarkAreaComponent,SVGRenderer]);
export {echarts};
export const THEME={blue:'#3167AC',gold:'#B88920',orange:'#CA713D',dark:'#283E54',text:'#1C2736',muted:'#505A66',grid:'#E4E8ED',axis:'#A3AAB4',box:'#DCE7F3'};
export const FONT='Noto Sans CJK JP';
const size=80/72;
export const dimensions=c=>c.dimensions||(c.id==='03'?[1600,1200]:c.id==='05'?[1360,1360]:[1360,Math.max(960,480*Math.ceil(c.panels.length/2))]);
export function text(x,y,value,font=12,fill=THEME.text,extra={}){return {type:'text',silent:true,x,y,style:{text:value,fontSize:font*size,fontFamily:FONT,fill,lineHeight:font*size*1.55,...extra}};}
export function line(x1,y1,x2,y2,color=THEME.axis,width=1){return {type:'line',silent:true,shape:{x1,y1,x2,y2},style:{stroke:color,lineWidth:width}};}
export function compact(v){const a=Math.abs(v);return a>=1e12?`${+(v/1e12).toPrecision(6)}万亿`:a>=1e8?`${+(v/1e8).toPrecision(6)}亿`:a>=1e4?`${+(v/1e4).toPrecision(6)}万`:`${+v.toPrecision(6)}`;}
export function grids(w,h,nrows,{left,right,top,bottom,wspace,hspace}){
  const gw=(right-left)*w/(2+wspace),gh=(top-bottom)*h/(nrows+(nrows-1)*hspace);
  return Array.from({length:nrows*2},(_,i)=>({left:(left*w)+(i%2)*gw*(1+wspace),top:(1-top)*h+Math.floor(i/2)*gh*(1+hspace),width:gw,height:gh,containLabel:false}));
}
export function base(c){
 const [w,h]=dimensions(c),graphic=[text(.045*w,.035*h,`${c.id}  ${c.title}`,24,THEME.text,{fontWeight:'bold'}),text(.045*w,.079*h,c.subtitle,12.5,'#556171'),line(.045*w,.103*h,.955*w,.103*h,THEME.blue,2*size),text(.045*w,.905*h,c.notes,10.5,'#495563'),text(.045*w,.968*h,'来源：OpenRouter 公开数据 / openrouter-data.pages.dev   |   采集：'+c.collectionTime,10,'#66727E')];
 return {animation:false,backgroundColor:'#fff',textStyle:{fontFamily:FONT,fontSize:12*size,color:THEME.text},graphic,grid:[],xAxis:[],yAxis:[],series:[]};
}
export const axisLabel={showMinLabel:false,showMaxLabel:false,fontFamily:FONT,fontSize:12*size,color:THEME.muted,margin:8};
export const valueAxis={type:'value',axisLine:{show:true,onZero:false,lineStyle:{color:THEME.axis}},axisTick:{show:false},axisLabel,splitLine:{show:true,lineStyle:{color:THEME.grid,width:.7*size}}};
export function title(o,g,s){o.graphic.push(text(g.left,g.top-27,s,15,THEME.text,{fontWeight:'bold'}));}
export function maxNTick(max,n){const power=10**Math.floor(Math.log10(max/n));return [1,1.5,2,2.5,3,4,5,6,8,10].map(x=>x*power).find(x=>x>=max/n)||power*10;}
function barOptions(c,o,w,h){
 o.grid=grids(w,h,2,{left:.245,right:.94,top:.84,bottom:.15,wspace:1.10,hspace:.48});
 c.panels.forEach((p,i)=>{const g=o.grid[i],max=Math.max(...p.rows.map(r=>r.value))*1.2;
  title(o,g,p.title);
  o.xAxis.push({...valueAxis,gridIndex:i,min:0,max,interval:maxNTick(max,4),axisLabel:{...axisLabel,formatter:compact},name:p.unit,nameLocation:'middle',nameGap:28,nameTextStyle:{fontFamily:FONT,fontSize:12*size,color:'#404852'}});
  o.yAxis.push({type:'category',gridIndex:i,inverse:true,data:p.rows.map(r=>r.label),axisLabel:{...axisLabel,showMinLabel:true,showMaxLabel:true,fontSize:10*size,margin:8},axisLine:{show:false},axisTick:{show:false},splitLine:{show:false}});
  o.series.push({type:'bar',xAxisIndex:i,yAxisIndex:i,data:p.rows.map(r=>r.value),barWidth:'68%',itemStyle:{color:THEME.blue},label:{show:true,position:'right',distance:Math.max(...p.rows.map(r=>r.value))/max*g.width*.016,fontFamily:FONT,fontSize:10.5*size,color:THEME.text,formatter:({value})=>value.toFixed(p.decimals)},silent:true});
 });
}
export function rangePad(values){const valid=values.filter(v=>v!==null&&Number.isFinite(v));if(!valid.length)return [0,1];const lo=Math.min(...valid),hi=Math.max(...valid),pad=(hi-lo||Math.abs(lo)||1)*.05;return[lo-pad,hi+pad];}
export function formatDate(ms,year){const s=new Date(ms).toISOString().slice(0,10);return year?s.slice(2):s.slice(5);}
function modalityOptions(c,o,w,h){
 o.grid=grids(w,h,4,{left:.09,right:.94,top:.87,bottom:.13,wspace:.25,hspace:.68});
 c.panels.forEach((p,i)=>{const g=o.grid[i],pts=p.points,first=pts[0].time,last=pts.at(-1).time,step=pts.length>1?last-pts.at(-2).time:604800000,xmax=last+(p.incomplete&&pts.length>1?step*.2:0),[min,max]=rangePad(pts.map(p=>p.value));
  title(o,g,p.title);
  o.graphic.push(text(g.left+g.width-10,g.top+8,p.incomplete?'末点未满周':'末周已结束',10,THEME.orange,{align:'right'}));
  o.xAxis.push({...valueAxis,gridIndex:i,min:first,max:xmax,axisLabel:{show:false},splitLine:{show:false}});
  const indices=[0,...(pts.length>8?[Math.floor(pts.length/4),Math.floor(pts.length/2),Math.floor(3*pts.length/4)]:[]),pts.length-1];
  for(const ix of new Set(indices)){const x=g.left+(pts[ix].time-first)/(xmax-first||1)*g.width;o.graphic.push(text(x,g.top+g.height+8,formatDate(pts[ix].time,new Date(first).getUTCFullYear()!==new Date(last).getUTCFullYear()),12,THEME.muted,{align:'center'}));}
  o.yAxis.push({...valueAxis,gridIndex:i,min,max,splitNumber:4,axisLabel:{...axisLabel,formatter:compact},name:'请求数',nameLocation:'middle',nameGap:42,nameTextStyle:{fontFamily:FONT,fontSize:12*size,color:'#404852'}});
  const common={type:'line',xAxisIndex:i,yAxisIndex:i,silent:true,connectNulls:false,showSymbol:false,lineStyle:{color:THEME.blue,width:2*size},itemStyle:{color:THEME.blue}};
  o.series.push({...common,data:pts.map((q,j)=>[q.time,p.incomplete&&pts.length>1&&j===pts.length-1?null:q.value])});
  if(p.incomplete&&pts.length>1){o.series.push({...common,data:pts.slice(-2).map(q=>[q.time,q.value]),lineStyle:{color:THEME.blue,width:1.6*size,type:'dotted'},markArea:{silent:true,itemStyle:{color:'rgba(202,113,61,0.10)'},data:[[{xAxis:last-step*.42},{xAxis:last+step*.2}]]}});
   if(pts.at(-1).value!==null)o.series.push({type:'scatter',xAxisIndex:i,yAxisIndex:i,silent:true,data:[[last,pts.at(-1).value]],symbolSize:5*size,itemStyle:{color:'#fff',borderColor:THEME.blue,borderWidth:1,opacity:1},z:8});
  }
 });
}
// Stable jitter is cosmetic. Numeric box statistics and individual y values are unchanged.
function random(seed){let a=seed;return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function sessionOptions(c,o,w,h){
 o.grid=grids(w,h,Math.ceil(c.panels.length/2),{left:.09,right:.94,top:.83,bottom:.18,wspace:.23,hspace:.42}).slice(0,c.panels.length);
 const rng=random(42);
 c.panels.forEach((p,i)=>{const g=o.grid[i];title(o,g,p.title);
  const vals=p.buckets.flatMap(b=>b.values),lo=vals.length?Math.min(...vals):.001,hi=vals.length?Math.max(...vals):1,padding=(Math.log10(hi)-Math.log10(lo)||1)*.05;
  if(!vals.length)o.graphic.push(text(g.left+12,g.top+15,'无有效正值；未以零填补',12));
  o.xAxis.push({...valueAxis,gridIndex:i,min:-.5,max:3.5,interval:1,axisLabel:{show:false},splitLine:{show:false}});
  p.buckets.forEach((b,j)=>o.graphic.push(text(g.left+(j+.5)/4*g.width,g.top+g.height+8,`${b.bucket}\nn=${b.values.length}`,12,THEME.muted,{align:'center',lineHeight:15*size})));
  o.yAxis.push({...valueAxis,type:'log',logBase:10,gridIndex:i,min:10**(Math.log10(lo)-padding),max:10**(Math.log10(hi)+padding),axisLabel:{...axisLabel,formatter:v=>`10${[...String(Math.round(Math.log10(v)))].map(x=>({'-':'⁻','0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹'}[x])).join('')}`},name:p.unit,nameLocation:'middle',nameGap:44,nameTextStyle:{fontFamily:FONT,fontSize:12*size,color:'#404852'}});
  // Custom box geometry makes the dark median and linear-space quartiles explicit on a log axis.
  o.series.push({type:'custom',xAxisIndex:i,yAxisIndex:i,silent:true,clip:true,data:p.buckets.flatMap((b,j)=>b.stats?[[j,b.stats.low,b.stats.q1,b.stats.median,b.stats.q3,b.stats.high]]:[]),renderItem:(params,api)=>{
    const x=api.coord([api.value(0),api.value(3)])[0],ys=[1,2,3,4,5].map(k=>api.coord([api.value(0),api.value(k)])[1]),bw=g.width/4*.46,cap=bw*.5;
    return {type:'group',children:[{type:'rect',shape:{x:x-bw/2,y:ys[3],width:bw,height:ys[1]-ys[3]},style:{fill:THEME.box,stroke:THEME.blue,lineWidth:size}},...[[x,ys[0],x,ys[1]],[x,ys[3],x,ys[4]],[x-cap/2,ys[0],x+cap/2,ys[0]],[x-cap/2,ys[4],x+cap/2,ys[4]]].map(([x1,y1,x2,y2])=>({type:'line',shape:{x1,y1,x2,y2},style:{stroke:THEME.blue,lineWidth:size}})),{type:'line',shape:{x1:x-bw/2,y1:ys[2],x2:x+bw/2,y2:ys[2]},style:{stroke:THEME.dark,lineWidth:2*size}}]};
  }});
  const points=p.buckets.flatMap((b,j)=>b.values.map(v=>[j+(rng()*.32-.16),v]));
  o.series.push({type:'scatter',xAxisIndex:i,yAxisIndex:i,silent:true,data:points,symbolSize:Math.sqrt(13)*size,itemStyle:{color:THEME.blue,opacity:.4},z:5});
 });
}
export function chartOptions(chart){const o=base(chart),[w,h]=dimensions(chart);if(chart.id==='03')barOptions(chart,o,w,h);else if(chart.id==='05')modalityOptions(chart,o,w,h);else if(chart.id==='08')sessionOptions(chart,o,w,h);else throw new Error('Chart not in approved prototype');return o;}
export function renderSvg(chart){const[w,h]=dimensions(chart),instance=echarts.init(null,null,{renderer:'svg',ssr:true,width:w,height:h});try{instance.setOption(chartOptions(chart));return instance.renderToSVGString();}finally{instance.dispose();}}
