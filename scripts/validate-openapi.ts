import SwaggerParser from '@apidevtools/swagger-parser';
import { readFile } from 'node:fs/promises';
import { datasetIds } from '../src/contracts.js';
const spec=JSON.parse(await readFile('docs/api/openapi.json','utf8'));
await SwaggerParser.validate(spec);
const documented = new Set(spec.components.schemas.DatasetId.enum);
for(const id of datasetIds) if(!documented.has(id)) throw new Error(`Dataset missing from OpenAPI: ${id}`);
for(const path of ['/','/healthz','/api/v1/snapshots','/api/v1/manifest','/api/v1/datasets','/api/v1/catalog','/feeds.json','/api/v1/data','/api/v1/dimensions','/rss.xml','/docs/api/openapi.json','/openapi.json']) if(!spec.paths[path]?.get) throw new Error(`Missing endpoint ${path}`);
console.log(`OpenAPI validated: ${Object.keys(spec.paths).length} paths, ${datasetIds.length} datasets.`);
