# 部署、运维与风险

## 1. 本地部署

MVP 先采用“一条 Python 流水线 + 一个 Next.js 前端”的本机运行方式：

```text
pipeline/  uv run horizon
web/       npm run dev
```

Horizon 生成 Markdown/JSON，Next.js 读取 JSON。Docker Compose 和 Postgres 作为部署升级路径：

```text
web (Next.js)
api (FastAPI + scheduler)
postgres (PostgreSQL 16 + pgvector)
```

抓取量和模型调用增加后，再拆出独立 worker，并把调度器切到 Redis/Celery。

## 2. 环境变量

```dotenv
APP_ENV=development
APP_BASE_URL=http://localhost:3000
API_HOST=0.0.0.0
API_PORT=8000
DATABASE_URL=postgresql+psycopg://signalweb:signalweb@postgres:5432/signalweb
ADMIN_TOKEN=replace-with-random-token

LLM_PROVIDER=openai-compatible
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=
LLM_TIMEOUT_SECONDS=60

DAILY_BRIEF_TIME=08:00
APP_TIMEZONE=Asia/Shanghai
FETCH_CONCURRENCY=4
MAX_ARTICLES_PER_RUN=150

SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
```

规则：

- API Key 只放在后端环境变量或本机密钥管理器中。
- 前端只拿到 `configured: true/false`，永远不返回完整密钥。
- 缺少配置时明确报错，不使用默认模型或默认来源。

## 3. 启动与健康检查

- `GET /api/v1/health` 检查 API、数据库、调度器。
- 启动前运行 Alembic 迁移；迁移失败不启动 API。
- Web 构建失败不覆盖上一次可用构建。
- 每天运行结束记录 `run_id`、故事数、简报状态。

## 4. 日志

使用结构化 JSON 日志，字段统一：

```json
{
  "ts": "2026-10-27T08:00:00+08:00",
  "level": "info",
  "event": "source.fetch",
  "run_id": "...",
  "source": "Hacker News",
  "duration_ms": 820,
  "item_count": 18
}
```

- 禁止记录 API Key、Authorization 头、完整数据库 URL。
- 抓取错误记录域名、HTTP 状态、错误类型；不记录完整正文。
- 日志保留 14 天或按磁盘上限轮转。

## 5. 备份与恢复

- 每日 `pg_dump` 到本地卷，保留 7 天。
- 备份前不进行 schema 迁移。
- 恢复演练：空数据库恢复后，`/health` 正常，历史简报可读。
- 原始 HTML 不长期保存；只保留必要元数据和短摘要。

## 6. 运行手册

### 全量抓取失败

1. 查看 `/admin/runs/:id` 和结构化日志。
2. 区分网络、DNS、来源改版、数据库问题。
3. 不临时切换到其他来源或静态数据。
4. 修复来源配置后重跑；保留失败运行记录。

### LLM 返回异常

1. 检查 429/5xx、模型名和配额。
2. 重试一次结构化修复；仍失败标记 `analysis_failed`。
3. UI 保留原始文章和失败原因，不生成摘要。

### 简报重复发送

1. 检查 `briefs.sent_at` 和投递幂等键。
2. 不在未确认状态下再次手动发送。
3. 记录投递失败和重试次数。

## 7. 风险清单

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 来源改版/下线 | 抓取失败、内容缺失 | RSS/API 优先、来源健康、契约测试、明确失败 |
| 反爬和限流 | IP 被封、数据中断 | 限速、缓存、尊重 robots/条款、只接允许来源 |
| 版权/转载 | 法律与信任风险 | 只存元数据和短摘要、原文链接、不镜像全文 |
| 模型幻觉 | 错误判断 | 引用校验、置信度、人工可见、原文优先 |
| 提示注入 | 模型执行恶意指令 | 文章数据隔离、禁用文章内工具调用、白名单工具 |
| SSRF | 访问内网服务 | URL 协议/私网阻断、DNS/IP 复核 |
| 图谱过密 | 不可读、性能差 | 故事簇优先、节点上限、折叠实体、局部展开 |
| 蜘蛛干扰阅读 | 用户反感 | 可关闭、降低动效、干净模式、阅读时暂停 |
| 重复事件 | 简报噪音 | URL/指纹/embedding/实体四层去重 |
| 成本失控 | 模型账单 | 先评分后摘要、缓存、批量、每日上限 |
| 单机故障 | 服务中断 | Docker 重启策略、备份、可重建索引 |
| 许可证 | 无法复用代码 | MIT 项目保留署名；无 LICENSE 项目只借鉴思路 |

## 8. 外部服务降级原则

- 单源失败：继续其他来源，状态标记 `partial`。
- 数据库不可用：停止写入和发布，返回明确错误。
- 模型不可用：保留采集和分析失败状态，不用规则或示例摘要冒充 AI 结果。
- 前端 API 失败：显示重试和最近成功时间，不展示旧数据为“今日数据”。

