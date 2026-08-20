#!/bin/bash
# Xantum Uzaktan Kurulum (Deploy) Scripti (Linux / macOS için)
# Bu script kendi bilgisayarınızda çalıştırılır ve kurulum dosyalarını VDS'e atıp orada çalıştırır.

echo -e "\033[0;36m[Xantum]\033[0m Uzaktan VDS Kurulum Aracına Hoş Geldiniz!"
echo "Bu araç kendi bilgisayarınızdaki kurulum dosyalarını VDS'inize kopyalayacak ve VDS içinde otomatik kuracaktır."
echo "Lütfen VDS bilgilerinizi girin:"

read -p "VDS IP Adresi: " VPS_IP
read -p "SSH Kullanıcı Adı (Genelde root): " VPS_USER
read -p "SSH Portu (Boş bırakırsanız 22): " VPS_PORT

if [ -z "$VPS_PORT" ]; then
    VPS_PORT="22"
fi

if [ -z "$VPS_USER" ]; then
    VPS_USER="root"
fi

echo -e "\033[1;33m[1/4]\033[0m Dosyalar paketleniyor..."
tar --exclude='backend/node_modules' --exclude='.git' -czf vpn-deploy.tar.gz ./*

echo -e "\033[1;33m[2/4]\033[0m Dosyalar yükleniyor (Bağlantı şifresi sorulabilir)..."
scp -P $VPS_PORT vpn-deploy.tar.gz ${VPS_USER}@${VPS_IP}:~/

if [ $? -ne 0 ]; then
    echo -e "\033[0;31mHATA:\033[0m Dosya kopyalama başarısız oldu. Şifrenizi veya IP adresinizi kontrol edin."
    rm -f vpn-deploy.tar.gz
    exit 1
fi
rm -f vpn-deploy.tar.gz

echo -e "\033[1;33m[3/4]\033[0m Dosyalar yüklendi. Şimdi VDS üzerinde kurulum başlatılıyor..."
ssh -p $VPS_PORT -t ${VPS_USER}@${VPS_IP} "mkdir -p ~/xantum-server && tar -xzf ~/vpn-deploy.tar.gz -C ~/xantum-server && rm ~/vpn-deploy.tar.gz && cd ~/xantum-server && chmod +x setup.sh && sudo ./setup.sh --auto"

echo -e "\033[0;32m[4/4]\033[0m Uzaktan kurulum tamamlandı veya sonlandırıldı."
echo "Lütfen VDS ekranındaki Token ve IP bilgilerini not almayı unutmayın!"
