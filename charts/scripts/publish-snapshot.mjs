import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {validatePayload} from '../src/payload.mjs';import {validateSnapshot} from '../src/contract.mjs';
const source=process.argv[2]||'.cache/current-snapshot.json',dest=process.argv[3]||'charts/site-dist';
const body=await fs.readFile(source,'utf8'),s=validateSnapshot(validatePayload(JSON.parse(body)));
await fs.writeFile(path.join(dest,'snapshot.json'),body);
await fs.writeFile(path.join(dest,'version.json'),JSON.stringify({schema_version:1,snapshot:s.snapshot,collected_at:s.collectedAt,archive_revision:s.archiveRevision,source_commit:s.sourceCommit,latest_attempt:s.latestAttempt,chart_count:s.charts.length,snapshot_sha256:createHash('sha256').update(body).digest('hex'),renderer:'ECharts 6.0.0 / browser SVG',source:'existing checksum-verified OpenRouter Data archive'},null,2)+'\n');
await fs.writeFile(path.join(dest,'.nojekyll'),'');
