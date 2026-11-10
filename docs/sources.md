# OpenRouter 官方来源调查

本文件保留项目建立时的来源调查，并记录 2026-11-10 对公开统计来源的修正。它不是快照运行结果：实际时间、HTTP 结果、记录数、完整性、partial/fallback 及错误以每次 manifest 为准。下文初始目录调查在 2026-11-08 16:00–16:10 UTC（北京时间 2026-11-09）通过无 Cookie、无 Authorization 的 GET 完成，所列计数只属于当时。

本项目是独立的历史归档和查询服务，非 OpenRouter 官方服务。下列官方 URL 均为上游来源，不能作为本项目部署地址。保留上游字段、未知字段和 null；没有取得的内容不补造，不将目录中的摘要、瞬时指标或排行榜次序当成完整历史数据。

公开归档存在一项明确的保真例外：官方 OpenAPI 的凭据样例触发了 GitHub GH013 推送保护，包含该样例的首次数据推送未成功。项目不绕过保护，公开副本会对凭据样例进行明确标记的脱敏，并在采集报告中记录脱敏说明。报告中的上游原始响应 SHA-256 用于标识实际取得的响应；归档 SHA-256 用于校验公开保存的脱敏副本，二者可能不同，不得把脱敏后的字节描述成上游原始字节。模型目录、价格和其它业务数据不因这项处理而补造或推断。

## 2026-11-10 修正：公开页面统计与认证 Data API 是不同来源

初次探测遗漏了公开页面接口中的 `/v1/`：`/api/frontend/stats/...` 的 404 不能证明 `/api/frontend/v1/stats/...` 不公开；`/api/v1/datasets/...` 的 401 也不能推广为所有排名、会话分桶、benchmarks 或任务统计均需认证。本轮根据官方公开网页及实际引用脚本发现准确 URL，再以无 Cookie、无 Authorization 的 GET 验证。完整路径、参数、响应结构、窗口、观察计数和单位证据见 [source-audit-2026-11-10.md](source-audit-2026-11-10.md)。

API 1.1 在原 16 个数据集之外增加以下 12 类，共 28 类。多数新来源是未收录于官方对外 OpenAPI 的公开页面接口，可能变更；每次运行仍必须校验结构并记录精确请求、HTTP 结果和范围，不能把研究时的 200 视作每日同步永远成功。

