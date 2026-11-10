import { expect, test } from 'vitest';
import { queryRows, dimensions, Query } from '../src/query.js';

test('combines author, modalities, context and numeric price filters before stable pagination', () => {
  const rows = [
    {id:'a/expensive', context_length:32000, pricing:{prompt:'0.00002'}, architecture:{input_modalities:['text','image'],output_modalities:['text']}},
    {id:'a/cheap', context_length:128000, pricing:{prompt:'0.000001'}, architecture:{input_modalities:['text','image'],output_modalities:['text']}},
    {id:'b/free', context_length:128000, pricing:{prompt:'0',completion:'0'}, architecture:{input_modalities:['text'],output_modalities:['text']}},
  ];
  const result = queryRows(rows, new URLSearchParams('author=a&input_modality=image&output_modality=text&min_context=64000&max_prompt_price=0.000002&sort=id&limit=1'));
  expect(result).toEqual({data:[rows[1]],total:1,limit:1,offset:0});
});

test('comma-separated filters trim whitespace and include all selected authors', () => {
  const rows=[{id:'a/one'},{id:'b/two'},{id:'c/three'}];
  expect(queryRows(rows,new URLSearchParams('author=a,%20b')).data).toEqual(rows.slice(0,2));
});

test('provider aggregation uses one canonical slug while filters accept aliases',()=>{
  const rows=[{model_id:'test/model',provider_name:'Example Host',provider_slug:'example-host',provider_tag:'example-host/turbo'}];
  const query=Query.parse({provider:'Example Host',dimension:'provider'});
  expect(dimensions(rows,query)).toMatchObject({data:[{value:'example-host',count:1}],total:1,matched_records:1});
});

test('RSS identity search reads the text of structured upstream GUIDs',()=>{
  const rows=[{guid:{'#text':'https://upstream.test/post-1','@_isPermaLink':'true'},title:'Original title'}];
  expect(queryRows(rows,new URLSearchParams('q=post-1')).data).toEqual(rows);
});

test('negative upstream price sentinels remain unknown for price filters and sort last',()=>{
  const rows=[{id:'test/dynamic',pricing:{prompt:'-1',completion:'-1'}},{id:'test/paid',pricing:{prompt:'0.00001',completion:'0.00002'}}];
  expect(queryRows(rows,new URLSearchParams('max_prompt_price=0.001')).data).toEqual([rows[1]]);
  expect(queryRows(rows,new URLSearchParams('free=false')).data).toEqual([rows[1]]);
  expect(queryRows(rows,new URLSearchParams('sort=pricing.prompt')).data).toEqual([rows[1],rows[0]]);
});

test('public ranking queries preserve native values and filter the source window and metric before paging',()=>{
  const rows=[
    {model_permaslug:'test/one',date:'2026-11-09',rankingMetricValue:200,prompt:null,_source:{window:'week',view:'week',metric:'tokens'}},
    {model_permaslug:'test/two',date:'2026-11-09',rankingMetricValue:100,prompt:50,_source:{window:'week',view:'week',metric:'tokens'}},
    {model_permaslug:'test/one',date:'2026-11-09',rankingMetricValue:900,_source:{window:'day',view:'day',metric:'tokens'}},
  ];
  expect(queryRows(rows,new URLSearchParams('window=week&metric=tokens&view=week&since=2026-11-01&until=2026-11-10&sort=rankingMetricValue&order=desc&limit=1'))).toEqual({data:[rows[0]],total:2,limit:1,offset:0});
  expect(rows[0]!.prompt).toBeNull();
});

test('public numeric application identities are queryable without changing their native type',()=>{
  const rows=[{app_id:42,name:'Public app',_source:{window:'week'}}];
  expect(queryRows(rows,new URLSearchParams('app=42')).data).toEqual(rows);
  expect(typeof rows[0]!.app_id).toBe('number');
});

test('performance provider filters use the two native best-provider observations without merging their meaning',()=>{
  const rows=[{slug:'test/model',model_permaslug:'test/model',best_latency_provider:'host-a',best_throughput_provider:'host-b',p50_latency:null,p50_throughput:123}];
  expect(queryRows(rows,new URLSearchParams('provider=host-b')).data).toEqual(rows);
  expect(dimensions(rows,Query.parse({dimension:'provider'})).data).toEqual([{value:'host-a',count:1},{value:'host-b',count:1}]);
});
