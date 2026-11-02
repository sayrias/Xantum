# Xantum Wiki

Kendi sunucunu kurmak, Windows/Linux istemcisini çalıştırmak ve sorunları incelemek için başlangıç noktası. **v1.0.0 geliştirme aşamasında:** güncel yayın kararı ve doğrulanmamış senaryolar [yayın kontrol belgesinde](GELISTIRME-PLANI.md) tutulur.

[← Ana sayfa](../README.md) · [Kurulum](KURULUM.md) · [Derleme](BUILDING.md) · [Mimari](SISTEM.md) · [Hata / Öneri](https://github.com/sayrias/VPN-App/issues)

## Rehberler

| Konu | İçerik |
| --- | --- |
| [Sunucu kur](KURULUM.md) | Linux VPS, TLS sertifikası, API/XTP portları, katılım anahtarı ve eski sürümden geçiş |
| [İstemci derle](BUILDING.md) | Windows x64 / Linux x64, yerel yardımcılar, Wintun ve dağıtım kuralları |
| [Mimariyi anla](SISTEM.md) | Paket aktarımı, kriptografi katmanları, sohbet, WebRTC ve uygulama yaşam döngüsü |
| [Trafik koruması](NETWORK-PROTECTION.md) | DNS/IPv6, kesintide kilit, sahipli kurtarma ve test kapsamı |
| [v1.0.0 durumunu izle](GELISTIRME-PLANI.md) | Tamamlanan düzeltmeler, test kanıtları, gerçek cihaz testleri ve yayın engelleri |
| [Seçmeli VPN laboratuvarı](../development/selective-vpn/README.md) | Ana uygulamadan ayrı deneysel politika ve TLS CONNECT prototipi |
| [Sonraki sürüm planı](../development/selective-vpn/PLAN.md) | Uygulama/site seçimi, Windows/Linux adaptörleri, aşamalar ve kabul koşulları |

## İlk bağlantı

1. Proje dizininde `bash xantum.sh` çalıştır → **1: Sunucu Kurulumu**. IP adresini ve SSH bilgilerini gir; otomatik sertifika seçeneğiyle devam et. Sertifika dosyası yolu gerekmez. [Kurulum adımları](KURULUM.md).
2. [Derleme rehberinden](BUILDING.md) işletim sistemine uygun masaüstü istemcisini hazırla.
3. Uygulamada **Ayarlar → Sunucun** bölümüne kurulum sonunda gösterilen IP adresini veya alan adını ve katılım anahtarını gir, kaydet.
4. Ana sayfadan **Bağlan** düğmesini kullan. Gerçek koruma kontrolünü [test matrisine](GELISTIRME-PLANI.md) göre tamamla.

Tarayıcı geliştirme önizlemesi VPN bağlantısı kurmaz ve Electron ayarlarını kaydetmez. Linux'ta Electron'u root olarak başlatma; gereken yetki akışını kurulum belgesinden takip et.

## Sorun giderme

### Sunucuya bağlanamıyorum

- Sunucu adresinin TLS sertifikasındaki adla eşleştiğini kontrol et. Uzak `http://` ve `ws://` bağlantıları kabul edilmez.
- Katılım anahtarını Ayarlar → Sunucun bölümünde yeniden kontrol et. Anahtarı hata kaydına yapıştırma.
- Sunucunun API ve XTP portlarına erişilebildiğini doğrula; varsayılanlar TCP 51821 ve TCP 8443.
- [Kurulum belgesindeki](KURULUM.md) `health` isteğini ve sunucu loglarını kontrol et. Sağlıklı API yanıtı tek başına VPN internet çıkışını kanıtlamaz.

### Otomatik sertifika alınamıyor

VDS sağlayıcının panelinde gelen **TCP 80** erişimi açık olmalı; sertifika doğrulaması ve sonraki yenilemeler bu portu kullanır. Mevcut Nginx varsa kurucu doğrulama dosyasını sunabilen web dizinini otomatik arar. Site dosyası sunulamıyorsa kurulum bunu açıklar; web sunucusu durdurulmaz. Alan adı kullandıysan DNS kaydı VDS'ye işaret etmeli; IP ile kurulumda alan adı gerekmez. Ayrıntılı hata ve yenileme kontrolleri [kurulum rehberinde](KURULUM.md) bulunur.

### Yerel yardımcı veya yetki hatası görüyorum

Yerel yardımcı, işletim sisteminin sanal ağ adaptörünü ve trafik korumasını yönetir. Linux'ta eksik kurulum bildirimi görünüyorsa **Korumayı kur** ile bilgisayarının yönetici onayını ver; uygulamayı sudo ile açma. Güncel AppImage yardımcıları içerir, Debian paketi sistem kurulumunda kopyalar. Kaynak alternatifi ve eksik paketler [derleme rehberinde](BUILDING.md). Windows'ta yönetici yetkisi gerekir.

### Uygulama kapandı, internet erişimi gelmiyor

Kesintide trafik koruması kuralları kalır. Xantum'u yeniden aç, **Durumu denetle** ile kontrol et; ardından yeniden bağlan veya **İnterneti geri aç** düğmesini kullan. Mevcut kuralları rastgele silmek yerine [sahipli kurtarma adımlarını](NETWORK-PROTECTION.md) takip et.

### Sohbet bağlanmıyor veya mesaj gönderilemiyor

Sunucu adresini ve katılım anahtarını kontrol et. Sohbetin çevrimiçi duruma geçmesini bekle; sunucu kapanmışsa yeniden bağlanma tamamlanmadan mesaj gönderilemez. Teslim işareti, sunucunun mesajı kabul ettiğini gösterir; alıcının okuduğunu göstermez. Mesajlar oturum içindedir ve sunucuda diske kaydedilmez.

### Ses odasına giriyorum ama karşı tarafı duyamıyorum

Mikrofon iznini, seçilen ses cihazını, ses seviyesini ve sessize alma durumunu kontrol et. Bas-konuş açıksa seçtiğin tuşu uygulama odaktayken kullan. Farklı ağlar veya CGNAT için sunucuda kendi STUN/TURN ayarın gerekebilir; [ses odası kurulumuna](KURULUM.md#ses-odası) bak. Sorunun yalnız aynı ağ dışında oluşup oluşmadığını hata kaydına ekle.

### VPN bağlı görünüyor; tüm trafiğim korunuyor mu?

Bağlantı durumu, test kanıtının yerini tutmaz. IPv4/IPv6 çıkışı, DNS, ağ kesintisi ve uygulama çökmesi için Windows ve Linux üzerinde ayrı doğrulama gerekir. Kodda uygulanan korumalar ve kalan sınırlamalar [yayın kontrol belgesinde](GELISTIRME-PLANI.md) açıklanır. Kararlı yayın kararı bu kontrollere bağlıdır.

## Sık sorulanlar

**WireGuard gerekiyor mu?** XTP bağlantısı WireGuard protokolünü veya WireGuard kurulumunu kullanmaz. Windows'ta kullanılan Wintun, sanal ağ adaptörünü sağlayan ayrı bileşendir.

**Kendi sunucumu kullanabilir miyim?** Evet. Sunucu tarafı Linux, TUN desteği, IPv4 forwarding/NAT, gerekli portlar ve doğrulanabilir TLS sertifikası ister. Aynı sunucu adresi ve katılım anahtarını istemcide kaydedersin.

**Sohbet uçtan uca şifreli mi?** Hayır. Sohbet TLS ile sunucuya taşınır ve sunucu mesaj içeriğini görebilir. Ses bağlantıları WebRTC'nin şifreli medya kanallarını kullanır.

**Sadece belirlediğim uygulamaları VPN'e alabilir miyim?** Bu hedef sonraki büyük sürüm için [ayrı laboratuvarda](../development/selective-vpn/README.md) geliştiriliyor. Mevcut uygulamada bu özellik bulunmuyor. Prototipin sınırları aynı belgede açıklanır.

**Hazır kurulum dosyasını nereden indiririm?** [GitHub Sürümler](https://github.com/sayrias/VPN-App/releases) sayfasını ve [yayın durumunu](GELISTIRME-PLANI.md) kontrol et. Henüz yayımlanmamış bir sürüm için README indirme veya kararlılık garantisi vermez.

## Yararlı bir hata kaydı

[GitHub Issues](https://github.com/sayrias/VPN-App/issues) üzerinde işletim sistemi ve mimarisini, uygulama sürümünü veya kaynak commit'ini, tekrarlama adımlarını, beklediğin sonucu ve gördüğün hata metnini paylaş. Sunucuya ait bir hata ise istemci ve sunucu sürümlerini birlikte belirt. Loglardan katılım anahtarlarını, özel anahtarları, tokenları ve kişisel bilgileri çıkar.
