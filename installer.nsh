!macro preInit
    SetRegView 64
    WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\Printventory"
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\Printventory"
    SetRegView 32
    WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES\Printventory"
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES\Printventory"
!macroend

!macro customInstall
    SetOutPath "$INSTDIR"
    CreateDirectory "$LOCALAPPDATA\Printventory"
    CreateDirectory "$LOCALAPPDATA\Printventory\data"
    
    # Preserve existing database during updates
    ${If} ${FileExists} "$LOCALAPPDATA\Printventory\data\printventory.db"
        CreateDirectory "$LOCALAPPDATA\Printventory\data\backup"
        CopyFiles "$LOCALAPPDATA\Printventory\data\printventory.db" "$LOCALAPPDATA\Printventory\data\backup\printventory.db"
    ${EndIf}
    
    SetShellVarContext current
    # CreateShortCut "$DESKTOP\Printventory.lnk" "$INSTDIR\Printventory.exe"
    CreateDirectory "$SMPROGRAMS\Printventory"
    CreateShortCut "$SMPROGRAMS\Printventory\Printventory.lnk" "$INSTDIR\Printventory.exe"
!macroend

!macro customUnInstall
    SetShellVarContext current
    Delete "$DESKTOP\Printventory.lnk"
    RMDir /r "$SMPROGRAMS\Printventory"
    
    # Don't remove user data on uninstall
    # RMDir /r "$LOCALAPPDATA\Printventory"
    
    # Instead, only remove the application files
    RMDir /r "$INSTDIR"
!macroend 