# OpenRouter Data Archive

独立的 OpenRouter 公共数据每日快照、JSON 查询 API 和 RSS 服务。仓库：<https://github.com/yuxiaoli/openrouter-data>；Cloudflare 服务：<https://openrouter-data.pages.dev>。本项目不由 OpenRouter 运营，官方地址仅作为上游来源归属，不冒称本项目服务。

API 1.1 保留 `/api/v1/` 路径和 `schema_version: 1`，在原有 16 类数据上增加 12 类公开统计；旧快照继续可读。实际线上覆盖、失败与数据时间以 [manifest](https://openrouter-data.pages.dev/api/v1/manifest) 为准，发布验收记录见 [operations](docs/operations.md)。

先看 [数据目录 catalog](https://openrouter-data.pages.dev/api/v1/catalog)、[全部订阅 feeds.json](https://openrouter-data.pages.dev/feeds.json) 和 [总览 RSS](https://openrouter-data.pages.dev/rss.xml?type=overview)：每个数据集都有分类、关键字段、真实状态、覆盖范围及完整 JSON / RSS 链接。

## 数据与来源

28 个数据集按用途分类；数据有重叠，条数不可相加当作独立模型或全平台用量：

| 类别 | 数据集 |
| --- | --- |
| 目录 | `models`、`providers`、`embedding_models`、`image_models`、`video_models`、`eu_models`、`model_count` |
| 性能与观测 | `endpoints`、`image_endpoints`、`zdr_endpoints`、`public_performance`、`public_model_observations` |
| 排名 | `public_model_rankings`、`public_app_rankings`、`public_modality_statistics` |
| 用量与公开聚合 | `public_ranking_history`、`public_apps`、`public_model_activity`、`public_model_apps`、`public_session_cost`、`public_task_mix`、`public_discovery` |
| 内容 | `model_rss`、`blog_posts`、`status_incidents` |
| 文档 | `upstream_openapi`、`docs_index`、`site_index` |

新增 12 类的用途与直接入口：

| 数据集 | 原生内容 | 入口 |
| --- | --- | --- |
| `public_model_rankings` | day/week/month × tokens、tokens_excl_byok、requests、spend 排名 | [JSON](https://openrouter-data.pages.dev/api/v1/data?type=public_model_rankings&limit=20) · [RSS](https://openrouter-data.pages.dev/rss.xml?type=public_model_rankings&limit=20) |
| `public_ranking_history` | 多种历史图表、Others、语言抽样值和完整 benchmark 视图 | [JSON](https://openrouter-data.pages.dev/api/v1/data?type=public_ranking_history) · [RSS](https://openrouter-data.pages.dev/rss.xml?type=public_ranking_history) |
| `public_performance` | p50 latency/throughput、request_count、最佳 provider 等原字段 | [JSON](https://openrouter-data.pages.dev/api/v1/data?type=public_performance) · [RSS](https://openrouter-data.pages.dev/rss.xml?type=public_performance) |
| `public_apps` | marketplace 全部 popular/trending/leaderboards/globalRankingMap 对象 | [JSON](https://openrouter-data.pages.dev/api/v1/data?type=public_apps) · [RSS](https://openrouter-data.pages.dev/rss.xml?type=public_apps) |
| `public_app_rankings` | 多窗口 app 榜、正常/low-count 子类和类别图表 | [JSON](https://openrouter-data.pages.dev/api/v1/data?type=public_app_rankings&limit=20) · [RSS](https://openrouter-data.pages.dev/rss.xml?type=public_app_rankings&limit=20) |
| `public_model_activity` | 每模型完整滚动 analytics，含缓存/BYOK/工具/多模态用量 | [JSON](https://openrouter-data.pages.dev/api/v1/data?type=public_model_activity&limit=1) · [RSS](https://openrouter-data.pages.dev/rss.xml?type=public_model_activity&limit=5) |
| `public_model_apps` | 每模型 top_apps、两类 chart 和 cachedAt | [JSON](https://openrouter-data.pages.dev/api/v1/data?type=public_model_apps&limit=1) · [RSS](https://openrouter-data.pages.dev/rss.xml?type=public_model_apps&limit=5) |
| `public_session_cost` | 公开会话分桶 medianUsd、windowDays/windowEnd | [JSON](https://openrouter-data.pages.dev/api/v1/data?type=public_session_cost) · [RSS](https://openrouter-data.pages.dev/rss.xml?type=public_session_cost) |
| `public_task_mix` | spend/token 分类份额及 deltaPp | [JSON](https://openrouter-data.pages.dev/api/v1/data?type=public_task_mix) · [RSS](https://openrouter-data.pages.dev/rss.xml?type=public_task_mix) |
| `public_discovery` | discovery、router、公开 provider 政策和 provider token 图表 | [JSON](https://openrouter-data.pages.dev/api/v1/data?type=public_discovery) · [RSS](https://openrouter-data.pages.dev/rss.xml?type=public_discovery) |
| `public_modality_statistics` | 8 种模态的图表、模型榜、分类选项/排名/份额 | [JSON](https://openrouter-data.pages.dev/api/v1/data?type=public_modality_statistics&limit=10) · [RSS](https://openrouter-data.pages.dev/rss.xml?type=public_modality_statistics&limit=10) |
| `public_model_observations` | 每模型 listed/effective pricing、uptime、provider token 和 colos | [JSON](https://openrouter-data.pages.dev/api/v1/data?type=public_model_observations&limit=1) · [RSS](https://openrouter-data.pages.dev/rss.xml?type=public_model_observations&limit=5) |

新增来源是官方公开页面实际引用、匿名 GET 已验证的 `/api/frontend/v1/...`，多数未文档且可能变化；不能与认证 `/api/v1/datasets/...` 混同。按用户当前要求，**暂不启用认证 Data API**，也不请求、存储或公开个人账户用量、私人会话、密钥或私有请求。公开聚合不代表全部平台流量。准确 URL、来源差异与缺口见 [来源说明](docs/sources.md) 和 [2026-11-10 复核](docs/source-audit-2026-11-10.md)。

所有来源保留原生字段、未知字段、父对象、窗口/cache 元数据和 null。`medianUsd` 明确为美元；其他 performance、价格或图表未声明单位/窗口时标记 unspecified，不从数值猜单位。图像、文档、视频秒/小时、转写字符、request、token、比例及百分点不可相加。目录中的 latency/throughput 字段可能全部为 null；不能因字段存在就宣称取得非空测量值，benchmarks 缺失值也不补齐。项目启动前的快照不回填；当前取得的旧日期滚动序列仍是当前观测。

官方 JSON 为 <https://openrouter.ai/api/v1/models?output_modalities=all>，官方 RSS 为 <https://openrouter.ai/api/v1/models?use_rss=true&output_modalities=all>。本项目复用并归档这些来源，另外提供自己的快照查询与 RSS，保留独立标题、self link 和来源说明。

## 查询 API

完整端点、参数约束、响应结构和示例见 [docs/api/openapi.json](docs/api/openapi.json)，线上同路径为 <https://openrouter-data.pages.dev/docs/api/openapi.json>。`/openapi.json` 为别名。

| 端点 | 用途 |
| --- | --- |
| `/` | 项目、来源和 API 导航 |
| `/healthz` | 上次成功、最近尝试及过期状态；采集失败或过期会降级 |
| `/api/v1/snapshots` | 按 `from` / `to` / `status` 筛选历史，使用 `limit` / `offset` 分页 |
| `/api/v1/manifest` | `date` 或 `snapshot` 对应运行的来源、覆盖与缺口 |
| `/api/v1/datasets` | 该快照各数据集的采集报告 |
| `/api/v1/catalog`、`/feeds.json` | 28 类数据的分类、状态、覆盖范围与 JSON / RSS 入口 |
| `/api/v1/data` | 通过 `type` 选择数据集，筛选、排序和分页 |
| `/api/v1/dimensions` | 通过 `dimension` 汇总作者、供应商、模态或支持参数 |
| `/rss.xml` | 各类型 RSS 摘要；`type=overview` 是数据集观测总览 |

`date=latest`（默认）选择最近可用的 success / partial 快照；`date=YYYY-MM-DD` 选择该 UTC 日最近可用快照；`snapshot=<id>` 精确选择一次运行，不能与 `date` 同用。失败尝试可以查看 manifest，但不能作为成功数据返回。历史列表保留 success / partial / failed。

```sh
# 新增公开统计：周榜窗口与实际 metric，保留 rankingMetricValue 的原始含义
curl 'https://openrouter-data.pages.dev/api/v1/data?type=public_model_rankings&view=week&metric=tokens_excl_byok&sort=rankingMetricValue&order=desc&limit=20'
curl 'https://openrouter-data.pages.dev/api/v1/data?type=public_modality_statistics&modality=image&kind=modality_models&view=week&limit=20'
curl 'https://openrouter-data.pages.dev/api/v1/data?type=public_app_rankings&group=coding&window=month&metric=requests&kind=app_category&limit=20'
curl 'https://openrouter-data.pages.dev/api/v1/data?type=public_model_observations&model=liquid%2Flfm-3-1.7b&kind=listed-pricing&limit=1'

# 最新全模态目录，OpenAI 作者、至少 128K 上下文，分页
curl 'https://openrouter-data.pages.dev/api/v1/data?type=models&author=openai&min_context=128000&limit=20&offset=0'

# Image 输入、支持 tools 的模型；价格按上游美元/每token单位筛选
curl 'https://openrouter-data.pages.dev/api/v1/data?type=models&input_modality=image&parameter=tools&max_prompt_price=0.00001&sort=pricing.prompt&order=asc'

# 模型端点中的供应商维度
curl 'https://openrouter-data.pages.dev/api/v1/dimensions?type=endpoints&dimension=provider&limit=20'

# 指定日期模型与运行覆盖范围（日期必须已真实采集）
curl 'https://openrouter-data.pages.dev/api/v1/data?type=models&date=2026-11-08&limit=10'
curl 'https://openrouter-data.pages.dev/api/v1/manifest?date=2026-11-08'

# 历史失败尝试和独立 RSS
curl 'https://openrouter-data.pages.dev/api/v1/snapshots?status=failed&limit=20'
curl 'https://openrouter-data.pages.dev/rss.xml?type=models&author=anthropic&limit=20'
```

RSS 默认让最近内容在前：模型目录按创建时间降序，模型 / 博客 / 状态 feed 按上游发布时间降序；可用 `sort` / `order` 显式覆盖。`sort=published_at` 读取 RSS 的 `pubDate` 或 `published_at`，完整规则见 OpenAPI。

RSS 是**字段摘要和完整 JSON 导航**，不是大型原生 payload 的完整镜像：每项注明来源、窗口/单位、数据时间和状态，并链接完整 JSON。`payload` 中的全部 analytics、图表、父对象和 cache 元数据通过 JSON/归档读取；`type=overview` 帮助发现默认 models feed 之外的数据。

筛选项包括 `q`、`model`、`author`、`provider`、`input_modality`、`output_modality`、`parameter`、`min_context`、`max_prompt_price` 和 `free`；具体适用类型见 OpenAPI。离散过滤值支持逗号分隔，组内为 OR、不同条件为 AND。未知、重复、冲突或不适用参数返回 400，不会默默忽略。JSON 列表使用 `meta`、`data`、`pagination` 包装；`meta.coverage` 附该数据集的来源与缺口。缺失或负值价格视为未知，不参与价格/免费筛选，价格排序时放最后；原始负值仍保留在数据中。`free=true` 仅匹配明确为零的 prompt 与 completion 单价。多值维度同一记录可能计入多个桶，维度计数不可直接相加当作独立模型数。

公开统计还支持 `window/metric/view/kind/section/group/subcategory/modality`；`app` 用于公开 app 排名。`since/until` 筛选行的原生日期/发布时间，不会递归裁剪 `payload` 内的图表。维度可按 window/metric/view/kind/section/group/subcategory/modality 汇总。JSON `limit` 为 1–500，RSS 最多 100；大数据使用 chunks 和模型索引，默认 `id asc` 无过滤分页只读相关块，`model` 优先读取相应模型块。广域筛选、排序或汇总可能需要更多块，建议先限定模型与窗口；全部适用范围、排序枚举见 OpenAPI。

## 快照与失败处理

代码只在 `main` 分支，快照只在 [`data` 分支](https://github.com/yuxiaoli/openrouter-data/tree/data)。每次真实运行生成独立 UTC ID，同一天多次运行也各自保留：

```text
index.json
runs/<YYYY-MM-DDTHHMMSSZ-random>/manifest.json
runs/<snapshot-id>/<dataset>.json
runs/<snapshot-id>/raw/...
runs/<snapshot-id>/chunks/<dataset>/...
```

`index.json` 保留运行摘要、整体 `last_success`、最近可用 `latest_snapshot` 和逐数据集 `dataset_last_success`。单次运行目录不可覆盖；部分来源失败时记录 partial，保留本次成功来源，失败数据集仅能使用其以前的成功 fallback，整体 `last_success` 不冒充推进。完全失败仍归档错误，不以空数据覆盖成功结果。旧 16 类 schema_version 1 快照仍可读取，没有新数据集的旧日期不补造。

fallback 返回 `meta.status=stale`，`meta.snapshot/data_collected_at` 指向真实旧结果，`attempt_snapshot/attempt_completed_at` 指向本次尝试；错误和来源同时可见。没有可用 fallback 则返回 503，不能把旧数据改成新采集时间。partial / failed 同步仍以非零退出，不能以 API 返回 200 当作全体来源成功。

manifest 的 `raw_path/pages` 可定位原响应：从 GitHub 固定 data 提交读取 `runs/<snapshot>/<raw_path>`；逐请求 NDJSON 通过 `body_base64` 或 `body_base64_chunks` 保存/引用响应字节。大型 `<dataset>.json` 可能是块索引，应读取 manifest.chunks；可运行 `npm run verify:archive -- data` 验证。官方 OpenAPI 凭据样例按报告脱敏，`sha256` 为归档字节、`original_sha256` 为脱敏前响应标识，不将样例当可用凭据。

服务从 GitHub raw 读取数据，因此依赖 GitHub 可用性。索引与响应存在短期缓存，新记录可能数分钟后可见；精确 `snapshot` 查询便于验证指定版本。最近可用结果超过 36 小时，或最近尝试为 partial / failed，会使健康检查降级；旧数据始终携带真实采集时间。

## 每日任务与本机操作

[`Daily OpenRouter snapshot`](https://github.com/yuxiaoli/openrouter-data/actions/workflows/sync.yml) 使用 GitHub Actions：每天 **01:23 UTC / 北京时间 09:23**，同时支持 `workflow_dispatch`。GitHub 定时任务可能延迟；以 Actions 运行记录判断实际执行。任务串行运行，使用内置 `GITHUB_TOKEN` 的 `contents:write` 权限只推送 `data` 分支，无 Cloudflare secret。采集失败仍归档失败报告并让 job 失败；日志、索引和最近 manifest 作为 artifact 保留 14 天。成功同步后验收线上指定快照，允许最多约六分钟的缓存传播重试。

2026-11-10 已观察到的[自然定时运行 42782949976](https://github.com/yuxiaoli/openrouter-data/actions/runs/42782949976) 在北京 16:28 启动；保留实际时间，不推断原因，不因此修改 09:23 的 cron。

```sh
npm ci
npm run check
npm run build

# 从仓库 data 分支取回历史后再采集，保留旧结果
git clone --branch data --single-branch https://github.com/yuxiaoli/openrouter-data.git data
npm run sync -- --output data

# 只校验，不发布
npm run smoke -- https://openrouter-data.pages.dev

# 手动触发已启用的 Actions
gh workflow run sync.yml --repo yuxiaoli/openrouter-data --ref main
```

本机采集不会自行推送。审查 `data/index.json` 与新 manifest 后，在 `data` 子目录提交并推送。不要把 `data/` 加入 `main`，不要编辑旧运行目录；修正采集器后创建新运行。修改代码必须通过 `npm run check`、`npm run build`，API 变化同步更新 OpenAPI；上线后执行 `npm run smoke`。CI 在 main push 与 PR 时执行这些本地检查，持有只读仓库权限。

## Cloudflare 部署

服务采用 Cloudflare Pages advanced mode，`npm run build` 产出 `dist/_worker.js`。使用已有 Cloudflare Pages 授权部署，不需要 Workers / KV 权限，也不将本机凭据复制到仓库或 Actions：

```sh
npm run check
npm run build
npx wrangler pages deploy dist --project-name openrouter-data --branch main
npm run smoke -- https://openrouter-data.pages.dev
```

每日同步仅更新数据分支，不重新部署代码。代码部署与数据同步相互独立，运行失败不会通过空数据替换成功结果。首次真实同步、测试、部署和线上验收证据记录在 [docs/operations.md](docs/operations.md)。
