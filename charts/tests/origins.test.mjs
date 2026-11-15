import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {nonnegative,nativeDate,identifyOrigin,groupOrigin,compileUsage,compilePrices,compileActivity,compileOrigins,validateOrigins,aggregateUsage,aggregatePrices,compileValuation,aggregateValuation} from '../src/origins.mjs';
const map=JSON.parse(fs.readFileSync(new URL('../config/origin-attribution.v1.json',import.meta.url)));
const units={rankingMetricValue:'tokens',total_prompt_tokens:'tokens',total_completion_tokens:'tokens'};
const row=(extra={})=>({model_permaslug:'qwen/a',variant_permaslug:'qwen/a',variant:'standard',date:'2026-11-14 00:00:00',total_prompt_tokens:10,total_completion_tokens:5,rankingMetricValue:15,_source:{view:'day',metric:'tokens',units},...extra});
const model=(extra={})=>({id:'qwen/a',canonical_slug:'qwen/a',name:'A',architecture:{output_modalities:['text']},pricing:{prompt:'0.000001',completion:'0.000004'},...extra});
import {originFixture} from './fixtures/origins-fixture.mjs';

test('numeric parsing keeps actual zero, rejects null, blanks, booleans and negative sentinels',()=>{for(const x of [null,undefined,'',false,true,' ',NaN,Infinity,-1,'-1'])assert.equal(nonnegative(x),null);assert.equal(nonnegative('0'),0);assert.equal(nonnegative(7),7);});
test('origin uses only exact reviewed native namespace, never provider or fuzzy aliases',()=>{assert.equal(identifyOrigin('qwen/a',map).originId,'qwen');for(const x of ['',null,'qwen','~qwen/a','Qwen/a','unknown/qwen'])assert.equal(identifyOrigin(x,map).originId,'unknown');assert.equal(groupOrigin('google',map).id,'MULTI');assert.equal(groupOrigin('mistralai',map).id,'EUROPE');assert.equal(groupOrigin('mistralai',map,'country').id,'FR');});
test('native date preserved as calendar label without asserting timezone; invalid dates fail',()=>{assert.equal(nativeDate('2026-11-14 00:00:00'),'2026-11-14');assert.equal(nativeDate(null),null);assert.throws(()=>nativeDate('2026-02-30'));assert.throws(()=>nativeDate('2026-11-14 12:00:00'));});
test('day ranks never mix windows, dates, variants or drop unmapped and empty positive rows',()=>{const out=compileUsage([row(),row(),row({date:'2026-11-13 00:00:00'}),row({variant_permaslug:'qwen/a:free'}),row({model_permaslug:'',variant_permaslug:''}),row({model_permaslug:'',variant_permaslug:''}),row({_source:{view:'week',metric:'tokens'}})],map);assert.equal(out.rawRows,6);assert.equal(out.duplicateRows,1);assert.equal(out.rows.length,5);assert.equal(out.missingIdentityRows,2);assert.deepEqual(out.dates,['2026-11-13','2026-11-14']);assert.equal(aggregateUsage(out.rows,map).find(x=>x.id==='UNKNOWN').tokens,30);});
test('conflicting daily duplicate or total disagreement fails instead of arbitrary winner',()=>{assert.throws(()=>compileUsage([row(),row({total_prompt_tokens:20,rankingMetricValue:25})],map),/Conflicting/);assert.throws(()=>compileUsage([row({rankingMetricValue:9})],map),/disagrees/);});
test('unknown numeric totals stay null; measured zero remains zero',()=>{const rows=compileUsage([row({rankingMetricValue:null,total_prompt_tokens:null,total_completion_tokens:null})],map).rows;assert.equal(aggregateUsage(rows,map)[0].tokens,null);rows[0].tokens=0;assert.equal(aggregateUsage(rows,map)[0].tokens,0);});
test('prices dedup only exact canonical/price pairs, keep free/unknown and per-side stats',()=>{const prices=compilePrices([model(),model({id:'qwen/alias'}),model({id:'qwen/a:free',pricing:{prompt:'0',completion:'0'}}),model({canonical_slug:'qwen/b',pricing:{prompt:'-1',completion:'0.000002'}}),model({canonical_slug:null,id:'qwen/missing'}),model({canonical_slug:null,id:'qwen/missing2'}),model({architecture:{output_modalities:['image']}})],map);assert.equal(prices.rawRoutes,6);assert.equal(prices.offers.length,5);assert.equal(prices.aliasRoutes,1);assert.deepEqual(prices.offers[0].routes,['qwen/a','qwen/alias']);const cn=aggregatePrices(prices.offers,map).find(x=>x.id==='CN');assert.equal(cn.prompt.count,2);assert.equal(cn.prompt.missing,1);assert.equal(cn.prompt.mean,.5);assert.equal(cn.prompt.median,.5);assert.equal(cn.prompt.free,1);assert.equal(cn.completion.mean,2);assert.equal(prices.offers.at(-1).originId,'unknown');});
test('activity uses exact canonical request, dedups variant/day aliases and retains sparse native days',()=>{const out=compileActivity([{_source:{units},model_id:'qwen/alias',payload:{analytics:[row()]}},{_source:{units},model_id:'qwen/a',payload:{analytics:[row(),row({date:'2026-11-12 00:00:00'})]}},{_source:{units},model_id:'other/alias',payload:{analytics:[row({variant_permaslug:'other/a'})]}}],map,'2026-11-15T08:00:00Z');assert.equal(out.nativeRows,2);assert.equal(out.aliasDuplicateRows,1);assert.equal(out.excludedNoCanonicalRows,1);assert.deepEqual(out.days.map(x=>x.date),['2026-11-12','2026-11-14']);assert.equal(out.days.at(-1).partial,true);assert.equal(out.days[0].origins[0].tokens,15);});
test('activity conflicting aliases fail; absent identity is excluded with explicit count',()=>{assert.throws(()=>compileActivity([{_source:{units},model_id:'qwen/a',payload:{analytics:[row(),row({total_prompt_tokens:99})]}}],map,''),/Conflicting/);assert.equal(compileActivity([{_source:{units},model_id:'qwen/a',payload:{analytics:[row({variant_permaslug:''})]}}],map,'').excludedMissingIdentityRows,1);});
test('payload validates identity, counts, dates and numbers and keeps public provenance',()=>{const p=originFixture();validateOrigins(p);const mutate=fn=>{const x=structuredClone(p);fn(x);assert.throws(()=>validateOrigins(x));};mutate(x=>x.sourceCommit=null);mutate(x=>x.usage.rows[0].tokens=-1);mutate(x=>x.usage.dates=[]);mutate(x=>x.pricing.rawRoutes++);mutate(x=>x.activity.nativeRows++);mutate(x=>x.provenance.fixture_only=true);});

