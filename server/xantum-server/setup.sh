#!/bin/bash
# ============================================================
#  Xantum — Otomatik WireGuard Sunucu Kurulum Scripti
#  Otomatik kurulum ve optimizasyon
# ============================================================

set -e  # Hata durumunda dur

# ---- Renkler ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ---- Konfigürasyon ----
WG_INTERFACE="wg0"
WG_PORT="51820"
WG_SERVER_IP="10.0.0.1"
WG_SUBNET="10.0.0.0/24"
WG_DNS="1.1.1.1, 8.8.8.8"
SERVER_PUBLIC_IP=$(curl -4 -s ifconfig.me)
CLIENT_IP="10.0.0.2"
IS_UPDATE=false

log()  { echo -e "${CYAN}[Xantum]${NC} $1"; }
ok()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

banner() {
cat << 'EOF'

  ███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗██╗   ██╗██████╗ ███╗   ██╗
  ████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝██║   ██║██╔══██╗████╗  ██║
  ██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗██║   ██║██████╔╝██╔██╗ ██║
  ██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║╚██╗ ██╔╝██╔═══╝ ██║╚██╗██║
  ██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║ ╚████╔╝ ██║     ██║ ╚████║
  ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝  ╚═══╝  ╚═╝     ╚═╝  ╚═══╝

  Kişisel WireGuard VPN Sunucusu — OVHCloud Almanya 🇩🇪
EOF
echo ""
}

# ---- Root kontrolü ----
check_root() {
    if [[ $EUID -ne 0 ]]; then
        err "Bu script root olarak çalıştırılmalı: sudo bash setup.sh"
    fi
}

# ---- Paket Yöneticisi Algılama ----
detect_package_manager() {
    if command -v apt-get >/dev/null; then
        PKG_MANAGER="apt"
        PKG_UPDATE="apt-get update -qq"
        PKG_INSTALL="apt-get install -y"
    elif command -v dnf >/dev/null; then
        PKG_MANAGER="dnf"
        PKG_UPDATE="dnf check-update || true"
        PKG_INSTALL="dnf install -y"
    elif command -v yum >/dev/null; then
        PKG_MANAGER="yum"
        PKG_UPDATE="yum check-update || true"
        PKG_INSTALL="yum install -y"
    elif command -v pacman >/dev/null; then
        PKG_MANAGER="pacman"
        PKG_UPDATE="pacman -Sy"
        PKG_INSTALL="pacman -S --noconfirm"
    else
        err "Desteklenmeyen paket yöneticisi! (Sadece apt, dnf, yum ve pacman desteklenir.)"
    fi
    log "Paket yöneticisi algılandı: ${PKG_MANAGER}"
}

# ---- Yanlışlıkla yerel çalıştırmayı önleme ----
confirm_execution() {
    if [[ "$1" == "--auto" ]]; then
        return 0
    fi
    echo -e "${YELLOW}DİKKAT: Bu scriptin VPN Sunucusu (VDS) üzerinde çalıştırılması gerekmektedir.${NC}"
    echo -e "Eğer kendi kişisel bilgisayarınızdaysanız bu işleme DEVAM ETMEYİN."
    read -p "Burası uzak sunucu (VDS) mu? Kuruluma devam edilsin mi? (E/H): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[EeYy]$ ]]; then
        err "Kurulum iptal edildi."
    fi
}

# ---- Güncelleme Modu Kontrolü ----
check_update_mode() {
    if [ -f "/etc/wireguard/wg0.conf" ]; then
        IS_UPDATE=true
        log "Mevcut WireGuard kurulumu tespit edildi. ${YELLOW}Güncelleme (Update) Modu${NC} aktif."
        log "Eski ağ şifreleri ve istemciler korunacak, sadece API ve kodlar güncellenecek."
    fi
}

