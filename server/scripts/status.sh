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
