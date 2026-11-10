import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {Manifest} from './contracts.js';

const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const snapshotId=z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{6}Z-[a-z0-9]+$/);
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const Entry=z.object({physical_path:z.string(),encoding:z.literal('gzip'),logical_sha256:sha,physical_sha256:sha,logical_bytes:z.number().int().nonnegative(),physical_bytes:z.number().int().nonnegative()});
const Storage=z.object({schema_version:z.literal(1),snapshot:snapshotId,compression:z.literal('gzip'),file_count:z.number().int().nonnegative(),logical_bytes:z.number().int().nonnegative(),physical_bytes:z.number().int().nonnegative(),files:z.record(z.string(),Entry)});
export type ArchiveStorage=z.infer<typeof Storage>;
const metadata=new Set(['manifest.json','query-manifest.json','storage.json']);
const code=(error:unknown)=>(error as NodeJS.ErrnoException)?.code;
const safe=(path:string)=>path!==''&&!isAbsolute(path)&&!path.includes('\\')&&path.split('/').every(part=>part!==''&&part!=='.'&&part!=='..');

/** Logical content remains byte-for-byte identical whether its transport is plain or gzip. */
export async function readLogicalArchiveFile(path:string):Promise<Buffer> {
  try{return await readFile(path);}
  catch(error){if(code(error)!=='ENOENT')throw error;return gunzipSync(await readFile(`${path}.gz`));}
}
async function walk(root:string,prefix=''):Promise<string[]> {
  const files:string[]=[];
  for(const entry of await readdir(join(root,prefix),{withFileTypes:true})) {
    const name=prefix?`${prefix}/${entry.name}`:entry.name;
    if(entry.isSymbolicLink())throw new Error('Archive storage refuses symbolic links');
    if(entry.isDirectory())files.push(...await walk(root,name));
    else if(entry.isFile())files.push(name);
  }
  return files.sort();
}
async function immutable(path:string,bytes:Uint8Array):Promise<void> {
  try{await writeFile(path,bytes,{flag:'wx'});}
  catch(error){if(code(error)!=='EEXIST')throw error;if(!(await readFile(path)).equals(Buffer.from(bytes)))throw new Error(`Refusing different bytes for immutable packed file: ${path}`);}
}
function gzip(bytes:Uint8Array):Buffer {
  const packed=gzipSync(bytes,{level:9});
  packed.fill(0,4,8); // Reproducible MTIME, independent of the packaging time.
  packed[9]=255; // Reproducible platform-neutral OS header.
  return packed;
}

/** Add deterministic siblings to this explicit run; never delete or rewrite logical source files. */
export async function packArchive(output:string,snapshot:string):Promise<ArchiveStorage> {
  snapshotId.parse(snapshot);
  const root=resolve(output,'runs',snapshot);
  const manifest=Manifest.parse(JSON.parse((await readFile(join(root,'manifest.json'))).toString('utf8')));
  if(manifest.id!==snapshot)throw new Error('Archive manifest identity differs from selected snapshot');
  const files:ArchiveStorage['files']={};
  for(const logical of await walk(root)) {
    if(metadata.has(logical)||logical.endsWith('.gz'))continue;
    if(!safe(logical))throw new Error('Unsafe logical archive path');
    const bytes=await readFile(join(root,logical));
    // Compression is a transport representation, never a way to publish unredacted examples.
    if(/sk-or-v1-[A-Za-z0-9_-]+/.test(bytes.toString('utf8')))throw new Error(`Refusing credential-shaped plaintext before compression: ${logical}`);
    const packed=gzip(bytes);
    const physical=`${logical}.gz`;
    await immutable(join(root,physical),packed);
    files[logical]={physical_path:physical,encoding:'gzip',logical_sha256:digest(bytes),physical_sha256:digest(packed),logical_bytes:bytes.length,physical_bytes:packed.length};
  }
  // Resume safely from a gzip-only checkout without silently dropping existing logical files.
  let existing:ArchiveStorage|undefined;
  try{existing=Storage.parse(JSON.parse(await readFile(join(root,'storage.json'),'utf8')));}
  catch(error){if(code(error)!=='ENOENT')throw error;}
  if(existing)for(const [logical,entry] of Object.entries(existing.files))if(!files[logical])files[logical]=entry;
  const ordered=Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b,'en')));
  const storage=Storage.parse({schema_version:1,snapshot,compression:'gzip',file_count:Object.keys(ordered).length,logical_bytes:Object.values(ordered).reduce((sum,entry)=>sum+entry.logical_bytes,0),physical_bytes:Object.values(ordered).reduce((sum,entry)=>sum+entry.physical_bytes,0),files:ordered});
  await immutable(join(root,'storage.json'),Buffer.from(JSON.stringify(storage,null,2)+'\n'));
  return storage;
}