| 新数据集 | 已验证来源族（origin 为 `https://openrouter.ai`） | 内容与边界 |
| --- | --- | --- |
| `public_model_rankings` | `/api/frontend/v1/rankings/models` | day/week/month × tokens/tokens_excl_byok/requests/spend；保留 native model/variant/date、各类用量、change 与 rankingMetricValue。窗口聚合不拆称每日流水；spend 单位未声明时不猜美元。 |
| `public_ranking_history` | `/rankings/model-rankings-chart`、author-market-share、open-closed、tools、images、image-output、rerank-documents、语言、context、STT、video 图表及 `/rankings/benchmarks`，均在 `/api/frontend/v1` 下 | 完整原生数组/父对象、cachedAt、Others、抽样小数、benchmark maps；只覆盖返回窗口，不补成任意年份的逐模型历史。 |
| `public_performance` | `/api/frontend/v1/rankings/performance` | 原生 request_count、p50_latency/p50_throughput、provider 与价格字段；窗口及若干单位未声明，标 unspecified，null 不变零。 |
| `public_apps` | `/api/frontend/v1/apps/marketplace/marketplace` | 整体 popular/trending/leaderboards/globalRankingMap，包括全部原生 app 对象；有界公开选择，不是所有 app。 |
| `public_app_rankings` | `/api/frontend/v1/rankings/apps`、marketplace globalRankingMap、`/apps/marketplace/category` 与 category-chart | day/week/month、tokens/requests、四 group、上游返回的正常/low-count subcategory；原榜单 rank 原样保留，忽略 limit/offset 的接口不伪称支持翻页。 |
| `public_model_activity` | `/api/frontend/v1/stats/model-activity` | 当前目录和公开榜实际发现的 canonical/variant 逐项请求；整份 analytics/cachedAt，保留缓存/BYOK/tool/multimodal 字段。合法空结果不当作零流量。 |
| `public_model_apps` | `/api/frontend/v1/stats/top-apps-for-model` | 整份 top_apps/top_apps_chart/model_chart/cachedAt；两类 chart 是原生 date + analytics 行，不强制转换为 x/ys。app_id 可为数字，token 字符串不强转损失精度。 |
| `public_session_cost` | `/api/frontend/v1/rankings/session-cost` | 公开 harness/model 会话分桶、medianUsd、windowDays/windowEnd；是发布的聚合样本，不是当前账户或个体会话记录。 |
| `public_task_mix` | `/api/frontend/v1/rankings/task-spend` | spend/token 分类份额、模型 share、deltaPp 和原生窗口；比例/百分点不是绝对花费或 token 数。 |
| `public_discovery` | `/api/frontend/v1/rankings/discovery`、`/api/frontend/v1/rankings/routers`、`/api/frontend/v1/all-providers`、`/api/frontend/v1/catalog/providers`、`/api/frontend/v1/stats/provider-token-chart` | 整体发现/路由器摘要、公开 provider 政策与按真实 slug 发现的 provider 图表；不同 section 不可相加当全平台总量。 |
| `public_modality_statistics` | `/api/frontend/v1/rankings/modality-chart`、modality-models、modality-category-options/rankings/share | 已验证 text/image/embeddings/rerank/video/speech/decisions/transcription；模型榜 day/week/month，维度与类别来自真实 options。请求指标与 generated 指标分开；不因查询传了模态就自行删改返回的跨模态系列。 |
| `public_model_observations` | `/api/frontend/v1/stats/listed-pricing`、effective-pricing、model-uptime-recent、uptime-recent、provider-token-chart、top-colos-for-model | 每模型完整价格、近期可用性、provider 系列与地域对象。provider 来自真实 providerSlug，不能把模型作者假当 hosting provider；原始单位和时间窗不擅自推断。 |

上表缩写路径的完整 URL 以每条 `_source.source_url` / manifest 请求记录及复核文档为准。模型 canonical_slug 不包含 free/batch 变体时，必须保留实际 variant 参数；公开榜补发现只能使用原生 `model_permaslug` 与 `variant/variant_permaslug`，缺身份的行不编造模型请求。模型详情尝试覆盖“当前目录 + 已获取公开榜中发现的身份”，不是全部曾存在模型或全部私有流量。

历史图表中的旧 `date/x`、cachedAt、windowEnd 与本项目采集时间是不同概念：当前取得的 53 周图表仍是当前快照里的滚动视图，不能生成 53 个并不存在的历史快照。JSON 保留完整 payload，RSS 提供摘要、来源/窗口/单位和完整 JSON 链接；catalog/feeds/overview 用于发现这些来源。

单位按可验证证据记录：模型目录 USD/token、session medianUsd 的 USD、原生 seconds/characters/documents/tokens/requests、份额 fraction 与 deltaPp 百分点；未明确的 p50、价格分母、图表 generated 值和聚合时区保持 unspecified/null。不同模态的图片数、请求数、token、视频秒/小时、字符、文档及比例不可相加，也不从标价反推真实收入或流量。

按用户当前要求，认证 Data API **暂不启用**。公开匿名聚合与认证导出分别记录；没有因发现公开统计而启用个人密钥、请求账户 activity/credits/generations，或把私人用量发布到此归档。服务遇到不应公开的 authenticated 数据会拒绝提供，而不是自动降级为公开数据。

## 初次调查：目录、内容与文档来源（2026-11-08）

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
| 官方 OpenAPI | <https://openrouter.ai/openapi.json> | 200；约 2.96 MB；官方接口规格归档，公开副本对凭据样例脱敏并保留说明及哈希。须与本项目 `docs/api/openapi.json` 区分，后者只描述本项目真实实现的查询服务。 |
| 官方站点 AI 索引 | <https://openrouter.ai/llms.txt> | 200；text/markdown。属于文档索引，不是新增数据目录。 |
| 官方文档索引 | <https://openrouter.ai/docs/llms.txt> | 200；text/plain。可归档 API 发现依据。 |

