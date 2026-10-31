# Third-Party Notices

本项目实际使用和参考的开源项目。复制代码或提示词时必须保留对应许可证和署名。

## 已复制代码：Horizon

- Repository: https://github.com/Thysrael/Horizon
- License: MIT（仓库内 pipeline/LICENSE 保留原文件）
- Copyright: Copyright (c) 2026 Thysrael
- 实际用途：整个 pipeline/ 是 Horizon 的副本，负责抓取、Profile 分类、AI 评分、去重、摘要和投递。
- 本项目在其上做的修改：
  - src/export/json_export.py：把结果导出为 Web 可读的 latest.json。
  - profiles/ai-news/：AI 资讯的匹配、评分和 enrichment 提示词。
  - src/export/crawl_events.py 与 orchestrator 的抓取钩子：供爬虫页读取的遥测事件。
  - 修复 orchestrator.run 中局部 Path 导入导致的 UnboundLocalError。

## 参考思路，未复制代码：DailyDawn

- Repository: https://github.com/TangSY/dailydawn
- License: MIT（按上游 README）
- 用途：参考每日 Top 3 的组织方式和编辑口吻；当前 profiles/ai-news 的提示词按本项目需求重写，未直接搬运原文。

## 仅研究交互，未使用代码：两个爬虫仓库

- https://github.com/fredfokan/web-crawler
- https://github.com/cyohei9907/web-crawlers

仓库中未发现 LICENSE 文件，默认保留版权。本项目没有复制其源代码或素材。

## 前端依赖

- Next.js 16.4.3 — MIT
- React 19.3 — MIT
- Tailwind CSS 4 — MIT
- react-force-graph-2d 1.29 — MIT
- Motion 14 — MIT

## 字体

- Bodoni Moda — SIL Open Font License 1.1
- IBM Plex Sans — SIL Open Font License 1.1
- JetBrains Mono — SIL Open Font License 1.1

三者都通过 next/font 从 Google Fonts 加载。

## 图像素材

- 维特鲁威人刻印：公有领域版画，按页面配色重新上色后作为首页主图。
- Herodotos 大理石半身像：The Metropolitan Museum of Art，CC0，目前只保留在 design-previews/assets 里作早期概念稿参考。

## 非代码参考

- Hermes 官网（https://hermes-agent.nousresearch.com/）：借鉴配色和版式语言，未使用其品牌资产。
- Hallmark 设计技能：本地技能文件，用于界面规范校验。

