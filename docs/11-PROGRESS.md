# 当前进度

更新时间：2026-10-28

## 已完成

### 后端底座

- 把 Horizon 复制到 pipeline/，保留 MIT 许可证和原有测试。
- 安装 uv 依赖，Horizon 基础环境可以运行。
- 新增 profiles/ai-news/，包含路由、评分和 enrichment 提示词。
- 新增 pipeline/data/config.json，启用 Hacker News、Google News、Simon Willison、vLLM 和 Hugging Face RSS。arXiv 的 RSS 单次返回条目过多，首版暂不启用，研究方向先用 Google News 查询覆盖。
- 新增 pipeline/src/export/json_export.py：
  - 把 Horizon 的 ContentItem、评分、artifacts 和来源状态导出为 data/export/latest.json。
  - 根据共享标签生成明确标注的 shared_tag 图边。
  - 不生成示例文章、假摘要或默认来源。

### 前端

- 使用 Next.js 16、React 19、Tailwind 创建 web/。
- 首页改为钴蓝信号版式：钴蓝底、Bodoni 衬线标题、右侧维特鲁威刻印、下方大理石信号账本放 Top 3，分类故事排在账本之后，页尾是关系网络与来源健康。
- 视觉系统统一到 tokens.css：surface-cobalt / surface-marble 两套表面令牌，按钮、输入框、图表面板都跟随所在表面换色。
- 除简报页外，网络、爬虫、设置、故事详情和空状态改用暖白主题（app-shell--warm）：纸面 #f7f2e9、暖墨 #2b2723、面板 #fffcf6、图表底 #efe7d9，钴蓝只作强调色；图谱与爬虫 canvas 的颜色改从所在元素读取，跟随主题切换。
- 完成 /network：基于 react-force-graph-2d 的信息网络；节点颜色读页面令牌，高分节点用纸白，其余用浅蓝。
- 完成 /crawl：每个抓取来源是一根连到中央的蛛丝，事件是沿丝流动的光点，中央显示本次抓到的条数；运行中每 2.5 秒刷新，结束后保留上一次的轨迹，下面列出各来源的条数与状态。
- 完成 /stories/[id]：AI 摘要块、评分理由、原文链接、相关故事。
- 完成无数据空状态，明确提示运行 Horizon，不自动展示假数据。
- 开发 fixture 仅在显式设置 SIGNALWEB_DEMO=1 时启用，并显示“示例数据”标记。

### 抓取遥测

- pipeline/src/export/crawl_events.py 负责写 data/state/crawl-events.jsonl，每次运行开始时清空。
- orchestrator 在 _fetch_with_progress 里发出 source_start / source_done，带来源名、条数、状态、耗时和错误。
- runner 在 run 前后发出 run_started / run_finished / run_failed。
- /api/crawl/events 把 JSONL 聚合成当前状态，供 /crawl 轮询。

### 桌面 APP

- 新增 desktop/ Electron 壳，开发模式可自动启动本地 Next 服务并打开桌面窗口。
- 新增 /setup 首次配置页：填写 API Base URL、模型、Key、每日时间。
- 新增 /api/setup 和 /api/setup/run，调用 Python Runner 完成配置和后台运行。
- 新增 pipeline/scripts/signalweb_runner.py：
  - 使用 keyring 写入/读取系统凭据库。
  - 写入非敏感 settings.json。
  - 注册 Windows 计划任务或 macOS LaunchAgent。
  - 调用 Horizon 并写 last_run.json。
- 实测 Windows Credential Manager 可写可读；实测 Windows 计划任务 SignalWebDaily 可创建和删除。

## 验证结果

- pipeline/tests/test_json_export.py 和 pipeline/tests/test_profiles.py：13 项通过。
- 实际来源诊断：抓取到 50 条内容（Hacker News 17、Google News 30、RSS 3），整体状态 success。部分 Simon Willison 全文提取被本机 DNS 安全策略阻断，但没有阻断整批采集。
- npm run build：通过。
- npm run lint：0 error、0 warning。
- Hallmark sloplint：0 FAIL、0 REFLEX、0 WARN。
- 用 1440x900 实际渲染检查了首页、网络、设置、故事详情和空状态五个界面。
- 实际打开首页、网络页和故事详情页，布局和交互可用。
- 空状态已验证：没有 latest.json 时会显示运行说明，不填入示例内容。

## 已知限制

- 还没有配置真实 LLM API Key，因此尚未完成一次真实 Horizon 抓取、评分和摘要运行。
- Horizon 全量测试在当前 Windows/DNS 环境中有少量上游失败，主要是 webhook URL 被安全解析为私有地址，以及 Windows 路径断言差异；本项目新增测试不受影响。
- 目前图谱的关系边来自共享标签，尚未接入实体抽取、引用关系和语义聚类。
- 爬虫可视化目前只有来源级事件：每个来源的条数、耗时和状态。单条内容的逐条轨迹、以及评分与摘要阶段的耗时还没有采集。
- macOS LaunchAgent 尚未在真实 Mac 上验证。
- Electron 安装包、PyInstaller sidecar 和 electron-builder 配置尚未完成。
- Next.js 直接读取本机 pipeline/data/export/latest.json，适合本地 MVP；部署到云端时需要把 JSON 复制到 Web 可访问目录或对象存储。

## 下一步

1. 在桌面 APP 配置页填入真实 API Key，完成一次端到端首次运行。
2. 根据真实结果调整 profiles/ai-news/analysis.md 和 enrichment.md。
3. 打包 Python Runner sidecar，并配置 electron-builder 生成安装包。
4. 补充故事聚类和实体关系，替换当前的共享标签图边。
5. 给爬虫可视化补上阶段事件（抓取完成、评分开始、摘要生成、导出），并记录单条内容的轨迹。

## 运行

### 真实数据

    cd F:\godot\ai-news-radar\pipeline
    Copy-Item .env.signalweb.example .env
    # 编辑 .env，填写 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
    cd ..
    .\scripts\run_daily.ps1
    .\scripts\start_web.ps1

### 界面开发

    cd F:\godot\ai-news-radar
    .\scripts\start_demo.ps1

演示模式使用 web/fixtures/sample-brief.json，只能用于界面开发，不应作为生产数据。
