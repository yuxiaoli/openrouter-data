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

本节由实际执行结果补充。文档创建时未将尚未观察到的测试、线上结果或任务状态记为成功；来源调查中的统计不代替真实同步记录。

需要记录：本地 check/build、真实同步 ID 与状态及各数据集条数、失败保留测试、Cloudflare 部署版本、线上 JSON/RSS/OpenAPI/多维查询验证结果、首次手动 Actions URL 与结论，以及定时 workflow 的 enabled 状态。未取得认证数据和启动前历史保持明确缺口。