调查时通用目录的输出模态计数为 text 461、decisions 35、video 33、image 66、embeddings 45、rerank 12、transcription 30、speech 38、audio 4。一个模型可有多个输出模态，不能将计数直接相加作为唯一模型总数。TTS/STT/rerank/decisions 等通过全模态目录覆盖。

`GET /api/v1/model/{author}/{slug}` 也公开可读；抽查 GPT-4o 与全模态目录对应对象字段一致，benchmarks 已包含在目录内，不必重复请求所有单项。目录及每模型端点均是采集时所见，无法重建项目启动前的完整目录/价格历史。

## 认证端点与其余缺口（初次 HTTP 结果保留，解释已按 1.1 修正）

| 来源或类别 | 实测或文档限制 | 处理原则 |
| --- | --- | --- |
| `/api/v1/datasets/rankings-daily` | 无认证 401；官方 Data API 要求有效 OpenRouter API key | 此认证导出未启用；与 `public_model_rankings` 的公开页面窗口是不同来源。其 top 50 + other 范围及私有/ZDR排除规则不得推广到别的来源。 |
| `/api/v1/datasets/app-rankings` | 无认证 401；需 API key；仅公开可见 app，别名可归并 | 此认证导出未启用；另行保留 `public_apps/public_app_rankings` 的有界原生页面结果，不冒充完整 app 数据。 |
| `/api/v1/datasets/session-cost` | 无认证 401；需 API key | 此认证导出未启用；`public_session_cost` 来自另一个匿名页面聚合，不能因这里401而宣称全部会话分桶不可得。 |
| `/api/v1/benchmarks` | 无认证 401；需 API key | 此认证接口未启用；models 中公开的 benchmarks 与 `/api/frontend/v1/rankings/benchmarks` 原对象另存，不宣称取得认证全集。 |
| `/api/v1/classifications/task` | 无认证 401；需 API key | 此认证接口未启用；`public_task_mix` 另存公开的分类份额，不包含私人任务日志。 |
| `/api/v1/parameters/openai/gpt-4o` | 无认证 401；当前官方 OpenAPI 未列此路径 | 支持参数从公开模型/端点目录取得，不依赖该历史或未文档路径。 |
| `/api/v1/tools` | 无认证 401；OpenAPI 标记 bearer | 不冒充公共工具完整目录。 |
| 账户 activity / analytics / credits / generation、private provider/endpoint、keys、workspace、组织及日志 | 账户或管理权限数据；与公共目录性质不同 | 不收集或公开私人账户数据，也不将该数据视为全站数据。 |
| `https://status.openrouter.ai/api/v2/summary.json` | 403 AccessDenied | 不假定其采用 Statuspage API；归档真实可读的官方状态 RSS，并明确事故历史窗口限制。 |
| TTS/STT/rerank/decisions 专用 GET 目录 | 当前 OpenAPI 无专用目录；探测 `/api/v1/audio/speech/models`、`/api/v1/audio/transcriptions/models`、`/api/v1/rerank/models`、`/api/v1/decisions/models`、`/api/alpha/decisions/models` 均 404 | 使用 `models?output_modalities=all` 的对应模态及通用端点；不创造不存在的上游 URL。 |
| 初次错误路径探测 | `/api/frontend/stats/{models,leaderboard,model,rankings}` 当时均 404 | 只说明这些准确路径404；2026-11-10 已从官方网页发现含 `/v1/` 的真实匿名 JSON，不再用该初次结果推断全部 frontend 统计不可得。 |
| 完整实时流量、请求内容、所有 provider 的长期性能、模型上线前历史 | 公开目录/RSS不提供 | 把缺口写入来源元数据，null 保持 null；采样窗口指标只能解释为官方声明的窗口。 |

当前不配置或启用 Data API。将来如用户另行授权，仍需单独设计认证范围、访问隔离、限流与引用，个人凭据的存在不等于获准公开私人数据。官方 Data API 文档描述的配额、CC BY 4.0 与 citation 要求只按其适用范围解释，不能不加判断套用于所有未文档 frontend 页面响应，也不能把本项目描述成官方 Data API 的完整免费替代品。

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
