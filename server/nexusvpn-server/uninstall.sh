#!/bin/bash
# ============================================================
#  NexusVPN Server — Kaldırma Scripti (İstersen sıfırdan kur)
#  Çalıştır: sudo bash uninstall.sh
# ============================================================

echo "=== NexusVPN Sunucu Kaldırılıyor ==="
systemctl stop wg-quick@wg0 2>/dev/null
systemctl disable wg-quick@wg0 2>/dev/null
rm -rf /etc/wireguard/
rm -rf /usr/local/bin/nexusvpn/
rm -f /etc/sysctl.d/99-wireguard.conf
ufw --force reset
echo "=== Kaldırma tamamlandı. Tekrar kurmak için: sudo bash setup.sh ==="
