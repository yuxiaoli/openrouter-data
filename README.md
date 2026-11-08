# OpenRouter Data Archive

独立的 OpenRouter 公共数据每日快照、JSON 查询 API 和 RSS 服务。仓库：<https://github.com/yuxiaoli/openrouter-data>；Cloudflare 服务：<https://openrouter-data.pages.dev>。本项目不由 OpenRouter 运营，官方地址仅作为上游来源归属，不冒称本项目服务。

## 数据与来源

按上游实际返回归档全模态模型、供应商、每模型端点、Embedding / Image / Video 专用目录、Image 专用端点、EU 模型、ZDR 端点，以及官方模型 / 博客 / 状态 RSS、官方 OpenAPI 与文档索引。以 [来源调查](docs/sources.md) 和每次运行的 manifest 为准：每个数据集记录来源 URL、采集时间、覆盖范围、记录数、HTTP 结果、缺口与错误，原始响应保留来源字段和 null。

没有配置 OpenRouter API key；需要认证的 Data API 排名、应用统计、会话成本、统一 benchmarks、任务分类及工具目录不会被伪造或补齐。账户消费、请求日志、私有模型、私有端点等不是公共目录，不会公开收集。状态 RSS 仅覆盖其当前窗口；目录里的短窗口性能值不是完整历史性能。项目启动前的历史不回填，模型标价不用于猜测流量、实际费用或缺失价格。

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
| `/api/v1/data` | 通过 `type` 选择数据集，筛选、排序和分页 |
| `/api/v1/dimensions` | 通过 `dimension` 汇总作者、供应商、模态或支持参数 |
| `/rss.xml` | 本项目 RSS，支持数据类型、历史选择及适用筛选条件 |

`date=latest`（默认）选择上次成功快照；`date=YYYY-MM-DD` 选择该 UTC 日最近成功快照；`snapshot=<id>` 精确选择一次运行，不能与 `date` 同用。失败尝试可以查看 manifest，但不能作为成功数据返回。历史列表同时保留成功和失败尝试。

```sh
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

筛选项包括 `q`、`model`、`author`、`provider`、`input_modality`、`output_modality`、`parameter`、`min_context`、`max_prompt_price` 和 `free`；具体适用类型见 OpenAPI。离散过滤值支持逗号分隔，组内为 OR、不同条件为 AND。未知、重复、冲突或不适用参数返回 400，不会默默忽略。JSON 列表使用 `meta`、`data`、`pagination` 包装；`meta.coverage` 附该数据集的来源与缺口。缺失价格不当作零；`free=true` 仅匹配明确为零的 prompt 与 completion 单价。多值维度同一记录可能计入多个桶，维度计数不可直接相加当作独立模型数。

## 快照与失败处理

代码只在 `main` 分支，快照只在 [`data` 分支](https://github.com/yuxiaoli/openrouter-data/tree/data)。每次真实运行生成独立 UTC ID，同一天多次运行也各自保留：

```text
index.json
runs/<YYYY-MM-DDTHHMMSSZ-random>/manifest.json
runs/<snapshot-id>/<dataset>.json
runs/<snapshot-id>/raw/...
```

`index.json` 保留运行摘要及 `last_success` 指针。单次运行目录不可覆盖；失败记录真实错误并以非零状态退出，仍提交运行报告，保留旧 `last_success`。上游异常或空数据不能发布成新的成功快照。整体成功是否成立及辅助来源是否 unavailable，以 collector 的完整性校验和 manifest 为准。

服务从 GitHub raw 读取数据，因此依赖 GitHub 可用性。索引与响应存在短期缓存，新记录可能数分钟后可见；精确 `snapshot` 查询便于验证指定版本。上次成功超过 36 小时或最近一次失败会使健康检查降级，旧成功数据仍携带真实采集时间。

## 每日任务与本机操作

[`Daily OpenRouter snapshot`](https://github.com/yuxiaoli/openrouter-data/actions/workflows/sync.yml) 使用 GitHub Actions：每天 **01:23 UTC / 北京时间 09:23**，同时支持 `workflow_dispatch`。GitHub 定时任务可能延迟；以 Actions 运行记录判断实际执行。任务串行运行，使用内置 `GITHUB_TOKEN` 的 `contents:write` 权限只推送 `data` 分支，无 Cloudflare secret。采集失败仍归档失败报告并让 job 失败；日志、索引和最近 manifest 作为 artifact 保留 14 天。成功同步后验收线上指定快照，允许最多约六分钟的缓存传播重试。

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
npx wrangler pages deploy dist --project-name openrouter-data --branch main --force
npm run smoke -- https://openrouter-data.pages.dev
```

每日同步仅更新数据分支，不重新部署代码。代码部署与数据同步相互独立，运行失败不会通过空数据替换成功结果。首次真实同步、测试、部署和线上验收证据记录在 [docs/operations.md](docs/operations.md)。
