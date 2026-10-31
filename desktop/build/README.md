# Windows installer packaging

Run commands from `desktop/`.

- `npm run dist:win` delegates to `node scripts/package-win.cjs`. That preparation script is maintained separately and must populate staging before invoking electron-builder.
- `npm run pack:win` creates an unpacked Windows app with electron-builder. It consumes the same staged resources; it does not prepare them.
- Output directory: `desktop/dist/`.
- Installer filename: `SignalWeb-Setup-<version>-x64.exe`.

## Identity and content

`appId` is `com.signalweb.desktop`; `productName` and `executableName` are `SignalWeb`. This keeps Electron's default user data directory at `%APPDATA%/SignalWeb`.

App source inclusion is restricted to `main.js` and `preload.js`. Electron-builder also includes the required package metadata automatically.

| Source relative to desktop | Installed destination |
| --- | --- |
| staging/web | resources/web |
| staging/pipeline | resources/pipeline |
| staging/python | resources/python |
| staging/web/node_modules | resources/web/node_modules (explicit mapping required by builder) |

The web staging directory must contain `server.js`, `.next/static`, and `public` at its standalone root. The Python executable is `resources/python/python.exe`. The runtime, maintained separately, initializes writable pipeline files in `%APPDATA%/SignalWeb/pipeline` and preserves existing config/data. The installer only places the staged files under the application installation directory.

## Wizard and shortcut choice

The Unicode assisted NSIS installer uses Simplified Chinese only. Its pages are welcome, installation scope (current user selected by default), installation directory, installation options, progress, and finish. Users can choose another installation directory and can opt into installing for all users through the standard elevation flow. The finish page offers to launch SignalWeb.

`build/installer.nsh` uses electron-builder's `customPageAfterChangeDir` hook to display a real checkbox labeled “创建桌面快捷方式”, checked by default. Its state survives Back/Next navigation. `customInstall` applies the choice after the built-in shortcut macro, so clearing the checkbox also removes the current desktop link on a manual reinstall. Start menu shortcut creation remains enabled. Built-in desktop shortcut support remains enabled for standard uninstall cleanup and shortcut metadata.

Silent installs and `--updated` runs use electron-builder's normal shortcut handling without applying an unseen checkbox choice. The custom page is skipped for `--updated`; `--no-desktop-shortcut` initializes the checkbox to unchecked on interactive runs and is honored by the built-in path on silent runs.

## Validation

The Windows x64 NSIS installer has been built successfully. The Simplified Chinese welcome, scope, custom directory and shortcut options pages were inspected in the native installer. A directory containing Chinese characters and spaces was entered, and the shortcut checkbox was successfully cleared. The preview was cancelled before installing, so creation/removal of installed shortcuts and uninstall behavior have not been exercised on this host.

`npm run test:package` passed against the packaged Electron/Node and embedded Python, with system developer tools removed from the subprocess PATH. It verified the setup page and static assets, setup/status runner, source configuration and crawl events using an isolated Unicode user directory. No API keys or developer news are included. The app's full live AI collection still requires a user's own model credentials.
