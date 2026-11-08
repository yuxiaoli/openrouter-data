import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
await mkdir('dist/docs/api',{recursive:true});
await build({entryPoints:['src/worker.ts'],outfile:'dist/_worker.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true});
await copyFile('docs/api/openapi.json','dist/docs/api/openapi.json');
await writeFile('dist/_routes.json',JSON.stringify({version:1,include:['/*'],exclude:[]}));
console.log('Built Cloudflare Pages advanced-mode API in dist/.');
