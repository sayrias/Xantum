# Xantum Wiki

[Home](../README.md) · [Setup](SETUP.md) · [Building](BUILDING.md) · [Protection and recovery](NETWORK-PROTECTION.md) · [Issues](https://github.com/sayrias/Xantum/issues)

## Quick help

**Cannot connect:** Check the server address and access key in Settings → Your server. The address must match a trusted TLS certificate. Default ports are 51821/TCP for API/chat and 8443/TCP for XTP. Check the server's `/health` endpoint and service logs using the [setup guide](SETUP.md).

**Certificate installation fails:** Incoming TCP 80 must be open. Existing Nginx sites must serve the ACME challenge files; Xantum does not stop the web server or rewrite its sites. See [TLS troubleshooting](SETUP.md#tls-troubleshooting).

**Missing helper or permission error:** On Linux, approve helper installation when connecting; do not start the app with sudo. Windows requires administrator privileges. See [Building](BUILDING.md) for manual helper installation.

**Internet stays blocked after a crash:** Reopen Xantum, check protection status and reconnect or restore internet access. [Recovery commands](NETWORK-PROTECTION.md#manual-recovery) are available if the app cannot open.

**Chat is offline:** Verify your server details and wait for reconnection. A delivery acknowledgement means the server accepted a message, not that someone read it. Chat history is held in memory rather than saved to disk.

**Voice has no sound:** Check microphone permission, input device, volume and mute settings. Push-to-talk requires the app to have focus. Connections across different networks may need [STUN/TURN configuration](SETUP.md#voice-across-networks).

## Common questions

**Does this need WireGuard?** No. XTP uses its own transport. Windows uses Wintun only as the virtual network adapter.

**Is chat end-to-end encrypted?** No. TLS protects the connection, but the server can read messages. Voice uses encrypted WebRTC media.

**Can I tunnel only certain apps or sites?** The desktop client currently uses a full IPv4 tunnel. Selective routing is not available in it.

**Where are downloads?** Check [GitHub Downloads](https://github.com/sayrias/Xantum/releases), or [build from source](BUILDING.md).

## Report a problem

Open an [issue](https://github.com/sayrias/Xantum/issues) with your OS, app version, reproduction steps, expected result and error text. Include both client and server versions for connection problems. Remove access keys, private connection profiles, TLS keys and personal information from logs and screenshots.
