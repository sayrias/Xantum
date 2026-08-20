#!/bin/bash
# ============================================================
#  Xantum — İstemci Derleme Scripti v1.0
#  Wine/Docker otomatik kurulum destekli
# ============================================================

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${CYAN}"
  echo "  ██╗  ██╗ █████╗ ███╗   ██╗████████╗██╗   ██╗███╗   ███╗"
  echo "  ╚██╗██╔╝██╔══██╗████╗  ██║╚══██╔══╝██║   ██║████╗ ████║"
  echo "   ╚███╔╝ ███████║██╔██╗ ██║   ██║   ██║   ██║██╔████╔██║"
  echo "   ██╔██╗ ██╔══██║██║╚██╗██║   ██║   ██║   ██║██║╚██╔╝██║"
  echo "  ██╔╝ ██╗██║  ██║██║ ╚████║   ██║   ╚██████╔╝██║ ╚═╝ ██║"
  echo "  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝ ╚═╝     ╚═╝"
echo -e "${NC}"
echo -e "${BOLD}  Xantum İstemci Derleme Aracı v1.0${NC}"
echo "  ────────────────────────────────────────────"
echo ""

# ============================================================
# YARDIMCI FONKSİYONLAR
# ============================================================

detect_distro() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        echo "$ID"
    elif command -v lsb_release &>/dev/null; then
        lsb_release -si | tr '[:upper:]' '[:lower:]'
    else
        echo "unknown"
    fi
}

detect_pkg_manager() {
    if command -v dnf &>/dev/null; then echo "dnf"
    elif command -v apt-get &>/dev/null; then echo "apt"
    elif command -v pacman &>/dev/null; then echo "pacman"
    elif command -v zypper &>/dev/null; then echo "zypper"
    else echo "unknown"
    fi
}

install_wine() {
    local PKG=$(detect_pkg_manager)
    local DISTRO=$(detect_distro)
    echo -e "  ${YELLOW}Wine kuruluyor (${DISTRO} / ${PKG})...${NC}"

    case "$PKG" in
        dnf)
            sudo dnf install -y wine
            ;;
        apt)
            echo -e "  ${CYAN}i386 mimarisi ekleniyor...${NC}"
            sudo dpkg --add-architecture i386
            sudo apt-get update -qq
            sudo apt-get install -y wine64 wine32 2>/dev/null || sudo apt-get install -y wine
            ;;
        pacman)
            sudo pacman -S --noconfirm wine
            ;;
        zypper)
            sudo zypper install -y wine
            ;;
        *)
            echo -e "  ${RED}[HATA]${NC} Paket yöneticisi tanınamadı. Wine'ı manuel kurun:"
            echo -e "  https://www.winehq.org/download"
            return 1
            ;;
    esac

    echo -e "  ${GREEN}✓${NC} Wine kuruldu: $(wine --version 2>/dev/null | head -1)"
}

install_docker() {
    local PKG=$(detect_pkg_manager)
    local DISTRO=$(detect_distro)
    echo -e "  ${YELLOW}Docker kuruluyor (${DISTRO} / ${PKG})...${NC}"

    case "$PKG" in
        dnf)
            sudo dnf install -y dnf-plugins-core
            sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo 2>/dev/null || true
            sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin
            sudo systemctl enable --now docker
            sudo usermod -aG docker "$USER"
            ;;
        apt)
            sudo apt-get update -qq
            sudo apt-get install -y ca-certificates curl gnupg
            sudo install -m 0755 -d /etc/apt/keyrings
            curl -fsSL https://download.docker.com/linux/${DISTRO}/gpg | \
                sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null || true
            sudo chmod a+r /etc/apt/keyrings/docker.gpg
            echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/${DISTRO} $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
                sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
            sudo apt-get update -qq
            sudo apt-get install -y docker-ce docker-ce-cli containerd.io
            sudo systemctl enable --now docker
            sudo usermod -aG docker "$USER"
            ;;
        pacman)
            sudo pacman -S --noconfirm docker
            sudo systemctl enable --now docker
            sudo usermod -aG docker "$USER"
            ;;
        zypper)
            sudo zypper install -y docker
            sudo systemctl enable --now docker
            sudo usermod -aG docker "$USER"
            ;;
        *)
            echo -e "  ${RED}[HATA]${NC} Paket yöneticisi tanınamadı."
            return 1
            ;;
    esac

    echo -e "  ${GREEN}✓${NC} Docker kuruldu: $(docker --version)"
    echo -e "  ${YELLOW}⚠${NC}  Tam yetki için: ${CYAN}newgrp docker${NC}"
}

