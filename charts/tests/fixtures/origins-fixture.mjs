import fs from 'node:fs';
import {compileOrigins} from '../../src/origins.mjs';
const map=JSON.parse(fs.readFileSync(new URL('../../config/origin-attribution.v1.json',import.meta.url)));
const units={rankingMetricValue:'tokens',total_prompt_tokens:'tokens',total_completion_tokens:'tokens'};
const row=()=>({model_permaslug:'qwen/a',variant_permaslug:'qwen/a',date:'2026-11-14 00:00:00',total_prompt_tokens:10,total_completion_tokens:5,rankingMetricValue:15,_source:{view:'day',metric:'tokens',units}});
const model=()=>({id:'qwen/a',canonical_slug:'qwen/a',name:'A',architecture:{output_modalities:['text']},pricing:{prompt:'0.000001',completion:'0.000004'}});
export function originFixture(){const datasets={public_model_rankings:[row()],models:[model()],public_model_activity:[{_source:{units},model_id:'qwen/a',payload:{analytics:[row()]}}]};return compileOrigins({manifest:{id:'2026-11-15T075642Z-c14b24d0a2',status:'success',completed_at:'2026-11-15T07:59:15.689Z',datasets:Object.entries(datasets).map(([id,d])=>({id,status:'ok',record_count:d.length}))},datasets,source_commit:'b'.repeat(40),archive_revision:'a'.repeat(40),provenance:{archiveChecksumsVerified:true}},map);}
