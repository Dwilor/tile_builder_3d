' Lance le .bat sans fenetre noire visible
' Le processus sera automatiquement ferme quand on ferme le navigateur.
Set oShell = CreateObject("WScript.Shell")
oShell.CurrentDirectory = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)
' True = attendre la fin du batch (le processus Python se termine quand on ferme le bat)
oShell.Run """" & oShell.CurrentDirectory & "\Lancer Tile Builder 3D.bat""", 0, True
