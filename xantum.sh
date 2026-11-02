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

if [[ -t 1 && -n ${TERM:-} ]]; then clear; fi
echo -e "${CYAN}"
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║    Xantum Merkezi Kontrol Paneli v1.0.0            ║"
echo "  ║    XTP Protokolü — WireGuard gerektirmez           ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "  ${YELLOW}1)${NC} ${BOLD}Sunucu Kurulumu veya Güncellemesi${NC} (VDS Deploy)"
echo -e "     IP + SSH ile kur. Güvenli sertifika ve yenileme otomatik."
echo ""
echo -e "  ${YELLOW}2)${NC} ${BOLD}İstemci Derleme${NC} (Client Build — Linux + Windows)"
echo -e "     Hazır bağlantı veya uygulamada yapılandır; derle ve paketle."
echo ""
echo -e "  ${YELLOW}3)${NC} ${BOLD}Windows TUN Helper Derle${NC} (MinGW cross-compile)"
echo -e "     Sadece xtp-tun-helper.exe + wintun.dll üret."
echo ""
echo -e "  ${YELLOW}4)${NC} Çıkış"
echo ""
read -p "  İşlem numarasını seçin (1-4): " CHOICE

case "$CHOICE" in
  "1")
    bash "$(dirname "$0")/scripts/setup-server.sh"
    ;;
  "2")
    bash "$(dirname "$0")/scripts/build-client.sh"
    ;;
  "3")
    bash "$(dirname "$0")/scripts/compile-win-tun.sh"
    ;;
  "4")
    echo -e "  ${YELLOW}Çıkılıyor...${NC}"
    exit 0
    ;;
  *)
    echo -e "  ${RED}Geçersiz seçim!${NC}"
    exit 1
    ;;
esac
