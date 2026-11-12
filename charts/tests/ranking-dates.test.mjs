import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compileRankings} from '../src/compile.mjs';
import {chartOptions,renderSvg} from '../src/charts.mjs';
import {sourceFixture} from './fixtures.mjs';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/weekly-rankings-2026-11-11.json',import.meta.url),'utf8'));
const metrics=['tokens','tokens_excl_byok','requests','spend'];
// Only the ranking records are historical evidence. Test manifest timing is synthetic.
const manifest={...sourceFixture().manifest,id:fixture.source.snapshot};
const expectedDates=['2026-11-10 00:00:00','2026-11-09 00:00:00'];
const selected=(rows,metric)=>rows.filter(r=>r._source?.view==='week'&&r._source?.metric===metric&&r.model_permaslug).sort((a,b)=>b.rankingMetricValue-a.rankingMetricValue).slice(0,8);

test('exact Nov11 top-eight records keep both native dates without dropping stealth/crouton-alpha',()=>{
 const before=structuredClone(fixture.data),chart=compileRankings(fixture.data,manifest);
 assert.deepEqual(fixture.data,before,'compilation cannot rewrite source records');
 assert.equal(chart.snapshot,fixture.source.snapshot);
 assert.deepEqual(chart.recordDates,expectedDates);
 assert.equal(chart.recordDate,null);assert.equal(chart.mixedRecordDates,true);
 assert.equal(chart.missingDateCount,0);assert.equal(chart.invalidDateCount,0);
 chart.panels.forEach((panel,i)=>{
  const expected=selected(before,metrics[i]);assert.equal(panel.rows.length,8);
  assert.deepEqual(panel.rows.map(r=>[r.label,r.rawValue,r.value,r.date]),expected.map(r=>[r.variant_permaslug||r.model_permaslug,r.rankingMetricValue,r.rankingMetricValue/panel.divisor,r.date]));
  assert.ok(panel.rows.every(r=>r.dateStatus==='valid'));
  assert.deepEqual(panel.recordDates,i<2?expectedDates:[expectedDates[0]]);
  assert.equal(panel.recordDate,i<2?null:expectedDates[0]);
  assert.equal(panel.mixedRecordDates,i<2);
  if(i<2){const older=panel.rows.filter(r=>r.date===expectedDates[1]);assert.equal(older.length,1);assert.equal(older[0].label,'stealth/crouton-alpha');assert.equal(older[0].rawValue,5074147929311);}
 });
 assert.equal(chart.panels[0].rows[7].label,'stealth/crouton-alpha');
 assert.equal(chart.panels[1].rows[4].label,'stealth/crouton-alpha');
 assert.equal(chart.panels[0].unit,'万亿 tokens');assert.equal(chart.panels[2].unit,'亿次请求');assert.equal(chart.panels[3].unit,'原始值：单位未声明');
 assert.match(chart.notes,/含 2 种有效值/);assert.match(chart.notes,/不假定相同起止/);
 assert.ok(!chart.title.includes('同一周窗口'));
});

test('same-date snapshots retain a common raw recordDate without fabricating a window',()=>{
 const source=sourceFixture(),chart=compileRankings(source.datasets.public_model_rankings,source.manifest);
 assert.equal(chart.recordDate,'2026-11-09 00:00:00');assert.deepEqual(chart.recordDates,['2026-11-09 00:00:00']);assert.equal(chart.mixedRecordDates,false);
 for(const panel of chart.panels){assert.equal(panel.recordDate,chart.recordDate);assert.deepEqual(panel.recordDates,chart.recordDates);for(const row of panel.rows){assert.equal(row.date,chart.recordDate);assert.equal(row.dateLabel,'date = '+row.date);}}
 assert.match(chart.notes,/week 精确起止未声明/);
});

