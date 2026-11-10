# 运行与验收

历史验收记录按执行当时的版本、条数和覆盖保留；不能用 1.1 的新能力改写首次 16 类验收。2026-11-10 的来源修正、自然定时观察和 1.1 执行状态追加在本文末尾。

## 架构与授权范围

- 代码仓库：<https://github.com/yuxiaoli/openrouter-data>，默认分支 `main`。
- 历史数据：同仓库 `data` 分支；`index.json` 为运行目录及上次成功指针。
- 服务：Cloudflare Pages advanced mode，地址 <https://openrouter-data.pages.dev>；构建产物 `dist/_worker.js`。
- 上游数据和公开可获取性见 [sources.md](sources.md)，实际运行范围、采集时间及错误以 manifest 为准。
- 本机已存在 Cloudflare Pages 授权。每日同步无需 Cloudflare 凭据，只用 GitHub 内置 token；不在仓库、日志、URL 中写入私人令牌。
- API 1.1 的公开数据目标共 28 类；来源、能力与订阅通过 `/api/v1/catalog`、`/feeds.json`、`/rss.xml?type=overview` 发现。认证 Data API 按用户当前要求暂不启用。

现有相关仓库已排查：GitHub 无 OpenRouter 专用仓库；既有 RSS 目录只引用官方 JSON 和 RSS；`cf-feeds` 为订阅监控，`llm-gateway-providers` 使用 models.dev。Cloudflare Pages 列表无同类 OpenRouter 项目。现有 OAuth 没有 Workers scope，未能穷尽 Workers 服务目录，因此不把该部分核查描述为完成。

## 每日同步

`sync.yml` 默认每天 `23 1 * * *` UTC（北京 09:23），可从 Actions 页面手动运行，或：

```sh
gh workflow run sync.yml --repo yuxiaoli/openrouter-data --ref main
gh run list --repo yuxiaoli/openrouter-data --workflow sync.yml --limit 10
```

任务先检出 main、安装锁定依赖并执行 `npm run check`，再将 data 分支检出到 `data/`。`npm run sync -- --output data` 创建不可覆盖的独立运行目录。success 推进整体 `last_success`；有新成功来源但部分失败时记录 partial，推进最近可用 `latest_snapshot`，整体成功指针保持旧值；逐数据集 `dataset_last_success` 仅指向该来源真实通过校验的运行。完全失败不推进最近可用结果。partial / failed 均退出非零，仍提交 manifest 和索引；推送失败同样使 job 失败。step summary 展示新鲜/旧结果与错误，日志、索引和最近 manifest artifact 保留 14 天。

success / partial 归档后会对 Cloudflare 服务执行 smoke，指定该次 snapshot ID，覆盖 JSON、RSS、OpenAPI 与多维筛选；每 30 秒重试，最多约六分钟，容纳 GitHub raw 缓存传播。partial 即使可用来源通过线上校验，最终 job 仍明确失败，不冒称整体完整。线上验证失败不删除已归档数据。HTTP 200 只表示该请求可读取，不能代替 manifest 完整性与健康检查。

旧数据 fallback 返回 `meta.status=stale`，保留实际 `meta.snapshot`、`data_collected_at`、原始来源与覆盖；`attempt_snapshot` / `attempt_completed_at` 单独说明本次失败尝试。RSS 同样标明旧数据、实际观测时间和错误，没有 fallback 时返回 503，不发布空成功。健康检查会在 partial / failed 或最近可用结果超过 36 小时时降级。

`schema_version: 1` 保持不变，新增 latest/逐数据集引用、fallback、窗口/单位及 chunks 索引为兼容字段；API 版本为 1.1，路径仍是 `/api/v1/`。旧 manifest 中没有的新数据集保持不可用，不生成虚假的早期采集记录。

## 本机恢复

```sh
npm ci
npm run check
npm run build
git clone --branch data --single-branch https://github.com/yuxiaoli/openrouter-data.git data
npm run sync -- --output data
```

若 `data/` 已存在，应检查它确实是同仓库 data 分支且工作区干净，再在该子目录执行 `git pull --ff-only`；不要覆盖未提交的真实快照。同步完成后检查新 manifest、`index.json` 的 `last_success` 和错误列表，再从 `data/` 单独提交推送。不要重写失败报告来假装成功，也不要删除旧成功结果。

失败诊断顺序：

