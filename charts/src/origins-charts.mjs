import * as echarts from 'echarts/core';
import {BarChart,LineChart} from 'echarts/charts';
import {GridComponent,TooltipComponent,LegendComponent} from 'echarts/components';
import {LegacyGridContainLabel} from 'echarts/features';
import {SVGRenderer} from 'echarts/renderers';
echarts.use([BarChart,LineChart,GridComponent,TooltipComponent,LegendComponent,SVGRenderer,LegacyGridContainLabel]);
export {echarts};
export const palette=['#3167ac','#b88920'];
// Geographic IDs, not rank/order, determine color across usage and trend panels.
export const geographicColors=Object.freeze({CN:'#3167ac',US:'#b88920',FR:'#73813f',DE:'#8672ac',GB:'#278f83',CA:'#b95d83',JP:'#915b37',MULTI:'#269ac2',UNKNOWN:'#7d8793',EUROPE:'#477d42',OTHER:'#cd713e'});
export const geographicColor=id=>Object.hasOwn(geographicColors,id)?geographicColors[id]:geographicColors.UNKNOWN;
export const number=value=>value===null||value===undefined?'未提供':Number(value).toLocaleString('zh-CN',Math.abs(Number(value))>0&&Math.abs(Number(value))<0.0001?{maximumSignificantDigits:7}:{maximumFractionDigits:4});
export const compact=value=>value===null||value===undefined?'未提供':Math.abs(value)>=1e9?(value/1e9).toLocaleString('zh-CN',{maximumFractionDigits:2})+'B':Math.abs(value)>=1e6?(value/1e6).toLocaleString('zh-CN',{maximumFractionDigits:2})+'M':number(value);
const base={animation:false,textStyle:{fontFamily:'Noto Sans CJK JP, system-ui, sans-serif',fontSize:11,color:'#54677d'},grid:{left:14,right:28,top:38,bottom:25,containLabel:true},tooltip:{trigger:'axis',renderMode:'richText',confine:true},xAxis:{type:'value',splitLine:{lineStyle:{color:'#edf0f4'}},axisLabel:{formatter:compact}},yAxis:{type:'category',inverse:true,axisTick:{show:false},axisLine:{show:false},axisLabel:{width:100,overflow:'truncate'}}};
export function usageOptions(rows){return {...base,yAxis:{...base.yAxis,data:rows.map(r=>r.label)},tooltip:{...base.tooltip,formatter:items=>items.map(x=>`${x.name}\n${number(x.value)} tokens`).join('\n')},series:[{name:'已报告 tokens',type:'bar',barMaxWidth:27,data:rows.map(r=>({value:r.tokens,itemStyle:{color:geographicColor(r.id)}}))}]};}
export function priceOptions(rows,field){return {...base,legend:{top:0,data:['算术平均','中位数'],textStyle:{fontSize:11}},yAxis:{...base.yAxis,data:rows.map(r=>r.label)},tooltip:{...base.tooltip,formatter:items=>[items[0]?.name,...items.map(x=>`${x.seriesName}：${number(x.value)} USD / 百万 tokens`)].join('\n')},series:[{name:'算术平均',type:'bar',barMaxWidth:17,itemStyle:{color:palette[0]},data:rows.map(r=>r[field].mean)},{name:'中位数',type:'bar',barMaxWidth:17,itemStyle:{color:palette[1]},data:rows.map(r=>r[field].median)}]};}
export function activityOptions(days,groups){return {...base,grid:{left:8,right:12,top:70,bottom:28,containLabel:true},legend:{type:'scroll',top:0,textStyle:{fontSize:10}},xAxis:{type:'category',data:days.map(d=>d.date+(d.partial?' *':'')),axisLabel:{formatter:v=>v.slice(5),fontSize:10},boundaryGap:false},yAxis:{type:'value',axisLabel:{formatter:compact},splitLine:{lineStyle:{color:'#edf0f4'}}},tooltip:{...base.tooltip,formatter:items=>[items[0]?.name,...items.map(x=>`${x.seriesName}：${number(x.value)} tokens`)].join('\n')},series:groups.map(g=>({name:g.label,type:'line',connectNulls:false,showSymbol:true,symbolSize:5,lineStyle:{width:2,color:geographicColor(g.id)},itemStyle:{color:geographicColor(g.id)},data:days.map(d=>d.groups.find(x=>x.id===g.id)?.tokens??null)}))};}
export function mountChart(host,option,{api=echarts,Observer=globalThis.ResizeObserver}={}){
 let instance,observer;
 try{instance=api.init(host,null,{renderer:'svg'});instance.setOption(option);observer=new Observer(()=>instance.resize());observer.observe(host);return()=>{observer.disconnect();instance.dispose();};}
 catch(error){observer?.disconnect();instance?.dispose();throw error;}
}
