# SignalWeb Android 本地版实现约束

## 交付目标

交付可安装的 Android APK。新闻抓取、正文提取、去重、分组、评分请求编排、双语日报、事件详情、网络图、词云、PDF、数据保存、来源配置和定时任务均在手机进程内完成。AI 推理按用户确认继续调用 DeepSeek API；手机不依赖桌面应用或另一个后台服务器。

## 与桌面版保持一致的契约

- 新闻源使用 `pipeline/data/config.desktop.json` 中实际启用的来源；来源失败必须显示来源及错误，不换用其他来源，也不显示样本数据。
- 分析规则和中英文标题、详情要求以 `pipeline/profiles/` 中的现有 Profile 和提示词为准。AI 请求失败时保留明确失败状态，不生成编造的报告。
- 日报数据按 `web/lib/types.ts` 的 `Brief`、`Story`、`GraphEdge`、`SourceHealth` 结构存储，确保评分、原文、引用和来源状态可追溯。
- API Key 由 Android Keystore 保护；安装包、日志、导出文件和页面数据中不得含 Key。
- PDF 使用已生成的真实日报。用户选择保存位置时使用 Android 系统文件选择器；不能写入时报告错误。
- 定时任务由 Android WorkManager 管理。系统可能延迟执行，界面显示实际完成时间和失败原因。

## 实现划分

1. Android 原生壳：设置、简报、事件详情、关系网络、词云、来源状态、运行进度、PDF 导出。
2. 手机本地数据层：配置、来源健康、事件、日报和运行日志；所有写入在应用私有目录，PDF 由用户选择位置导出。
3. 手机本地流水线：按现有来源抓取和提取正文，调用现有 Profile 的评分与双语提示词，通过 DeepSeek 的 `chat/completions` 生成分析，写入真实结果。
4. 系统集成：安全保存 Key、后台任务、通知、文件选择器。
5. 交付检查：断网及无 Key 时明确报错；真实来源和 DeepSeek 连通后生成日报、网络图、词云与 PDF；安装到 Android 设备验证前后台运行。

## 当前实现状态（2026-10-30）

Windows 安装包无法直接转换为 APK，因此 `android/` 是独立的原生应用。Android Studio、SDK、JDK 17 和 Gradle 已安装；`assembleDebug` 已成功生成测试 APK。现有 Python 依赖中的 `pydantic-core`、`reportlab` 和 `primp` 没有对应的 Android 构建包，因此当前实现用 Android 原生代码重新实现核心流程。

已接入手机端真实 RSS/Atom、Google News RSS 和 Hacker News 抓取；按配置的 Profile 提示词请求 DeepSeek 完成双语评分和详情；保存日报、事件、来源状态和 AI 错误；浏览与搜索历史、查看关系和关键词；以网格档案、暗房、手作工坊、孔版印刷四种配色导出 PDF；按 WorkManager 定时运行。禁用来源不会抓取；启用但尚未移植的 GitHub、Reddit、Twitter、OpenBB、OSSInsight、Telegram 和 GDELT 会明确显示错误。

模拟设备已安装并启动 APK，真实来源抓取了 221 条，21 个启用来源的状态均为成功。使用保存在 Windows Credential Manager 的 DeepSeek 凭据在模拟设备上通过连接测试。最终端到端复测选取 5 条真实新闻，经手机本地正文提取、双语分析、阈值过滤和语义去重后生成 3 条事件的日报；来源错误 0 条、AI 错误 0 条、低于阈值 2 条、去重移除 0 条。日报为 `is_sample=false`，所有事件详情字段都有非空的 `zh` 和 `en`，中英日报摘要均存在。Android 系统文件选择器导出的这份手机生成的日报 PDF 为 6 页，可正常读取，包含标签和原文链接；另验证暗房配色的 PDF 页面。关系图节点可以点开事件详情，关键词词云和本地历史搜索在模拟设备上显示正常。WorkManager 定时任务可在模拟设备注册并取消；尚未验证计划时间到达后的实际执行和用户实体手机的网络环境。

对于在桌面配置中要求 `trafilatura` 的来源，安卓版现用手机本地的语义 HTML 区域提取正文；没有可识别结构时明确报错，且不会改用 RSS 摘要。此提取器仍不能等同于桌面版 `trafilatura`。未要求正文提取的来源直接使用 RSS/Atom 内容。Profile 的 `web_search` / `history_search` 丰富化工具和桌面版完整的网络图交互尚未移植；手机上的历史搜索是独立的本地查询功能。已实现可点选的简化关系图。当前 APK 是测试版，不能宣称与桌面版完整等价。

