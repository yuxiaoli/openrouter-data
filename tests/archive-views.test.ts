import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe,expect,it } from 'vitest';
import { ArchiveIndex,Manifest } from '../src/contracts.js';
import { writeArchiveViews } from '../src/archive-views.js';

describe('archive query projections',()=>{
  it('preserves real counts and fallback times without mutating the complete archive',async()=>{
    const output=await mkdtemp(join(tmpdir(),'archive-query-views-'));
    const oldId='2026-11-09T000000Z-old';
    const id='2026-11-10T000000Z-current';
    const oldTime='2026-11-09T00:00:01.000Z';
    const time='2026-11-10T00:00:01.000Z';
    const errors=Array.from({length:35},(_,i)=>`Explicit failure ${i}`);
    const heavy={source_urls:Array.from({length:500},(_,i)=>`https://openrouter.ai/public/${i}`),time_ranges:Array.from({length:500},()=>({from:oldTime,to:time})),coverage_by_model:Object.fromEntries(Array.from({length:500},(_,i)=>[`model-${i}`,{requested:1,succeeded:1}])),coverage_by_window:Array.from({length:500},()=>({window:'day',requested:1})),pages:Array.from({length:500},(_,i)=>({raw_path:`raw/page-${i}.json`}))};
    const stale={snapshot:oldId,data_path:`runs/${oldId}/providers.json`,collected_at:oldTime,record_count:11,source_url:'https://openrouter.ai/api/v1/providers',sha256:'a'.repeat(64),access:'public',window:{label:'Old observation'},units:{record_count:'records'},chunks:['chunks/providers/part-00001.json'],chunk_counts:{'chunks/providers/part-00001.json':11},chunk_sha256s:{'chunks/providers/part-00001.json':'b'.repeat(64)},model_chunks:{'test/model':['chunks/providers/part-00001.json']},...heavy};
    const manifest=Manifest.parse({schema_version:1,id,date:'2026-11-10',started_at:time,completed_at:time,status:'partial',counts:{models:7,providers:0,authenticated_data:0},errors,datasets:[
      {id:'models',source_url:'https://openrouter.ai/api/v1/models',collected_at:time,status:'ok',record_count:7,coverage:'Observed model rows.',unavailable:[],errors:[],access:'public'},
      {id:'providers',source_url:'https://openrouter.ai/api/v1/providers',collected_at:time,status:'failed',record_count:0,coverage:'This attempt failed.',unavailable:errors,errors,fallback:stale,access:'public',...heavy},
      {id:'authenticated_data',source_url:'https://openrouter.ai/api/v1/datasets/',collected_at:time,status:'unavailable',record_count:0,coverage:'Private account data is excluded.',unavailable:['Requires authentication'],errors:[],access:'authenticated'},
    ]});
    const {datasets:_datasets,schema_version:_version,...summary}=manifest;
    const index=ArchiveIndex.parse({schema_version:1,updated_at:time,last_success:oldId,latest_snapshot:id,dataset_last_success:{providers:stale},snapshots:[summary,{id:oldId,date:'2026-11-09',started_at:oldTime,completed_at:oldTime,status:'success',counts:{providers:11},errors:[]}]});
    const originalManifest=JSON.stringify(manifest);
    const originalIndex=JSON.stringify(index);
    await mkdir(join(output,'runs',id),{recursive:true});
    await mkdir(join(output,'runs',oldId),{recursive:true});
    await writeFile(join(output,'runs',id,'manifest.json'),originalManifest);
    await writeFile(join(output,'runs',oldId,'manifest.json'),'old immutable content');
    await writeFile(join(output,'index.json'),originalIndex);
    await writeArchiveViews(output,index,manifest);
    const query=JSON.parse(await readFile(join(output,'runs',id,'query-manifest.json'),'utf8'));
    expect(query.counts).toEqual(manifest.counts);
    expect(query.error_count).toBe(35);
    expect(query.errors).toHaveLength(20);
    expect(query.errors_truncated).toBe(true);
    const provider=query.datasets.find((report:{id:string})=>report.id==='providers');
    expect(provider.status).toBe('failed');
    expect(provider.record_count).toBe(0);
    expect(provider.error_count).toBe(35);
    expect(provider.errors_truncated).toBe(true);
    expect(provider.fallback.collected_at).toBe(oldTime);
    expect(provider.fallback.record_count).toBe(11);
    expect(provider.fallback.model_chunks).toEqual(stale.model_chunks);
    expect(provider.fallback.chunk_sha256s).toEqual(stale.chunk_sha256s);
    expect(provider.source_urls).toBeUndefined();
    expect(provider.coverage_by_model).toBeUndefined();
    expect(provider.fallback.coverage_by_model).toBeUndefined();
    expect(query.datasets.find((report:{id:string})=>report.id==='authenticated_data').access).toBe('authenticated');
    const publicIndex=JSON.parse(await readFile(join(output,'public-index.json'),'utf8'));
    expect(publicIndex.dataset_last_success).toBeUndefined();
    expect(publicIndex.latest_snapshot).toBe(id);
    expect(publicIndex.last_success).toBe(oldId);
    expect(ArchiveIndex.parse(publicIndex).snapshots[0]?.error_count).toBe(35);
    expect(publicIndex.snapshots[0].errors).toHaveLength(20);
    expect(await readFile(join(output,'runs',id,'manifest.json'),'utf8')).toBe(originalManifest);
    expect(await readFile(join(output,'index.json'),'utf8')).toBe(originalIndex);
    expect(await readFile(join(output,'runs',oldId,'manifest.json'),'utf8')).toBe('old immutable content');
    await expect(access(join(output,'runs',oldId,'query-manifest.json'))).rejects.toThrow();
    expect(JSON.stringify(manifest)).toBe(originalManifest);
    expect(JSON.stringify(index)).toBe(originalIndex);
    await writeArchiveViews(output,index,manifest);
    const sidecarPath=join(output,'runs',id,'query-manifest.json');
    await writeFile(sidecarPath,'different existing bytes');
    await expect(writeArchiveViews(output,index,manifest)).rejects.toThrow(/refus|different|immutable/i);
    expect(await readFile(sidecarPath,'utf8')).toBe('different existing bytes');
  });
});