/** Publication gate checks physical bytes even when local uncompressed originals still exist. */
export async function verifyPackedArchive(output:string,snapshot:string):Promise<{snapshot:string;files:number;logical_bytes:number;physical_bytes:number}> {
  snapshotId.parse(snapshot);
  const root=resolve(output,'runs',snapshot);
  const storage=Storage.parse(JSON.parse(await readFile(join(root,'storage.json'),'utf8')));
  if(storage.snapshot!==snapshot)throw new Error('Packed storage snapshot identity mismatch');
  const manifest=Manifest.parse(JSON.parse(await readFile(join(root,'manifest.json'),'utf8')));
  if(manifest.id!==snapshot)throw new Error('Packed manifest identity mismatch');
  const query=Manifest.parse(JSON.parse(await readFile(join(root,'query-manifest.json'),'utf8')));
  for(const key of ['id','date','started_at','completed_at','status'] as const)if(query[key]!==manifest[key])throw new Error(`Query projection identity mismatch: ${key}`);
  if(JSON.stringify(query.counts)!==JSON.stringify(manifest.counts))throw new Error('Query projection changed logical record counts');
  const expected=new Set<string>();
  for(const report of manifest.datasets)if(report.status!=='unavailable') {
    expected.add(`${report.id}.json`);
    if(report.raw_path)expected.add(report.raw_path);
    for(const page of Array.isArray(report.pages)?report.pages:[])if(typeof page.raw_path==='string')expected.add(page.raw_path);
    for(const path of report.chunks??[])expected.add(path);
    for(const paths of Object.values(report.model_chunks??{}))for(const path of paths)expected.add(path);
  }
  for(const path of await walk(root))if(!metadata.has(path))expected.add(path.endsWith('.gz')?path.slice(0,-3):path);
  for(const path of expected)if(!Object.hasOwn(storage.files,path))throw new Error(`Logical payload missing from packed storage map: ${path}`);
  let logicalBytes=0,physicalBytes=0;
  for(const [logical,entry] of Object.entries(storage.files)) {
    if(!safe(logical)||entry.physical_path!==`${logical}.gz`||metadata.has(logical))throw new Error('Unsafe or incorrect packed storage path');
    const packed=await readFile(join(root,entry.physical_path));
    if(packed.length!==entry.physical_bytes||digest(packed)!==entry.physical_sha256)throw new Error(`Physical gzip checksum mismatch: ${logical}`);
    const decoded=gunzipSync(packed);
    if(decoded.length!==entry.logical_bytes||digest(decoded)!==entry.logical_sha256)throw new Error(`Logical decompressed checksum mismatch: ${logical}`);
    try{if(!(await readFile(join(root,logical))).equals(decoded))throw new Error(`Logical original changed after packing: ${logical}`);}
    catch(error){if(code(error)!=='ENOENT')throw error;}
    logicalBytes+=decoded.length;physicalBytes+=packed.length;
  }
  if(Object.keys(storage.files).length!==storage.file_count||logicalBytes!==storage.logical_bytes||physicalBytes!==storage.physical_bytes)throw new Error('Packed storage aggregate count/bytes mismatch');
  return {snapshot,files:storage.file_count,logical_bytes:logicalBytes,physical_bytes:physicalBytes};
}
