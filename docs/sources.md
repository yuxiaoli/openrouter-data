# OpenRouter 官方来源调查

本文件记录项目建立时的来源调查，不是快照运行结果。实际采集时间、HTTP 结果、记录数、完整性及错误以每次快照的 manifest 为准。调查在 2026-11-08 16:00–16:10 UTC（北京时间 2026-11-09）通过无 Cookie、无 Authorization 的实际 GET 请求完成；计数会随官方目录变化。

本项目是独立的历史归档和查询服务，非 OpenRouter 官方服务。下列官方 URL 均为上游来源，不能作为本项目部署地址。保留上游字段、未知字段和 null；没有取得的内容不补造，不将目录中的摘要、瞬时指标或排行榜次序当成完整历史数据。

## 建议每天归档的公开来源

| 数据 | 官方 URL | 调查结果与覆盖范围 |
| --- | --- | --- |
| 全模态模型目录 | <https://openrouter.ai/api/v1/models?output_modalities=all> | 200；705 条；`{data: Model[], total_count, links:{next}}`。包括 ID、canonical slug、名称、创建时间、摘要、架构/输入输出模态、上下文、价格、支持参数、默认参数、语音、知识截止日、到期日、API 路径及部分 benchmarks。必须显式 `output_modalities=all`，默认仅 text（本次 461 条）。 |
| 全模态计数 | <https://openrouter.ai/api/v1/models/count?output_modalities=all> | 200；`{data:{count:705}}`。默认计数为 461。可作辅助完整性校验，但与目录请求并非原子事务，临时差异须记录。 |
| Embedding 专用目录 | <https://openrouter.ai/api/v1/embeddings/models> | 200；40 条；结构类似通用模型目录。本次通用目录含 45 个 embeddings 输出模型，两种目录覆盖有差异，不强行合并或推定缺失原因。 |
| Image API 专用目录 | <https://openrouter.ai/api/v1/images/models> | 200；63 条；`{data:[]}`。包括模型参数的 enum/range 约束、流式能力和专用端点 URL；与通用目录的 image 输出 66 条并不等同。 |
| 每个 Image API 模型的专用端点 | `https://openrouter.ai/api/v1/images/models/{author}/{slug}/endpoints` | 200 实测；按专用目录返回的 `endpoints` URL 枚举。结构为 `{id,endpoints:[]}`，不是通用端点的 `data` 包装；含 provider name/slug/tag、参数约束、透传参数、流式能力及 `pricing:[{billable,unit,cost_usd}]`。 |
| Video 专用目录 | <https://openrouter.ai/api/v1/videos/models> | 200；33 条；`{data:[]}`。包含分辨率、长宽比、尺寸、时长、首尾帧、音频/seed 支持、SKU 价格和透传参数；这些详情不完全存在于通用目录。 |
| EU 区域目录 | <https://eu.openrouter.ai/api/v1/models?output_modalities=all> | 200；78 条。单独保留 EU 来源和范围；不能将其等同于全部模型的 EU 可用性历史。 |
| Provider 目录 | <https://openrouter.ai/api/v1/providers> | 200；121 条；`{data:[]}`，包括名称、slug、隐私/条款/状态链接、总部及 datacenters。API 与网页展示的 provider 数量可能不同。 |
| 每模型通用端点 | `https://openrouter.ai/api/v1/models/{author}/{slug}/endpoints` | 200 实测；优先使用目录提供的 `links.details`。结构 `{data:{id,name,created,description,architecture,endpoints:[]}}`。含 provider、tag、量化、上下文、价格、支持参数、状态、短窗口 uptime/latency/throughput 等；字段可能为 null，不能补成零。 |
| ZDR 端点预览 | <https://openrouter.ai/api/v1/endpoints/zdr> | 200；1117 条；`{data:Endpoint[]}`。是官方 ZDR 可用端点视图，不是实际 ZDR 流量或用户日志；包含 `safety_retention` 等上游字段。 |
| 官方模型 RSS | <https://openrouter.ai/api/v1/models?use_rss=true&output_modalities=all> | 200；RSS 2.0。原样存档作为官方 feed；项目自己的 RSS 应有独立 title/self link，注明来源和采集时间。 |
| 官方博客 RSS | <https://openrouter.ai/blog/feed.xml> | 200；166 项。由官方博客 HTML 的 `rel=alternate` 链接确认。`/rss.xml`、`/blog/rss.xml` 和 `/announcements/rss.xml` 不是有效 feed（本次 404）。 |
| 官方状态 RSS | <https://status.openrouter.ai/history.rss> | 200；6 项。保留 channel 的 lastBuildDate、原始 item 日期和链接；当前 feed 窗口不能宣称是全部事故历史。 |
| 官方 OpenAPI | <https://openrouter.ai/openapi.json> | 200；约 2.96 MB；官方接口规格归档。须与本项目 `docs/api/openapi.json` 区分，后者只描述本项目真实实现的查询服务。 |
| 官方站点 AI 索引 | <https://openrouter.ai/llms.txt> | 200；text/markdown。属于文档索引，不是新增数据目录。 |
| 官方文档索引 | <https://openrouter.ai/docs/llms.txt> | 200；text/plain。可归档 API 发现依据。 |

