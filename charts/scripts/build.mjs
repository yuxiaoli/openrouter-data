import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'site-dist');
await fs.mkdir(out,{recursive:true});
// Generated code/assets only; the independently validated data build supplies snapshot.json.
for(const entry of await fs.readdir(out)){if(entry==='snapshot.json')continue;await fs.rm(path.join(out,entry),{recursive:true,force:true});}
const result=await build({entryPoints:[path.join(root,'src/app.mjs')],bundle:true,format:'esm',platform:'browser',target:['es2022'],minify:true,legalComments:'linked',outfile:path.join(out,'app.js'),metafile:true});
await fs.mkdir(path.join(root,'qa'),{recursive:true});await fs.writeFile(path.join(root,'qa/bundle-meta.json'),JSON.stringify(result.metafile,null,2));
await fs.mkdir(path.join(out,'licenses'),{recursive:true});
for(const [from,to] of [['echarts/LICENSE','ECharts-LICENSE.txt'],['echarts/NOTICE','ECharts-NOTICE.txt'],['zrender/LICENSE','ZRender-LICENSE.txt']])await fs.copyFile(path.join(root,'node_modules',from),path.join(out,'licenses',to));
await fs.copyFile(path.join(root,'web/index.html'),path.join(out,'index.html'));await fs.copyFile(path.join(root,'web/style.css'),path.join(out,'style.css'));await fs.cp(path.join(root,'assets/fonts'),path.join(out,'fonts'),{recursive:true});
const files=await fs.readdir(out,{recursive:true});if(files.some(f=>/\.png$|\.gz$|fixture|node_modules|^qa\/|^dist\//.test(f)))throw new Error('Unsafe production output');
console.log('Built relative-path frontend assets:',out);for(const name of files){const s=await fs.stat(path.join(out,name));if(s.isFile())console.log(name,s.size);}
