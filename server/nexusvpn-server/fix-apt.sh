#!/bin/bash
# NexusVPN — APT Düzeltme + Temiz Kurulum
# "held broken packages" hatasını çözer

echo "=== APT Temizleniyor ==="

# 1. Kilitli paketleri serbest bırak
sudo dpkg --configure -a

# 2. Bozuk bağımlılıkları düzelt
sudo apt-get install -f -y

# 3. Önbelleği temizle
sudo apt-get clean
sudo apt-get autoclean

# 4. Paket listelerini yenile
sudo apt-get update --fix-missing

# 5. Tutulan paketleri göster (sorun kaynağı)
echo ""
echo "=== Tutulan Paketler (Held Packages) ==="
apt-mark showhold

# 6. Tutulan paketleri serbest bırak
sudo apt-mark unhold $(apt-mark showhold) 2>/dev/null

# 7. Şimdi WireGuard'ı tek tek kur
echo ""
echo "=== WireGuard Kuruluyor ==="
sudo apt-get install -y wireguard
sudo apt-get install -y wireguard-tools
sudo apt-get install -y qrencode
sudo apt-get install -y iptables-persistent
sudo apt-get install -y ufw

echo ""
echo "=== TAMAM! Şimdi setup.sh'i tekrar çalıştır ==="
echo "sudo bash setup.sh"