1. 查看 Actions 的采集日志、step summary、sync-report artifact，确认网络、HTTP、结构、条数或分页完整性错误。
2. 查看 `data/runs/<id>/manifest.json` 的来源状态及缺口；partial 时分别检查 latest_snapshot、last_success、dataset_last_success 和每个 fallback 的真实时间，不能把可用旧数据当成新采集。
3. 对上游实际返回做最小复查。官方接口变更时修改采集器及契约、运行测试，再创建新的真实运行；不补造缺失数据。
4. 归档成功但线上不可见时，检查 GitHub raw 和服务缓存；使用精确 snapshot ID 排除 latest 缓存差异。

大数据集的 `<dataset>.json` 可能是 `{storage:"chunked",record_count,chunks}` 索引而非完整行数组。按 manifest 的 `chunks/chunk_counts/chunk_sha256s` 读取与校验，按 `model_chunks` 优先定位模型；默认 id 升序无过滤分页只加载相关块，广域统计可能读取更多块。不要把索引当成只有一个数据行的空数据集。

原始归档可从 GitHub 固定 data 提交的 `runs/<snapshot>/<raw_path>` 直接取得；报告 pages 可列多个 raw 文件。逐请求 NDJSON 保存 body_base64，较大响应通过 body_base64_chunks 引用字节片段；读取时按记录重建后核验对应 SHA。`npm run verify:archive -- data` 验证本地真实归档，不触发采集。明确脱敏时 `sha256` 对应公开字节，`original_sha256` 仅标识未公开原响应，二者不能混用。

## 部署与回滚

```sh
npm run check
npm run build
npx wrangler pages deploy dist --project-name openrouter-data --branch main
npm run smoke -- https://openrouter-data.pages.dev
```

首次创建 `openrouter-data` 项目时已使用 `pages project create --force` 保留 Pages 项目；项目现已建立，后续部署不使用 `--force`。代码变更需同步维护 `docs/api/openapi.json`，CI 检查通过后部署。Cloudflare 上回滚到之前已验证的代码部署不会改写 data 分支。数据恢复应修复采集逻辑并生成新快照；若索引损坏，先从 Git 历史核实并恢复已真实存在的运行引用，不改旧运行内容。

## 首次验收记录

验收于 2026-11-08 UTC（北京时间 2026-11-09）执行。快照日期使用真实 UTC，不以北京时间改写采集日期。

