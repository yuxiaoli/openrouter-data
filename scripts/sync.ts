import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { collectSnapshot } from '../src/collector.js';

function option(name:string,fallback:string):string {
  const index=process.argv.indexOf(name);
  if(index===-1)return fallback;
  const value=process.argv[index+1];
  if(!value||value.startsWith('--'))throw new Error(`Missing ${name} value`);
  return value;
}

try {
  const output=resolve(option('--output','data'));
  const concurrency=Number(option('--concurrency','4'));
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>6)throw new Error('--concurrency must be an integer from 1 to 6');
  const manifest=await collectSnapshot({output,concurrency,progress:console.log});
  console.log(JSON.stringify({id:manifest.id,date:manifest.date,status:manifest.status,counts:manifest.counts,error_count:manifest.errors.length,errors:manifest.errors.slice(0,20),manifest_path:`runs/${manifest.id}/manifest.json`},null,2));
  if(process.env.GITHUB_STEP_SUMMARY) {
    const rows=manifest.datasets.map(dataset=>`| ${dataset.id} | ${dataset.status} | ${dataset.record_count} | ${dataset.status==='ok'?'fresh':dataset.fallback?'stale fallback':dataset.status==='unavailable'?'excluded':'unavailable'} | ${dataset.fallback?.snapshot??(dataset.status==='ok'?manifest.id:'—')} | ${dataset.fallback?.collected_at??dataset.collected_at} |`).join('\n');
    const errors=manifest.errors.slice(0,25).map(error=>`- ${error}`).join('\n');
    const more=manifest.errors.length>25?`\n\n${manifest.errors.length-25} additional errors are retained in the complete manifest.\n`:'';
    await appendFile(process.env.GITHUB_STEP_SUMMARY,`## OpenRouter synchronization: ${manifest.status}\n\nAttempt snapshot: \`${manifest.id}\`. Counts below describe this attempt; stale data remains in the referenced earlier snapshot. Full errors: \`runs/${manifest.id}/manifest.json\`.\n\n| Dataset | Attempt status | Attempt records | Served state | Data snapshot | Data collection time |\n|---|---|---:|---|---|---|\n${rows}\n\n${errors}${more}\n`);
  }
  if(process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,`snapshot_id=${manifest.id}\nsync_status=${manifest.status}\n`);
  if(manifest.status!=='success') {
    console.error(manifest.status==='partial'
      ?'Synchronization partially completed. Fresh datasets and failed attempts archived; stale dataset references retained. The last fully successful snapshot is unchanged.'
      :'Synchronization failed for all enabled public datasets. Failed attempts archived; latest usable and last fully successful snapshots retained.');
    process.exitCode=1;
  }
} catch(error) {
  console.error(`Synchronization could not complete: ${error instanceof Error?error.message:String(error)}`);
  process.exitCode=1;
}
