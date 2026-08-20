@echo off
chcp 65001 >nul
title Xantum Kontrol Paneli

:MENU
cls
echo.
echo  ========================================================
echo           Xantum Merkezi Kontrol Paneli (Windows)
echo  ========================================================
echo.
echo    [1] Sunucu Kurulumu veya Guncellemesi (VDS Deploy)
echo    [2] Istemci Test ve Derleme (Client Build)
echo    [3] Cikis
echo.
set /p CHOICE="  Islem numarasini secin (1-3): "

if "%CHOICE%"=="1" goto DEPLOY
if "%CHOICE%"=="2" goto BUILD
if "%CHOICE%"=="3" exit /b 0
goto MENU

:DEPLOY
echo.
echo  [Xantum] Sunucu Kurulum Aracina Hos Geldiniz!
echo.
set /p VPS_IP="VDS IP Adresi: "
set /p VPS_USER="SSH Kullanici Adi (ubuntu): "
if "%VPS_USER%"=="" set VPS_USER=ubuntu

echo.
echo  [1/3] Kurulum dosyalari paketleniyor...
cd /d "%~dp0server\xantum-server"
tar --exclude="backend\node_modules" -czf "%TEMP%\vpn-deploy.tar.gz" .

echo  [2/3] Dosyalar VDS'e yukleniyor...
scp "%TEMP%\vpn-deploy.tar.gz" "%VPS_USER%@%VPS_IP%:~/"
del "%TEMP%\vpn-deploy.tar.gz"

echo  [3/3] VDS'de kurulum baslatiliyor...
ssh -t "%VPS_USER%@%VPS_IP%" "mkdir -p ~/xantum-server && tar -xzf ~/vpn-deploy.tar.gz -C ~/xantum-server && rm ~/vpn-deploy.tar.gz && cd ~/xantum-server && chmod +x setup.sh && sudo ./setup.sh --auto"

echo.
echo  Kurulum tamamlandi! Token ve IP bilgilerini not almayi unutmayin.
pause
goto MENU

:BUILD
echo.
echo  [Xantum] Istemci Derleme Araci
echo  NOT: Derleme islemi Linux'ta build-client.sh ile yapilmalidir.
echo  Windows'ta WSL (Windows Subsystem for Linux) kurulu ise:
echo.
echo    wsl bash scripts/build-client.sh
echo.
pause
goto MENU
