# OpenRouter 公开数据来源复核（2026-11-10）

## 结论与调查方式

本文件是来源调查记录，**不表示其中每个接口已进入每日采集**。实施和真实采集覆盖应以发布后的 manifest 为准。

2026-11-10 08:33–08:49 UTC（北京时间 16:33–16:49），使用不带 Cookie、不带 Authorization 的同源 GET 读取了官方 [rankings](https://openrouter.ai/rankings)、[apps](https://openrouter.ai/apps)、[GPT-4o 模型页](https://openrouter.ai/openai/gpt-4o)、页面 HTML/RSC 和公开引用的 JavaScript，再对页面实际使用的 JSON URL 进行了请求。没有调用私人接口、创建令牌、绕过登录，也没有触发本项目同步或部署。

**此前调查遗漏了公开页面接口中的 `/v1/` 路径段。** `/api/frontend/stats/...` 的 404 不能证明 `/api/frontend/v1/stats/...` 不可公开读取；官方认证 Data API 的 401 也不能推广为全部排行、用量和应用统计都需要认证。以下公开页面接口本次均有真实 200 结果。

这些接口来自官方公开网页，但多数**未收录于官方对外 OpenAPI，属于不稳定页面接口**。应保存原始响应、准确 URL、参数、采集时间、上游 cachedAt/window 元数据、HTTP 状态和哈希，保留未知字段；发生变更或错误要显式记录，不能用零或空数组假装成功。

## 既有 16 类数据清单

| 数据集 ID | 类别 | 原始来源与边界 |
| --- | --- | --- |
| models | 模型目录 | `/api/v1/models?output_modalities=all`；全部返回的公开模态，不代表私有/已下架模型 |
| providers | 提供商目录 | `/api/v1/providers`；目录及政策链接，不是提供商流量统计 |
| endpoints | 每模型端点及短窗口性能 | `/api/v1/models/{author}/{slug}/endpoints`；原生价格、支持参数、uptime/latency/throughput，null 保留 |
| embedding_models | 专用模态目录 | `/api/v1/embeddings/models`；与通用目录覆盖可能不同 |
| image_models | 专用模态目录 | `/api/v1/images/models`；包含参数约束 |
| video_models | 专用模态目录 | `/api/v1/videos/models`；包含时长/分辨率/按 SKU 计价 |
| image_endpoints | 专用端点 | `/api/v1/images/models/{author}/{slug}/endpoints`；包含 billable/unit/cost_usd |
| eu_models | 区域目录 | `https://eu.openrouter.ai/api/v1/models?output_modalities=all` |
| zdr_endpoints | 隐私能力端点目录 | `/api/v1/endpoints/zdr`；不是 ZDR 真实流量 |
| model_count | 目录校验 | `/api/v1/models/count?output_modalities=all`；独立请求时点计数 |
| model_rss | 官方发布窗口 | `/api/v1/models?use_rss=true&output_modalities=all`；原始 RSS 日期与采集时间不同 |
| blog_posts | 官方发布窗口 | `/blog/feed.xml`；有界 feed，不代表每篇文章全部版本 |
| status_incidents | 官方状态窗口 | `https://status.openrouter.ai/history.rss`；有界事故窗口 |
| upstream_openapi | 官方规范 | `/openapi.json`；与本项目 API 规范不同，凭据形状的官方样例按 manifest 声明脱敏 |
| docs_index | 官方文档索引 | `/docs/llms.txt`；没有递归下载全部文档 |
| site_index | 官方站点索引 | `/llms.txt`；不是站点全部内容 |

既有列表主要覆盖目录、能力、发布和规范，**没有覆盖下述公开统计页面所提供的完整统计种类**。

## 本次确认的公开统计 JSON

以下路径均以 `https://openrouter.ai` 为 origin。所有记录数仅为调查时观察值，会变化。

### 模型排名

`GET /api/frontend/v1/rankings/models?view=day|week|month&metric=tokens|tokens_excl_byok|requests|spend`

- `view=day/week/month` 实测分别返回 652/680/740 行；默认请求相当于周窗口。四种 metric 均得到 200，且 `tokens_excl_byok`、`spend` 也在公开脚本中明确出现。
- 根结构 `{data:[row...]}`。原生行包括 `date`、`model_permaslug`、`variant`、`variant_permaslug`、`total_prompt_tokens`、`total_completion_tokens`、`total_native_tokens_reasoning`、`count`、缓存/BYOK token、图像/视频/音频/重排量、tool call 数、`change`、`rankingMetricValue` 等。
- `date` 不是项目快照日。周/月响应中不同模型行的 date 不同；这是窗口排名结果，不能拆称完整每日流水。
- `view=all/year/bad` 返回 400。`limit=1&offset=1` 被忽略，仍返回 652 条，不能假称上游支持分页。
- 保留 metric 及其原生值。token、request、seconds、characters 等字段按原生名称保存；不能把每种 `rankingMetricValue` 都命名为 token，`spend` 值没有在该响应中附带单位说明时不自行换算或命名为美元。

建议数据集：`public_model_rankings`；每行附加采集请求的 view/metric/source 元数据，避免把三个窗口重复相加。

### 模型与平台排行历史窗口

| 已验证路径 | 原生结构与本次范围 | 限制 |
| --- | --- | --- |
| `/api/frontend/v1/rankings/model-rankings-chart` | `{data:{data:[{x,ys}],cachedAt}}`；53 周，2025-11-10 至 2026-11-09 | 每桶约 top 9 加 `Others`，不是全部模型明细 |
| `/api/frontend/v1/rankings/author-market-share` | 同类 nested data/cachedAt，53 周 | 作者聚合，不是请求记录 |
| `/api/frontend/v1/rankings/open-closed` | `{data:[{x,ys}]}`；52 周，2025-11-17 至 2026-11-09 | open/closed 聚合 |
| `/api/frontend/v1/rankings/tools` | `{data:[{x,ys}]}`；13 周，2026-08-17 至 2026-11-09 | 分组统计；保留 `Others` |
| `/api/frontend/v1/rankings/images` | 同上，13 周 | 图像输入统计，与图像输出数量不同 |
| `/api/frontend/v1/rankings/image-output` | 同上，13 周 | 官方页面标识为生成图像数量，不是 token |
| `/api/frontend/v1/rankings/rerank-documents` | 同上，13 周 | 重排文档数 |
| `/api/frontend/v1/rankings/stt-transcript-characters` | nested data/cachedAt；22 周，2026-06-15 至 2026-11-09 | 转写字符数 |
| `/api/frontend/v1/rankings/video-output-hours` | nested data/cachedAt；31 周，2026-04-13 至 2026-11-09 | 路径/页面命名为视频输出小时，不能标成 token |
| `/api/frontend/v1/rankings/context-length` | `{data:[{x,ys}]}`；26 周，2026-05-18 至 2026-11-09 | 默认 context 分组；不能推定覆盖所有 context 筛选组合 |
| `/api/frontend/v1/rankings/natural-language` | 同上；30 日，2026-10-11 至 2026-11-09 | 值含小数，分类抽样/推估值不能强制整数或冒充精确全量 |
| `/api/frontend/v1/rankings/programming-language` | 同上；30 日，同日期范围 | 同上 |
| `/api/frontend/v1/rankings/routers?view=day|week|month` | `{data:{weekly:[{x,ys}],models:[{model,tokens,change,sources}]}}`；三个 view 均实测 200，53 周及 20 个模型 | weekly 始终是周序列；不能因 view=day 就把它改称日数据 |
| `/api/frontend/v1/rankings/discovery` | `{data:{modelOfWeek,climbing,breakouts,authors,totals,videoRequests,generatedAt,routerTokens}}` | 带模型 30 日/14 日序列及路由器 token 字典；不是全平台原始流量 |
| `/api/frontend/v1/rankings/session-cost` | `{data:{windowDays:30,windowEnd:"2026-11-01",harnesses:[...]}}`；4 个 harness，模型 points 含 `bucket/medianUsd` | 可确认 medianUsd 是美元；保留上游 windowEnd，不用采集日替换；只代表发布的分桶统计 |
| `/api/frontend/v1/rankings/task-spend` | `{data:{spend:{windowDays,macroCategories,tasks},tokens:{...}}}`；windowDays=30 | 份额及 deltaPp 不是金额/token 绝对量；保留原生小数、分类和来源 |
| `/api/frontend/v1/rankings/benchmarks` | `{data:{aaData,daData,valsIndex,weightedInputPrices,costPerRequest}}` | 公开页面整合视图，不等于认证 `/api/v1/benchmarks` 全部结果 |

`model-rankings-chart?start_date=2020-01-01&end_date=2020-01-31` 仍返回相同 53 周窗口，说明这两个参数被忽略，**不能声称该 URL 支持任意历史回填**。`cachedAt` 为上游毫秒时间戳，应与本项目 collection time 分开记录。

建议数据集：`public_ranking_history`，区分 source_section、原始 shape、时间粒度、窗口和计量单位，不强迫全部来源成为同一种 token 表。

### 公开模型性能

`GET /api/frontend/v1/rankings/performance` 实测 `{data:[row...]}`，193 条。行包括 `id/slug/name/author/request_count/p50_latency/p50_throughput/best_latency_provider/best_latency_price/best_throughput_provider/best_throughput_price/provider_count`。

该响应未提供明确窗口和每个数字的单位元数据；不能仅因字段名或数值看起来像毫秒就承诺单位。应原样保留，并在 coverage 标注未文档窗口/单位未证实；不要把价格字段直接复用为目录 USD/token。既有 endpoints 的短窗口性能也应继续完整保存，二者是不同公开视图。

建议数据集：`public_performance`。

### 公开应用目录与多窗口排名

`GET /api/frontend/v1/apps/marketplace/marketplace` 根为 `{data:{popular,trending,leaderboards,globalRankingMap}}`。本次 popular 4、trending 8、coding/creative/productivity/entertainment 四个 leaderboard 各 5，`globalRankingMap.day/week/month` 各 200。

原生 app analytics 行为 `{app_id,total_tokens:string,total_requests:number,rank,app:{id,created_at,description,title,main_url,origin_url,slug,source_code_url,icon_class_name,favicon_url,categories,related_apps}}`。保留十进制字符串 token 值，不将 app_id 当模型 ID。仅公开页面展示的 app；这些数据不是当前用户账号的 activity。

`GET /api/frontend/v1/rankings/apps` 另有 `{data:{day:[20],week:[20],month:[20]}}`，是另一个有界窗口，不能用 20/200 条证明全部 app 数量。

`GET /api/frontend/v1/apps/marketplace/category?group={group}&subcategory={optional}&period={day|week|month}&sortBy={tokens|requests}`：

- 脚本实际传入 group/subcategory/period/sortBy；上述三个 period 和两个 sortBy 的六个组合已实测 200。
- 根 `{data:{apps,group,subcategory,subcategories,lowCountSubcategories}}`。默认四个 group 返回行数为 coding 50、creative 9、productivity 48、entertainment 27。
- coding 的 tokens 排名三窗口各 50 条，requests 排名则为 33/34/32；原生返回集合可能不同，不补造缺失 app。
- `limit=1&offset=1` 仍返回 50 条且首项不变，未发现有用 cursor/next/total；不能对外声称爬完所有页。
- 无效 period=year 或 sortBy=bad 也会 200 回退默认，因此 HTTP 200 不能证明参数有实际作用。只能声明经过 UI 与实际结果验证的参数。
- 动态发现时要同时枚举 `subcategories` **和** `lowCountSubcategories`。本次四组共 15 子类：coding 五类 `cli-agent,ide-extension,cloud-agent,programming-app,native-app-builder`；creative 四类 `creative-writing,video-gen,image-gen,audio-gen`；productivity 四类 `writing-assistant,general-chat,personal-agent,legal`；entertainment 两类 `roleplay,game`。其中 image-gen/audio-gen/legal 在 lowCount 列表，不能丢掉。
- 4 组加 15 子类、3 period、2 sort 共 114 个已知参数组合是可枚举的采集目标，**不是证明每个组合都有数据或应用全集无截断**。各组合的合法空、HTTP 错误及实际数量须分别记录。

`GET /api/frontend/v1/apps/marketplace/category-chart?group=coding` 本次返回 `{data:{chartData:[{x,ys}]52,titleMap:{...}}}`，2025-11-17 至 2026-11-09。脚本也会传 subcategory；对子类历史应逐请求验证、保存。

建议 `public_apps` 保留 marketplace 目录整根；`public_app_rankings` 保存各 section/group/subcategory/period/sortBy 的原生排名，不把不同窗口重复加总。

### 每模型活动与 top apps

`GET /api/frontend/v1/stats/model-activity?permaslug={canonical_slug}&variant={optional}`：根 `{data:{analytics:[activityRows],cachedAt}}`。GPT-4o 为 31 个日期，含 2026-11-10 尚在进行的 UTC 日；模型活动字段与排名的 token/request/media/cache/tool-call 计数类似，但不是同一窗口排名数据。

`GET /api/frontend/v1/stats/top-apps-for-model?permaslug={canonical_slug}&variant={optional}`：根 `{data:{top_apps,top_apps_chart,model_chart,cachedAt}}`。GPT-4o top_apps 5 条，两种 chart 各 31 条。`top_apps` 使用上述 app analytics 原生结构；图表的未知字段和映射要原样保留。

**canonical ID 实证：** `liquid/lfm-3-1.7b-20261106` 返回 4 个活动日及 5 top apps；`liquid/lfm-3-1.7b`（目录展示 ID、无日期）返回 200 但 analytics 为空。因此应使用目录 `canonical_slug`/页面 permaslug，而不是盲目使用 model.id。`openrouter/auto` 的 activity 与 top-apps 均合法 200 空，但 discovery 的 routerTokens 有路由器数据；空结果不能推断路由器没有流量。

**变体也不能丢失：** 本次目录 `thinkingmachines/inkling-2-small:free` 的 canonical_slug 是不带 `:free` 的 `thinkingmachines/inkling-2-small-20261107`。只传 canonical 得到 standard 行；额外 `variant=free` 得到 `variant_permaslug=...:free` 行。`anthropic/claude-fable-5.2-20261109&variant=batch` 同样返回真实 batch 行；top-apps 接口的 free 变体也 200。因此请求身份必须由 `(canonical_slug, variant)` 组成，variant 来自目录 ID 后缀或 standard，不能只按 canonical 去重。

建议数据集 `public_model_activity`、`public_model_apps`，对目录中可请求的 canonical 模型枚举，并记录请求数、成功、合法空、404/其他错误、窗口。是否所有模型/变体都有公开统计需要实际完整采集后才能确认。

## 额外确认公开、需要单独决定采集范围的来源

以下均由模型页脚本发现，并以 GPT-4o canonical permaslug 实测 200：

| 路径（均 `/api/frontend/v1/` 下） | 原生内容及本次边界 |
| --- | --- |
| `stats/endpoint?permaslug=openai%2Fgpt-4o` | 2 个详细端点对象，包含 provider/model 关系及更多页面字段 |
| `stats/listed-pricing?permaslug=...` | `{data:{series:[{endpointId,providerName,providerSlug,input/output/cacheRead/cacheWrite/discount:[{at,value}]}]}}`；本次可见 2026-01 起变更点，不代表模型完整价格历史 |
| `stats/effective-pricing?permaslug=...` | 加权输入/输出价、cache hit rate、provider summaries 及图表；值与目录每 token 价不能直接混用，必须明确单位后再归一化 |
| `stats/model-uptime-recent?permaslug=...` | 145 个约 10 分钟 availability bucket、72 个 hourly bucket，包含 uptime/availability/recentAvailability/withoutRouting 字段；公开模型页对应近 24/72 小时，不是长期历史 |
| `stats/uptime-recent?permaslug=...` | 按 endpoint ID 和 openrouter 的近 3 日 `{date,uptime,judgedMinutes}`；null 保留 |
| `stats/provider-token-chart?provider=openai&permaslug=...` | `{data:{chartData:[{x,ys}]90,cachedAt}}`；本次 90 日滚动 token 图 |
| `stats/top-colos-for-model?permaslug=...` | `{data:{colos:[...]}}`；本次 25 个 colo 字符串，没有流量总量字段 |
| `rankings/modality-category-options?routeSegment=text` | dimensions 数组，当前 text/domain 有 17 类，可动态发现 |
| `rankings/modality-chart?routeSegment=text` | 52 周 data、metricData.request、marketShareData、granularity 和 cachedAt，不能把所有 data 默认当 token |
| `rankings/modality-models?routeSegment=text&view=day` | 407 原生模型行；统计范围与通用 token 排名不同 |

额外 range/shape/routeSegment 等参数虽然在脚本中出现，未经实测的取值不写成支持承诺。要么补采并明确归档类别，要么在 manifest unavailable/coverage 中明示未实施；不能再仅用“需要 API key”解释以上已公开可读的来源。

### 八种模态及分类维度的最终核验

官方 `0zc5xm7kv_nxj.js` 明确列出八种 routeSegment：`text,image,embeddings,rerank,video,speech,decisions,transcription`。本次已完成八种的 category-options/chart 请求，以及八种 models 的 day/week/month 共 24 组合，全部得到 200。后 16 个 day/month 请求由并行调查者于约 08:46 UTC 核查。

| routeSegment | models day / week / month 行数 | options 中实际维度 | chart 周窗口起点（终点均 2026-11-09） |
| --- | --- | --- | --- |
| text | 407 / 427 / 474 | domain | 2025-11-17 |
| image | 62 / 62 / 67 | visual_style, domain | 2025-11-17 |
| embeddings | 42 / 42 / 43 | item_type, domain | 2025-11-17 |
| rerank | 12 / 12 / 12 | item_type, criterion, domain | 2026-04-06 |
| video | 33 / 33 / 33 | visual_style, domain | 2026-03-23 |
| speech | 38 / 38 / 38 | language, domain | 2026-04-20 |
| decisions | 29 / 31 / 35 | criterion, domain | 2026-09-14 |
| transcription | 30 / 30 / 30 | language, domain | 2026-04-27 |

脚本明确说明所有模态 leaderboard 的 primaryMetric 是 request。image 的请求列为 `image_output_requests`：只有返回图像的请求计数，一次返回多张图仍算一次。generated 指标分别为 image 的 `num_media_completion`（图像数）、embeddings 的 `total_prompt_tokens`（token）、rerank 的 `rerank_documents`（文档）、video 的 `video_output_seconds`（原始秒数，UI 另按小时显示）、transcription 的 `stt_transcript_characters`（字符）。speech/decisions 当前没有 generated chart。不能把全部模态图表都标为 token，也不能把原始视频秒数因为 UI 显示小时就静默改单位。

已从脚本确认并实际请求：`GET /api/frontend/v1/rankings/modality-category-rankings?routeSegment={route}&dimension={options 返回的 dimension}`。以 text/domain、image/visual_style、transcription/language 实测均为 200，根为 `{data:{spend:{windowDays:30,categories:[{value,label,shareOfTotal,models:[{model,share,deltaPp}]}]},tokens:{...},requests:{...}}}`。一次请求覆盖整个维度的分类排行，无需猜测 categoryId 或逐分类请求。各维度仍应动态按 options 枚举并报告其实际结果。

`modality-category-share` 只传 routeSegment/dimension 时返回 400、提示缺少 category。08:49 UTC 补上 options 中真实值后，`GET /api/frontend/v1/rankings/modality-category-share?routeSegment=text&dimension=domain&category=software_technology` 得到 200，根 `{data:{marketShareData:[{x,ys}],cachedAt}}`，本次 8 周，2026-09-21 至 2026-11-09，ys 是原生份额小数。可以从 options 的 categories[].value 动态发现请求。**语义限制：**该次首周返回包括 image 模型，即使请求 routeSegment=text，也不能擅自保证后端已严格按模态过滤；必须保留原始 query/响应及未文档语义说明，不能自行改写上游结果。该视图也不是认证数据；如果实现没有采集，应明确标出未采集窗口。

### 提供商公开页面统计

- `GET /api/frontend/v1/all-providers`：200，`{data:[provider...]}`，本次 98 条；有 name/displayName/slug/adapterName/baseUrl/dataPolicy/headquarters/datacenters/BYOK 等公开字段。dataPolicy 比 `/api/v1/providers` 更详。slug 可用于公开 provider chart，不把 adapterName 或展示名当 slug。
- `GET /api/frontend/v1/catalog/providers`：200，`{data:string[]}`，本次 122 个名称（如 AI21），不是可直接请求统计的 slug 列表。
- `GET /api/frontend/v1/stats/provider-token-chart?provider=openai`：200，`{data:{chartData:[{x,ys}],cachedAt}}`，本次 90 日，从 2026-08-13 开始；每桶 top 模型和 `Others`，不代表所有模型完整明细。带 permaslug 的同一路径则限制到该模型。可按公开提供商真实 slug 枚举提供商级统计，而不是把模型 author 误作 provider。

上述 98/122 与既有 provider 目录数量不一致是不同公开投影的事实，应分别记录，不能强行填补或宣称某个数字是“平台全部提供商数”。

## 实现分类约定

新增公开统计采用以下 12 个数据集类别；本表表示调查与实现的对应约定，是否完整采集、合法空、失败和实际数量仍由每次 manifest 证明：

| 新 ID | 保存范围 |
| --- | --- |
| public_model_rankings | 模型 day/week/month、四种 metric 的原生排名 |
| public_ranking_history | 各公开历史图表及 benchmarks，保留每种原始 shape、window 和 source section |
| public_performance | 原生性能排行，未知单位/窗口显式记录 |
| public_apps | marketplace 各目录 section 及 app 公共对象 |
| public_app_rankings | 全局与组/子类、窗口、排序的有界 app 排名 |
| public_model_activity | 每 canonical 模型和实际变体的公开每日活动窗口 |
| public_model_apps | 每 canonical 模型和实际变体的 top apps、相关图表 |
| public_session_cost | 公开 medianUsd 分桶及 windowDays/windowEnd |
| public_task_mix | 公开 spend/tokens 份额、分类和百分点变化 |
| public_discovery | discovery、router 视图、公开 provider 投影和 provider chart，分别标 kind |
| public_modality_statistics | 八模态 options/chart/models/分类维度排行，分别标 kind/routeSegment/view/dimension |
| public_model_observations | 六种模型价格/uptime/provider-chart/colo 观察，保留各自原生结构和范围 |

## 认证与公共范围的明确边界

[官方 Data API 文档](https://openrouter.ai/docs/cookbook/administration/data-api) 对 `/api/v1/datasets/*`、统一 benchmarks/classifications 等正规 Data API 的认证、额度和引用另有规定。这些认证要求继续成立；本次没有尝试规避它们。公开页面接口与认证 Data API 可能共享部分底层统计，但不能宣称两者字段、时间范围、许可契约及全集相等。

页面公开声明排行数据可按 CC BY 4.0 署名复用。发布时应带 OpenRouter 官方来源链接、上游可得的 as-of/cachedAt、项目采集时间和声明的窗口，不把采集日期伪装成统计日期。私有模型、私有应用、非公开流量、原始用户 prompt/response、私人账户 usage 和完整无限历史仍不在本次可证明范围。

## 发现依据

- 页面：<https://openrouter.ai/rankings>、<https://openrouter.ai/apps>、<https://openrouter.ai/openai/gpt-4o>。
- 排行请求引用：`/_next/static/immutable/chunks/10tk0d5frcih8.js`，含上述 rankings 路径和 tokens_excl_byok/spend literal。
- App 请求引用：`/_next/static/immutable/chunks/2h0fkputi0kca.js`，含 marketplace/category/category-chart 和 period/sortBy 传参。
- 模型统计请求引用：`/_next/static/immutable/chunks/0n0jtm6oqxbk7.js`，含 model-activity/top-apps-for-model/endpoint/价格和 uptime 路径。
- Chunk 文件名是本次页面版本的证据，随构建变化；采集器应依赖已确认接口并监测结构变化，不能承诺此 chunk 名永久可用。
