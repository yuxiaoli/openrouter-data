import fs from 'node:fs/promises';import path from 'node:path';import {validatePayload} from '../src/payload.mjs';import {validateSnapshot} from '../src/contract.mjs';import {createHash} from 'node:crypto';import {renderSvg} from '../src/charts-all.mjs';
const root=path.resolve(process.argv[2]||'site-dist');
const body=await fs.readFile(path.join(root,'snapshot.json'),'utf8'),p=validateSnapshot(validatePayload(JSON.parse(body)));
const version=JSON.parse(await fs.readFile(path.join(root,'version.json'),'utf8'));if(version.snapshot!==p.snapshot||version.snapshot_sha256!==createHash('sha256').update(body).digest('hex'))throw Error('Snapshot/version identity mismatch');
const html=await fs.readFile(path.join(root,'index.html'),'utf8');
if(!html.includes('<html')||!html.includes('snapshot'))throw Error('Incomplete chart HTML');
const walk=async dir=>(await Promise.all((await fs.readdir(dir,{withFileTypes:true})).map(async d=>d.isDirectory()?walk(path.join(dir,d.name)):[path.join(dir,d.name)]))).flat();
const files=await walk(root);
for(const file of files){const rel=path.relative(root,file);if(/(?:^|\/)(?:node_modules|\.cache|qa|\.git|runs)(?:\/|$)/.test(rel)||/\.(?:png|py|gz|zip)$/.test(rel)||/gallery-fixture/.test(rel))throw Error('Unsafe build artifact '+rel);}
if(!files.some(p=>p.endsWith('.js')))throw Error('Missing browser script');
for(const chart of p.charts){const svg=renderSvg(chart);if(!svg.startsWith('<svg')||/NaN|Infinity|<script|<image/.test(svg))throw Error('Chart rendering verification failed '+chart.id);}
console.log(JSON.stringify({snapshot:p.snapshot,charts:p.charts.length,files:files.length,staticOnly:true,allFourteenRender:true}));
