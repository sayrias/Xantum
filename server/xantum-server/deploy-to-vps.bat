@echo off
chcp 65001 >nul
powershell.exe -NoProfile -File "%~dp0deploy-to-vps.ps1"
if errorlevel 1 (
  echo Kurulum tamamlanmadi. Yukaridaki aciklamayi denetleyin.
  pause
  exit /b 1
)
pause
