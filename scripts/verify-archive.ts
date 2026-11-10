import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { ArchiveIndex, DatasetReference, Manifest } from '../src/contracts.js';
import {readLogicalArchiveFile,verifyPackedArchive} from '../src/archive-storage.js';
async function readFile(path:string):Promise<Buffer>;
async function readFile(path:string,encoding:'utf8'):Promise<string>;
async function readFile(path:string,encoding?:'utf8'):Promise<Buffer|string>{const bytes=await readLogicalArchiveFile(path);return encoding?bytes.toString(encoding):bytes;}
const root=resolve(process.argv.slice(2).find(value=>!value.startsWith('--'))??'data');
const index=ArchiveIndex.parse(JSON.parse(await readFile(join(root,'index.json'),'utf8')));
let packedLatest:Awaited<ReturnType<typeof verifyPackedArchive>>|undefined;
if(process.argv.includes('--require-packed-latest')) {
  const newest=index.snapshots[0]?.id;
  if(!newest)throw new Error('No latest archive attempt to verify for publication');
  packedLatest=await verifyPackedArchive(root,newest);
}
if(index.last_success!==null)assert.equal(index.snapshots.find(s=>s.id===index.last_success)?.status,'success');
const latest=index.latest_snapshot??index.last_success;
if(latest!==null)assert.ok(['success','partial'].includes(index.snapshots.find(s=>s.id===latest)?.status??''),'Latest snapshot must reference a usable attempt');
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
let checksums=0;
const manifests=new Map<string,Manifest>();
async function manifestFor(snapshot:string):Promise<Manifest> {
  const cached=manifests.get(snapshot);
  if(cached)return cached;
  const manifest=Manifest.parse(JSON.parse(await readFile(join(root,'runs',snapshot,'manifest.json'),'utf8')));
  assert.equal(manifest.id,snapshot,'Manifest id must match its directory');
  manifests.set(snapshot,manifest);
  return manifest;
}
async function verifyReference(dataset:string,value:unknown):Promise<void> {
  const reference=DatasetReference.parse(value);
  assert.equal(reference.data_path,`runs/${reference.snapshot}/${dataset}.json`,'Dataset reference cannot point at another source');
  const report=(await manifestFor(reference.snapshot)).datasets.find(report=>report.id===dataset);
  assert.equal(report?.status,'ok',`${dataset} fallback must point to an actually successful source`);
  assert.equal(report.collected_at,reference.collected_at,`${dataset} fallback collection time`);
  assert.equal(report.record_count,reference.record_count,`${dataset} fallback count`);
  assert.equal(report.source_url,reference.source_url,`${dataset} fallback source`);
  assert.equal(report.sha256,reference.sha256,`${dataset} fallback raw checksum`);
  assert.deepEqual(report.chunks,reference.chunks,`${dataset} fallback chunks`);
  assert.deepEqual(report.model_chunks,reference.model_chunks,`${dataset} fallback model chunks`);
  assert.deepEqual(report.chunk_counts,reference.chunk_counts,`${dataset} fallback chunk counts`);
  assert.deepEqual(report.chunk_sha256s,reference.chunk_sha256s,`${dataset} fallback chunk checksums`);
}
const safeDataPath=(path:unknown):path is string=>typeof path==='string'&&/^(?:[a-z0-9_]+\.json|chunks\/[a-z0-9_]+\/part-\d+\.json|shards\/[a-z0-9_]+\/[a-f0-9]+\.json)$/.test(path);
const safeRawPath=(path:unknown):path is string=>typeof path==='string'&&/^raw\/[a-z0-9_.-]+$/i.test(path);
async function verifyData(run:string,report:Manifest['datasets'][number]):Promise<void> {
  const rootBytes=await readFile(join(run,`${report.id}.json`));
  const rootData=JSON.parse(rootBytes.toString('utf8'));
  if(typeof report.normalized_sha256==='string'){assert.equal(hash(rootBytes),report.normalized_sha256,`${report.id} normalized checksum`);checksums++;}
  const paths=Array.isArray(report.chunks)?report.chunks:[`${report.id}.json`];
  assert.equal(new Set(paths).size,paths.length,`${report.id} duplicate chunks`);
  let count=0;
  const models:Record<string,string[]>={};
  for(const path of paths) {
    assert.ok(safeDataPath(path),`${report.id} unsafe data chunk path`);
    if(Array.isArray(report.chunks))assert.ok(path.startsWith(`chunks/${report.id}/`),`${report.id} chunk belongs to another dataset`);
    const chunkBytes=path===`${report.id}.json`?rootBytes:await readFile(join(run,path));
    const data=path===`${report.id}.json`?rootData:JSON.parse(chunkBytes.toString('utf8'));
    assert.ok(Array.isArray(data.data),`${report.id} chunk lacks a data array`);
    if(report.chunk_counts&&typeof report.chunk_counts==='object')assert.equal((report.chunk_counts as Record<string,number>)[path],data.data.length,`${report.id}/${path} count`);
    if(report.chunk_sha256s&&typeof report.chunk_sha256s==='object'){assert.equal((report.chunk_sha256s as Record<string,string>)[path],hash(chunkBytes),`${report.id}/${path} checksum`);checksums++;}
    count+=data.data.length;
    for(const row of data.data)if(typeof row.model_id==='string') {
      const modelPaths=models[row.model_id]??=[];
      if(!modelPaths.includes(path))modelPaths.push(path);
    }
  }
  assert.equal(count,report.record_count,`${report.id} chunk record count`);
  if(Array.isArray(rootData.data))assert.equal(rootData.data.length,report.record_count,`${report.id} full file count`);
  else {
    assert.equal(rootData.storage,'chunked');
    assert.equal(rootData.record_count,report.record_count);
    assert.deepEqual(rootData.chunks,report.chunks);
  }
  if(report.row_count_actual!==undefined)assert.equal(report.row_count_actual,report.record_count);
  if(report.model_chunks!==undefined)assert.deepEqual(report.model_chunks,models,`${report.id} model chunk coverage`);
}
const entries=process.argv.includes('--latest-only')?index.snapshots.slice(0,1):index.snapshots;
for(const entry of entries) {
  const run=join(root,'runs',entry.id);
  const manifest=await manifestFor(entry.id);
  assert.equal(manifest.status,entry.status);
  assert.deepEqual(manifest.counts,entry.counts);
  if(manifest.status==='partial')assert.ok(manifest.datasets.some(report=>report.status==='ok')&&manifest.datasets.some(report=>report.status==='failed'),'Partial attempt must include both successful and failed sources');
  for(const report of manifest.datasets) {
    if(report.status==='unavailable') continue;
    await verifyData(run,report);
    assert.equal(manifest.counts[report.id],report.record_count);
    const files=(Array.isArray(report.pages)?report.pages:[report]) as Record<string,unknown>[];
    for(const page of files) if(typeof page.raw_path==='string' && typeof page.sha256==='string') {
      assert.ok(safeRawPath(page.raw_path));
      const bytes=await readFile(join(run,page.raw_path));
      assert.equal(hash(bytes),page.sha256,`${entry.id}/${page.raw_path}`); checksums++;
      if(page.raw_path.endsWith('.ndjson')) for(const line of bytes.toString('utf8').trim().split('\n')) {
        if(!line.trim())continue;
        const item=JSON.parse(line);
        if(item.body_base64) { assert.equal(hash(Buffer.from(item.body_base64,'base64')),item.sha256,item.source_url);checksums++; }
        if(Array.isArray(item.body_base64_chunks)) {
          const parts:string[]=[];
          for(const part of item.body_base64_chunks) {
            assert.ok(safeRawPath(part.raw_path),'Unsafe raw response chunk path');
            const bytes=await readFile(join(run,part.raw_path));
            assert.equal(hash(bytes),part.sha256,part.raw_path);checksums++;
            parts.push(bytes.toString('utf8'));
          }
          assert.equal(hash(Buffer.from(parts.join(''),'base64')),item.sha256,item.source_url);checksums++;
        }
      }
    }
    if(report.fallback) {
      assert.equal(report.status,'failed','Only failed attempts may reference stale data');
      assert.notEqual(report.fallback.snapshot,entry.id,'Fallback must reference a prior snapshot');
      await verifyReference(report.id,report.fallback);
    }
  }
}
for(const [dataset,reference] of Object.entries(index.dataset_last_success??{}))await verifyReference(dataset,reference);
console.log(JSON.stringify({status:'passed',snapshots:index.snapshots.length,verified_snapshots:entries.length,mode:process.argv.includes('--latest-only')?'latest_only':'all',last_success:index.last_success,latest_snapshot:latest,dataset_references:Object.keys(index.dataset_last_success??{}).length,checksums,packed_latest:packedLatest},null,2));
