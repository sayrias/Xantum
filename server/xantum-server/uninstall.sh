#!/bin/bash
# ============================================================
#  Xantum Server — Kaldırma Scripti (İstersen sıfırdan kur)
#  Çalıştır: sudo bash uninstall.sh
# ============================================================

echo "=== Xantum Sunucu Kaldırılıyor ==="
systemctl stop wg-quick@wg0 2>/dev/null
systemctl disable wg-quick@wg0 2>/dev/null
rm -rf /etc/wireguard/
rm -rf /usr/local/bin/xantum/
rm -f /etc/sysctl.d/99-wireguard.conf
ufw --force reset
echo "=== Kaldırma tamamlandı. Tekrar kurmak için: sudo bash setup.sh ==="
