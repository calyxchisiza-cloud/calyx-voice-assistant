' CALYX launcher.
'
' Started by the Desktop / Start Menu shortcut. Chooses the best available
' window shell, starts the local server, and exits immediately so this script
' leaves no process behind.
'
' This file is intentionally a .vbs: wscript.exe can start a program with its
' window hidden, which a .bat or .cmd file cannot do.
'
' The window shell is Edge when it is installed, because the free voice engine
' needs Microsoft's speech service. Electron is the fallback.

Option Explicit

Dim shell, fso, projectRoot, nodeExe, entry, command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' CALYX.vbs lives in the project root.
projectRoot = fso.GetParentFolderName(WScript.ScriptFullName)
entry = fso.BuildPath(projectRoot, "desktop\launch.js")

If Not fso.FileExists(entry) Then
    MsgBox "CALYX cannot start because desktop\launch.js is missing." & vbCrLf & vbCrLf & _
           "Project folder:" & vbCrLf & projectRoot, 16, "CALYX"
    WScript.Quit 1
End If

If Not fso.FolderExists(fso.BuildPath(projectRoot, ".next")) Then
    MsgBox "CALYX has no production build yet." & vbCrLf & vbCrLf & _
           "Open a terminal in:" & vbCrLf & projectRoot & vbCrLf & vbCrLf & _
           "and run:  pnpm build", 16, "CALYX"
    WScript.Quit 1
End If

' Prefer a bundled Node runtime, then Electron's (which is Node-compatible),
' then a system Node. Electron's binary is always present after install.
nodeExe = fso.BuildPath(projectRoot, "node_modules\electron\dist\electron.exe")
If Not fso.FileExists(nodeExe) Then
    MsgBox "CALYX cannot find its runtime." & vbCrLf & vbCrLf & _
           "Open a terminal in:" & vbCrLf & projectRoot & vbCrLf & vbCrLf & _
           "and run:  pnpm install", 16, "CALYX"
    WScript.Quit 1
End If

shell.CurrentDirectory = projectRoot
shell.Environment("Process")("ELECTRON_RUN_AS_NODE") = "1"

' 0 = hidden window, False = do not wait for it to finish.
command = """" & nodeExe & """ """ & entry & """"
shell.Run command, 0, False

WScript.Quit 0
