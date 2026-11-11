import fs from 'node:fs';import assert from 'node:assert/strict';import {validateSnapshot} from '../src/contract.mjs';
if(process.argv.length<4)throw new Error('Usage: node scripts/verify-reference.mjs <compact-snapshot.json> <oracle.json>');
const snapshot=validateSnapshot(JSON.parse(fs.readFileSync(process.argv[2]))),oracle=JSON.parse(fs.readFileSync(process.argv[3]));assert.equal(snapshot.snapshot,oracle.snapshot);
const values=p=>p.rows.map(r=>r.value),series=p=>p.series.map(s=>s.points.map(p=>p.value));
const projections={
 '01':c=>c.panels.map(values),'02':c=>c.panels.map(p=>p.points),'03':c=>c.panels.map(p=>p.rows.map(r=>[r.label,r.value])),
 '04':c=>c.panels.map(series),'05':c=>c.panels.map(p=>({points:p.points.map(q=>[q.time,q.value]),incomplete:p.incomplete})),
 '06':c=>c.panels.map(p=>p.rows.map(r=>[r.a,r.b])),'07':c=>c.panels.map(values),'08':c=>c.panels.map(p=>p.buckets.map(b=>({values:b.values,stats:b.stats}))),
 '09':c=>[c.panels[0].rows.map(r=>[r.a,r.b]),series(c.panels[1])],'10':c=>c.panels.map(series),'11':c=>c.panels.map(series),
 '12':c=>[values(c.panels[0]),values(c.panels[1]),c.panels[2].rows.map(r=>r.time)],'13':c=>c.panels.map(values),
 '14':c=>[...c.panels.slice(0,3).map(values),c.panels[3].rows.map(r=>r.values)]
};
let numeric=0;
function same(a,b,where){if(typeof a==='number'&&typeof b==='number'){numeric++;assert.ok(Math.abs(a-b)<=Math.max(1e-12,Math.abs(b)*1e-12),`${where}: ${a} != ${b}`);}else if(Array.isArray(a)){assert.ok(Array.isArray(b),where);assert.equal(a.length,b.length,where);a.forEach((x,i)=>same(x,b[i],`${where}/${i}`));}else if(a&&typeof a==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort(),where);for(const k of Object.keys(a))same(a[k],b[k],`${where}/${k}`);}else assert.equal(a,b,where);}
for(const c of snapshot.charts){same(projections[c.id](c),oracle.numeric[c.id],c.id);console.log('PASS',c.id,c.title);}console.log(`Verified ${numeric} numerical values against independent Python/NumPy/Matplotlib calculations; nulls, identities and shapes also match.`);
