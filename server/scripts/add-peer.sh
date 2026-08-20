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
