; Included before electron-builder's installer.nsi; page macros expand after MUI2.
!include nsDialogs.nsh

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎安装 SignalWeb"
  !define MUI_WELCOMEPAGE_TEXT "此向导将引导您安装织讯 SignalWeb。$\r$\n$\r$\n您可以选择安装位置，以及是否创建桌面快捷方式。$\r$\n$\r$\n单击“下一步”继续。"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInit
  StrCpy $signalWebDesktopShortcut ${BST_CHECKED}
  ${If} ${isNoDesktopShortcut}
    StrCpy $signalWebDesktopShortcut ${BST_UNCHECKED}
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  Var signalWebOptionsDialog
  Var signalWebDesktopCheckbox
  Var signalWebDesktopShortcut

  Page custom SignalWebOptionsCreate SignalWebOptionsLeave

  Function SignalWebOptionsCreate
    ; Automatic updates retain electron-builder's existing shortcut behavior.
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "安装选项" "选择是否在桌面创建 SignalWeb 快捷方式。"
    nsDialogs::Create 1018
    Pop $signalWebOptionsDialog
    ${If} $signalWebOptionsDialog == error
      MessageBox MB_OK|MB_ICONSTOP "无法创建安装选项页面，安装已终止。"
      Quit
    ${EndIf}
    ${NSD_CreateCheckbox} 0 16u 100% 14u "创建桌面快捷方式"
    Pop $signalWebDesktopCheckbox
    ${NSD_SetState} $signalWebDesktopCheckbox $signalWebDesktopShortcut
    nsDialogs::Show
  FunctionEnd

  Function SignalWebOptionsLeave
    ${NSD_GetState} $signalWebDesktopCheckbox $signalWebDesktopShortcut
  FunctionEnd
!macroend

!macro customInstall
  ; Built-in shortcut support stays enabled so the uninstaller removes the link.
  ; Apply the visible choice after addDesktopLink, including on manual reinstall.
  ${IfNot} ${Silent}
  ${AndIfNot} ${isUpdated}
    ${If} $signalWebDesktopShortcut == ${BST_CHECKED}
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${Else}
      WinShell::UninstShortcut "$newDesktopLink"
      Delete "$newDesktopLink"
    ${EndIf}
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${EndIf}
!macroend