try_install_windows_dep() {
    echo ""
    echo -e "  ${BOLD}Windows derleme için gereksinim bulunamadı.${NC}"
    echo -e "  Wine veya Docker gereklidir."
    echo ""
    echo -e "  ${YELLOW}1)${NC} Wine kur (Önerilen — daha hızlı)"
    echo -e "  ${YELLOW}2)${NC} Docker kur"
    echo -e "  ${YELLOW}3)${NC} Atla — Sadece Linux derle"
    echo ""
    read -p "  Seçiminiz (1, 2 veya 3): " DEP_CHOICE
    echo ""

    case "$DEP_CHOICE" in
        "1") install_wine; command -v wine &>/dev/null && echo "wine" || echo "none" ;;
        "2") install_docker; command -v docker &>/dev/null && echo "docker" || echo "none" ;;
        *)   echo "none" ;;
    esac
}

# ============================================================
# 1. Sunucu bilgilerini al
# ============================================================
read -p "  VDS IP Adresi     : " VPS_IP
read -p "  Invite Token      : " VPS_TOKEN
echo ""

if [ -z "$VPS_IP" ] || [ -z "$VPS_TOKEN" ]; then
    echo -e "${RED}[HATA]${NC} IP Adresi ve Token boş bırakılamaz!"
    exit 1
fi

# ============================================================
# 2. Config dosyası oluştur
# ============================================================
echo -e "${YELLOW}[1/5]${NC} Ayar dosyası (config.json) oluşturuluyor..."
cd "$(dirname "$0")/../client" || exit 1
cat > config.json << EOF
{
  "serverIp": "$VPS_IP",
  "apiPort": 51821,
  "inviteToken": "$VPS_TOKEN"
}
EOF
echo -e "      ${GREEN}✓${NC} config.json oluşturuldu (IP: $VPS_IP)"

# ============================================================
# 3. Node.js modüllerini kur
# ============================================================
echo -e "${YELLOW}[2/5]${NC} Node.js modülleri kuruluyor..."
npm install --silent
echo -e "      ${GREEN}✓${NC} Modüller hazır"

# ============================================================
# 4. Test modu
# ============================================================
echo -e "${YELLOW}[3/5]${NC} TEST MODU: Uygulama test için başlatılıyor..."
echo "      Lütfen açılan uygulamada bağlantıyı test edin."
echo "      Uygulamayı kapattığınızda derleme aşamasına geçilecektir."
echo ""
rm -rf logs/ 2>/dev/null || true
npm run dev

echo ""
read -p "  Test başarılı mı? Uygulama dağıtım için derlensin mi? (E/H): " -n 1 -r DO_BUILD
echo ""
if [[ ! $DO_BUILD =~ ^[EeYy]$ ]]; then
    echo -e "  ${YELLOW}Derleme iptal edildi.${NC}"
    exit 0
fi

# ============================================================
# 5. Platform seçimi
# ============================================================
echo ""
echo -e "  ${BOLD}Hangi işletim sistemi için derlemek istiyorsunuz?${NC}"
echo ""
echo -e "  ${YELLOW}1)${NC} Linux — .AppImage + .deb (Tüm dağıtımlar)"
echo -e "  ${YELLOW}2)${NC} Windows — .exe NSIS Installer"
echo -e "  ${YELLOW}3)${NC} Tümü (Linux + Windows)"
echo ""
read -p "  Seçiminiz (1, 2 veya 3): " PLATFORM_CHOICE
echo ""

# ============================================================
# 6. Windows için gereksinim kontrolü
# ============================================================
WIN_BUILD_METHOD="none"

if [[ "$PLATFORM_CHOICE" == "2" || "$PLATFORM_CHOICE" == "3" ]]; then
    echo -e "  ${BOLD}Windows derleme gereksinimleri kontrol ediliyor...${NC}"

    if command -v wine &>/dev/null; then
        echo -e "  ${GREEN}✓${NC} Wine bulundu: $(wine --version 2>/dev/null | head -1)"
        WIN_BUILD_METHOD="wine"
    elif command -v docker &>/dev/null; then
        echo -e "  ${GREEN}✓${NC} Docker bulundu: $(docker --version)"
        WIN_BUILD_METHOD="docker"
        if ! docker info &>/dev/null; then
            echo -e "  ${YELLOW}⚠${NC}  Docker başlatılıyor..."
            sudo systemctl start docker 2>/dev/null || true
            sleep 2
        fi
    else
        RESULT=$(try_install_windows_dep)
        WIN_BUILD_METHOD=$(echo "$RESULT" | tail -1)
    fi
    echo ""
