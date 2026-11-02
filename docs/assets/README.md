# README görselleri

Banner, gezinme düğmeleri ve mimari şemalar Xantum için özgün SVG olarak hazırlanır. Koyu lacivert yüzeyler, turkuaz ve mor vurgular masaüstü uygulamasının paletini izler. SVG dosyaları script, dış resim veya uzak font isteği içermez. Banner ve düğme başlıkları, sistemler arasında aynı görünüm için Montserrat harf konturlarını kullanır.

README, dar ekranlarda `picture` üzerinden kompakt banner ve dikey akış şemasını gösterir. Görsellerin erişilebilir metinleri hem SVG başlık/açıklamalarında hem README `alt` alanlarında bulunur. Düğmelerin gerçek bağlantıları README'deki `<a>` etiketleridir; SVG içindeki JavaScript veya bağlantılara bağlı değildir.

## Yeniden üretme

`generate.py` yalnızca belge görsellerini üretir; uygulamanın çalışma veya derleme bağımlılığı değildir. Python 3, Pango'nun `pango-view` aracı ve Montserrat fontları bulunan bir sistemde:

```bash
python3 docs/assets/generate.py
```

Metin veya renk değişikliklerini betikte yap, ardından üretilen SVG'leri README içinde masaüstü ve dar ekranda kontrol et. Ana palette `#070b14`, `#0d1526`, `#3ecfcf`, `#6c63ff`, `#f0f4ff` kullanılır. Montserrat, SIL Open Font License ile dağıtılan Julieta Ulanovsky ve katkıcılarının yazı tipidir; font dosyaları bu depoya eklenmez.
