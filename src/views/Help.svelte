<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { router } from '../lib/router.svelte.ts';

  const cards = [
    { n: '01', title: 'Oyun ekle', text: 'Oyun ekle → Dosya seç ya da Klasör tara. Her dosyanın ne olduğu önce listelenir: oynatılabilir, uyarılı ya da eklenmeyecek. Onaylayınca eklenir. Yalnızca sahip olduğun veya kullanma hakkın olan dosyaları ekle; dosyalar bu cihazda kalır.' },
    { n: '02', title: 'Desteklenen dosyalar', text: 'NES (.nes), Super Nintendo (.sfc/.smc), Mega Drive (.md/.gen ve SEGA başlıklı .bin), içinde ROM olan .zip dosyaları ve arcade setleri (.zip; FinalBurn Neo v1.0.0.03, FB Alpha 2012 CPS2 veya MAME 2003-Plus sürümü; Tekken 3, Tekken Tag, Soul Calibur gibi Namco System 12 oyunları güncel MAME 2003-Plus ile, sesli ve tam hızda). Neo Geo oyunları için neogeo.zip gerekir. Bir dosyanın eklenmesi her oyunun kusursuz çalışacağı anlamına gelmez.' },
    { n: '03', title: 'Kayıtlar', text: 'Oyunun kendi kaydı (SRAM) 30 saniyede bir, duraklatınca, arka plana geçince ve çıkışta yedeklenir. Oyundan çıkınca kaldığın an "devam noktası" olarak saklanır; oyun sayfasında "Baştan başla" da seçebilirsin. Menüden 3 yuvaya resmiyle kaydedebilirsin.' },
    { n: '04', title: 'Dokunmatik tuşlar', text: 'Telefonda her konsolun kendi kolu çıkar: NES B·A, Super Nintendo X·Y·A·B ve L·R, Mega Drive A·B·C ile X·Y·Z, arcade düğme paneli, Neo Geo A·B·C·D. Yön tuşunda parmağını kaldırmadan 8 yöne kaydırabilirsin; iki düğmenin arasına basınca ikisi birden basılır. Boyut, saydamlık, titreşim, 4/8 yön ve çapraz basma: oyunda ☰ → Kontroller ve oyuncular.' },
    { n: '05', title: 'Kontrolcü (gamepad)', text: 'USB veya Bluetooth kontrolcüyü bağla ve bir tuşa bas: düğmeler konumlarına göre eşlenir (alt = B, sağ = A, sol = Y, üst = X), sol çubuk yön tuşu gibi çalışır. Oyun menüsü: ortadaki ana düğme ya da Select + Start birlikte. Menülerde ve kütüphanede de kontrolcüyle gezersin: A seç, B geri, X favori, Y ayrıntılar, L/R sistem.' },
    { n: '06', title: 'Klavye', text: 'Ok tuşları yön, Z/X/A/S/Q/W oyun düğmeleri (oyun açıkken ekranın altında hangisinin ne olduğu yazar). Start: Enter ya da 1. Select: Sağ Shift, 5, V veya Sağ Ctrl. Arcade oyunlarda 5 jeton atar, 1 başlatır; üst çubukta Jeton ve Başla düğmeleri de var. Esc oyun menüsünü açar. Kütüphanede Ctrl+K arama kutusuna gider.' },
    { n: '07', title: 'Birden çok oyuncu', text: 'Her kumanda ayrı bir oyuncudur: ilk tuşuna basılan 1. oyuncu, sonraki 2. oyuncu olur (NES, Super Nintendo ve Mega Drive’da 2 oyuncu; arcade’de kabinin oyuncu sayısı kadar, en çok 4). Dokunmatik tuşlar ve klavye 1. oyuncudur. Oyunda ☰ → Kontroller ve oyuncular’dan her kontrolün kaçıncı oyuncu olacağını seçersin; telefonda dokunmatikle bir arkadaşın kumandayla oynayacaksa kumandayı 2 yap. Arcade’de her oyuncu kendi kumandasında Select ile jeton atar, Start ile başlar; klavyede 2. oyuncu 2 ile başlar, 6 ile jeton atar. Televizyonda iki Bluetooth kumanda bağlaman yeter.' },
    { n: '08', title: 'Çevrimdışı ve güncelleme', text: 'İlk açılıştan sonra uygulama ve emülatör çekirdekleri cihaza kaydedilir; oyunlar internetsiz açılır. Yeni sürüm hazır olunca oyun bitene kadar beklenir ve "Yenile" önerilir.' },
    { n: '09', title: 'Verini yedekle', text: 'Tarayıcı verileri temizlenebilir veya alan daralınca silinebilir. Ayarlar → Yedek al ile oyun listeni, oyun sayfalarından ROM ve kayıt dosyalarını indirip ayrıca sakla.' },
    { n: '10', title: 'Google TV / Android TV', text: 'RetroPlay TV uygulaması (Ayarlar → Google TV / Android TV) siteyi televizyonda tam ekran açar. Kumandanın yön tuşlarıyla gezersin, OK seçer, Geri bir önceki ekrana döner; oyunda Geri menüyü açar. Oyunları Oyun ekle → Telefondan gönder ile eklersin: telefonda QR kodu tara, 4 haneli kodu gir, dosyaları seç. Oynamak için Bluetooth kontrolcü önerilir.' }
  ];
</script>

<div class="page help" id="view-help">
  <header class="page-head">
    <div class="titles left">
      <button type="button" class="icon-btn" aria-label="Geri" onclick={() => router.back('settings')}><Icon name="back" size={22} /></button>
      <h1 class="display-title small">Nasıl çalışır?</h1>
    </div>
  </header>
  <div class="grid">
    {#each cards as card (card.n)}
      <article class="card"><span class="n">{card.n}</span><h2>{card.title}</h2><p>{card.text}</p></article>
    {/each}
  </div>
</div>

<style>
  .left { gap: 12px; align-items: center; }
  .display-title.small { font-size: 22px; }
  .grid { display: grid; gap: 10px; }
  .card { padding: 16px; border-radius: var(--r-lg); background: var(--surface); border: 1px solid var(--line-soft); display: flex; flex-direction: column; gap: 6px; }
  .n { font-family: var(--mono); font-size: 12px; font-weight: 600; color: var(--accent); letter-spacing: 0.1em; }
  h2 { font-size: 16px; font-weight: 700; }
  p { font-size: 14px; line-height: 1.55; color: var(--text-2); }
  @media (min-width: 760px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
