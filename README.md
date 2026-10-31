# 织讯 · SignalWeb

> 把每天散落在官方博客、社区、论文和开源项目里的 AI 信号，织成一张能读、能追、能行动的网络。

**状态：** 产品与工程文档 v0.1，已进入实现阶段。  
**目标形态：** 个人优先的中文 Web 应用，后续可部署为公开站点或包装为桌面应用。

> Horizon 底座、ai-news Profile、JSON 导出和 Next.js 阅读界面已经落地。进度见 docs/11-PROGRESS.md。

## 本地运行

### 1. 配置 Horizon

    cd F:\godot\ai-news-radar\pipeline
    New-Item .env -ItemType File

编辑 pipeline/.env，填写：

    LLM_BASE_URL=你的 OpenAI 兼容接口地址
    LLM_API_KEY=你的 API Key
    LLM_MODEL=你的模型名

如果本机没有 uv，先运行：python -m pip install uv

然后运行一次真实采集和日报：

    cd F:\godot\ai-news-radar
    .\scripts\run_daily.ps1

### 2. 启动网页

    .\scripts\start_web.ps1

打开 http://localhost:3000。网页读取 pipeline/data/export/latest.json。

### 3. 只开发界面

    .\scripts\start_demo.ps1

演示模式使用 web/fixtures/sample-brief.json，并会在页面顶部标明“示例数据”。不设置 SIGNALWEB_DEMO=1 时不会使用示例内容；没有真实 JSON 就显示空状态。

### 4. 启动桌面 APP

    cd F:\godot\ai-news-radar\desktop
    npm run dev

Electron 会自动检查本地 Next 服务；首次没有配置时打开配置页，已配置时直接打开看板。

Windows x64 安装包构建：

    cd F:\godot\ai-news-radar\desktop
    npm run dist:win

安装文件输出到 `desktop/dist/SignalWeb-Setup-0.1.2-x64.exe`。安装向导提供欢迎页、安装范围、安装位置、“创建桌面快捷方式”复选框、安装进度和完成页。运行环境随安装包提供，终端用户无需安装 Node.js、Python 或开发依赖。

macOS 测试包由 GitHub Actions 的 Mac 构建机生成，下载方法见 [macOS 云端构建](docs/18-MACOS-CLOUD-BUILD.md)。

应用程序安装目录与用户数据分开。配置和日报保存在用户数据目录，升级不会覆盖用户配置。构建和验证说明见 [Windows 安装包](docs/16-WINDOWS-INSTALLER.md)。

设置页的“立即运行一次”会在页面顶部显示抓取阶段和百分比。Windows 后台运行使用 `pythonw.exe`，不会弹出控制台窗口；macOS/Linux 同样以无窗口子进程运行。

“日报投递”里可以分别关闭每日自动运行、每日推送和开机自启动。关闭每日自动运行会移除系统定时任务；关闭每日推送只停止飞书/企业微信发送，仍可手动生成 PDF；开机自启动由桌面壳在系统登录项中注册。

### 5. 日报投递与 PDF

在「设置 → 日报投递」中可以选择每日运行时间、飞书机器人 Webhook、企业微信机器人 Webhook、PDF 保存目录和 PDF 风格。飞书与企业微信可以同时启用；Webhook 写入系统凭据库，不进入浏览器存储和 settings.json。

每日任务生成 latest.json 后会自动生成 PDF 并发送摘要通知。也可以点「立即导出今日 PDF」用当前数据重新生成，不触发 AI 抓取。四种 PDF 风格为：网格档案、暗房、手作工坊、孔版印刷。PDF 默认保存到文档目录下的 `SignalWeb Reports`，文件名包含日期和风格。

PDF 生成依赖 `reportlab`，已加入 `pipeline/pyproject.toml`。Windows 使用 Microsoft YaHei，macOS 使用 PingFang/Heiti 字体；缺少中文字体时会在运行状态里明确报错。

