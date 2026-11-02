# İstemci derleme

Node.js 22.12+ ve npm gerekir. Varsayılan genel paket bağlantı bilgisini uygulamada ister; isteğe bağlı **Hazır bağlantı** yalnız özel dağıtım içindir.

## Derleme sihirbazı

Proje dizininde `bash xantum.sh` → **2** veya `bash scripts/build-client.sh` çalıştırın.

| Seçenek | Davranış | Çıktı |
| --- | --- | --- |
| Uygulamada yapılandır | Genel pakete IP veya anahtar eklenmez; kullanıcı uygulamada bir kez kaydeder | `client/dist-electron/` |
| Hazır bağlantı | IP/alan adı, gizli anahtar girişi ve isteğe bağlı portlar bu pakete eklenir; ilk kullanımda ayarlar hazır gelir | `client/dist-electron/private/` |

Hazır bağlantının anahtarı paket içinden çıkarılabilir; bu bir gizli anahtar kasası değildir. Paketi yalnız yetkilendirdiğiniz kişilerle paylaşın. Genel GitHub sürümüne koymayın. Bilgiler kaynak `config.json` dosyasına yazılmaz; izinleri 600 olan geçici profil, işlem sonunda temizlenir. Kayıtlı kullanıcı ayarları paket yükseltmesinde değişmez. “Bağlantıyı düzenle” ile sonradan değiştirilebilir.

Sihirbaz platformu seçtirir, gerekli native bileşeni derler/kontrol eder ve isteğe bağlı önizleme açar. Sistem paketlerini, sudoers veya ağ ayarlarını değiştirmez. Windows için önceden hazırlanmış helper/DLL ve Wine ya da çalışan Docker gerekir. Doğrudan aşağıdaki npm komutlarıyla yapılan derlemeler varsayılan olarak genel pakettir; özel profil yalnız `XANTUM_CONNECTION_PROFILE` ile açıkça seçilir.

## Kaynak doğrulama

```bash
npm ci --prefix client
npm ci --prefix server/xantum-server/backend
npm test --prefix client
npm test --prefix development/selective-vpn
npm run build:ui --prefix client
```

Linux'ta testler GCC ve Linux geliştirme başlıklarını da gerektirir. Native testler gerçek kaynağı `_FORTIFY_SOURCE=2` ve `3` ile derler; paket yazma, kesik frame, hata çıkışı ve sahipli rota temizliğini ağ komutlarını taklit ederek sınar. Yetki veya host ağ değişikliği gerekmez. Entegrasyon testleri geçici localhost portları açar.

## Linux x64

```bash
mkdir -p client/bin
gcc -Wall -Wextra -Werror -O2 -D_FORTIFY_SOURCE=2 -o client/bin/xtp-tun-helper server/xantum-server/xtp-tun.c
npm run build:linux --prefix client
```

Çıktı: `client/dist-electron/`. Debian paketinin kurulum kancası root sahipli TUN/koruma yardımcılarını ve polkit ilkesini kurar; kaldırma kancası önce sahipli koruma oturumunu temizler. Geliştirme veya AppImage ile ilk bağlantıda yardımcılar yönetici onayıyla hazırlanır; ayrı “Korumayı kur” düğmesi isteğe bağlıdır. Terminal alternatifi:

```bash
sudo bash client/native/install-linux-helpers.sh
```

Bu komut yardımcı kurulumu yapar; VPN veya firewall açmaz. Electron'u root çalıştırmayın. `nftables`, `python3`, `iproute2`, `pkexec/polkit` gerekir. Temiz sistemde paket kancalarının çalışması [yayın kontrolünde](GELISTIRME-PLANI.md) ayrıca doğrulanır.

## Windows x64

Linux'ta MinGW-w64 ile helper derlenebilir:

```bash
x86_64-w64-mingw32-gcc -Wall -Wextra -Werror -O2 \
  -o client/bin/xtp-tun-helper.exe client/native/xtp-tun-win.c \
  -lws2_32 -liphlpapi -lole32 -lfwpuclnt -ladvapi32 -static -static-libgcc
```

Resmî [Wintun dağıtımından](https://www.wintun.net/) AMD64 `wintun.dll` ve dağıtım lisanslarını edinin. Binary bütünlüğü ve dağıtım hakları yayın öncesi kontrol edilir; depoda rastgele DLL tutulmaz. `scripts/compile-win-tun.sh` indirme ve derlemeyi otomatikleştirir, eksik araçları kurmaya çalışabilir; çalıştırmadan önce okuyun.

```bash
npm run build:win --prefix client
```

Windows NSIS paketlemesi tercihen Windows makinesinde yapılır. Linux çapraz paketlemede Wine gerekebilir. Wintun kullanmak WireGuard protokolü kullanmak değildir. Installer WireGuard MSI kurmaz. Helper veya DLL eksikse `beforePack` doğrulaması paketlemeyi durdurur.

## Dağıtım kuralları

- Genel pakete `config.json`, `.env`, token, PEM/key dosyaları ve loglar konmaz. Hazır bağlantılı özel paket, açıkça seçilen katılım anahtarını içerir ve GitHub'a yüklenmez.
- `development/` ve test sunucuları istemci paketinde yoktur.
- Helper binary'leri kaynaktan yeniden derlenmeli; eski `client/bin` çıktısına güvenilmemeli.
- Her iki platformda gerçek temiz kurulum/kaldırma, bağlantı ve kesinti testleri gerekir.
- Üretim binary'leri imzalanmalı; SHA-256 özetleri, sürüm notu ve kullanılan kaynak commit'i release'e eklenmeli.
- Kaynak deponun kök lisans seçimi henüz belirlenmemiştir; bir lisans varsayılıp eklenmedi.

## Bağımlılık güvenliği

Bağımlılık sürümleri kilit dosyalarında tutulur; denetim ve güncelleme işleri [geliştirme planında](GELISTIRME-PLANI.md) izlenir. Kilit dosyasını kullanın; audit fix --force ile eski bir paketleyiciye dönmeyin.

## Parola ve yönetici onayı

Linux deb paketi kurulum sırasında yardımcıları da kurar; uygulamada ayrı kurulum adımı yoktur. AppImage/kaynak çalıştırmada ilk bağlantı bu hazırlığı yapar. İlk yardımcı kurulumu ile bağlantı yetkisi ayrı işlemler olduğundan ilk kullanımda iki onay görülebilir. Ağ koruması onayı, dar kapsamlı TUN eylemini polkit `imply` ile kapsar; geçici onay geçerliyken aynı bağlantının ikinci TUN parolası hedeflenmez. Süre ve tekrar isteme davranışını sistemin polkit ilkesi belirler; kalıcı parolasız root yetkisi verilmez. Gerçek masaüstünde doğrulanmalıdır.

Windows paketi yönetici kurulumu ve uygulama açılışında UAC kullanır; ayrı “Korumayı kur” akışı yoktur. Linux'ta üretilen NSIS paketi gerçek Windows testi yerine geçmez. NSIS çapraz derleme araçları Türkçe harf dönüşümünden etkilenebildiği için derleme çocuk süreçleri `C.UTF-8` yerel ayarıyla çalışır; Unicode proje yolları korunur.
