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
  const manifest=await collectSnapshot({output,progress:console.log});
  console.log(JSON.stringify({id:manifest.id,date:manifest.date,status:manifest.status,counts:manifest.counts,errors:manifest.errors},null,2));
  if(process.env.GITHUB_STEP_SUMMARY) {
    const rows=manifest.datasets.map(dataset=>`| ${dataset.id} | ${dataset.status} | ${dataset.record_count} |`).join('\n');
    await appendFile(process.env.GITHUB_STEP_SUMMARY,`## OpenRouter synchronization: ${manifest.status}\n\nSnapshot: \`${manifest.id}\`\n\n| Dataset | Status | Records |\n|---|---|---:|\n${rows}\n\n${manifest.errors.map(error=>`- ${error}`).join('\n')}\n`);
  }
  if(process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,`snapshot_id=${manifest.id}\nsync_status=${manifest.status}\n`);
  if(manifest.status!=='success') {
    console.error('Synchronization failed. Attempt archived; last successful snapshot retained.');
    process.exitCode=1;
  }
} catch(error) {
  console.error(`Synchronization could not complete: ${error instanceof Error?error.message:String(error)}`);
  process.exitCode=1;
}
