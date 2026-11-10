import {mkdtemp,mkdir,readFile,writeFile,copyFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {describe,it,expect} from 'vitest';
import {packArchive,readLogicalArchiveFile,verifyPackedArchive} from '../src/archive-storage.js';

describe('transparent logical archive storage',()=>{
  it('packs deterministic siblings without changing originals and verifies a gzip-only checkout',async()=>{
    const output=await mkdtemp(join(tmpdir(),'archive-storage-'));
    const snapshot='2026-11-10T000000Z-fixture';
    const run=join(output,'runs',snapshot);
    await mkdir(join(run,'raw'),{recursive:true});
    const source=Buffer.from('{ "data": [{"id":"test/model","opaque_native":{"value":null}}] }\n');
    const raw=Buffer.from('{"unmodified":true,"unknown":[1,2,3]}\n');
    const manifest={schema_version:1,id:snapshot,date:'2026-11-10',started_at:'2026-11-10T00:00:00Z',completed_at:'2026-11-10T00:00:01Z',status:'success',counts:{models:1},errors:[],datasets:[{id:'models',source_url:'https://openrouter.ai/api/v1/models',collected_at:'2026-11-10T00:00:00Z',status:'ok',record_count:1,coverage:'Fixture',unavailable:[],errors:[],raw_path:'raw/models.json',sha256:createHash('sha256').update(raw).digest('hex')}]};
    await writeFile(join(run,'models.json'),source);
    await writeFile(join(run,'raw/models.json'),raw);
    await writeFile(join(run,'manifest.json'),JSON.stringify(manifest));
    await writeFile(join(run,'query-manifest.json'),JSON.stringify(manifest));
    await packArchive(output,snapshot);
    const storage=JSON.parse(await readFile(join(run,'storage.json'),'utf8'));
    expect(storage.snapshot).toBe(snapshot);
    expect(Object.keys(storage.files).sort()).toEqual(['models.json','raw/models.json']);
    expect(await readFile(join(run,'models.json'))).toEqual(source);
    expect(await readFile(join(run,'raw/models.json'))).toEqual(raw);
    expect(gunzipSync(await readFile(join(run,'models.json.gz')))).toEqual(source);
    expect(await readLogicalArchiveFile(join(run,'models.json'))).toEqual(source);
    await expect(access(join(run,'manifest.json.gz'))).rejects.toThrow();
    const packed=await readFile(join(run,'models.json.gz'));
    await packArchive(output,snapshot);
    expect(await readFile(join(run,'models.json.gz'))).toEqual(packed);
    const checkout=await mkdtemp(join(tmpdir(),'gzip-only-checkout-'));
    const target=join(checkout,'runs',snapshot);
    await mkdir(target,{recursive:true});
    for(const name of ['manifest.json','query-manifest.json','storage.json',...Object.values(storage.files).map((entry:any)=>entry.physical_path)]){
      await mkdir(dirname(join(target,name)),{recursive:true});
      await copyFile(join(run,name),join(target,name));
    }
    expect(await readLogicalArchiveFile(join(target,'models.json'))).toEqual(source);
    await expect(verifyPackedArchive(checkout,snapshot)).resolves.toMatchObject({snapshot,files:2});
    await writeFile(join(target,'models.json.gz'),'damaged physical bytes');
    await expect(verifyPackedArchive(checkout,snapshot)).rejects.toThrow(/hash|checksum|gzip/i);
    await writeFile(join(run,'models.json.gz'),'different immutable bytes');
    await expect(packArchive(output,snapshot)).rejects.toThrow(/immutable|different|refus/i);
  });
});
