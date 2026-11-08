# 运行与验收

## 架构与授权范围

- 代码仓库：<https://github.com/yuxiaoli/openrouter-data>，默认分支 `main`。
- 历史数据：同仓库 `data` 分支；`index.json` 为运行目录及上次成功指针。
- 服务：Cloudflare Pages advanced mode，地址 <https://openrouter-data.pages.dev>；构建产物 `dist/_worker.js`。
- 上游数据和公开可获取性见 [sources.md](sources.md)，实际运行范围、采集时间及错误以 manifest 为准。
- 本机已存在 Cloudflare Pages 授权。每日同步无需 Cloudflare 凭据，只用 GitHub 内置 token；不在仓库、日志、URL 中写入私人令牌。

现有相关仓库已排查：GitHub 无 OpenRouter 专用仓库；既有 RSS 目录只引用官方 JSON 和 RSS；`cf-feeds` 为订阅监控，`llm-gateway-providers` 使用 models.dev。Cloudflare Pages 列表无同类 OpenRouter 项目。现有 OAuth 没有 Workers scope，未能穷尽 Workers 服务目录，因此不把该部分核查描述为完成。

## 每日同步

`sync.yml` 默认每天 `23 1 * * *` UTC（北京 09:23），可从 Actions 页面手动运行，或：

```sh
gh workflow run sync.yml --repo yuxiaoli/openrouter-data --ref main
gh run list --repo yuxiaoli/openrouter-data --workflow sync.yml --limit 10
```

任务先检出 main、安装锁定依赖并执行 `npm run check`，再将 data 分支检出到 `data/`。`npm run sync -- --output data` 创建不可覆盖的独立运行目录。失败退出非零，仍提交新 manifest 和索引；旧成功指针保持不变。推送失败也使 job 失败。Actions step summary 展示来源状态及发布结果，artifact 包含日志、索引和该次 manifest，保留 14 天。

成功归档后会对 Cloudflare 服务执行 smoke，指定该次 snapshot ID，覆盖 JSON、RSS、OpenAPI 与多维筛选；每 30 秒重试，最多约六分钟，容纳 GitHub raw 缓存传播。线上验证失败不删除已归档的数据，job 仍报告失败。服务不会依据 HTTP 200 自行判定采集完整，必须查看 manifest 和健康状态。

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
2. 查看 `data/runs/<id>/manifest.json` 的来源状态及缺口，并核对 `last_success` 仍指向有效旧运行。
3. 对上游实际返回做最小复查。官方接口变更时修改采集器及契约、运行测试，再创建新的真实运行；不补造缺失数据。
4. 归档成功但线上不可见时，检查 GitHub raw 和服务缓存；使用精确 snapshot ID 排除 latest 缓存差异。

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
