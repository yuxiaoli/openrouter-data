import { readFile,rename,writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join,resolve } from 'node:path';
import { ArchiveIndex,Manifest,type Row } from './contracts.js';
import {packArchive} from './archive-storage.js';

const sourceKeys=[
  'id','source_url','documentation_url','collected_at','status','record_count','coverage',
  'raw_path','sha256','original_sha256','http_status','category','units','window','access','scope',
  'endpoint_scope','observed_at','request_started_at','request_completed_at','redactions',
  'chunks','chunk_counts','chunk_sha256s','model_chunks','shards','default_order','row_count_actual',
  'normalized_sha256','coverage_count','network_requests','models_requested','models_succeeded',
  'models_with_no_endpoints','catalogue_count','catalogue_status','count_matches_catalogue',
  'snapshot','data_path',
] as const;
const object=(value:unknown):value is Row=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function boundedErrors(value:{errors:string[];error_count?:unknown;errors_truncated?:unknown}) {
  return {
    errors:value.errors.slice(0,20),
    error_count:Math.max(value.errors.length,typeof value.error_count==='number'?value.error_count:0),
    errors_truncated:value.errors.length>20||value.errors_truncated===true,
  };
}
function compactSource(source:Row):Row {
  const projection:Row={};
  for(const key of sourceKeys)if(Object.hasOwn(source,key))projection[key]=structuredClone(source[key]);
  if(Array.isArray(source.errors))Object.assign(projection,boundedErrors(source as Row&{errors:string[]}));
  if(Array.isArray(source.unavailable))Object.assign(projection,{
    unavailable:source.unavailable.slice(0,20),
    unavailable_count:Math.max(source.unavailable.length,typeof source.unavailable_count==='number'?source.unavailable_count:0),
    unavailable_truncated:source.unavailable.length>20||source.unavailable_truncated===true,
  });
  if(object(source.fallback))projection.fallback=compactSource(source.fallback);
  return projection;
}

/** Lossless service metadata projection; large diagnostics remain in the immutable full manifest. */
export function projectArchiveViews(index:ArchiveIndex,manifest:Manifest):{publicIndex:ArchiveIndex;queryManifest:Manifest} {
  const publicIndex=ArchiveIndex.parse({
    schema_version:index.schema_version,updated_at:index.updated_at,last_success:index.last_success,
    ...(index.latest_snapshot!==undefined?{latest_snapshot:index.latest_snapshot}:{}),
    snapshots:index.snapshots.map(snapshot=>({...structuredClone(snapshot),...boundedErrors(snapshot)})),
  });
  const queryManifest=Manifest.parse({
    schema_version:manifest.schema_version,id:manifest.id,date:manifest.date,started_at:manifest.started_at,
    completed_at:manifest.completed_at,status:manifest.status,counts:structuredClone(manifest.counts),
    ...boundedErrors(manifest),datasets:manifest.datasets.map(report=>compactSource(report)),
  });
  return {publicIndex,queryManifest};
}

/** Only the current attempt receives a new immutable sidecar; old run files are never rewritten. */
export async function writeArchiveViews(output:string,index:ArchiveIndex,manifest:Manifest):Promise<void> {
  if(index.snapshots[0]?.id!==manifest.id)throw new Error('Refusing to generate a query sidecar for an older archive run');
  const {publicIndex,queryManifest}=projectArchiveViews(index,manifest);
  const root=resolve(output);
  const queryPath=join(root,'runs',manifest.id,'query-manifest.json');
  const queryBytes=JSON.stringify(queryManifest,null,2)+'\n';
  try {await writeFile(queryPath,queryBytes,{flag:'wx'});}
  catch(error) {
    if(!object(error)||error.code!=='EEXIST')throw error;
    if(await readFile(queryPath,'utf8')!==queryBytes)throw new Error('Refusing to replace an immutable query sidecar with different bytes');
  }
  await packArchive(root,manifest.id);
  const temporary=join(root,`public-index-${manifest.id}-${randomBytes(4).toString('hex')}.tmp`);
  await writeFile(temporary,JSON.stringify(publicIndex,null,2)+'\n',{flag:'wx'});
  await rename(temporary,join(root,'public-index.json'));
}