## 2026-10-31 增量

测试 APK 0.2.0 已增加 GitHub 用户事件和仓库 Release、Reddit 用户与板块 JSON、GDELT、OSS Insight、Telegram 公开频道和 X 的 Apify 模式。X 的 Token 由 Android Keystore 加密；未配置时明确报错。来源按桌面配置启用，逐个显示成功数量或失败原因，不切换到其他数据入口。GitHub、GDELT、OSS Insight、Telegram 已在模拟设备发起真实请求；GitHub 测试用的不存在仓库返回 404，GDELT 当前受接口限制未取到文章，后两项在当天筛选下为 0 条。Reddit 和 X 尚未用真实账号或 Token 测通。

Profile 的 `web_search` 与 `history_search` 已接入手机端：先由模型规划区块范围内最多 3 次调用；联网搜索按用户 2026-10-31 同意使用 DeepSeek 官方 Search API，历史搜索以手机本地旧日报做 BM25 查询。结果附带来源链接、区块 ID 和引用编号，生成的双语详情与 PDF 均保存实际引用，不允许跨区块引用。DeepSeek 官方文档说明成功且有结果的 Search 请求从 2026-11-01 00:00（北京时间）开始收费，现行标价为每 1000 次 0.75 美元。参见 https://api-docs.deepseek.com/guides/search/ 。

新 Key 已在模拟设备通过连接测试。用 1 条真实新闻端到端生成双语日报，来源错误 0、AI 错误 0；模型实际取回 6 条联网检索来源并引用其中 4 条。手机系统文件选择器导出的 PDF 共 2 页，已检查到引用编号和来源链接。关系图现有本地力导向布局、拖动和双指缩放，以及双语事件列表。安装包内仍不含 Key。

后续同日增量：用户同意 OpenBB 按所选提供方直连。手机端已实现 `yfinance`（Yahoo Finance）、`nasdaq`、`tmx` 三种观察名单来源；模拟设备连接 3 个观察名单，合计取回 5 条新闻，来源错误 0。其他提供方仍逐项报错。X 的 Apify 模式已增加按配置抓取回复，尚无 Token 做端到端验证。定时日报现可发系统通知；没有通知权限或通知失败时首页显示原因。财经新闻的原文引用现支持将完全相同的原文 URL 规范化为 `source-1`，其他跨区块或虚构引用仍拒绝。一次财经新闻分析中模型返回不完整 JSON，应用明确报分析失败，未生成虚假报告。

**仍未完成完整移植：** OpenBB 除上述 3 家以外的提供方尚未实现。正文提取仍是 Android 上的语义 HTML 方案，不能等同于 Python trafilatura。Reddit、X/Apify、后台定时任务和系统通知尚需真实配置或实体手机验证。0.2.0 仍是 Debug 签名测试包，不能当作正式发布版。

最终打包复核：OpenBB 手机端逐来源状态显示为 Yahoo AAPL 5 条、Nasdaq AAPL 0 条、TMX SHOP 0 条，三项接口状态均为成功；0 条为所选时间窗内无条目。已恢复模拟设备原始来源配置（19 个 RSS 启用），最终 APK 编译并通过 apksigner 校验。APK 为 3,254,590 字节，SHA-256：37CDB8CDBB12AC5FF605B31F882ECE5BE808797C044CDF6711D233442DAE39DD；检查确认未包含测试 DeepSeek Key。财经观察名单可直接在手机来源页添加与删除。来源抓取现按来源原子收录：失败来源的部分条目不会进入日报。

后续构建：用户同意 X 改用官方 API。安卓端已实现官方最近帖子搜索，按配置的账号和关键词抓取过去 24 小时内容，并可按对话 ID 补充热门回复；旧 `playwright` 配置按用户同意转接官方 API，显式 `apify` 配置继续使用 Apify。X Bearer Token 在设置页输入并加密保存，来源页可添加账号和关键词。没有 Token 时会明确报错。尚未收到 X Bearer Token，故无法验证真实帖子抓取。X 官方接口文档： https://docs.x.com/x-api/posts/search/introduction 。
