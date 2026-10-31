!include nsDialogs.nsh
!define NM_SETUP_SCRIPT "${__FILEDIR__}\install-chocolatey.ps1"
!ifndef BUILD_UNINSTALLER
Var ChocoCheckbox
Var ChocoSelected
Var MapCheckbox
Var MapSelected
!macro customPageAfterChangeDir
Function ChocoPageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "Optional integrations" "Choose package-manager and Explorer integrations."
  ${NSD_CreateLabel} 0 0 100% 24u "System69 Manager can use Chocolatey to install and uninstall Node.js packages. Independent side-by-side versions work without Chocolatey."
  Pop $0
  ${NSD_CreateCheckbox} 0 28u 100% 20u "Install Chocolatey if it is not already installed"
  Pop $ChocoCheckbox
  ${NSD_Check} $ChocoCheckbox
  ${NSD_CreateLabel} 0 53u 100% 48u "This option downloads and runs the official setup script from https://community.chocolatey.org/install.ps1 with administrator access. An internet connection is required. Chocolatey is maintained separately and will remain installed if you remove System69 Manager."
  Pop $0
  ${NSD_CreateCheckbox} 0 112u 100% 20u "Add Map with System69 to the directory context menu"
  Pop $MapCheckbox
  ${NSD_Uncheck} $MapCheckbox
  ${NSD_CreateLabel} 0 137u 100% 26u "Optional, off by default. Open a folder directly in Disk map. You can also enable or remove this shortcut inside the app."
  Pop $0
  nsDialogs::Show
FunctionEnd

Function ChocoPageLeave
  ${NSD_GetState} $ChocoCheckbox $ChocoSelected
  ${NSD_GetState} $MapCheckbox $MapSelected
FunctionEnd
  Page custom ChocoPageCreate ChocoPageLeave
!macroend

!macro customInstall
  ${If} $MapSelected == ${BST_CHECKED}
    WriteRegStr HKCU "Software\Classes\Directory\shell\System69.Map" "" "Map with System69"
    WriteRegStr HKCU "Software\Classes\Directory\shell\System69.Map" "Icon" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\",0'
    WriteRegStr HKCU "Software\Classes\Directory\shell\System69.Map\command" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" --map $\"%1$\"'
  ${EndIf}
  ${If} $ChocoSelected == ${BST_CHECKED}
    DetailPrint "Checking Chocolatey setup..."
    File /oname=$PLUGINSDIR\install-chocolatey.ps1 "${NM_SETUP_SCRIPT}"
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\install-chocolatey.ps1"'
    Pop $0
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "System69 Manager was installed, but Chocolatey setup failed. You can retry from the Chocolatey page in System69 Manager as administrator."
    ${EndIf}
  ${EndIf}
!macroend
!endif

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\Directory\shell\System69.Map"
!macroend
