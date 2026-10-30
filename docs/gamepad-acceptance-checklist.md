# RetroPlay — Gamepad Kabul Testi

Bu liste, oyun kolu desteğini kaynak kod testlerinden ayrı olarak gerçek tarayıcı ve donanım üzerinde doğrulamak için kullanılır. **Bir ROM'un açılması veya Gamepad API'de kolun görünmesi tek başına oyunun kol ile oynanabildiğini kanıtlamaz.**

## Test ortamı

- [ ] Netlify Deploy Preview açıldı: https://deploy-preview-2--retroteo1.netlify.app
- [ ] Tarayıcı ve işletim sistemi not edildi: ____________________
- [ ] Kontrolcü modeli ve bağlantısı (USB / Bluetooth) not edildi: ____________________
- [ ] Yalnızca sahip olunan veya kullanım hakkı bulunan yerel ROM kullanıldı.

## 1. Tarayıcı kontrolcüyü görüyor mu?

1. Oyunu açmadan önce kontrolcüyü USB veya Bluetooth ile bağla.
2. RetroPlay'de desteklenen bir ROM'u başlat.
3. Oyuncu penceresindeki gamepad durumu satırını kontrol et.
4. Durum algılanmadı diyorsa kontrolcüde bir tuşa basıp **Yeniden tara** düğmesine bas.
5. Bağlantı kurulunca kontrolcü adı veya bağlı kontrolcü sayısı görünmeli.

- [ ] Kontrolcü tarayıcı tarafından algılandı.
- [ ] Çıkarıp tekrar bağladıktan sonra durum doğru güncellendi.
- [ ] API desteklenmiyorsa veya tarama hata verirse arayüz bunu açıkça gösterdi.

## 2. EmulatorJS tuş eşleştirme

1. Oyun açıkken emülatör araç çubuğundaki gamepad/kontrolcü eşleştirme düğmesini aç.
2. Gerekirse yönleri, analog çubukları ve aksiyon tuşlarını yeniden eşleştir.
3. Eşleştirme penceresini kapatıp oyuna dön.

- [ ] Eşleştirme düğmesi görünür ve açılabiliyor.
- [ ] Kontrolcü tuşları eşleştirme sırasında kaydediliyor.
- [ ] Oyuna geri dönüldüğünde eşleştirme penceresi kapanıyor ve oyun devam ediyor.

## 3. Her sistem için oyun içi girdi

Her sistemde ayrı bir ROM kullan ve ayrı ayrı işaretle:

| Kontrol | NES | SNES | Mega Drive |
|---|---|---|---|
| Yön tuşları / D-pad | [ ] | [ ] | [ ] |
| Sol analog yönleri (varsa) | [ ] | [ ] | [ ] |
| Ana aksiyon tuşları | [ ] | [ ] | [ ] |
| Start | [ ] | [ ] | [ ] |
| Select (sistemde varsa) | [ ] | [ ] | Uygulanmaz |
| Tuş bırakıldığında karakter/durum normale dönüyor | [ ] | [ ] | [ ] |
| RetroPlay Duraklat / Devam Et | [ ] | [ ] | [ ] |
| Oyundan çık ve aynı oyunu yeniden aç | [ ] | [ ] | [ ] |

## 4. İki ortamda tekrar

- [ ] Masaüstü Chrome'da yukarıdaki kontroller tamamlandı.
- [ ] Android Chrome'da yukarıdaki kontroller tamamlandı.
- [ ] Ses, oyun hızı ve görüntüde belirgin sorun gözlenmedi.
- [ ] Kontrolcü bağlantısı kesilip tekrar bağlandığında oyun takılı tuş bırakmadı.

## Hata kaydı

Sistem / ROM adı: ____________________

Tarayıcı / cihaz: ____________________

Beklenen davranış: ____________________

Gerçekte olan: ____________________

Tekrar üretme adımları: ____________________

Ekran görüntüsü veya konsol hatası (varsa): ____________________

## Kabul ölçütü

Bir sistem ancak yönler, aksiyon tuşları, Start/Select, tuş bırakma, duraklat/devam ve yeniden açma kontrolleri gerçek donanımda başarılı olduktan sonra o cihaz/tarayıcı birleşimi için **test edildi** olarak işaretlenmeli. Bu dosyanın kendisi testlerin yapıldığını göstermez.
