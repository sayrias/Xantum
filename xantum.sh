#!/bin/bash
# ============================================================
#  Xantum — Ana Kontrol Paneli (Linux)
# ============================================================

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

clear
echo -e "${CYAN}"
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║    Xantum Merkezi Kontrol Paneli (Linux)           ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo "  [1] Sunucu Kurulumu veya Güncellemesi (VDS Deploy)"
echo "  [2] İstemci Test ve Derleme (Client Build)"
echo "  [3] Çıkış"
echo ""
read -p "  İşlem numarasını seçin (1-3): " CHOICE

case "$CHOICE" in
  "1")
    bash "$(dirname "$0")/scripts/setup-server.sh"
    ;;
  "2")
    bash "$(dirname "$0")/scripts/build-client.sh"
    ;;
  "3")
    echo -e "  ${YELLOW}Çıkılıyor...${NC}"
    exit 0
    ;;
  *)
    echo -e "  ${RED}Geçersiz seçim!${NC}"
    exit 1
    ;;
esac