test('missing or changed token units cannot silently enter a token view',()=>{assert.throws(()=>compileUsage([row({_source:{view:'day',metric:'tokens'}})],map),/units/);assert.throws(()=>compileUsage([row({_source:{view:'day',metric:'tokens',units:{...units,rankingMetricValue:'requests'}}})],map),/units/);assert.throws(()=>compileActivity([{model_id:'qwen/a',payload:{analytics:[row()]}}],map,''),/units/);});

test('catalog-value scenario uses exact standard-model input/output rates, not average tariff',()=>{
 const usage=compileUsage([row()],map),pricing=compilePrices([model()],map),v=compileValuation(usage,pricing);
 assert.equal(v.rows[0].reason,'matched');assert.equal(v.rows[0].promptUsdPerMillion,1);assert.equal(v.rows[0].completionUsdPerMillion,4);assert.ok(Math.abs(v.rows[0].amountUsd-0.00003)<1e-15);
 assert.equal(v.rows[0].date,'2026-11-14');const g=aggregateValuation(v.rows,map)[0];assert.equal(g.matchedRows,1);assert.equal(g.tokenCoverage,1);
});
test('valuation excludes ambiguous, nonstandard, absent and incomplete observations without zero-imputation',()=>{
 const price=compilePrices([model(),model({id:'alias',pricing:{prompt:'0.000002',completion:'0.000004'}})],map);
 assert.equal(compileValuation(compileUsage([row()],map),price).rows[0].reason,'ambiguous_quote');
 const cases=[['batch','nonstandard_or_unknown_variant'],['free','nonstandard_or_unknown_variant'],[null,'nonstandard_or_unknown_variant']];
 for(const [variant,reason]of cases)assert.equal(compileValuation(compileUsage([row({variant})],map),compilePrices([model()],map)).rows[0].reason,reason);
 for(const [raw,offers,reason]of [[row({variant_permaslug:'qwen/b'}),[model()],'variant_identity_mismatch'],[row(),[],'no_eligible_base_text_quote'],[row(),[model({pricing:{prompt:'-1',completion:'1'}})],'missing_quote'],[row({rankingMetricValue:null}),[model()],'missing_usage']]){
  const v=compileValuation(compileUsage([raw],map),compilePrices(offers,map));assert.equal(v.rows[0].reason,reason);assert.equal(v.rows[0].amountUsd,null);assert.equal(aggregateValuation(v.rows,map)[0].amountUsd,null);
 }
});
test('valuation retains free observed zero and matched unknown geography; coverage is not extrapolated',()=>{
 const raw=[row(),row({model_permaslug:'unreviewed/a',variant_permaslug:'unreviewed/a'}),row({model_permaslug:'qwen/absent',variant_permaslug:'qwen/absent'})];
 const models=[model({pricing:{prompt:'0',completion:'0'}}),model({id:'unreviewed/a',canonical_slug:'unreviewed/a'})];
 const v=compileValuation(compileUsage(raw,map),compilePrices(models,map));const groups=aggregateValuation(v.rows,map);
 const cn=groups.find(r=>r.id==='CN'),unknown=groups.find(r=>r.id==='UNKNOWN');assert.equal(cn.amountUsd,0);assert.equal(cn.matchedRows,1);assert.equal(cn.excludedRows,1);assert.equal(cn.tokenCoverage,.5);assert.ok(unknown.amountUsd>0);assert.equal(unknown.matchedRows,1);
});
test('valuation rejects a modified computed amount or detached source row',()=>{const p=originFixture();p.valuation.rows[0].amountUsd=123;assert.throws(()=>validateOrigins(p),/Valuation/);});