# ---- Sistem güncelle & WireGuard kur ----
install_wireguard() {
    log "Sistem güncelleniyor ve WireGuard kuruluyor..."
    eval $PKG_UPDATE

    # wireguard-tools
    eval "$PKG_INSTALL wireguard-tools" 2>/dev/null || true

    # Diğer araçlar
    eval "$PKG_INSTALL qrencode"    2>/dev/null || warn "qrencode kurulamadı (QR kod olmayacak)"
    eval "$PKG_INSTALL curl iptables" 2>/dev/null || true
    
    if [ "$PKG_MANAGER" = "apt" ]; then
        eval "$PKG_INSTALL ufw" 2>/dev/null || true
    fi

    ok "WireGuard araçları kuruldu"

    # Ubuntu 24.04 (noble) — WireGuard kernel 5.6+ ile gelir, modprobe yeterli
    modprobe wireguard 2>/dev/null && ok "WireGuard kernel modülü aktif" || warn "Kernel modülü yüklenemedi (built-in olabilir)"
}

# ---- Kernel performans optimizasyonları ----
apply_kernel_tuning() {
    log "Kernel performans parametreleri ayarlanıyor..."
    
    cat > /etc/sysctl.d/99-wireguard.conf << 'SYSCTL'
# Xantum — WireGuard Kernel Optimizasyonları

# IP Forwarding (zorunlu)
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1

# Ağ tamponu boyutları (yüksek throughput için)
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728
net.core.rmem_default = 31457280
net.core.wmem_default = 31457280
net.core.optmem_max = 67108864
net.core.netdev_max_backlog = 250000

# TCP optimizasyonları
net.ipv4.tcp_rmem = 4096 87380 134217728
net.ipv4.tcp_wmem = 4096 65536 134217728
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_mtu_probing = 1

# Google BBR — En iyi TCP congestion control algoritması
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr

# Güvenlik
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.conf.all.accept_source_route = 0
SYSCTL

    sysctl --system -q
    ok "Kernel optimizasyonları uygulandı (BBR etkin)"
}

# ---- Ağ arayüzü tespit ----
detect_interface() {
    NET_IFACE=$(ip route | grep default | awk '{print $5}' | head -1)
    if [[ -z "$NET_IFACE" ]]; then
        NET_IFACE="eth0"
        warn "Varsayılan ağ arayüzü tespit edilemedi, eth0 kullanılıyor"
    fi
    log "Ağ arayüzü: ${BOLD}$NET_IFACE${NC}"
}

# ---- Anahtar çiftleri üret ----
generate_keys() {
    if [ "$IS_UPDATE" = true ]; then return 0; fi
    log "Kriptografik anahtarlar üretiliyor..."
    
    mkdir -p /etc/wireguard
    chmod 700 /etc/wireguard
    
    # Sunucu anahtarları
    wg genkey | tee /etc/wireguard/server_private.key | wg pubkey > /etc/wireguard/server_public.key
    chmod 600 /etc/wireguard/server_private.key
    
    # İstemci anahtarları
    wg genkey | tee /etc/wireguard/client_private.key | wg pubkey > /etc/wireguard/client_public.key
    chmod 600 /etc/wireguard/client_private.key
    
    # Pre-shared key (ek güvenlik katmanı)
    wg genpsk > /etc/wireguard/preshared.key
    chmod 600 /etc/wireguard/preshared.key
    
    ok "Anahtar çiftleri üretildi"
}

