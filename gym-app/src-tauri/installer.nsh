; NSIS installer hooks — run during install/uninstall to wire the parts the
; built-in Tauri bundle config doesn't (yet) expose. Currently just adds a
; desktop shortcut on install and removes it on uninstall.

!macro NSIS_HOOK_POSTINSTALL
  ; CreateShortcut needs the target's directory active so NSIS can resolve
  ; the working directory for the shortcut (otherwise the app launches with
  ; an arbitrary working dir and relative paths to bundled resources break).
  SetOutPath "$INSTDIR"
  CreateShortcut "$DESKTOP\TuGymPR.lnk" "$INSTDIR\TuGymPR.exe" "" "$INSTDIR\TuGymPR.exe" 0
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$DESKTOP\TuGymPR.lnk"
!macroend
