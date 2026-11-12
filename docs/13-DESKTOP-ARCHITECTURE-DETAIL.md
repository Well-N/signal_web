# 桌面 APP 详细架构

## 1. 设计目标

最终产品是 Windows 和 macOS 可安装应用。用户只需要完成一次配置：

1. 打开 APP。
2. 输入 API Base URL、模型名和 API Key。
3. 选择每天运行时间。
4. 点击保存。

应用随后负责：

- 把 API Key 存入系统凭据库。
- 注册操作系统每日任务。
- 立即运行第一次抓取和分析。
- 每天自动更新本地数据和看板。
- APP 未打开时，每日任务仍然可以运行。

首版是单用户、单机应用，不做账号系统、云端同步和公网服务。

## 2. 运行时拓扑

    Electron 主进程
      ├─ 启动本地 Next.js standalone server
      ├─ 创建 BrowserWindow
      ├─ 管理系统托盘和单实例
      └─ 退出时清理本地 Next 进程

    Next.js UI + Route Handlers
      ├─ /setup 首次配置
      ├─ /api/setup 调用 Runner
      ├─ /api/brief 读取导出 JSON
      └─ /api/health 检查服务状态

    SignalWeb Runner sidecar
      ├─ configure：保存 Key、写配置、注册任务
      ├─ run：执行 Horizon、写 latest.json
      ├─ schedule / unschedule
      ├─ test：测试 OpenAI 兼容接口
      └─ status：返回非敏感状态

    操作系统
      ├─ Windows Credential Manager 或 macOS Keychain
      ├─ Windows Task Scheduler 或 macOS LaunchAgent
      └─ 用户数据目录

## 3. 进程职责

### Electron 主进程

- 只负责窗口、单个实例、托盘、进程生命周期和本地服务启动。
- 不直接保存 API Key。
- 不直接运行 Horizon。
- 生成并管理本地服务端口。
- 记录启动失败原因，弹窗或进入错误页。

### Next.js 服务

- 负责页面和本地 HTTP API。
- 读取 Runner 返回的状态和导出的 JSON。
- 配置接口只向本机回环地址开放。
- 不返回 API Key，不把 Key 放进 HTML、localStorage 或查询参数。

### SignalWeb Runner

- 是唯一接触 Keyring 和系统计划任务的进程。
- 通过 stdin 接收配置，避免 Key 出现在命令行参数和进程列表里。
- 执行 Horizon 前设置 LLM_BASE_URL、LLM_API_KEY、LLM_MODEL 环境变量，只在子进程内存在。
- 每次运行写 last_run.json，记录成功、失败和阶段。
- 使用运行锁，防止每日任务和手动运行同时写同一份数据。

### Horizon

- 保留现有抓取器、去重、Profile、评分和摘要。
- ai-news Profile 从只读资源目录加载。
- 所有运行结果写入用户数据目录。

## 4. 首次配置时序

    Electron 启动
      → 本地 Next 服务健康检查
      → 读取 /api/setup
      → 无 settings 时打开 /setup
      → 用户填写表单
      → POST /api/setup
      → Runner configure
      → keyring 写入 API Key
      → 写 settings.json
      → 注册系统每日任务
      → 返回成功
      → 后台启动 Runner run
      → UI 轮询 /api/setup
      → latest.json 出现后打开看板

每个阶段都必须有明确错误：

- Keyring 不可用：不继续注册任务。
- 计划任务注册失败：保留已保存配置，提示可重试。
- 首次运行失败：显示 last_run.json 里的错误，不生成假日报。

## 5. 每日运行时序

    系统计划任务
      → SignalWeb Runner run
      → 获取运行锁
      → 读取 settings.json
      → 从系统凭据库读取 Key
      → 设置临时环境变量
      → 调用 Horizon
      → 生成 latest.json 和 Markdown
      → 写 last_run.json
      → 释放运行锁

APP 打开时：

    Next 服务读取 latest.json
      → 看板展示数据
      → 可轮询 last_run.json 显示最近运行状态

APP 未打开时：

- 每日任务仍运行。
- 重新打开 APP 后读取最新文件。
- 不需要常驻托盘进程。

## 6. 资源目录与用户数据目录

安装包资源目录只读：

    resources/
      runner/
        signalweb-runner.exe
      web/
        .next/standalone/server.js
        .next/static/
        public/
      pipeline/
        profiles/ai-news/
        data/config.json
        README/LICENSE

用户数据目录可写：

    Windows:
      %APPDATA%\SignalWeb\
        settings.json
        last_run.json
        run.lock
        logs/
        pipeline/
          summaries/
          export/
          history/

    macOS:
      ~/Library/Application Support/SignalWeb/
        settings.json
        last_run.json
        run.lock
        logs/
        pipeline/
          summaries/
          export/
          history/

原则：

- 升级应用时替换 resources，不覆盖用户设置和历史。
- 用户数据不写入安装目录，避免权限和更新问题。
- 配置只在 settings.json 保存 Base URL、模型、时间、语言和开关；Key、Webhook 和额外请求头在 Keyring。

## 7. Runner 的目录改造

当前开发版 Runner 仍把代码根目录和运行数据放在一起。正式版需要拆成：

    RESOURCE_ROOT
      只读代码、Profile、默认 config

    STATE_ROOT
      用户配置、运行锁、日志、summary、export

Horizon 初始化方式：

    StorageManager(
      data_dir=STATE_ROOT / "pipeline",
      config_path=RESOURCE_ROOT / "pipeline/data/config.json"
    )

