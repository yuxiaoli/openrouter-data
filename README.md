# OpenRouter public data archive

This branch contains real collection attempts from https://github.com/yuxiaoli/openrouter-data.
`index.json` identifies the last successful snapshot and lists every completed attempt.
Each immutable `runs/<id>/` contains a manifest, queryable data and upstream responses under `raw/`.
Times and date partitions use UTC. Failed attempts do not advance `last_success`.
The service is independent of OpenRouter; official source URLs are attribution.

Credential-shaped examples in upstream documentation are explicitly redacted before public storage.
The manifest records the replacement rule/count, original response SHA-256 and archived SHA-256.
Responses with no matching credential-shaped text are stored byte-for-byte.
`.gitattributes` disables line-ending conversion so archived-response hashes remain verifiable.
Source code, API contract and collection limitations are on the `main` branch.

New snapshots use lossless gzip transport for dataset/chunk/raw files. The original logical paths,
objects and timestamps are unchanged; append `.gz` to a missing logical file and decompress it.
`runs/<id>/storage.json` records compressed and logical byte hashes and sizes. Full manifests,
query manifests and indexes remain JSON. Existing tracked snapshots remain in their original format.
The public API reads either representation; `npm run verify:archive` validates the logical bytes.
