# 桌面 APP 架构

## 目标

最终交付是一个 Windows/macOS 可安装应用：

1. 打开应用。
2. 输入 API Base URL、模型名和 API Key。
3. 应用保存密钥、注册每日任务，并立即运行一次。
4. 之后每天在指定时间自动抓取、分析和更新看板。

## 分层

    Electron Shell
      ├─ 启动本地 Next.js 服务
      ├─ 打开桌面窗口或首次配置窗口
      └─ 关闭时结束后台服务

    Next.js UI
      ├─ /setup 首次配置
      ├─ / 今日简报
      ├─ /network 信息网络
      └─ /stories/[id] 故事详情

    Python Runner
      ├─ 保存/读取系统凭据库
      ├─ 注册 Windows 计划任务或 macOS LaunchAgent
      ├─ 调用 Horizon 流水线
      └─ 写 latest.json、last_run.json

    Horizon
      ├─ 多源抓取
      ├─ 去重、评分、摘要
      └─ ai-news Profile

## 首次配置流程

    Electron
      → 打开 localhost/setup
      → 用户填写 API 信息
      → POST /api/setup
      → Python Runner configure
      → keyring.set_password
      → 写 settings.json（不含 Key）
      → 注册每日任务
      → 后台启动 run
      → UI 轮询 /api/setup 状态

API Key 不会写入 settings.json、浏览器 localStorage、URL 参数或命令行参数。

## 每日任务

### Windows

Runner 使用 schtasks 创建当前用户任务：

    Task name: SignalWebDaily
    Schedule: daily at configured HH:MM
    Command: signalweb_runner.run

创建后会立即 Query 验证；如果创建失败，配置接口返回错误，不假装成功。

### macOS

Runner 写入：

    ~/Library/LaunchAgents/com.signalweb.daily.plist

使用 launchctl bootstrap，失败时尝试 load -w；日历时间由 StartCalendarInterval 控制。

## 运行目录

Windows 配置目录：

    %APPDATA%\SignalWeb

macOS 配置目录：

    ~/Library/Application Support/SignalWeb

包含：

    settings.json    非敏感配置
    last_run.json    最近一次运行状态
    daily.out.log    定时任务输出
    daily.err.log    定时任务错误

## 凭据存储

使用 Python keyring：

    service = SignalWeb
    username = llm-api-key

Windows 使用 Credential Manager，macOS 使用 Keychain。读取失败时明确报错，不退回明文文件。

## 打包路线

### Python

使用 PyInstaller 把 signalweb_runner.py、Horizon 依赖、ai-news Profile 和数据目录打成 sidecar 可执行文件。

### Web

Next.js 使用 standalone 输出。Electron 生产模式启动：

    web/.next/standalone/server.js

并把 .next/static 和 public 复制到 standalone 目录。

### Electron

使用 electron-builder：

    desktop/main.js
    resources/web
    resources/pipeline
    resources/runner

Windows 生成 NSIS 安装包，macOS 生成 .dmg；macOS 需要 Apple 签名和公证，否则 Gatekeeper 会拦截。

## 当前实现状态

- Electron 开发壳已可用，能启动本地 Next 服务并打开窗口。
- 首次配置页已可用。
- keyring 已实测可写入和读取 Windows Credential Manager。
- Windows 计划任务已实测创建和删除。
- macOS LaunchAgent 代码已写，但当前机器无法实机验证。
- 后台首次运行已由 API 启动；真实 AI 输出需要用户填写有效 API Key。
- 安装包、PyInstaller sidecar 和 electron-builder 尚未完成。
