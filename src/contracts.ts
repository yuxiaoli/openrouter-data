import { z } from 'zod';

export const datasetIds = ['models', 'providers', 'endpoints', 'embedding_models', 'image_models', 'video_models', 'image_endpoints', 'eu_models', 'zdr_endpoints', 'model_count', 'model_rss', 'blog_posts', 'status_incidents', 'upstream_openapi', 'docs_index', 'site_index', 'public_model_rankings', 'public_ranking_history', 'public_performance', 'public_apps', 'public_app_rankings', 'public_model_activity', 'public_model_apps', 'public_session_cost', 'public_task_mix', 'public_discovery', 'public_modality_statistics', 'public_model_observations'] as const;
export const DatasetId = z.enum(datasetIds);
export type DatasetId = z.infer<typeof DatasetId>;
export type Row = Record<string, unknown>;

const SnapshotId = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{6}Z-[a-z0-9]+$/);
const Window = z.object({
  label:z.string(),start:z.string().nullable().optional(),end:z.string().nullable().optional(),
  timezone:z.string().nullable().optional(),kind:z.string().optional(),
}).passthrough();
const SourceMetadata = {
  category:z.string().optional(),units:z.record(z.string(),z.string()).optional(),window:Window.optional(),
  access:z.enum(['public','authenticated']).optional(),endpoint_scope:z.string().optional(),
  observed_at:z.string().optional(),request_started_at:z.string().optional(),request_completed_at:z.string().optional(),
};
const StorageMetadata={
  chunks:z.array(z.string()).optional(),chunk_counts:z.record(z.string(),z.number().int().nonnegative()).optional(),
  chunk_sha256s:z.record(z.string(),z.string()).optional(),model_chunks:z.record(z.string(),z.array(z.string())).optional(),
  shards:z.record(z.string(),z.string()).optional(),default_order:z.string().optional(),
  row_count_actual:z.number().int().nonnegative().optional(),normalized_sha256:z.string().optional(),
  coverage_count:z.record(z.string(),z.number().int().nonnegative()).optional(),
  coverage_by_model:z.record(z.string(),z.record(z.string(),z.number().int().nonnegative())).optional(),
};
export const DatasetReference = z.object({
  snapshot:SnapshotId,collected_at:z.string(),record_count:z.number().int().nonnegative(),
  source_url:z.string(),data_path:z.string().regex(/^runs\/\d{4}-\d{2}-\d{2}T\d{6}Z-[a-z0-9]+\/[a-z0-9_]+\.json$/),
  documentation_url:z.string().optional(),raw_path:z.string().optional(),sha256:z.string().optional(),
  original_sha256:z.string().optional(),coverage:z.string().optional(),...SourceMetadata,...StorageMetadata,
}).passthrough();
export type DatasetReference = z.infer<typeof DatasetReference>;
export const DatasetReport = z.object({
  id: z.string(), source_url: z.string(), documentation_url: z.string().optional(),
  collected_at: z.string(), status: z.enum(['ok', 'failed', 'unavailable']),
  record_count: z.number().int().nonnegative(), coverage: z.string(),
  unavailable: z.array(z.string()), errors: z.array(z.string()),
  raw_path: z.string().optional(), sha256: z.string().optional(),
  http_status: z.number().optional(),fallback:DatasetReference.optional(),...SourceMetadata,...StorageMetadata,
}).passthrough();
export type DatasetReport = z.infer<typeof DatasetReport>;
export const SnapshotSummary = z.object({
  id: SnapshotId,
  date: z.string(), started_at: z.string(), completed_at: z.string(),
  status: z.enum(['success', 'partial', 'failed']), counts: z.record(z.string(), z.number()),
  errors: z.array(z.string()),
  error_count:z.number().int().nonnegative().optional(),errors_truncated:z.boolean().optional(),
});
export type SnapshotSummary = z.infer<typeof SnapshotSummary>;
export const Manifest = SnapshotSummary.extend({schema_version: z.literal(1), datasets: z.array(DatasetReport)});
export type Manifest = z.infer<typeof Manifest>;
export const ArchiveIndex = z.object({
  schema_version: z.literal(1), updated_at: z.string(), last_success: z.string().nullable(),
  latest_snapshot:SnapshotId.nullable().optional(),dataset_last_success:z.record(z.string(),DatasetReference).optional(),
  snapshots: z.array(SnapshotSummary),
});
export type ArchiveIndex = z.infer<typeof ArchiveIndex>;

export type Result<T> = { ok: true; value: T } | { ok: false; error: {code: string; message: string; status: number} };
export interface ArchiveStore {
  read(path: string): Promise<Result<unknown>>;
}
