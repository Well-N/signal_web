# 文档索引

版本：v0.1  
日期：2026-10-27  
状态：设计定稿前草案

| 文档 | 内容 | 主要读者 |
| --- | --- | --- |
| [00-ONE-PAGER](00-ONE-PAGER.md) | 一页看懂产品、组合方式和首版范围 | 所有人 |
| [01-PRD](01-PRD.md) | 产品定位、用户、场景、范围、指标 | 产品、设计、开发 |
| [02-UX-VISUAL](02-UX-VISUAL.md) | 三种视图、布局、图谱编码、蜘蛛动效 | 设计、前端 |
| [03-ARCHITECTURE](03-ARCHITECTURE.md) | 系统分层、采集流水线、部署拓扑 | 后端、运维 |
| [04-DATA-API](04-DATA-API.md) | 数据表、枚举、REST API、图谱响应 | 全栈 |
| [05-AI-PIPELINE](05-AI-PIPELINE.md) | Profile、评分、摘要、日报、防注入 | AI/后端 |
| [06-SOURCES-COMPLIANCE](06-SOURCES-COMPLIANCE.md) | 首批来源、适配器、版权与抓取规则 | 后端、内容 |
| [07-ROADMAP-QA](07-ROADMAP-QA.md) | 里程碑、任务拆分、测试矩阵、验收 | 项目负责人 |
| [08-OPERATIONS-RISKS](08-OPERATIONS-RISKS.md) | 环境变量、Docker、日志、备份、风险 | 运维、负责人 |
| [09-DECISIONS](09-DECISIONS.md) | 已定决策、参考项目边界、待确认项 | 全体 |
| [10-BUILD-PLAN](10-BUILD-PLAN.md) | 直接复用 Horizon/DailyDawn 的构建顺序和改造边界 | 开发、项目负责人 |
| [11-PROGRESS](11-PROGRESS.md) | 当前已实现内容、验证结果和已知限制 | 全体 |
| [12-APP-ARCHITECTURE](12-APP-ARCHITECTURE.md) | 桌面 APP、首次配置、凭据库和系统每日任务 | 全体 |
| [13-DESKTOP-ARCHITECTURE-DETAIL](13-DESKTOP-ARCHITECTURE-DETAIL.md) | APP 进程、目录、安全、锁、打包和发布细节 | 开发、运维 |
| [14-UI-DIRECTION](14-UI-DIRECTION.md) | Hallmark Cobalt 界面系统、状态和验证记录 | 设计、前端 |
| [15-STYLE-OPTIONS](15-STYLE-OPTIONS.md) | 蓝白古希腊 + 赛博朋克首页风格候选 | 设计、产品 |

许可证与第三方项目说明见 [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md)。

## 文档维护规则

- 任何影响产品范围、数据结构或公网行为的决定，先更新文档再改代码。
- 引入新的信息源必须同步更新来源文档，写清访问方式、频率、许可和失败表现。
- 任何“默认值”“示例数据”必须明确标注用途；生产环境不得用示例数据顶替真实来源。
- 文档中的接口和数据表是开发契约，变更需要记录在 `09-DECISIONS.md`。