调查时通用目录的输出模态计数为 text 461、decisions 35、video 33、image 66、embeddings 45、rerank 12、transcription 30、speech 38、audio 4。一个模型可有多个输出模态，不能将计数直接相加作为唯一模型总数。TTS/STT/rerank/decisions 等通过全模态目录覆盖。

`GET /api/v1/model/{author}/{slug}` 也公开可读；抽查 GPT-4o 与全模态目录对应对象字段一致，benchmarks 已包含在目录内，不必重复请求所有单项。目录及每模型端点均是采集时所见，无法重建项目启动前的完整目录/价格历史。

## 无法公开采集及未采集部分

| 来源或类别 | 实测或文档限制 | 处理原则 |
| --- | --- | --- |
| `/api/v1/datasets/rankings-daily` | 无认证 401；官方 Data API 要求有效 OpenRouter API key | 不伪造排名、token 数或历史；记录 unavailable。官方返回范围是公开流量 top 50 模型加 other，排除私有模型、私有端点及 ZDR 流量，并非所有 OpenRouter 流量。 |
| `/api/v1/datasets/app-rankings` | 无认证 401；需 API key；仅公开可见 app，别名可归并 | 不把网页 top app 摘要扩展成完整数据集。 |
| `/api/v1/datasets/session-cost` | 无认证 401；需 API key | 未取得真实 session 统计，不从模型标价推算用户会话成本。 |
| `/api/v1/benchmarks` | 无认证 401；需 API key | 通用目录中公开的 benchmarks 字段可如实保留，不能宣称取得统一 benchmark 数据集所有记录。 |
| `/api/v1/classifications/task` | 无认证 401；需 API key | 未取得分类份额和相关模型统计。 |
| `/api/v1/parameters/openai/gpt-4o` | 无认证 401；当前官方 OpenAPI 未列此路径 | 支持参数从公开模型/端点目录取得，不依赖该历史或未文档路径。 |
| `/api/v1/tools` | 无认证 401；OpenAPI 标记 bearer | 不冒充公共工具完整目录。 |
| 账户 activity / analytics / credits / generation、private provider/endpoint、keys、workspace、组织及日志 | 账户或管理权限数据；与公共目录性质不同 | 不收集或公开私人账户数据，也不将该数据视为全站数据。 |
| `https://status.openrouter.ai/api/v2/summary.json` | 403 AccessDenied | 不假定其采用 Statuspage API；归档真实可读的官方状态 RSS，并明确事故历史窗口限制。 |
| TTS/STT/rerank/decisions 专用 GET 目录 | 当前 OpenAPI 无专用目录；探测 `/api/v1/audio/speech/models`、`/api/v1/audio/transcriptions/models`、`/api/v1/rerank/models`、`/api/v1/decisions/models`、`/api/alpha/decisions/models` 均 404 | 使用 `models?output_modalities=all` 的对应模态及通用端点；不创造不存在的上游 URL。 |
| 未文档 frontend 排行 JSON | 探测 `/api/frontend/stats/{models,leaderboard,model,rankings}` 均 404 | 不依赖猜测接口，不绕过正式 Data API 的认证。公开 rankings HTML 是展示页面，不代表全部结构化历史。 |
| 完整实时流量、请求内容、所有 provider 的长期性能、模型上线前历史 | 公开目录/RSS不提供 | 把缺口写入来源元数据，null 保持 null；采样窗口指标只能解释为官方声明的窗口。 |

若将来配置有效 API key，需单独设计认证数据采集范围、限流和引用，不能默认把私人账户数据发布。官方 Data API 文档标注每 key 每分钟 30 次、每账户每天 500 次；聚合数据采用 CC BY 4.0，须保留 `meta` 以及对应来源/citation，并提示其可随上游重述。文档另说明此数据面向分析和报告，不能把本项目描述成替代官方的免费 Data API。

## 官方依据

- [Models API](https://openrouter.ai/docs/api/api-reference/models/get-models)
- [Per-model endpoints](https://openrouter.ai/docs/api/api-reference/endpoints/list-all-endpoints-for-a-model)
- [Providers API](https://openrouter.ai/docs/api/api-reference/providers/list-all-providers)
- [ZDR endpoints](https://openrouter.ai/docs/api/api-reference/endpoints/preview-the-impact-of-zdr-on-the-available-endpoints)
- [Image models API](https://openrouter.ai/docs/api/api-reference/images/list-image-models)
- [Video models API](https://openrouter.ai/docs/api/api-reference/video-generation/list-videos-models)
- [Embeddings models API](https://openrouter.ai/docs/api/api-reference/embeddings/list-embeddings-models)
- [EU routing and regional models](https://openrouter.ai/business/eu/)
- [Data API, coverage, authentication, limits and citation](https://openrouter.ai/docs/cookbook/administration/data-api)

注意：许多目录的官方示例统一展示 Authorization header，而本次无认证请求实际返回 200；这表示本次调查可公开读取，并不是上游永久免认证的承诺。任何以后变更均应在同步报告中如实标注。
