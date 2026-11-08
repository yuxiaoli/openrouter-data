import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { ArchiveIndex, Manifest } from '../src/contracts.js';
const root=resolve(process.argv[2]??'data');
const index=ArchiveIndex.parse(JSON.parse(await readFile(join(root,'index.json'),'utf8')));
assert.ok(index.last_success,'No successful snapshot in archive');
assert.equal(index.snapshots.find(s=>s.id===index.last_success)?.status,'success');
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
let checksums=0;
for(const entry of index.snapshots) {
  const run=join(root,'runs',entry.id);
  const manifest=Manifest.parse(JSON.parse(await readFile(join(run,'manifest.json'),'utf8')));
  assert.equal(manifest.status,entry.status);
  for(const report of manifest.datasets) {
    if(report.status==='unavailable') continue;
    const data=JSON.parse(await readFile(join(run,`${report.id}.json`),'utf8'));
    assert.equal(data.data.length,report.record_count,`${report.id} count`);
    assert.equal(manifest.counts[report.id],report.record_count);
    const files=(Array.isArray(report.pages)?report.pages:[report]) as Record<string,unknown>[];
    for(const page of files) if(typeof page.raw_path==='string' && typeof page.sha256==='string') {
      assert.match(page.raw_path,/^raw\/[a-z0-9_.-]+$/i);
      const bytes=await readFile(join(run,page.raw_path));
      assert.equal(hash(bytes),page.sha256,`${entry.id}/${page.raw_path}`); checksums++;
      if(page.raw_path.endsWith('.ndjson')) for(const line of bytes.toString('utf8').trim().split('\n')) {
        const item=JSON.parse(line);
        if(item.body_base64) { assert.equal(hash(Buffer.from(item.body_base64,'base64')),item.sha256,item.source_url);checksums++; }
      }
    }
  }
}
console.log(JSON.stringify({status:'passed',snapshots:index.snapshots.length,last_success:index.last_success,checksums},null,2));
