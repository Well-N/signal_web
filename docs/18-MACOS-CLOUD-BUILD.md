# macOS 云端构建

Windows 上编辑代码并推送到 GitHub。仓库根目录的 `.github/workflows/build-macos.yml` 在 GitHub 的 macOS 构建机上分别生成 Apple Silicon（arm64）和 Intel（x64）版本。所有构建依赖仅安装在临时云端机器上。

## 下载

1. 打开仓库的 **Actions → Build macOS app**。
2. 选择最新一次成功的运行，在 **Artifacts** 下载与 Mac 芯片对应的 `SignalWeb-mac-arm64` 或 `SignalWeb-mac-x64`。
3. 解压 Actions 产物后，选用 DMG 安装；ZIP 含相同架构的应用。

此构建使用临时签名，供本人试用。正式对外分发需 Apple Developer ID 签名和公证。首次打开如遇 macOS 安全提示，需在系统设置中明确允许。没有在 GitHub 配置、上传或嵌入新闻 API Key；用户首次打开应用后在设置页填写，密钥保存在 Mac 系统钥匙串。

## 验证范围

工作流检查 Python 运行器、安装文件存在、应用能够启动并使本地设置接口响应。它不会调用需要用户凭据的 AI 或付费新闻 API。最终仍需在目标 Mac 上检查新闻抓取、AI 双语日报、PDF 导出与每日定时任务。任何来源失败应显示错误，不应切换数据源。
