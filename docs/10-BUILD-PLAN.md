# 项目构建计划

## 1. 原则

首版目标是尽快得到一条真实可用的闭环：**真实来源 → 真实评分 → 真实简报 → 可读界面**。

实现策略：

1. 后端直接以 Horizon 为底座，不重写抓取器、去重、Profile 和评分。
2. 编辑结构直接借用 DailyDawn 的提示词和 Top 3 思路，不重新发明日报体系。
3. 前端使用现成框架、组件库和图谱库，不自研 Canvas 图引擎。
4. 蜘蛛先用 SVG + Motion 做简化版，不首版手写八腿 IK。
5. MVP 使用 Horizon 现有的文件输出，加一层 JSON 导出；数据库和独立 API 服务后置。
6. 参考项目中无 LICENSE 的蜘蛛代码只借鉴交互，不复制。

## 2. 复用矩阵

| 需求 | 直接使用 | 自己写的部分 |
| --- | --- | --- |
| 多源抓取 | Horizon `src/scrapers/*` | 只加来源配置 |
| 正文提取 | Horizon `trafilatura` extractor | 无需重写 |
| 去重 | Horizon URL / cross-source / topic dedup | 补充展示字段 |
| 评分与 Profile | Horizon `profiles/*` + `src/ai/analyzer.py` | 新增 `ai-news` Profile |
| 日报 | Horizon `DailySummarizer` | 用 DailyDawn 的 Top 3 提示词增强 |
| 邮件/Webhook | Horizon `src/services/*` | 配置即可 |
| 调度 | GitHub Actions 或系统计划任务 | 不先写队列系统 |
| Web 框架 | Next.js App Router | 页面和视觉层 |
| UI 组件 | shadcn/ui + Tailwind | 主题和布局 |
| 数据请求 | TanStack Query | API 适配层 |
| 图谱 | `react-force-graph-2d` | 节点/边样式和过滤 |
| 蜘蛛动效 | `motion` + SVG 蜘蛛 | 路径和落脚点逻辑 |
| 存储 | Horizon `data/` 文件 | JSON 导出器 |
| 数据库 | 暂不使用 | 需要多用户/复杂搜索时再接 Postgres |

## 3. 目标目录

```text
ai-news-radar/
├── pipeline/                 # Horizon fork；保留其 src、profiles、tests
│   ├── src/                  # 采集、分析、摘要、投递
│   ├── profiles/             # 新增 ai-news
│   ├── data/                 # config、summaries、export
│   └── tests/
├── web/                      # Next.js + Tailwind + shadcn/ui
│   ├── app/
│   ├── components/
│   └── public/
├── scripts/
│   ├── export_horizon_json.py
│   └── run_daily.py
├── docs/
└── THIRD_PARTY_NOTICES.md
```

`pipeline/` 直接保留 Horizon 的许可证和上游 README；`profiles/ai-news/` 是新文件；`web/` 是新前端。

许可证与改编说明记录在 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。

## 4. 分阶段构建

### 阶段 0：先跑通 Horizon（0.5–1 天）

不写任何产品代码，先证明底座可用。

当前项目已经预置 pipeline/data/config.json 和 pipeline/.env.signalweb.example。先复制环境文件并填写密钥；不要用上游示例配置覆盖 ai-news 配置。

```powershell
git clone https://github.com/Thysrael/Horizon.git pipeline
cd pipeline
uv sync
Copy-Item .env.example .env
Copy-Item data/config.example.json data/config.json
# 填写 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
uv run horizon --hours 24
```

验收：

- 生成一份 `data/summaries/horizon-YYYY-MM-DD-*.md`。
- 至少有一个真实 RSS/API 来源成功。
- 失败来源在日志里明确显示。
- 不改 Horizon 核心代码即可跑通。

如果这一步跑不通，先解决配置或 API，不进入前端。

### 阶段 1：配置 AI 资讯 Profile（1–2 天）

复制现有 `tech-news` Profile，创建 `profiles/ai-news/`：

```text
profiles/ai-news/
├── profile.json
├── match.md
├── analysis.md
└── enrichment.md
```

要做的事：

- 路由规则覆盖模型发布、研究、工具、开源、行业和社区讨论。
- 评分使用文档中的 0–10 rubric。
- enrichment 输出一句话、三条要点、为什么重要、风险、标签和证据。
- 首批来源只启用 6–8 个 RSS/API，先不接 HTML 选择器。

验收：

- 同一批真实内容至少有一条被正确分成模型发布、一条研究、一条工具。
- 评分有理由，不是只有数字。
- 低质量营销内容能被压到 4 分以下。

### 阶段 2：增加 JSON 导出（1–2 天）

Horizon 目前主要输出 Markdown。新增一个轻量导出器，不动抓取逻辑：

```text
pipeline/src/export/json_export.py
```

输出：

```text
data/export/latest.json
data/export/YYYY-MM-DD.json
```

