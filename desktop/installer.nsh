; CALYX NSIS customisation.
;
; The app itself only needs to know where the project folder lives, which is
; recorded in resources/calyx-root.txt at build time. This file exists so the
; installer can show a short, honest note about that requirement.

!macro customInstall
  DetailPrint "CALYX installed. The app runs from its project folder."
!macroend
