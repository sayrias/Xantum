@echo off
chcp 65001 >nul
:: NexusVPN Uzaktan Kurulum (Deploy) Scripti (Windows için)
:: Bu script kendi bilgisayarınızda çalıştırılır ve kurulum dosyalarını VDS'e atıp orada çalıştırır.

echo [NexusVPN] Uzaktan VDS Kurulum Aracina Hos Geldiniz!
echo Bu arac kendi bilgisayarinizdaki kurulum dosyalarini VDS'inize kopyalayacak ve VDS icinde otomatik kuracaktir.
echo.

set /p VPS_IP="VDS IP Adresi: "
set /p VPS_USER="SSH Kullanici Adi (Genelde root): "
set /p VPS_PORT="SSH Portu (Bos birakirsaniz 22): "

if "%VPS_PORT%"=="" set VPS_PORT=22
if "%VPS_USER%"=="" set VPS_USER=root

echo.
echo [1/4] Dosyalar paketleniyor...
tar --exclude="backend/node_modules" --exclude=".git" -czf vpn-deploy.tar.gz ./*

echo.
echo [2/4] Dosyalar yukleniyor (Baglanti sifresi sorulabilir)...
scp -P %VPS_PORT% vpn-deploy.tar.gz %VPS_USER%@%VPS_IP%:~/

if %errorlevel% neq 0 (
    echo [HATA] Dosya kopyalama basarisiz oldu. Sifrenizi veya IP adresinizi kontrol edin.
    del vpn-deploy.tar.gz
    pause
    exit /b 1
)
del vpn-deploy.tar.gz

echo.
echo [3/4] Dosyalar yuklendi. Simdi VDS uzerinde kurulum baslatiliyor...
ssh -p %VPS_PORT% -t %VPS_USER%@%VPS_IP% "mkdir -p ~/nexusvpn-server && tar -xzf ~/vpn-deploy.tar.gz -C ~/nexusvpn-server && rm ~/vpn-deploy.tar.gz && cd ~/nexusvpn-server && chmod +x setup.sh && sudo ./setup.sh --auto"

echo.
echo [4/4] Uzaktan kurulum tamamlandi veya sonlandirildi.
echo Lutfen VDS ekranindaki Token ve IP bilgilerini not almayi unutmayin!
pause
