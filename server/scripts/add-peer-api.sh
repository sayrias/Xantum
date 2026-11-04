#!/bin/bash
# ============================================================
# API üzerinden yeni peer ekleyen ve JSON dönen yardımcı script
# Kullanım: ./add-peer-api.sh "isim" "istemci_public_key"
# ============================================================

if [[ -z "$1" || -z "$2" ]]; then
    echo '{"error": "Eksik parametre"}'
    exit 1
fi

NAME=$1
CLIENT_PUBLIC_KEY=$2

# Rastgele boştaki bir IP'yi bul
# Basitlik için rastgele atıyoruz, çakışma ihtimali var ama küçük ağlar için kabul edilebilir.
PEER_IP="10.0.0.$((RANDOM % 200 + 10))"

# Sunucu Public Key'ini al
SERVER_PUBLIC_KEY=$(cat /etc/wireguard/server_public.key)

# Preshared key (Ekstra güvenlik için)
PSK=$(wg genpsk)

# Sunucunun public IP adresini öğren (setup.sh tarafından daha önceden kaydedilmiş olmalı, yoksa curl ile al)
SERVER_PUBLIC_IP=$(curl -4 -s ifconfig.me)

# wg0'a ekle
wg set wg0 peer "$CLIENT_PUBLIC_KEY" preshared-key <(echo "$PSK") allowed-ips "${PEER_IP}/32"

# wg0.conf dosyasına kalıcı olarak ekle
cat >> /etc/wireguard/wg0.conf << EOF

# ---- İstemci (API): ${NAME} ----
[Peer]
PublicKey = ${CLIENT_PUBLIC_KEY}
PresharedKey = ${PSK}
AllowedIPs = ${PEER_IP}/32
EOF

# Sonucu JSON olarak döndür
cat << EOF
{
  "address": "${PEER_IP}/32",
  "dns": "1.1.1.1, 8.8.8.8",
  "mtu": 1420,
  "serverPublicKey": "${SERVER_PUBLIC_KEY}",
  "presharedKey": "${PSK}",
  "endpoint": "${SERVER_PUBLIC_IP}:51820",
  "allowedIps": "0.0.0.0/0, ::/0"
}
EOF
