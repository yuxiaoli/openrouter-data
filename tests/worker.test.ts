import { expect, test } from 'vitest';
import { handleRequest } from '../src/worker.js';
import type { ArchiveStore, Manifest, ArchiveIndex } from '../src/contracts.js';
const id='2026-11-08T160000Z-abcd';
const summary={id,date:'2026-11-08',started_at:'2026-11-08T16:00:00Z',completed_at:'2026-11-08T16:01:00Z',status:'success' as const,counts:{models:1},errors:[]};
const manifest:Manifest={...summary,schema_version:1,datasets:[{id:'models',source_url:'https://openrouter.ai/api/v1/models?output_modalities=all',collected_at:summary.completed_at,status:'ok',record_count:1,coverage:'test-only synthetic fixture',unavailable:[],errors:[]}]};
const index:ArchiveIndex={schema_version:1,updated_at:summary.completed_at,last_success:id,snapshots:[summary]};
function store(indexValue:ArchiveIndex=index,rows=[{id:'test/one',description:'<markup>& text\u0001',name:'A & B',architecture:{input_modalities:['text'],output_modalities:['text']},pricing:{prompt:null,completion:null}}]):ArchiveStore {
  return {async read(path) {const value=path==='index.json'?indexValue:path.endsWith('manifest.json')?manifest:path.endsWith('models.json')?{data:rows}:undefined;return value?{ok:true,value}:{ok:false,error:{code:'ARCHIVE_UNAVAILABLE',message:'Missing fixture',status:502}};}};
}
test('RSS escapes upstream text and removes XML-forbidden control characters', async()=>{
  const response=await handleRequest(new Request('https://example.test/rss.xml?limit=1'),store(),Date.parse(summary.completed_at));
  expect(response.status).toBe(200);
  const xml=await response.text();
  expect(xml).toContain('A &amp; B'); expect(xml).toContain('&lt;markup&gt;&amp; text');
  expect(xml).not.toContain('\u0001');
});

test('failed latest attempt degrades health while data still uses the last successful snapshot',async()=>{
  const failed={...summary,id:'2026-11-08T160200Z-failed',completed_at:'2026-11-08T16:03:00Z',status:'failed' as const,errors:['upstream timed out']};
  const archive=store({...index,snapshots:[failed,summary]});
  const response=await handleRequest(new Request('https://example.test/api/v1/data?type=models&free=false'),archive,Date.parse(failed.completed_at));
  const body=await response.json();
  expect(response.status).toBe(200); expect(body.meta.snapshot).toBe(id); expect(body.meta.latest_attempt_status).toBe('failed');
  expect(body.data).toEqual([]); // Unknown prices must not be treated as paid or free.
  const health=await handleRequest(new Request('https://example.test/healthz'),archive,Date.parse(failed.completed_at));
  expect(health.status).toBe(503); expect((await health.json()).status).toBe('degraded');
});
