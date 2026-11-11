/** Complete public snapshot contract for the static GitHub Pages build. */
export const MAX_BYTES = 2 * 1024 * 1024;
export const CHART_IDS = Array.from({length:14},(_,i)=>String(i+1).padStart(2,'0'));
export const PUBLIC_DATASETS = ['models','providers','embedding_models','image_models','video_models','eu_models','zdr_endpoints','model_count','model_rss','blog_posts','status_incidents','upstream_openapi','docs_index','site_index','endpoints','image_endpoints','public_model_rankings','public_ranking_history','public_performance','public_apps','public_app_rankings','public_model_activity','public_model_apps','public_session_cost','public_task_mix','public_discovery','public_modality_statistics','public_model_observations'];
const snapshotRE=/^\d{4}-\d{2}-\d{2}T\d{6}Z-[a-z0-9]+$/;
export function validatePayload(p) {
  if(p?.schemaVersion!==1 || !snapshotRE.test(p.snapshot||'') || !Number.isFinite(Date.parse(p.collectedAt)) || !/^[a-f0-9]{40}$/.test(p.archiveRevision||''))throw Error('INVALID_METADATA');
  if(!p.provenance?.archiveChecksumsVerified || p.provenance?.fixture_only || p.provenance?.fixtureOnly)throw Error('UNVERIFIED_ARCHIVE');
  if(!Array.isArray(p.chartIds)||p.chartIds.join(',')!==CHART_IDS.join(',')||!Array.isArray(p.charts)||p.charts.length!==14)throw Error('INCOMPLETE_CHARTS');
  for(const n of PUBLIC_DATASETS)if(!Number.isSafeInteger(p.coverage?.[n])||p.coverage[n]<0)throw Error('INVALID_COVERAGE');
  for(let i=0;i<14;i++){
    const c=p.charts[i];
    if(c.id!==CHART_IDS[i]||c.snapshot!==p.snapshot||typeof c.title!=='string'||!c.title||!Array.isArray(c.panels)||!c.panels.length||!Array.isArray(c.datasets)||!c.datasets.length||c.datasets.some(n=>!PUBLIC_DATASETS.includes(n)))throw Error('INVALID_CHART');
  }
  return p;
}
