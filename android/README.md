# 织讯 Android 本地测试版

此工程生成可安装的 Android APK。手机本地执行抓取、分析编排、日报保存、PDF 导出和定时任务；AI 推理访问用户配置的 DeepSeek 官方 API。

## 构建

需要 JDK 17、Android SDK Platform 35、Build Tools 35 和联网的 Gradle。PowerShell 中设置 `JAVA_HOME` 和 `ANDROID_HOME` 后运行：

```powershell
.\gradlew.bat assembleDebug
```

可直接传到 Android 8.0 或更高版本手机的测试 APK 位于 `dist/SignalWeb-Android-0.2.1-test.apk`。在手机上打开该文件并按系统提示允许安装。首次打开时在“设置”中填写 DeepSeek API Key，测试连接并保存，然后在“日报”运行一次。来源配置从 `pipeline/data/config.desktop.json` 复制到 APK，安装后保存在手机本地并可在“来源”编辑。Key 不打包在 APK 中；手机上的 Key 由 Android Keystore 加密保存。

当前功能和限制见 `../docs/16-ANDROID-LOCAL-APP.md`。此 APK 是 Debug 签名测试版；正式分发前需建立独立发布密钥、完成真机验证及 Release 构建。
