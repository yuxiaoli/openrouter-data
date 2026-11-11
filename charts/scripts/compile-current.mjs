/** Compile existing checksum-verified archive data, never fetch upstream OpenRouter. */
import fs from 'node:fs/promises';import path from 'node:path';import {gunzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
import {compileGallery,PAYLOAD_DATASETS,PUBLIC_DATASETS} from '../src/compile-all.mjs';
import {validatePayload,MAX_BYTES} from '../src/payload.mjs';
const root=path.resolve(process.argv[2]||'.cache/archive'),output=path.resolve(process.argv[3]||'.cache/current-snapshot.json');
const state=JSON.parse(await fs.readFile(path.join(root,'state.json'),'utf8'));
if(!/^[a-f0-9]{40}$/.test(state.archive_revision||''))throw Error('Pinned archive revision required');
const index=JSON.parse(await fs.readFile(path.join(root,'public-index.json'),'utf8'));
const selected=index.snapshots.find(s=>s.id===index.last_success&&s.status==='success');
if(!selected||selected.id!==state.snapshot||!/^\d{4}-\d{2}-\d{2}T\d{6}Z-[a-z0-9]+$/.test(selected.id))throw Error('No matching complete success snapshot');
const base=path.join(root,'runs',selected.id),manifestBytes=await fs.readFile(path.join(base,'manifest.json')),manifest=JSON.parse(manifestBytes);
if(manifest.id!==selected.id||manifest.status!=='success')throw Error('Manifest snapshot mismatch');
for(const name of PUBLIC_DATASETS){const r=manifest.datasets.find(r=>r.id===name);if(!r||r.status!=='ok'||![undefined,'public'].includes(r.access)||r.data_snapshot&&r.data_snapshot!==manifest.id||r.record_count!==manifest.counts[name])throw Error('Incomplete public dataset '+name);}
const storage=JSON.parse(await fs.readFile(path.join(base,'storage.json'),'utf8'));
const safe=p=>{if(typeof p!=='string'||p.startsWith('/')||p.split('/').some(s=>['','.','..'].includes(s))||!/^[a-zA-Z0-9_.\-/]+$/.test(p))throw Error('Unsafe archive path');return p;};
const sha=b=>createHash('sha256').update(b).digest('hex');const datasets={};let files=0;
for(const name of PAYLOAD_DATASETS){
 const report=manifest.datasets.find(r=>r.id===name),rows=[];
 for(const part of report.chunks?.length?report.chunks:[name+'.json']){
  if(report.chunks?.length&&!part.startsWith(`chunks/${name}/`))throw Error('Cross-dataset chunk');
  const entry=storage.files[safe(part)];if(!entry)throw Error('Missing checksum');
  const physical=await fs.readFile(path.join(base,safe(entry.physical_path)));
  if(sha(physical)!==entry.physical_sha256)throw Error('Physical checksum mismatch');
  if(!['gzip','identity',undefined,null].includes(entry.encoding))throw Error('Unknown storage encoding');
  const logical=entry.encoding==='gzip'?gunzipSync(physical):physical;
  if(sha(logical)!==entry.logical_sha256)throw Error('Logical checksum mismatch');
  const parsed=JSON.parse(logical);
  if(!Array.isArray(parsed.data))throw Error('Missing dataset rows');
  if(report.chunk_counts?.[part]!==undefined&&parsed.data.length!==report.chunk_counts[part])throw Error('Chunk count mismatch');
  rows.push(...parsed.data);files++;
 }
 if(rows.length!==report.record_count)throw Error('Record count mismatch '+name);datasets[name]=rows;
}
const sourceCommit=process.env.GITHUB_SHA||state.source_commit;
if(!/^[a-f0-9]{40}$/.test(sourceCommit||''))throw Error('Source commit identity required');
const compact=compileGallery({manifest,datasets,archive_revision:state.archive_revision,source_commit:sourceCommit,latest_attempt:state.latest_attempt,provenance:{archiveChecksumsVerified:true,sourceRepository:'https://github.com/yuxiaoli/openrouter-data',archiveRevision:state.archive_revision,manifestSha256:sha(manifestBytes),verifiedInputFiles:files}});
validatePayload(compact);const body=JSON.stringify(compact);
if(Buffer.byteLength(body)>MAX_BYTES)throw Error('Compact snapshot exceeds update limit');
await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,body);
console.log(JSON.stringify({snapshot:compact.snapshot,archiveRevision:compact.archiveRevision,sourceCommit,chartCount:compact.charts.length,bytes:Buffer.byteLength(body),sha256:sha(body),verifiedInputFiles:files}));
