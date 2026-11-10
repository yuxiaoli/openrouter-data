import {packArchive,verifyPackedArchive} from '../src/archive-storage.js';
function option(name:string):string|undefined {const index=process.argv.indexOf(name);if(index===-1)return undefined;const value=process.argv[index+1];if(!value||value.startsWith('--'))throw new Error(`Missing ${name} value`);return value;}
try {
  const snapshot=option('--snapshot');
  if(!snapshot)throw new Error('Explicit --snapshot is required; packing never selects an older run implicitly');
  await packArchive(option('--output')??'data',snapshot);
  console.log(JSON.stringify({status:'packed',...await verifyPackedArchive(option('--output')??'data',snapshot)},null,2));
}catch(error){console.error(`Archive packing failed: ${error instanceof Error?error.message:String(error)}`);process.exitCode=1;}
