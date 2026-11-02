# Tam VPN trafik koruması

Bu belge v1.0.0 kaynak uygulamasını ve doğrulanan sınırları açıklar. Linux'ta gerçek paket testi izole bir ağ namespace'inde geçti. Windows kaynakları derlendi ve API koşulları incelendi; gerçek Windows doğrulaması hâlâ gerekir. [Güncel yayın durumu](GELISTIRME-PLANI.md).

## Kullanıcı davranışı

- **Bağlan:** sunucu IPv4 adresi bir kez çözülür, platform koruması kurulur ve doğrulanır. Ardından TLS/XTP bağlantısı ve TUN açılır. IPv4 tünel çıkışı yalnız TUN hazır olduğunda açılır.
- **Tünel koptu / yardımcı kapandı:** normal internet yönüne otomatik geçilmez. Kurallar Electron ve TUN süreçlerinden bağımsız kalır. Arayüz internetin kilitli olduğunu gösterir.
- **Yeniden bağlan:** aynı sunucunun önceden doğrulanan adresi ve kayıtlı bağlantı bilgileri kullanılır. Fiziksel DNS'e yeni bir istisna açılmaz. Sunucu IP'si değişmişse korumayı kaldırıp tekrar bağlanmak gerekebilir.
- **Bağlantıyı kes / İnterneti geri aç / bilinçli uygulamadan çıkış:** yalnız bu oturumun sahipli DNS/filtre/rota kayıtları temizlenir. İşlem başarısızsa başarı gösterilmez; kurtarma araçları korunur.
- **Uygulama yeniden açıldı:** önceki oturum okunur. Linux başlangıç denetimi yönetici penceresi açmadan muhafazakâr durum gösterir; **Durumu denetle** gerçek kuralları polkit ile doğrular. Kurallar doğrulanana kadar etkin koruma kesinleşmiş gibi gösterilmez.

Koruma bütün sistemin IPv4 çıkışını kapsar. Seçmeli uygulama/site özelliği bu sürüme bağlı değildir. Önceden açık bağlantılar yeni ağa taşınamayabilir; ilgili uygulama bağlantıyı yeniden kurmalıdır.

## İzin verilen kapsam

| Trafik | Davranış |
| --- | --- |
| IPv4 uygulama trafiği | Etkin tünelin arayüzünden çıkabilir; diğer fiziksel çıkışlar engellenir |
| DNS UDP/TCP 53 | Linux'ta hedef ve gerekirse kaynak NAT ile 1.1.1.1'e tünelden yönlendirilir; Windows'ta sahipli NRPT kuralı ve fiziksel çıkış filtresi kullanılır |
| DoH/DoT ve diğer uygulama protokolleri | IPv4 ise normal tünel kapsamındadır; doğrudan fiziksel çıkış izni yoktur |
| IPv6 | Dış çıkış engellenir; IPv6 tüneli uygulanmadı |
| Loopback | Yerel süreçlerin iletişimi için korunur; yerel resolver'ın fiziksel çıkışı ayrıca filtrelenir |
| VPN sunucusunun XTP/API TCP portları | Aynı IPv4 sunucuda TLS bağlantıları için dar istisna; API ve XTP aynı hostname kullanmalıdır |
| LAN ve multicast | Özel izin yoktur; fiziksel doğrudan çıkış engellenir |
| DHCPv4 yenilemesi | Yalnız UDP yerel 68 → uzak 67; Linux'ta root/bilinen sistem DHCP UID'leri, Windows'ta broadcast ve işletim sisteminin bildirdiği DHCP sunucuları ile sınırlandırılır |

DNS resolver seçimi şu an 1.1.1.1'dir. Bu, DNS'in istemci ile VPN sunucusu arasındaki tünelden taşınmasıdır; VPN sunucusundan resolver'a ayrı şifreli DNS protokolü eklenmiş değildir. Windows'ta mevcut daha özel NRPT/kurumsal ilkeler öncelik alabilir; fiziksel engel sızıntıyı durdururken isim çözümlemesini kullanılamaz hale getirebilir. Bu durum gerçek cihaz testine dahildir.

## Linux uygulaması

