@echo off
rem Duenne Huelle um session-end-hook.sh, damit globale CLI-Hooks (Claude Code)
rem den Aufruf ohne cmd-Quoting-Hoelle machen koennen. %1 = Instanzname.
rem Blockiert nie: Exit immer 0 (session-end-hook.sh exitet selbst immer 0).
"C:\Program Files\Git\bin\bash.exe" "%USERPROFILE%\Desktop\ProjectA\scripts\session-end-hook.sh" %1
exit /b 0