config.json 中的 profiles_dir 通过环境变量或绝对路径指向 RESOURCE_ROOT/profiles。

Runner 不能把 settings、Key 或 export 写到 resources 目录。

## 8. 本地服务安全

本地 Next 服务只监听：

    127.0.0.1

不监听 0.0.0.0，不开放局域网访问。

建议增加本地请求令牌：

1. Electron 主进程生成随机 token。
2. Next 服务通过环境变量读取 token。
3. 所有写接口要求 X-SignalWeb-Token。
4. 渲染页面通过 preload 暴露 token 给受控 fetch 包装器。

首版至少保证：

- API Key 不出现在浏览器响应和日志。
- 配置接口不记录请求体。
- 启动失败错误不包含凭据。
- 运行日志脱敏。

## 9. 系统任务设计

### Windows

- 任务名：SignalWebDaily。
- 作用域：当前用户。
- 不需要管理员权限。
- 每日时间由 settings.json 决定。
- 任务命令指向 signalweb-runner.exe run。
- 注册后立即 Query 验证。

### macOS

- 文件：~/Library/LaunchAgents/com.signalweb.daily.plist。
- StartCalendarInterval 指定小时和分钟。
- 通过 launchctl bootstrap gui/UID 注册。
- 失败时尝试 launchctl load -w，并把错误返回 UI。

### 运行锁

Runner 使用 STATE_ROOT/run.lock：

- 已经有运行：返回 already_running，不重复抓取。
- 上次异常退出：锁文件包含 PID 和开始时间，超时后才允许回收。
- 写入 latest.json 使用临时文件后原子替换。

## 10. 错误与恢复

    settings 不存在 → 打开 /setup
    Keyring 读取失败 → 标记配置错误，不运行
    计划任务注册失败 → 保存配置但显示错误，允许重试
    单源抓取失败 → partial_failure，其他源继续
    LLM 失败 → analysis_failed，保留原文，不生成假摘要
    导出失败 → last_run 失败，Next 读取旧数据但显示最后成功时间
    Next 服务启动失败 → Electron 弹窗，提示日志路径

应用不静默覆盖旧数据。写文件使用临时文件加替换。

## 11. 打包设计

### Python sidecar

使用 PyInstaller 打包：

    signalweb-runner.exe

需要包含：

- Horizon src
- ai-news Profile
- keyring 依赖
- httpx、trafilatura、feedparser 等运行依赖
- Python 运行时

建议使用 one-dir 模式，启动比 one-file 快，也方便定位依赖。

### Web

Next.js 使用 standalone 输出：

    web/.next/standalone/server.js

打包时把 .next/static 和 public 复制到 standalone 目录。

### Electron

使用 electron-builder：

    Windows: NSIS 安装包
    macOS: DMG

extraResources 包含：

    resources/web
    resources/pipeline
    resources/runner

安装后写入开始菜单和卸载入口；不默认开机启动。

## 12. 更新与迁移

- settings.json 带 schema_version。
- latest.json 带 version。
- 旧版本数据不能读时显示迁移错误，不覆盖原文件。
- 应用升级保留用户目录。
- 暂不做自动更新；后续接 electron-updater。
- macOS 正式分发需要 Apple Developer 签名和公证。

## 13. 托盘与窗口行为

- 单实例锁，重复启动时聚焦已有窗口。
- 关闭窗口默认隐藏到托盘，托盘菜单提供打开、立即运行、暂停任务、退出。
- 退出窗口不删除每日任务；设置页提供取消每日任务。
- 首次配置未完成时，关闭窗口直接退出或提示尚未配置。
- 每日任务独立于 APP，不要求托盘常驻。

## 14. 可观测性

不接第三方遥测。本地记录：

- 启动日志
- Runner 标准输出和错误
- 每个来源的抓取结果
- 每次运行耗时、故事数、失败阶段
- 最近一次成功导出时间

设置页显示：

- 是否已保存 Key
- 是否已注册每日任务
- 下一次运行时间
- 最近一次运行状态
- 导出文件位置

## 15. 测试与发布

### 自动测试

- Runner configure 参数校验。
- keyring mock 写入/读取。
- Windows 计划任务 dry-run 和临时任务创建删除。
- 运行锁并发。
- latest.json 契约。
- Electron 启动和设置页路由。
- Next build 和 lint。

### 手工验收

- 全新 Windows 用户安装并完成首次配置。
- 关闭 APP 后等待每日任务运行。
- 重新打开 APP 读取新数据。
- 修改每天时间并刷新任务。
- 取消每日任务。
- 删除 Key 后运行显示明确错误。
- macOS 签名包 Gatekeeper 启动、Keychain 和 LaunchAgent 验证。

### CI

    web lint + build
    runner pytest
    PyInstaller build
    electron-builder Windows
    electron-builder macOS

发布产物附带 SHA256 校验值。

## 16. 当前实现的架构缺口

已实现：

- Electron 开发壳。
- 首次配置页。
- Runner configure/run/schedule/status。
- Keyring Windows 实测。
- Windows 计划任务创建和删除实测。

还需完成：

1. Runner 的 RESOURCE_ROOT/STATE_ROOT 拆分。
2. Next 本地写接口 token 保护。
3. 运行锁和原子写 latest.json。
4. Electron 生产模式 standalone server 打包。
5. PyInstaller sidecar。
6. electron-builder 安装包。
7. macOS 实机 LaunchAgent、Keychain 和 Gatekeeper 验证。