## 当前目录

    pipeline/    Horizon 后端底座、ai-news Profile、JSON 导出
    web/         Next.js 简报、网络图、故事详情
    desktop/     Electron 桌面壳和首次启动入口
    scripts/     启动与每日运行脚本
    docs/        产品、架构、构建计划和进度

## 产品一句话

织讯每天自动收集 AI 资讯，去重、聚类、评分并生成编辑判断；用户在看板上既能读每日简报，也能在网络图中看到故事、来源、模型和公司之间的关系。

## 文档入口

建议按以下顺序阅读：

1. [产品一页纸](docs/00-ONE-PAGER.md)
2. [文档索引](docs/README.md)
3. [产品需求文档](docs/01-PRD.md)
4. [交互与视觉规范](docs/02-UX-VISUAL.md)
5. [技术架构](docs/03-ARCHITECTURE.md)
6. [数据模型与 API](docs/04-DATA-API.md)
7. [AI 分析流程](docs/05-AI-PIPELINE.md)
8. [信息源与合规](docs/06-SOURCES-COMPLIANCE.md)
9. [路线图与验收](docs/07-ROADMAP-QA.md)
10. [部署、运维与风险](docs/08-OPERATIONS-RISKS.md)
11. [决策记录](docs/09-DECISIONS.md)
12. [项目构建计划](docs/10-BUILD-PLAN.md)
13. [当前进度](docs/11-PROGRESS.md)
14. [桌面 APP 架构](docs/12-APP-ARCHITECTURE.md)
15. [桌面 APP 详细架构](docs/13-DESKTOP-ARCHITECTURE-DETAIL.md)
16. [界面设计方向](docs/14-UI-DIRECTION.md)
17. [首页风格候选](docs/15-STYLE-OPTIONS.md)

## 产品基本原则

- **先读懂，再好看。** 可视化服务于发现关系，阅读面板负责交付信息。
- **故事簇优先。** 一篇文章一个节点会让图谱不可读；默认节点是同一事件的聚合。
- **没有静默兜底。** 信息源、AI 配置或正文提取失败时显示明确状态，不用假数据或默认来源替代。
- **原文可追溯。** AI 摘要始终保留原文链接、来源、时间和引用依据。
- **动效可控。** 蜘蛛与蛛丝是可选浏览层，提供暂停、降低动效和干净阅读模式。

## 参考项目的使用方式

| 项目 | 借鉴内容 | 使用边界 |
| --- | --- | --- |
| [Horizon](https://github.com/Thysrael/Horizon) | 多源抓取、Profile 评分、全文提取、去重、投递和测试结构 | MIT；可参考或复用，保留许可证与署名 |
| [DailyDawn](https://github.com/TangSY/dailydawn) | 每日重点、编辑结构、行动建议和多智能体日报思路 | MIT；可参考或复用，保留许可证与署名 |
| [fredfokan/web-crawler](https://github.com/fredfokan/web-crawler) | 蜘蛛覆盖层、链接落脚点、Canvas 叠加 | 仓库未见 LICENSE；只借鉴思路，不复制代码与素材 |
| [cyohei9907/web-crawlers](https://github.com/cyohei9907/web-crawlers) | 单词落脚、两段式 IK、步态、DOM 读取与写入分离 | 仓库未见 LICENSE；只借鉴思路，不复制代码与素材 |

## 暂时不包含

- 全文镜像、绕过付费墙或自动转载。
- 公网多租户、复杂权限和付费系统。
- 实时秒级推送；首版以 15–60 分钟批次为主。
- 浏览器扩展。等 Web 版数据层稳定后再评估。

## 实施策略

MVP 不重写采集和分析系统：以 Horizon 作为后端底座，借用 DailyDawn 的编辑提示词，前端使用 Next.js、Tailwind 和 react-force-graph-2d。具体改造顺序见 [项目构建计划](docs/10-BUILD-PLAN.md)。

