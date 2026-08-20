# 🚀 NexusVPN (v1.0.0)

Kendi VDS'inizde barındırabileceğiniz, **Sıfır Ayar (Zero-Config)** ile çalışan ve **Discord tarzı WebRTC Ses Odaları** sunan yeni nesil P2P Oyuncu Ağı ve VPN Çözümü!

## 🌟 Neden NexusVPN?

Hamachi, Radmin VPN gibi uygulamalara bağımlı kalmadan kendi yüksek hızlı oyun ağınızı kurun!  
Arkadaşlarınızın IP adresi girmesine, şifre ezberlemesine veya ayar yapmasına gerek yok.  
Gönderdiğiniz `NexusVPN` uygulamasını açıp **Bağlan** tuşuna basmaları yeterlidir!

### ✨ Temel Özellikler
* ⚡ **Zero-Config Katılım:** Uygulamayı açınca otomatik bağlanır
* 🎙️ **Grup Ses Odası (Mesh WebRTC):** Discord'a gerek kalmadan sesli sohbet
* 💬 **Canlı Sohbet:** Socket.IO ile anlık yazışma
* 🛡️ **WireGuard Çekirdeği:** En hızlı ve güvenli VPN protokolü
* 🌍 **Kendi Sunucun, Kendi Kuralların:** Hız limiti yok
* 🔔 **Bas-Konuş (PTT):** Özelleştirilebilir kısayol tuşu

---

## 📂 Proje Yapısı

```
NexusVPN/
├── nexusvpn.sh          # Linux kontrol paneli
├── nexusvpn.bat         # Windows kontrol paneli
├── client/              # Electron + React masaüstü uygulaması
│   ├── electron/        # Electron ana process
│   │   ├── main.js      # Ana process, pencere yönetimi, log sistemi
│   │   └── preload.js   # IPC köprüsü
│   └── src/             # React arayüzü
│       └── components/  # UI bileşenleri
├── server/
│   ├── backend/         # Express + Socket.IO API sunucusu
│   └── nexusvpn-server/ # VDS kurulum scriptleri
│       ├── setup.sh     # Ana kurulum scripti
│       ├── add-peer-api.sh
│       └── ...
├── scripts/
│   ├── build-client.sh  # Derleme aracı (Linux → AppImage, deb, exe)
│   └── setup-server.sh  # Sunucu kurulum köprüsü
└── docs/
    ├── KURULUM.md       # Sunucu kurulum rehberi
    ├── BUILDING.md      # Derleme rehberi
    └── SISTEM.md        # Teknik mimari
```

---

## 🚀 Hızlı Başlangıç

### 1. Sunucu Kur (Tek seferlik)
```bash
bash nexusvpn.sh  # → Seçenek 1
```
Açılan ekranda VDS IP ve SSH bilgilerini girin. Script her şeyi otomatik kurar ve sana **IP + Token** verir.

### 2. İstemci Derle (Arkadaşlara dağıt)
```bash
bash nexusvpn.sh  # → Seçenek 2
```
Derleme bitince `client/dist-electron/` içinde `.AppImage`, `.deb` ve `.exe` dosyaları hazır olur.

---

## 📚 Dokümantasyon

* 📖 [Sunucu Kurulum Rehberi](docs/KURULUM.md)
* 🔨 [Derleme Rehberi](docs/BUILDING.md)
* ⚙️ [Sistem Mimarisi](docs/SISTEM.md)

---

## 🛠️ Teknolojiler

| Katman | Teknoloji |
|--------|-----------|
| Sunucu Ağ | WireGuard, UFW |
| Sunucu API | Node.js, Express, Socket.IO |
| İstemci | Electron.js, React, Vite |
| Ses | WebRTC, simple-peer (Opus 48kHz) |
| Paketleme | electron-builder (AppImage, deb, NSIS) |

---

## 📁 Log Sistemi

```
client/logs/
└── 2026-08-20/
    ├── 2026-08-20-activity.log   ← Tüm olaylar
    └── 2026-08-20-error.log      ← Sadece hatalar
```

**Konum:**
- Linux: `~/.config/NexusVPN/logs/`
- Windows: `%APPDATA%\NexusVPN\logs\`