结构：

```json
{
  "date": "2026-10-27",
  "headline": "...",
  "sections": [
    {
      "id": "top3",
      "title": "今日 Top 3",
      "stories": []
    }
  ],
  "stories": [],
  "sources": []
}
```

数据直接来自 Horizon 已选中的 `ContentItem` 和 summary，不重新做评分。

验收：

- JSON 能被前端读取。
- 每条故事保留来源、URL、分数、摘要和标签。
- 不存在伪造文章；失败字段清楚可见。

### 阶段 3：做可读前端（3–5 天）

```powershell
npx create-next-app@latest web --typescript --tailwind --eslint --app
cd web
npm install @tanstack/react-query react-force-graph-2d motion
npx shadcn@latest init
```

先做三个页面：

- `/`：今日简报。
- `/stories`：列表和时间筛选。
- `/stories/[id]`：故事详情和原文链接。

数据读取用 Next.js route handler，直接读取 `data/export/latest.json`。此阶段不启动 FastAPI、不建数据库，减少一层服务。

验收：

- 简报能在 2 秒内打开。
- 故事详情能回到原文。
- 手机宽度可读，列表不横向溢出。
- 没有数据时显示明确空状态。

### 阶段 4：接入图谱（2–3 天）

用 `react-force-graph-2d` 渲染故事、来源和实体节点。

- 先显示故事节点和 `same_story` / `mentions` 边。
- 超过 120 个节点时只显示 Top N 和分类抽样。
- 点击节点打开右侧详情。
- 节点位置在刷新后保持稳定。

不自己实现力导向布局。图谱库负责布局和缩放；我们只做数据结构、样式和交互。

验收：

- 100 个节点可拖动、缩放、筛选。
- 相似主题不会因为颜色相同被误认为同一事件。
- 无关系时不画假边。

### 阶段 5：蜘蛛视觉层（2–4 天）

首版不实现八腿 IK。

- 使用 SVG 蜘蛛 + Motion 沿卡片路径移动。
- 在 2–3 个故事卡片之间移动，不做全页面漫游。
- 使用 SVG 曲线画 1–3 条短生命周期的蛛丝。
- 点击故事时，蜘蛛移动到该卡片附近；不覆盖正文。
- 提供暂停、关闭和 `prefers-reduced-motion`。

只有当视觉验证通过、确实需要更真实的步态时，再考虑自写 IK。

验收：

- 不影响卡片点击和文本选择。
- 阅读详情时自动暂停。
- 关闭后无持续动画开销。

### 阶段 6：自动运行与交付（2–3 天）

- 使用 Horizon 的 GitHub Actions 模板定时运行。
- 将 `data/export/latest.json` 发布到前端可读取的位置，或提交到仓库后由 Vercel 部署。
- 本地用户也可以双击 `scripts/run_daily.py` 手动生成。
- 邮件/Webhook 直接使用 Horizon 现成模块，不新写投递系统。

验收：

- 连续 3 天自动更新。
- 失败时不覆盖上一次成功 JSON。
- 前端显示最后成功时间和失败原因。

## 5. 需要修改 Horizon 的文件

尽量只改以下位置：

1. `data/config.json`：来源与 AI 配置。
2. `profiles/ai-news/*`：新 Profile。
3. `src/export/json_export.py`：新文件。
4. `src/orchestrator.py`：在成功生成摘要后调用导出器。
5. `tests/test_json_export.py`：导出契约测试。

不改：抓取器、`trafilatura` 提取器、Profile 加载器、邮件/Webhook 服务，除非遇到明确 bug。

## 6. DailyDawn 的接入方式

第一阶段不运行 DailyDawn 的完整流水线。只复制并改编它的编辑提示词：

- `prompts/editor.zh.md`：Top 3、每日一句话、编辑口吻。
- `prompts/expert.zh.md`：深度判断和反向视角。

把适配后的提示词放入 `pipeline/profiles/ai-news/`，让 Horizon 的现有 LLM 流程调用。这样可以复用编辑经验，又不会同时维护两个 Python 调度器。

在 `THIRD_PARTY_NOTICES.md` 记录 DailyDawn 的 MIT 许可证、作者和改编说明。

## 7. 不做什么

- 不写新的 RSS 抓取框架。
- 不写新的 LLM SDK。
- 不写新的力导向图引擎。
- 不写新的任务队列或数据库层（MVP 阶段）。
- 不手写八腿 IK（首版）。
- 不复制无 LICENSE 的蜘蛛代码。
- 不在首版做注册、计费、多租户。

## 8. 关键路径

```text
Horizon 跑通
  → ai-news Profile
  → JSON 导出
  → Next.js 简报/列表/详情
  → 图谱
  → 蜘蛛
  → 自动更新
```

前三天只验证前两步。只要 Horizon 能产出真实简报，后面的前端就是组装工作。