# ---- Sunucu konfigürasyonu ----
create_server_config() {
    if [ "$IS_UPDATE" = true ]; then return 0; fi
    log "WireGuard sunucu konfigürasyonu oluşturuluyor..."
    
    SERVER_PRIVATE=$(cat /etc/wireguard/server_private.key)
    CLIENT_PUBLIC=$(cat /etc/wireguard/client_public.key)
    PRESHARED=$(cat /etc/wireguard/preshared.key)
    
    cat > /etc/wireguard/wg0.conf << EOF
# Xantum WireGuard Sunucu — Oluşturuldu: $(date)

[Interface]
Address = ${WG_SERVER_IP}/24
ListenPort = ${WG_PORT}
PrivateKey = ${SERVER_PRIVATE}
DNS = ${WG_DNS}

# MTU optimizasyonu (paket parçalanmasını önler)
MTU = 1420

# iptables NAT kuralları — bağlantı kurulunca/kesilince otomatik eklenir/silinir
PostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT; iptables -t nat -A POSTROUTING -o ${NET_IFACE} -j MASQUERADE; iptables -t mangle -A FORWARD -o %i -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -j ACCEPT; iptables -t nat -D POSTROUTING -o ${NET_IFACE} -j MASQUERADE; iptables -t mangle -D FORWARD -o %i -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu

# ---- İstemci 1: Varsayılan Bilgisayar ----
[Peer]
PublicKey = ${CLIENT_PUBLIC}
PresharedKey = ${PRESHARED}
AllowedIPs = ${CLIENT_IP}/32
EOF

    chmod 600 /etc/wireguard/wg0.conf
    ok "Sunucu konfigürasyonu oluşturuldu"
}

# ---- İstemci konfigürasyonu ----
create_client_config() {
    if [ "$IS_UPDATE" = true ]; then return 0; fi
    log "İstemci konfigürasyonu oluşturuluyor..."
    
    SERVER_PUBLIC=$(cat /etc/wireguard/server_public.key)
    CLIENT_PRIVATE=$(cat /etc/wireguard/client_private.key)
    PRESHARED=$(cat /etc/wireguard/preshared.key)
    
    mkdir -p /etc/wireguard/clients
    
    cat > /etc/wireguard/clients/client1.conf << EOF
# Xantum İstemci Konfigürasyonu
# Oluşturuldu: $(date)
# Bu dosyayı Electron uygulamasına import et

[Interface]
Address = ${CLIENT_IP}/32
PrivateKey = ${CLIENT_PRIVATE}
DNS = 1.1.1.1, 8.8.8.8
MTU = 1420

[Peer]
PublicKey = ${SERVER_PUBLIC}
PresharedKey = ${PRESHARED}
Endpoint = ${SERVER_PUBLIC_IP}:${WG_PORT}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
EOF

    chmod 600 /etc/wireguard/clients/client1.conf
    ok "İstemci konfigürasyonu: /etc/wireguard/clients/client1.conf"
}

# ---- UFW Güvenlik Duvarı Yapılandırması ----
configure_firewall() {
    log "UFW güvenlik duvarı yapılandırılıyor..."
    
    if [ "$IS_UPDATE" = false ]; then
        # UFW'yi sıfırla (sadece ilk kurulumda)
        ufw --force reset
        ufw default deny incoming
        ufw default allow outgoing
    fi
    
    # Forward politikasını düzelt (İnternete çıkış için zorunlu)
    sed -i 's/DEFAULT_FORWARD_POLICY="DROP"/DEFAULT_FORWARD_POLICY="ACCEPT"/g' /etc/default/ufw
    
    # SSH bağlantısına izin ver (kendini kilitleme!)
    ufw allow 22/tcp comment 'SSH'
    ufw allow 51821/tcp comment 'Xantum API'
    ufw allow ${WG_PORT}/udp comment 'WireGuard VPN'
    
    ufw --force enable
    ok "UFW güvenlik duvarı etkin (SSH:22, WireGuard:${WG_PORT}/UDP)"
}

# ---- WireGuard Servisini Başlat ----
start_service() {
    log "WireGuard servisi başlatılıyor/yeniden başlatılıyor..."
    
    systemctl enable wg-quick@${WG_INTERFACE}
    if [ "$IS_UPDATE" = true ]; then
        systemctl restart wg-quick@${WG_INTERFACE}
    else
        systemctl start wg-quick@${WG_INTERFACE}
    fi
    
    sleep 2
    
    if systemctl is-active --quiet wg-quick@${WG_INTERFACE}; then
        ok "WireGuard servisi çalışıyor"
    else
        err "WireGuard servisi başlatılamadı! 'journalctl -u wg-quick@wg0' ile kontrol et"
    fi
}

