import { expect, test } from 'vitest';
import { queryRows } from '../src/query.js';

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
