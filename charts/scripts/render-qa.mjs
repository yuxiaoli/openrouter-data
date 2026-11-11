import fs from 'node:fs/promises';import path from 'node:path';import {Resvg} from '@resvg/resvg-js';import {renderSvg} from '../src/charts-all.mjs';import {validateSnapshot} from '../src/contract.mjs';
if(!process.argv[2])throw new Error('Usage: npm run qa:render -- <compact-snapshot.json> [output-directory] [local-font-path]');
const snapshot=validateSnapshot(JSON.parse(await fs.readFile(process.argv[2],'utf8'))),out=process.argv[3]||'qa/render';await fs.mkdir(out,{recursive:true});
for(const c of snapshot.charts){const svg=renderSvg(c);await fs.writeFile(path.join(out,c.id+'.svg'),svg);if(process.argv[4])await fs.writeFile(path.join(out,c.id+'.png'),new Resvg(svg,{font:{fontFiles:[process.argv[4]],defaultFontFamily:'Noto Sans CJK JP'},fitTo:{mode:'width',value:1400}}).render().asPng());}
console.log(`Rendered ${snapshot.charts.length} internal QA SVGs${process.argv[4]?' and PNGs':''} to ${out}; not production assets.`);
