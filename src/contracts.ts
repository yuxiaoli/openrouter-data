import { z } from 'zod';

export const datasetIds = ['models', 'providers', 'endpoints', 'embedding_models', 'image_models', 'video_models', 'image_endpoints', 'eu_models', 'zdr_endpoints', 'model_count', 'model_rss', 'blog_posts', 'status_incidents', 'upstream_openapi', 'docs_index', 'site_index'] as const;
export const DatasetId = z.enum(datasetIds);
export type DatasetId = z.infer<typeof DatasetId>;
export type Row = Record<string, unknown>;

export const DatasetReport = z.object({
  id: z.string(), source_url: z.string(), documentation_url: z.string().optional(),
  collected_at: z.string(), status: z.enum(['ok', 'failed', 'unavailable']),
  record_count: z.number().int().nonnegative(), coverage: z.string(),
  unavailable: z.array(z.string()), errors: z.array(z.string()),
  raw_path: z.string().optional(), sha256: z.string().optional(),
  http_status: z.number().optional(),
}).passthrough();
export type DatasetReport = z.infer<typeof DatasetReport>;
export const SnapshotSummary = z.object({
  id: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{6}Z-[a-z0-9]+$/),
  date: z.string(), started_at: z.string(), completed_at: z.string(),
  status: z.enum(['success', 'failed']), counts: z.record(z.string(), z.number()),
  errors: z.array(z.string()),
});
export type SnapshotSummary = z.infer<typeof SnapshotSummary>;
export const Manifest = SnapshotSummary.extend({schema_version: z.literal(1), datasets: z.array(DatasetReport)});
export type Manifest = z.infer<typeof Manifest>;
export const ArchiveIndex = z.object({
  schema_version: z.literal(1), updated_at: z.string(), last_success: z.string().nullable(),
  snapshots: z.array(SnapshotSummary),
});
export type ArchiveIndex = z.infer<typeof ArchiveIndex>;

export type Result<T> = { ok: true; value: T } | { ok: false; error: {code: string; message: string; status: number} };
export interface ArchiveStore {
  read(path: string): Promise<Result<unknown>>;
}