- `npm run check` 通过：14 项测试、TypeScript 类型检查、10 条路径 / 16 类数据的 OpenAPI 校验。测试覆盖空数据、网络失败、截断或异常分页、失败保留成功指针、原字段/null、明确脱敏、组合筛选、供应商去重聚合、负价格哨兵值、RSS GUID 与 XML 和默认最近内容排序。
- `npm run build` 通过；最终 API 代码为 `3f84d06`，部署版本为 <https://f14bd1ba.openrouter-data.pages.dev>，生产地址为 <https://openrouter-data.pages.dev>。源码对应的 [GitHub CI](https://github.com/yuxiaoli/openrouter-data/actions/runs/42500370373) 可直接查看检查结果。
- 第一份公开真实快照为 `2026-11-08T162034Z-1c05c652f6`；随后通过 Actions 继续保留同日多个独立快照。没有真实跨日历史样本，启动前历史未回填。
- [首次完整通过的 Actions 同步](https://github.com/yuxiaoli/openrouter-data/actions/runs/42499635780) 完成真实采集、推送 data 分支及 43 项线上验收。[后续同步](https://github.com/yuxiaoli/openrouter-data/actions/runs/42499941713) 同样完整成功，并通过增加历史快照读取后的 45 项线上检查，生成 `2026-11-08T162731Z-09e0d9395d`。
- JSON、16 类数据、RSS、线上 OpenAPI、UTC 日期选择、多维筛选、供应商/模态汇总、分页、未知/重复/冲突参数及无历史日期响应均经过真实 HTTP 验证；独立复查还验证了 HEAD / OPTIONS / POST。模型、博客和状态 RSS 的前五项按上游发布时间最近优先，XML 有效且标注独立服务身份。
- 最终部署上的 `npm run smoke -- https://openrouter-data.pages.dev --expected-snapshot 2026-11-08T162731Z-09e0d9395d` 通过 47 项检查，另外验证了负价格不会被误当作已知低价或付费价格。已观察的上游负值原样保留，不推断路由模型的真实请求成本。
- `npm run verify:archive -- data` 在从 GitHub 拉回的四次快照上验证了 3136 项归档文件及逐模型响应校验值。data 分支的 `.gitattributes` 禁止换行转换，避免原响应字节在检出时变化。
- `npm audit --omit=dev --audit-level=moderate` 通过，无生产依赖漏洞。
- GitHub API 已确认每日 workflow 的 `state=active`，cron 为 `23 1 * * *`（北京每天 09:23）；手动实跑成功。验收时下次定时触发尚未到时，不能将手动运行描述为已经观察到的定时触发。

成功运行的实际公开范围如下；这些数据集有重叠，不得将条数相加当作唯一模型/端点总数：

| 数据集 | 实际记录数 | 覆盖说明 |
| --- | ---: | --- |
| models | 705 | 显式请求全部输出模态 |
| providers | 121 | 官方提供商目录 |
| endpoints | 1776 | 705 个模型逐项请求全部成功；33 个模型返回合法空端点数组 |
| embedding_models | 40 | 专用 Embedding 目录 |
| image_models | 63 | 专用 Image 目录 |
| image_endpoints | 67 | 63 个 Image 模型逐项请求全部成功；1 个模型返回合法空数组 |
| video_models | 33 | 专用 Video 目录及原始 SKU 计价详情 |
| eu_models | 78 | EU 主机单独目录 |
| zdr_endpoints | 1117 | 官方 ZDR 端点视图 |
| model_count | 1 | 全模态计数对象，count=705 |
| model_rss | 705 | 官方当前模型 feed 项 |
| blog_posts | 166 | 官方博客当前 feed 项 |
| status_incidents | 6 | 官方当前事故 feed 窗口 |
| upstream_openapi | 1 | 官方规格文档，18 处凭据形态样例明确脱敏 |
| docs_index / site_index | 各 1 | 两份官方文档索引 |

最初未经脱敏的官方 OpenAPI 凭据样例触发 GitHub GH013，数据发布被拒，未绕过保护。该未公开运行仅保留本机；修复后使用新的真实采集时间生成上述公开快照，原响应哈希、归档哈希和脱敏规则/次数均写入 manifest。第一次 Actions 采集和推送成功后，验收脚本发现 OpenAPI 解析器原地修改对象导致别名比较失败；该运行取消验证并保留已采集数据，修复脚本后重新运行完整成功，没有把失败验收记为成功。

未完成的范围只限明确不可公开取得的内容：需要 OpenRouter 授权的排名、应用统计、会话成本、统一 benchmarks、任务分类、工具及私人账户数据；完整事故/长期性能/启动前历史；未具备权限的 Cloudflare Workers 全目录核查。具体来源及限制见 [sources.md](sources.md)。

## 2026-11-10 自然定时观察（原 16 类版本）

本节是既有服务的只读核查，未重建仓库、手动 dispatch、修改 cron 或改变授权。每日 workflow 仍为 active，配置 `23 1 * * *`（北京 09:23）。[自然定时运行 42782949976](https://github.com/yuxiaoli/openrouter-data/actions/runs/42782949976) 的 event 为 schedule，实际在 2026-11-10 08:28:45 UTC（北京 16:28:45）启动，08:29:28 UTC 完成，结论 success；这里只记录实际时间，不猜测与计划时刻差异的原因。

该次生成 `2026-11-10T082859Z-1ed5a98882`，采集区间 08:28:59.398–08:29:14.216 UTC，日期为 UTC 2026-11-10。data 头为 [`1d2513a7c1c8861fc66dc5051c397e498cb741ef`](https://github.com/yuxiaoli/openrouter-data/commit/1d2513a7c1c8861fc66dc5051c397e498cb741ef)，当时 index 保留 6 次真实运行；16 公开来源均 ok，models/model_rss 为 711，endpoints 为 1774，ZDR 为 1110。该观察属于新增 12 类发布之前，不把它算成 28 类新版验收。

当前进程及工作区未发现已配置的 OpenRouter credential，仓库 Actions secret 名称清单为空；这不是对机器所有凭据存储的穷尽检查，也没有读取、创建或复制密钥内容。GitHub 仓库授权和已有 Cloudflare Pages 授权不能当作 OpenRouter Data API 授权。

## 2026-11-10 来源更正与 API 1.1 本轮记录

对“首次验收记录”最后一段的**当前范围更正**：当时认证 `/api/v1/datasets/...` 的 401 与错误 `/api/frontend/stats/...` 路径的 404，不代表全部排名/会话/benchmark/任务统计都需要认证。此次从官方公开网页发现并匿名验证 `/api/frontend/v1/...`；详见 [独立来源复核](source-audit-2026-11-10.md) 和 [sources.md](sources.md)。原 16 类历史记录保持不改，新版增加 12 类公开统计；认证 Data API 仍按用户要求暂不启用，私人账户数据仍隔离。

新版通过 catalog、feeds 和 overview RSS 发现全部 28 类，RSS 附字段摘要、来源/单位/窗口、真实观测时间与完整 JSON；大型 native payload、原始响应和未知字段留在 JSON/归档。既有 endpoints 已保存 uptime/latency/throughput 原对象，但本轮研究所见 latency/throughput 可能全 null，不能声称这些端点已有非空性能测量；另行公开 performance 与 benchmark 视图保留原生值、null、窗口/单位未知说明，不推断价格分母或货币。

本轮已观察到包含 44 项测试的阶段性本地检查通过；随后纯公开来源 parser 已通过其红绿回归与匿名真实结构核查。此处记录阶段性证据，不把它替代最终 check/build、真实归档完整性或线上验收。

本轮现已完成真实采集、压缩归档发布及线上验收。[机器可读完整回执](sync-receipt-2026-11-10.json) 给出逐类条数、请求/响应数、窗口、单位、空样本、404、原始哈希变化和公开边界。

| 验收项 | 实际结果 |
| --- | --- |
| 最终本地验证 | 49 项测试、TypeScript、12 paths / 28 datasets OpenAPI 校验、build 均通过；[源码 CI](https://github.com/yuxiaoli/openrouter-data/actions/runs/42793633979) success |
| 真实采集 | `2026-11-10T093020Z-eb9b8257a8`，09:30:20.500–09:36:43.114 UTC（北京 17:30:20–17:36:43）；28 类 ok，errors 0，stale 0；13049 逻辑请求、8374 真实 fetch、4675 同 run 复用、0 重试 |
| 新鲜度与恢复 | latest_snapshot 与 last_success 同为上述成功 run；逐数据集成功映射 28 项；失败/stale 回退与时间区分已回归测试，首次 partial 原件与错误保留 |
| 归档 | [data e0b6f46](https://github.com/yuxiaoli/openrouter-data/commit/e0b6f46bfae683cce14269bfcde632552aeffd8a)；从实际暂存区导出的仅 gzip 发布格式验证 8 快照 / 30848 校验通过；旧 198 个文件树哈希不变 |
| 存储 | 本 run 133 payload 文件无损 gzip：537491873 逻辑 bytes → 48773335 压缩 bytes；加 plain metadata 共 54288075 bytes；原件本机保留，storage.json 双哈希、压缩损坏发布门和旧 plain 格式兼容均验证 |
| 线上部署 | [代码 9fdc791](https://github.com/yuxiaoli/openrouter-data/commit/9fdc791eb7dc5714a5c029a36a70efa389ad0ab3)，[Pages 180f01e7](https://180f01e7.openrouter-data.pages.dev)，生产 <https://openrouter-data.pages.dev> |
| 线上功能 | 80 项真实 HTTP GET 验收通过，另有独立 32 次定向只读复查通过：28 类 data、catalog / feeds / overview、分类 RSS、OpenAPI、窗口 / metric / 模型 / app 查询、分页、旧历史、严格错误参数与 private type 拒绝；与本地暂存发布格式 80 项检查分开报告 |
| 每日任务 | 当前 state active，唯一原 cron `23 1 * * *` / 北京 09:23 不变；既有自然运行 42782949976 success；本轮未 dispatch 或创建新定时。任务超时调整为 90 分钟适应完整公开数据，新增最新 gzip 发布门；来源 partial 仍归档并让 job 明确失败 |

公开榜中的退役模型仅按原生 canonical/variant 身份补发现并尝试其当前可读窗口；合法空和 404 明确记录，不补造零用量或早期 snapshot。图片数、request、token、文档、视频秒/小时、字符、份额与百分点不可相加；没有声明的窗口、时区、performance/价格单位保留 unknown/unspecified。

第一次新增采集 `2026-11-10T090637Z-35d01ff9e5` 明确为 partial：25 类 ok、三类逐模型统计出现 72 条请求生成错误（24 个目录真实 `~author/model` 别名被本地白名单遗漏），无其他网络/结构错误。这不是上游需要认证。修复仅允许原生作者前单个 `~`，仍保持 host / 路径 / 参数和私有接口白名单限制；保留该运行后重新完整匿名采集，得到上述 success。两次记录均在 data 分支，不覆盖失败记录，不复用旧时间冒作新观察。

此次实际 404 共 16 条，均为特定模型的公开可用性接口，按不可得保留原响应。1297 个 activity 和 1297 个 model-apps 行是保留完整 payload 的请求上下文，不是 1297 个独立模型；覆盖 711 个当前目录模型，并从公开榜补足至 792 个 canonical/variant 上下文（额外 81 个）。旧目录与新增统计有重叠，不把它们相加当全平台流量。
