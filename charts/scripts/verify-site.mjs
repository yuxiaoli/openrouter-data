import fs from 'node:fs/promises';import path from 'node:path';import {validatePayload} from '../src/payload.mjs';import {validateSnapshot} from '../src/contract.mjs';import {createHash} from 'node:crypto';import {renderSvg} from '../src/charts-all.mjs';
import {validateOrigins,aggregateUsage,aggregatePrices,aggregateValuation} from '../src/origins.mjs';
import {echarts,usageOptions,priceOptions,activityOptions,tokenShares,shareOptions,valuationOptions} from '../src/origins-charts.mjs';
import {activityGroups} from '../src/origins-app.mjs';
const root=path.resolve(process.argv[2]||'site-dist');
const body=await fs.readFile(path.join(root,'snapshot.json'),'utf8'),p=validateSnapshot(validatePayload(JSON.parse(body)));
const version=JSON.parse(await fs.readFile(path.join(root,'version.json'),'utf8'));if(version.snapshot!==p.snapshot||version.snapshot_sha256!==createHash('sha256').update(body).digest('hex'))throw Error('Snapshot/version identity mismatch');
const originBody=await fs.readFile(path.join(root,'origins.json'),'utf8'),origins=validateOrigins(JSON.parse(originBody));
for(const key of ['snapshot','collectedAt','archiveRevision','sourceCommit'])if(origins[key]!==p[key])throw Error('Origins/gallery identity mismatch');
if(version.origins_sha256!==createHash('sha256').update(originBody).digest('hex'))throw Error('Origins/version hash mismatch');
const originHtml=await fs.readFile(path.join(root,'origins/index.html'),'utf8');
if(!originHtml.includes('<html')||!originHtml.includes('origins'))throw Error('Missing origins frontend');
for(const file of ['origins.js','origins.css'])await fs.access(path.join(root,'origins',file));
for(const [a,b] of [['source_commit','sourceCommit'],['archive_revision','archiveRevision'],['collected_at','collectedAt']])if(version[a]!==p[b])throw Error('Version provenance mismatch');
let originRenders=0;
for(const mode of ['region','country']){
 const usage=aggregateUsage(origins.usage.rows.filter(r=>r.date===origins.usage.dates.at(-1)),origins.attribution,mode),prices=aggregatePrices(origins.pricing.offers,origins.attribution,mode),days=activityGroups(origins.activity.days,origins.attribution,mode);
 const groups=[...new Map(days.flatMap(d=>d.groups.map(g=>[g.id,g]))).values()];
 for(const options of [usageOptions(usage),shareOptions(tokenShares(usage)),valuationOptions(aggregateValuation(origins.valuation.rows.filter(r=>r.date===origins.usage.dates.at(-1)),origins.attribution,mode)),priceOptions(prices,'prompt'),priceOptions(prices,'completion'),activityOptions(days,groups)]){const chart=echarts.init(null,null,{renderer:'svg',ssr:true,width:800,height:480});try{chart.setOption(options);const svg=chart.renderToSVGString();if(!svg.startsWith('<svg')||/NaN|Infinity|<script|<image/.test(svg))throw Error('Origin chart rendering failed');originRenders++;}finally{chart.dispose();}}
}
const html=await fs.readFile(path.join(root,'index.html'),'utf8');
if(!html.includes('<html')||!html.includes('snapshot'))throw Error('Incomplete chart HTML');
const walk=async dir=>(await Promise.all((await fs.readdir(dir,{withFileTypes:true})).map(async d=>d.isDirectory()?walk(path.join(dir,d.name)):[path.join(dir,d.name)]))).flat();
const files=await walk(root);
for(const file of files){const rel=path.relative(root,file);if(/(?:^|\/)(?:node_modules|\.cache|qa|\.git|runs)(?:\/|$)/.test(rel)||/\.(?:png|py|gz|zip)$/.test(rel)||/gallery-fixture/.test(rel))throw Error('Unsafe build artifact '+rel);}
if(!files.some(p=>p.endsWith('.js')))throw Error('Missing browser script');
for(const chart of p.charts){const svg=renderSvg(chart);if(!svg.startsWith('<svg')||/NaN|Infinity|<script|<image/.test(svg))throw Error('Chart rendering verification failed '+chart.id);}
console.log(JSON.stringify({snapshot:p.snapshot,charts:p.charts.length,files:files.length,staticOnly:true,allFourteenRender:true,originRenders}));
