#!/bin/bash
# ============================================================
#  NexusVPN — VDS Sunucu Kurulum ve Güncelleme Scripti
#  Ubuntu 20.04 / 22.04 / 24.04 destekli
# ============================================================

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${CYAN}"
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║    NexusVPN — VDS Kurulum Scripti                    ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Bilgileri al
read -p "  VDS IP Adresi        : " VPS_IP
read -p "  SSH Kullanıcı Adı    : " VPS_USER
[ -z "$VPS_USER" ] && VPS_USER="ubuntu"

read -s -p "  SSH Şifresi          : " VPS_PASS
echo ""
echo ""

if [ -z "$VPS_IP" ] || [ -z "$VPS_PASS" ]; then
    echo -e "${RED}[HATA]${NC} IP adresi ve şifre boş bırakılamaz!"
    exit 1
fi

if ! command -v sshpass &>/dev/null; then
    echo -e "${YELLOW}[!] sshpass aracı bulunamadı. Kuruluyor...${NC}"
    sudo apt-get install -y sshpass || true
fi

SSH_TARGET="${VPS_USER}@${VPS_IP}"
export SSHPASS="$VPS_PASS"

echo -e "${YELLOW}[1/3]${NC} Kurulum dosyaları paketleniyor..."
cd "$(dirname "$0")/../server"
tar --exclude="backend/node_modules" -czf /tmp/vpn-deploy.tar.gz nexusvpn-server/

echo -e "${YELLOW}[2/3]${NC} Dosyalar VDS'e yükleniyor..."
sshpass -e scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null /tmp/vpn-deploy.tar.gz ${SSH_TARGET}:~/

echo -e "${YELLOW}[3/3]${NC} VDS'de kurulum başlatılıyor... Lütfen bekleyin..."
echo -e "${CYAN}------------------------------------------------------------${NC}"
sshpass -e ssh -t -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${SSH_TARGET} "mkdir -p ~/nexusvpn-server && tar -xzf ~/vpn-deploy.tar.gz -C ~/ && rm ~/vpn-deploy.tar.gz && cd ~/nexusvpn-server && chmod +x setup.sh && echo \"$VPS_PASS\" | sudo -S ./setup.sh --auto"

echo -e "${CYAN}------------------------------------------------------------${NC}"
echo -e "  ${GREEN}Kurulum işlemi tamamlandı! Lütfen yukarıdaki Token ve IP bilgisini not alın.${NC}"
echo ""
read -p "Devam etmek için bir tuşa basın..." -n 1