- Root sahipli `/usr/local/libexec/xantum/network-protection-linux.py`; izole Python, shell çağırmadan sabit `nft`/`ip` komutları, doğrulanmış argümanlar.
- `inet xantum_v1` adlı özel nftables tablosu; oturum tokenı/UID ile sahiplik doğrulama. Başka tablolar temizlenmez.
- DNS DNAT, yeniden rota kararı ve source NAT tamamlandıktan sonra POSTROUTING'de gerçek çıkış arayüzü denetlenir. Mevcut fiziksel bağlantılar için geniş established/related istisnası yoktur.
- `/run/xantum-protection/state.json`: root yazabilir, normal kullanıcı okuyabilir; endpoint/port, sahiplik ve kural parmak izi içerir, PIN içermez. `flock` eşzamanlı değişimleri sıralar.
- Kural değişimi nft transaction'ı ile atomiktir. Journal önce yazılır; arada süreç kapanırsa durum doğrulanmamış/kilitli kalır.
- Sunucu host rotası `proto 186`, metrik1 ve tam gateway/dev ile takip edilir. Kurtarma yalnız kaydedilmiş ve hâlâ eşleşen rotayı kaldırır.
- Yardımcı yolları ve tüm üst dizinler root sahipli, sembolik bağlantı olmayan ve normal kullanıcı tarafından yazılamayan dizinler olmalıdır. Polkit `auth_admin_keep` yönetici izni sağlar; Electron root çalışmaz.

Kaynaktan/AppImage kullanımında `sudo bash client/native/install-linux-helpers.sh` bir kez kurulum yapar. Debian paketinde yardımcı/polkit kurulum ve kaldırma kancaları bulunur. Bu kancaların temiz hedef dağıtımda doğrulanması gerekir.

## Windows uygulaması

- Wintun adaptörü; ağ koruması için ayrı `--protect` komutları aynı native yardımcıda bulunur.
- Kendi persistent WFP provider/sublayer'ı: IPv4/IPv6 outbound packet ve transport katmanları. Paket katmanı önceden kurulmuş fiziksel akışların da filtreden kaçmasını engeller.
- İzin kuralları soft permit'tir; başka firewall blokları zorla geçersiz kılınmaz. Tünel arayüzü LUID ve atanmış adresle kontrol edilir.
- DNS Client üzerinden oturuma özel rastgele işaretli NRPT kuralı eklenir. Yalnız o kayıt kaldırılır; kullanıcının adaptör DNS ayarları topluca değiştirilmez.
- Sahip SID, endpoint/port ve rota kayıtları WFP provider state içinde tutulur. Aynı isimli ama farklı sahipli kayıtlar değiştirilmez. Kaynak API doğrulaması derlenmiş olması kadar gereklidir; WFP/NRPT runtime testi ayrıca yapılır.

## Kurtarma

Önce uygulamayı açıp **Durumu denetle** ve **İnterneti geri aç** kullan. Uygulama açılamıyorsa Linux'ta aynı masaüstü kullanıcısıyla kurulu helper çağrılabilir:

```bash
pkexec /usr/local/libexec/xantum/network-protection-linux.py status
pkexec /usr/local/libexec/xantum/network-protection-linux.py release
```

Windows'ta yönetici terminalinde kurulu `resources/bin/xtp-tun-helper.exe --protect status` ve `--protect release` komutları kullanılabilir. Kayıt başka kullanıcıya aitse hata döner; aynı kullanıcı/yönetici hesabı ve sahiplik bilgisiyle kurtarılmalıdır. İşletim sistemi firewall'unu topluca kapatmayın.

Linux kuralları ve journal `/run` içeriği yeniden başlatmada kalmaz. Windows WFP/NRPT kayıtları persistent'tir; sistem yeniden başladığında da kurtarma gerekir. Bu sürüm açılıştan itibaren koruma sağlayan ayrı bir servis içermez; reboot davranışları eşdeğer değildir. Beklenmedik uygulama/helper kapanışında koruma kalması bu kapsamdan ayrıdır.

## Tekrarlanabilir doğrulama

```bash
npm test --prefix client
python3 tests/network_protection_netns.py
```

İkinci test kendi user/network namespace'ini açar ve asıl network namespace'inde çalışmayı reddeder. Sanal bağlantılarda gerçek IPv4/IPv6, TCP port istisnası, DNS DNAT+SNAT, önceden açılmış trafik, tünel silinmesi, kural parmak izi, restart ve bilinçli kaldırma kontrol edilir. Host firewall/DNS/rota ayarları değiştirilmez. Kernel user namespace, nftables ve raw socket desteği gerekir.

Gerçek VPS üzerinden throughput, farklı Linux masaüstü ağ yöneticileri, Windows WFP/NRPT, DHCP yenilemesi, uyku/uyanma, temiz kurulum/kaldırma ve fiziksel arayüzde packet capture hâlâ yayın matrisinde ölçülmelidir.