# ---- Yardımcı scriptler ----
install_helper_scripts() {
    log "Yardımcı scriptler kuruluyor..."
    
    mkdir -p /usr/local/bin/xantum
    
    # Durum scripti
    cat > /usr/local/bin/xantum/status.sh << 'SCRIPT'
#!/bin/bash
echo "=== Xantum Durum Raporu ==="
echo "Tarih: $(date)"
echo ""
echo "--- WireGuard Arayüzü ---"
wg show
echo ""
echo "--- Bağlı İstemciler ---"
wg show wg0 peers | while read peer; do
    echo "Peer: $peer"
    wg show wg0 latest-handshakes | grep "$peer" | awk '{print "  Son Handshake:", $2}'
    wg show wg0 transfer | grep "$peer" | awk '{print "  Transfer:", $2, "rx /", $3, "tx"}'
done
SCRIPT
    chmod +x /usr/local/bin/xantum/status.sh

    # Ağ / LAN durumunu JSON olarak çeken API benzeri script (Hamachi özelliği için)
    cat > /usr/local/bin/xantum/get-network-status.sh << 'SCRIPT'
#!/bin/bash
if [[ $EUID -ne 0 ]]; then echo '{"error": "Root gerekli"}'; exit 1; fi

PEERS_JSON="["
FIRST=true

while read peer_pubkey; do
    if [[ -z "$peer_pubkey" || "$peer_pubkey" == "peer" ]]; then continue; fi

    PEER_IP=$(wg show wg0 allowed-ips | grep "$peer_pubkey" | awk '{print $2}' | cut -d'/' -f1)
    LATEST_HANDSHAKE=$(wg show wg0 latest-handshakes | grep "$peer_pubkey" | awk '{print $2}')
    
    if [ "$FIRST" = true ]; then
        FIRST=false
    else
        PEERS_JSON="$PEERS_JSON,"
    fi
    
    PEERS_JSON="$PEERS_JSON {\"publicKey\": \"$peer_pubkey\", \"ip\": \"$PEER_IP\", \"latestHandshake\": $LATEST_HANDSHAKE}"
done < <(wg show wg0 peers)

PEERS_JSON="$PEERS_JSON]"
echo "$PEERS_JSON"
SCRIPT
    chmod +x /usr/local/bin/xantum/get-network-status.sh
    
    # Yeni peer ekle scripti
    cat > /usr/local/bin/xantum/add-peer.sh << 'SCRIPT'
#!/bin/bash
if [[ $EUID -ne 0 ]]; then echo "Root gerekli"; exit 1; fi
if [[ -z "$1" ]]; then echo "Kullanım: add-peer.sh <isim>"; exit 1; fi

NAME=$1
PEER_IP="10.0.0.$((RANDOM % 200 + 50))"
PEER_PRIVATE=$(wg genkey)
PEER_PUBLIC=$(echo "$PEER_PRIVATE" | wg pubkey)
PSK=$(wg genpsk)
SERVER_PUBLIC=$(cat /etc/wireguard/server_public.key)

mkdir -p /etc/wireguard/clients

cat >> /etc/wireguard/wg0.conf << EOF

# ---- İstemci: ${NAME} ----
[Peer]
PublicKey = ${PEER_PUBLIC}
PresharedKey = ${PSK}
AllowedIPs = ${PEER_IP}/32
EOF

cat > /etc/wireguard/clients/${NAME}.conf << EOF
[Interface]
Address = ${PEER_IP}/32
PrivateKey = ${PEER_PRIVATE}
DNS = 1.1.1.1, 8.8.8.8
MTU = 1420

[Peer]
PublicKey = ${SERVER_PUBLIC}
PresharedKey = ${PSK}
Endpoint = ${SERVER_PUBLIC_IP}:${WG_PORT}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
EOF

wg addconf wg0 <(wg-quick strip /etc/wireguard/wg0.conf)
wg set wg0 peer "$PEER_PUBLIC" preshared-key <(echo "$PSK") allowed-ips "${PEER_IP}/32"

echo "Yeni istemci eklendi: ${NAME} (${PEER_IP})"
echo "Config: /etc/wireguard/clients/${NAME}.conf"
qrencode -t ansiutf8 < /etc/wireguard/clients/${NAME}.conf
SCRIPT
    chmod +x /usr/local/bin/xantum/add-peer.sh
    
    if [ -f "add-peer-api.sh" ]; then
        cp add-peer-api.sh /usr/local/bin/xantum/
        chmod +x /usr/local/bin/xantum/add-peer-api.sh
    fi
    
    ok "Yardımcı scriptler kuruldu"
}

