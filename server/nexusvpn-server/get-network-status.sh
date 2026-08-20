#!/bin/bash
# ============================================================
#  NexusVPN — Ağ Durumu ve Peer JSON Çıktısı
#  Hamachi benzeri LAN IP'lerini çekmek için
# ============================================================
if [[ $EUID -ne 0 ]]; then echo '{"error": "Root gerekli"}'; exit 1; fi

PEERS_JSON="["
FIRST=true

while read peer_pubkey; do
    if [[ -z "$peer_pubkey" || "$peer_pubkey" == "peer" ]]; then continue; fi

    PEER_IP=$(wg show wg0 allowed-ips | grep "$peer_pubkey" | awk '{print $2}' | cut -d'/' -f1)
    LATEST_HANDSHAKE=$(wg show wg0 latest-handshakes | grep "$peer_pubkey" | awk '{print $2}')
    
    # Sadece aktif peer'ları veya hepsini gösterebiliriz, şimdilik hepsini gösterelim
    if [ "$FIRST" = true ]; then
        FIRST=false
    else
        PEERS_JSON="$PEERS_JSON,"
    fi
    
    PEERS_JSON="$PEERS_JSON {\"publicKey\": \"$peer_pubkey\", \"ip\": \"$PEER_IP\", \"latestHandshake\": $LATEST_HANDSHAKE}"
done < <(wg show wg0 peers)

PEERS_JSON="$PEERS_JSON]"

echo "$PEERS_JSON"
