!include "update-version.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"
!include "LogicLib.nsh"

!macro customHeader
  Caption "Обновление TAIMIO Beta"
  BrandingText "Обновление TAIMIO Beta"
  ShowInstDetails nevershow
!macroend

!macro customInstallMode
  ${If} $hasPerMachineInstallation == "1"
  ${AndIf} $hasPerUserInstallation != "1"
    StrCpy $isForceMachineInstall "1"
    StrCpy $isForceCurrentInstall "0"
  ${Else}
    StrCpy $isForceCurrentInstall "1"
    StrCpy $isForceMachineInstall "0"
  ${EndIf}
!macroend

!macro customInit
  IfFileExists "$INSTDIR\TAIMIO.exe" taimio_found 0
  IfFileExists "$INSTDIR\${PRODUCT_FILENAME}.exe" taimio_found 0
  IfFileExists "$LOCALAPPDATA\Programs\TAIMIO\TAIMIO.exe" taimio_found 0
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "InstallLocation"
  StrCmp $R0 "" taimio_check_guid 0
  IfFileExists "$R0\TAIMIO.exe" taimio_found 0
  IfFileExists "$R0\${PRODUCT_FILENAME}.exe" taimio_found 0
  taimio_check_guid:
  ReadRegStr $R0 HKCU "Software\${APP_GUID}" "InstallLocation"
  StrCmp $R0 "" taimio_missing 0
  IfFileExists "$R0\TAIMIO.exe" taimio_found 0
  IfFileExists "$R0\${PRODUCT_FILENAME}.exe" taimio_found taimio_missing
  taimio_missing:
    MessageBox MB_OK|MB_ICONEXCLAMATION "TAIMIO не найдена на этом компьютере. Для начала работы установите полную версию TAIMIO."
    Quit
  taimio_found:
!macroend

!macro customWelcomePage
  Var UpdateDialog
  Var UpdateLabel

  Function ReadInstalledBeta
    ReadRegStr $R1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "DisplayVersion"
    ${If} $R1 == ""
      ReadRegStr $R1 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "DisplayVersion"
    ${EndIf}
    ${If} $R1 == ""
      StrCpy $R1 "0.1"
    ${Else}
      StrCpy $R2 $R1 2 -2
      ${If} $R2 == ".0"
        StrLen $R3 $R1
        IntOp $R3 $R3 - 2
        StrCpy $R1 $R1 $R3
      ${EndIf}
    ${EndIf}
  FunctionEnd

  Function UpdateWelcomeShow
    GetDlgItem $0 $HWNDPARENT 3
    ShowWindow $0 ${SW_HIDE}
    GetDlgItem $0 $HWNDPARENT 1
    SendMessage $0 ${WM_SETTEXT} 0 "STR:Обновить"
    GetDlgItem $0 $HWNDPARENT 2
    SendMessage $0 ${WM_SETTEXT} 0 "STR:Отмена"

    nsDialogs::Create 1018
    Pop $UpdateDialog

    Call ReadInstalledBeta
    ${NSD_CreateLabel} 0u 0u 300u 90u "Обнаружена установленная версия TAIMIO Beta $R1.$\r$\n$\r$\nБудет установлено обновление до Beta ${TAIMIO_BETA_NEW}.$\r$\n$\r$\nВаши проекты, настройки и ключ доступа будут сохранены."
    Pop $UpdateLabel

    nsDialogs::Show
  FunctionEnd

  Function UpdateWelcomeLeave
  FunctionEnd

  Page custom UpdateWelcomeShow UpdateWelcomeLeave
!macroend

!macro customFinishPage
  Function UpdateFinishShow
    GetDlgItem $0 $HWNDPARENT 3
    ShowWindow $0 ${SW_HIDE}
  FunctionEnd
  !define MUI_FINISHPAGE_TITLE "TAIMIO успешно обновлена до Beta ${TAIMIO_BETA_NEW}"
  !define MUI_FINISHPAGE_TEXT "Ваши проекты и настройки сохранены."
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW UpdateFinishShow
  !insertmacro MUI_PAGE_FINISH
!macroend