# ---- Sonuç özeti ----
print_summary() {
    # Token'i (.env dosyasından VPN_PIN) alalım
    local API_TOKEN="123456"
    if [ -f /opt/xantum-backend/.env ]; then
        API_TOKEN=$(grep VPN_PIN /opt/xantum-backend/.env | cut -d '=' -f2)
    fi

    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║          🎉 Xantum KURULUM TAMAMLANDI! 🎉                ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${BOLD}LÜTFEN AŞAĞIDAKİ 2 BİLGİYİ KOPYALAYIN (Masaüstü uygulaması için gereklidir):${NC}"
    echo -e "${YELLOW}══════════════════════════════════════════════════════════════${NC}"
    echo -e "  ${CYAN}VDS IP Adresi${NC}  : ${BOLD}${SERVER_PUBLIC_IP}${NC}"
    echo -e "  ${CYAN}Invite Token${NC}   : ${BOLD}${API_TOKEN}${NC}"
    echo -e "${YELLOW}══════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${BOLD}İstemci Konfigürasyonu (Eski Yöntem İçin):${NC}"
    echo "  Dosya: /etc/wireguard/clients/client1.conf"
    echo ""
    echo -e "${BOLD}Yararlı Komutlar:${NC}"
    echo "  Durum       : /usr/local/bin/xantum/status.sh"
    echo "  Yeni istemci: sudo /usr/local/bin/xantum/add-peer.sh <isim>"
    echo "  WG durumu   : wg show"
    echo "  Servis      : systemctl status wg-quick@wg0"
    echo ""
}

# ---- Backend API Kurulumu ----
install_backend_api() {
    if ! command -v pm2 &> /dev/null; then
        log "Backend API (Node.js) kuruluyor..."
        # Modern Node.js kurulumları npm'i içerir, ayrı npm kurmak çakışmalara yol açabilir
        eval "$PKG_INSTALL nodejs"
        npm install -g pm2
    fi
    
    log "Backend kodları güncelleniyor..."
    mkdir -p /opt/xantum-backend
    
    if [ -d "backend" ]; then
        cp -r backend/* /opt/xantum-backend/
        cd /opt/xantum-backend
        
        # API Pin (Invite Token) oluştur
        if [ ! -f .env ]; then
            local NEW_PIN=$(head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 16)
            echo "VPN_PIN=$NEW_PIN" > .env
            echo "VPN_IP=$SERVER_PUBLIC_IP" >> .env
        fi
        
        npm install
        pm2 restart xantum-backend || pm2 start server.js --name "xantum-backend"
        pm2 save
        ok "Backend API güncellendi ve başlatıldı."
    else
        warn "backend/ klasörü bulunamadı, API kodları kopyalanamadı."
    fi
}

# ---- Ana akış ----
main() {
    clear
    banner
    
    if [ "$1" != "--auto" ]; then
        confirm_execution
    fi
    
    check_root
    detect_package_manager
    check_update_mode
    install_wireguard
    apply_kernel_tuning
    detect_interface
    generate_keys
    create_server_config
    create_client_config
    configure_firewall
    start_service
    install_helper_scripts
    install_backend_api
    print_summary
}

main "$@"
