import {readFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {ArchiveIndex,Manifest} from '../src/contracts.js';
import {writeArchiveViews} from '../src/archive-views.js';

function option(name:string):string|undefined {
  const index=process.argv.indexOf(name);
  if(index===-1)return undefined;
  const value=process.argv[index+1];
  if(!value||value.startsWith('--'))throw new Error(`Missing ${name} value`);
  return value;
}
try {
  const positional=process.argv[2]&&!process.argv[2].startsWith('--')?process.argv[2]:undefined;
  const output=resolve(option('--output')??positional??'data');
  const index=ArchiveIndex.parse(JSON.parse(await readFile(join(output,'index.json'),'utf8')));
  const snapshot=option('--snapshot')??index.snapshots[0]?.id;
  if(!snapshot||snapshot!==index.snapshots[0]?.id)throw new Error('Only the current newest archive attempt may receive a query sidecar');
  const run=join(output,'runs',snapshot);
  const manifest=Manifest.parse(JSON.parse(await readFile(join(run,'manifest.json'),'utf8')));
  await writeArchiveViews(output,index,manifest);
  const [full,query,pub]=await Promise.all([stat(join(run,'manifest.json')),stat(join(run,'query-manifest.json')),stat(join(output,'public-index.json'))]);
  console.log(JSON.stringify({status:'prepared',snapshot,query_manifest:`runs/${snapshot}/query-manifest.json`,public_index:'public-index.json',bytes:{full_manifest:full.size,query_manifest:query.size,public_index:pub.size}},null,2));
} catch(error) {
  console.error(`Archive view preparation failed: ${error instanceof Error?error.message:String(error)}`);
  process.exitCode=1;
}
