!include "update-version.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"
!include "LogicLib.nsh"

!macro customHeader
  Caption "Установка TAIMIO"
  BrandingText "Установка TAIMIO"
  ShowInstDetails nevershow
!macroend

!macro customInstallMode
  ; Всегда только для текущего пользователя — без экрана «для всех / только для меня».
  StrCpy $isForceCurrentInstall "1"
  StrCpy $isForceMachineInstall "0"
!macroend

!macro customWelcomePage
  Var SetupDialog
  Var SetupLabel
  Var TaimioAlreadyInstalled

  Function DetectExistingTaimio
    StrCpy $TaimioAlreadyInstalled "0"
    IfFileExists "$INSTDIR\TAIMIO.exe" setup_found 0
    IfFileExists "$INSTDIR\${PRODUCT_FILENAME}.exe" setup_found 0
    IfFileExists "$LOCALAPPDATA\Programs\TAIMIO\TAIMIO.exe" setup_found 0
    ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "InstallLocation"
    StrCmp $R0 "" setup_check_guid 0
    IfFileExists "$R0\TAIMIO.exe" setup_found 0
    IfFileExists "$R0\${PRODUCT_FILENAME}.exe" setup_found 0
    setup_check_guid:
    ReadRegStr $R0 HKCU "Software\${APP_GUID}" "InstallLocation"
    StrCmp $R0 "" setup_done 0
    IfFileExists "$R0\TAIMIO.exe" setup_found 0
    IfFileExists "$R0\${PRODUCT_FILENAME}.exe" setup_found setup_done
    setup_found:
      StrCpy $TaimioAlreadyInstalled "1"
    setup_done:
  FunctionEnd

  Function SetupWelcomeShow
    GetDlgItem $0 $HWNDPARENT 3
    ShowWindow $0 ${SW_HIDE}
    GetDlgItem $0 $HWNDPARENT 1
    SendMessage $0 ${WM_SETTEXT} 0 "STR:Установить"
    GetDlgItem $0 $HWNDPARENT 2
    SendMessage $0 ${WM_SETTEXT} 0 "STR:Отмена"

    nsDialogs::Create 1018
    Pop $SetupDialog

    Call DetectExistingTaimio
    ${If} $TaimioAlreadyInstalled == "1"
      ${NSD_CreateLabel} 0u 0u 300u 110u "На этом компьютере уже установлена TAIMIO.$\r$\n$\r$\nЕсли нажмёте «Установить», программа будет переустановлена поверх текущей.$\r$\n$\r$\nПроекты, настройки и ключ доступа сохранятся.$\r$\n$\r$\nДля обычного обновления до новой версии лучше использовать файл TAIMIO_Beta_Update."
      Pop $SetupLabel
    ${Else}
      ${NSD_CreateLabel} 0u 0u 300u 90u "Будет установлена TAIMIO Beta ${TAIMIO_BETA_NEW}.$\r$\n$\r$\nПрограмма ставится только для вашего пользователя Windows.$\r$\n$\r$\nПосле установки можно активировать ключ доступа."
      Pop $SetupLabel
    ${EndIf}

    nsDialogs::Show
  FunctionEnd

  Function SetupWelcomeLeave
  FunctionEnd

  Page custom SetupWelcomeShow SetupWelcomeLeave
!macroend

!macro customFinishPage
  Function SetupFinishShow
    GetDlgItem $0 $HWNDPARENT 3
    ShowWindow $0 ${SW_HIDE}
  FunctionEnd
  !define MUI_FINISHPAGE_TITLE "TAIMIO Beta ${TAIMIO_BETA_NEW} установлена"
  !define MUI_FINISHPAGE_TEXT "Можно запускать программу и вводить ключ доступа."
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW SetupFinishShow
  !insertmacro MUI_PAGE_FINISH
!macroend