fi

# ============================================================
# 7. Derleme
# ============================================================
rm -rf logs/ 2>/dev/null || true

echo -e "${YELLOW}[4/5]${NC} Derleme başlıyor..."

build_linux() {
    echo -e "      ${BOLD}Linux hedefleri:${NC} AppImage (Evrensel) · deb (Debian/Ubuntu)"
    npm run build:linux
    echo -e "      ${GREEN}✓${NC} Linux derlemesi tamamlandı"
}

build_windows_wine() {
    echo -e "      ${BOLD}Windows hedefi:${NC} NSIS Installer (.exe) — Wine ile"
    # Wine ve NSIS, Türkçe karakterli yolları (ör. Masaüstü) bozmaktadır.
    # ASCII karakterli güvenli bir dizine (home) hardlink kopyası alıp derlemeyi orada yapıyoruz.
    local BUILD_LINK="$HOME/.xantum-build-tmp"
    rm -rf "$BUILD_LINK"
    cp -al "$(pwd)" "$BUILD_LINK" 2>/dev/null || rsync -a --exclude=node_modules --exclude=dist-electron "$(pwd)/" "$BUILD_LINK/"
    
    cd "$BUILD_LINK"
    # Eğer hardlink yerine rsync kopyası kullanıldıysa npm install gerekebilir
    [ ! -d "node_modules" ] && npm install --silent
    npm run build:win
    cd - > /dev/null
    
    # Oluşan EXE ve paketleri gerçek dizine taşı
    cp -r "$BUILD_LINK/dist-electron/"*.exe dist-electron/ 2>/dev/null || true
    cp -r "$BUILD_LINK/dist-electron/"*-unpacked dist-electron/ 2>/dev/null || true
    rm -rf "$BUILD_LINK"
    
    echo -e "      ${GREEN}✓${NC} Windows derlemesi tamamlandı"
}

build_windows_docker() {
    echo -e "      ${BOLD}Windows hedefi:${NC} NSIS Installer (.exe) — Docker ile"
    DOCKER_CMD="docker"
    if ! docker info &>/dev/null; then DOCKER_CMD="sudo docker"; fi
    $DOCKER_CMD run --rm \
        -v "$(pwd)":/project \
        -w /project \
        -v "$HOME/.cache/electron":/root/.cache/electron \
        -v "$HOME/.cache/electron-builder":/root/.cache/electron-builder \
        electronuserland/builder:wine \
        /bin/bash -c "npm install --silent && npm run build:win"
    echo -e "      ${GREEN}✓${NC} Windows derlemesi tamamlandı"
}

case "$PLATFORM_CHOICE" in
    "1") build_linux ;;
    "2")
        case "$WIN_BUILD_METHOD" in
            "wine")   build_windows_wine ;;
            "docker") build_windows_docker ;;
            *)
                echo -e "  ${RED}[HATA]${NC} Windows derleme aracı kurulamadı. Linux derleniyor."
                build_linux
                ;;
        esac
        ;;
    "3")
        build_linux
        case "$WIN_BUILD_METHOD" in
            "wine")   build_windows_wine ;;
            "docker") build_windows_docker ;;
            *)
                echo -e "  ${YELLOW}[UYARI]${NC} Windows derleme aracı bulunamadı, atlanıyor."
                ;;
        esac
        ;;
    *)
        echo -e "  ${YELLOW}Geçersiz seçim — Linux derleniyor.${NC}"
        build_linux
        ;;
esac

# ============================================================
# 8. Özet
# ============================================================
OUTDIR="$(pwd)/dist-electron"

echo ""
echo -e "${YELLOW}[5/5]${NC} Sonuçlar:"
echo ""
echo -e "  ${GREEN}════════════════════════════════════════════${NC}"
echo -e "  ${GREEN}✓  Derleme başarıyla tamamlandı!${NC}"
echo -e "  ${GREEN}════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Çıktı klasörü:${NC} ${CYAN}${OUTDIR}${NC}"
echo ""
echo -e "  ${BOLD}Derlenen dosyalar:${NC}"
if [ -d "$OUTDIR" ]; then
    find "$OUTDIR" -maxdepth 1 \( -name "*.AppImage" -o -name "*.deb" -o -name "*.exe" \) \
        -printf "    %-40f  %s bytes\n" 2>/dev/null || \
    ls -lh "$OUTDIR" 2>/dev/null | awk 'NR>1 {printf "    %s\t%s\n", $5, $9}'
fi
echo ""
