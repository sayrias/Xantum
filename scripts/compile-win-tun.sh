#!/bin/bash
# ============================================================
#  Xantum — Windows XTP TUN Helper Derleme Scripti
#  MinGW-w64 ile cross-compile (Linux'ta Windows .exe üretir)
#
#  Kullanım:
#    chmod +x compile-win.sh
#    ./compile-win.sh
# ============================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NATIVE_DIR="$SCRIPT_DIR/../client/native"
BIN_DIR="$SCRIPT_DIR/../client/bin"
WINTUN_VER="0.14.1"
WINTUN_URL="https://www.wintun.net/builds/wintun-${WINTUN_VER}.zip"
WINTUN_ZIP="/tmp/wintun-${WINTUN_VER}.zip"
WINTUN_DIR="/tmp/wintun-sdk-${WINTUN_VER}"

echo -e "${CYAN}"
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║  Xantum — Windows TUN Helper Cross-Compiler         ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"

# 1. MinGW kontrolü
if ! command -v x86_64-w64-mingw32-gcc &>/dev/null; then
    echo -e "${YELLOW}[!]${NC} MinGW-w64 bulunamadı. Kuruluyor..."
    if command -v apt-get &>/dev/null; then
        sudo apt-get install -y mingw-w64
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y mingw64-gcc mingw64-winpthreads-static
    elif command -v pacman &>/dev/null; then
        sudo pacman -S --noconfirm mingw-w64-gcc
    else
        echo -e "${RED}[✗]${NC} MinGW manuel kurulumu gerekiyor: https://www.mingw-w64.org/"
        exit 1
    fi
fi

GCC_VER=$(x86_64-w64-mingw32-gcc --version | head -1)
echo -e "${GREEN}[✓]${NC} MinGW-w64: $GCC_VER"

# 2. WinTun DLL indir
mkdir -p "$BIN_DIR"

if [ ! -f "$BIN_DIR/wintun.dll" ]; then
    echo -e "${YELLOW}[→]${NC} WinTun ${WINTUN_VER} indiriliyor..."
    if curl -fsSL --max-time 30 "$WINTUN_URL" -o "$WINTUN_ZIP"; then
        mkdir -p "$WINTUN_DIR"
        unzip -q -o "$WINTUN_ZIP" -d "$WINTUN_DIR"

        # AMD64 DLL bul ve kopyala
        DLL_PATH=$(find "$WINTUN_DIR" -name "wintun.dll" | grep -i amd64 | head -1)
        [ -z "$DLL_PATH" ] && DLL_PATH=$(find "$WINTUN_DIR" -name "wintun.dll" | head -1)

        if [ -n "$DLL_PATH" ]; then
            cp "$DLL_PATH" "$BIN_DIR/wintun.dll"
            echo -e "${GREEN}[✓]${NC} WinTun DLL: client/bin/wintun.dll"
        else
            echo -e "${RED}[✗]${NC} WinTun DLL bulunamadı zip içinde!"
            exit 1
        fi
        rm -f "$WINTUN_ZIP"
        rm -rf "$WINTUN_DIR"
    else
        echo -e "${RED}[✗]${NC} WinTun indirilemedi!"
        echo "   Manuel indirme: $WINTUN_URL"
        echo "   wintun.dll (amd64) dosyasını client/bin/ klasörüne koyun."
        exit 1
    fi
else
    echo -e "${GREEN}[✓]${NC} WinTun DLL mevcut: client/bin/wintun.dll"
fi

# 3. Cross-compile
WIN_SRC="$NATIVE_DIR/xtp-tun-win.c"
WIN_OUT="$BIN_DIR/xtp-tun-helper.exe"

if [ ! -f "$WIN_SRC" ]; then
    echo -e "${RED}[✗]${NC} Kaynak bulunamadı: $WIN_SRC"
    exit 1
fi

echo -e "${YELLOW}[→]${NC} xtp-tun-win.c derleniyor → xtp-tun-helper.exe ..."

x86_64-w64-mingw32-gcc \
    -O2 \
    -Wall \
    -o "$WIN_OUT" \
    "$WIN_SRC" \
    -lws2_32 \
    -liphlpapi \
    -lole32 \
    -lfwpuclnt \
    -ladvapi32 \
    -static \
    -static-libgcc

SIZE=$(du -sh "$WIN_OUT" | cut -f1)
echo -e "${GREEN}[✓]${NC} Derleme başarılı!"
echo ""
echo -e "  ${CYAN}Çıktı dosyaları (client/bin/):${NC}"
echo -e "  ├── xtp-tun-helper.exe  (${SIZE})"
echo -e "  └── wintun.dll"
echo ""
echo -e "  ${YELLOW}Not:${NC} Bu dosyalar Electron build sırasında otomatik paketlenir."
echo -e "       Windows'ta Admin yetkisi ile çalışır."
echo ""