test('standard valuation never borrows free, batch, alias or mixed-output route prices',()=>{
 const usage=compileUsage([row()],map);
 for(const m of [model({id:'qwen/a:free',pricing:{prompt:'0',completion:'0'}}),model({id:'qwen/a:batch'}),model({id:'~qwen/a'}),model({architecture:{output_modalities:['text','audio']},pricing:{prompt:'0',completion:'0'}})]){
  const v=compileValuation(usage,compilePrices([m],map));assert.equal(v.rows[0].reason,'no_eligible_base_text_quote');assert.equal(v.rows[0].amountUsd,null);
 }
 const offers=compilePrices([model(),model({id:'qwen/a:free',pricing:{prompt:'0',completion:'0'}}),model({id:'qwen/a:batch',pricing:{prompt:'0.0000005',completion:'0.000002'}})],map);
 const v=compileValuation(usage,offers);assert.equal(v.rows[0].reason,'matched');assert.deepEqual(v.rows[0].quoteRoutes,['qwen/a']);assert.ok(Math.abs(v.rows[0].amountUsd-.00003)<1e-15);
 const same=compilePrices([model(),model({id:'qwen/a:batch'})],map);assert.equal(same.offers.length,1);assert.deepEqual(same.offers[0].standardTextRoutes,['qwen/a']);
});

test('conditional tariffs are disclosed but never silently substituted into the default-price scenario',()=>{
 const prices=compilePrices([model({pricing:{prompt:'0.000001',completion:'0.000004',overrides:[{min_prompt_tokens:100,prompt:'0.000002',completion:'0.000008'}]}})],map);
 const v=compileValuation(compileUsage([row()],map),prices);assert.equal(v.rows[0].hasConditionalPricing,true);assert.ok(Math.abs(v.rows[0].amountUsd-.00003)<1e-15);const g=aggregateValuation(v.rows,map)[0];assert.equal(g.conditionalRows,1);assert.equal(g.conditionalTokens,15);
});