test('missing and invalid native dates remain unknown, preserve raw values, and never remove rankings',()=>{
 const rows=structuredClone(fixture.data);rows[0].date=null;delete rows[1].date;rows[2].date='not-a-date';rows[3].date='2026-02-30 00:00:00';rows[4].date=42;rows[5].date='';rows[6].date='2024-02-29T01:02:03Z';
 const chart=compileRankings(rows,manifest),first=chart.panels[0].rows;
 assert.equal(chart.panels.flatMap(p=>p.rows).length,32);assert.equal(chart.recordDate,null);
 assert.equal(chart.missingDateCount,3);assert.equal(chart.invalidDateCount,3);
 assert.deepEqual(first.slice(0,7).map(r=>r.date),[null,null,'not-a-date','2026-02-30 00:00:00',42,'','2024-02-29T01:02:03Z']);
 assert.deepEqual(first.slice(0,7).map(r=>r.dateStatus),['missing','missing','invalid','invalid','invalid','missing','valid']);
 assert.equal(first[0].dateLabel,'date 未提供');assert.match(first[2].dateLabel,/date 无效/);
 assert.ok(!chart.recordDates.includes('2026-02-30 00:00:00'));
 assert.match(chart.notes,/缺失 3 条/);assert.match(chart.notes,/无效 3 条/);
});

test('native date strings are never normalized to snapshot time or to another timezone',()=>{
 const rows=structuredClone(fixture.data);rows[0].date='2026-11-10T08:00:00+08:00';rows[1].date='2026-11-10T00:00:00Z';rows[2].date='2026-11-10';rows[3].date='2026-11-10 24:00:00';rows[4].date='2026-11-10T00:00:00+25:00';
 const chart=compileRankings(rows,manifest),p=chart.panels[0];
 assert.deepEqual(p.rows.slice(0,3).map(r=>r.date),rows.slice(0,3).map(r=>r.date));
 assert.ok(p.rows.slice(0,3).every(r=>r.dateStatus==='valid'));
 assert.ok(p.rows.slice(3,5).every(r=>r.dateStatus==='invalid'));
 assert.equal(p.recordDate,null);
});

test('date metadata cannot affect stable ranking order or metric selection',()=>{
 const rows=structuredClone(fixture.data);rows[0].rankingMetricValue=rows[1].rankingMetricValue;rows[0].date='2020-01-01';rows[1].date='2030-01-01';
 rows.push({...rows[0],_source:{...rows[0]._source,view:'day'},rankingMetricValue:1e15});
 const chart=compileRankings(rows,manifest);
 assert.deepEqual(chart.panels[0].rows.map(r=>[r.label,r.rawValue]),selected(rows,'tokens').map(r=>[r.variant_permaslug||r.model_permaslug,r.rankingMetricValue]));
 assert.equal(chart.panels[0].rows[0].date,'2020-01-01');assert.equal(chart.panels[0].rows[1].date,'2030-01-01');
});

test('SVG labels visibly preserve every native date and the caveat without an unbounded footer list',()=>{
 const chart=compileRankings(fixture.data,manifest),options=chartOptions(chart),svg=renderSvg(chart);
 chart.panels.forEach((panel,i)=>panel.rows.forEach((row,j)=>assert.equal(options.yAxis[i].data[j],`${row.label}\ndate = ${row.date}`)));
 for(const date of expectedDates)assert.ok(svg.includes('date = '+date));
 assert.ok(svg.includes('stealth/crouton-alpha'));assert.ok(svg.includes('不假定相同起止'));
 assert.ok(!svg.includes('同一周窗口'));assert.ok(!/NaN|Infinity/.test(svg));
 // 32 distinct valid raw dates are metadata, not 32 appended footer values.
 const rows=structuredClone(fixture.data);rows.forEach((r,i)=>{r.date=`2026-11-${String(i%28+1).padStart(2,'0')} ${String(Math.floor(i/28)).padStart(2,'0')}:00:00`;});
 const many=compileRankings(rows,manifest);assert.equal(many.recordDates.length,32);assert.ok(many.notes.length<200);assert.ok(!many.notes.includes(rows[0].date));
});
