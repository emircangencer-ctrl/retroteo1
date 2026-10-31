<script lang="ts">
  import Icon from './Icon.svelte';
  import { router } from '../lib/router.svelte.ts';
  import { library } from '../lib/library.svelte.ts';
  import { gamepadUI } from '../lib/gamepad-ui.svelte.ts';
  import { systemCounts } from '../lib/library-view.ts';
  import { systemLook } from '../lib/systems.ts';

  const route = $derived(router.route);
  const counts = $derived(systemCounts(library.games));
  const libView = $derived(route.name === 'library' || route.name === 'home' ? (route.query.fav ? 'fav' : route.query.sort === 'recent' ? 'recent' : route.query.system ? `sys:${route.query.system}` : 'all') : '');
  const items = $derived([
    { href: '#/', label: 'Kütüphane', icon: 'grid', current: route.name === 'game' || libView === 'all' || libView.startsWith('sys:') },
    { href: '#/library?fav=1', label: 'Favoriler', icon: 'heart', current: libView === 'fav' },
    { href: '#/library?sort=recent', label: 'Son oynananlar', icon: 'clock', current: libView === 'recent' },
    { href: '#/import', label: 'Oyun ekle', icon: 'plus', current: route.name === 'import' },
    { href: '#/settings', label: 'Ayarlar', icon: 'sliders', current: route.name === 'settings' || route.name === 'help' }
  ]);
</script>

<aside class="sidebar" aria-label="Kenar menüsü" data-nav-region="sidebar">
  <a class="brand" href="#/" aria-label="RetroPlay kütüphane">
    <span class="mark" aria-hidden="true"></span><span>RETROPLAY</span>
  </a>
  <nav aria-label="Ana menü" class="nav">
    {#each items as item (item.href)}
      <a href={item.href} aria-current={item.current ? 'page' : undefined}><Icon name={item.icon} size={20} />{item.label}</a>
    {/each}
  </nav>
  <section class="systems" aria-labelledby="systems-title">
    <h2 id="systems-title" class="eyebrow">Sistemler</h2>
    {#each counts as entry (entry.key)}
      {@const look = systemLook(entry.key)}
      <a href={`#/library?system=${encodeURIComponent(entry.key)}`} aria-current={libView === `sys:${entry.key}` ? 'page' : undefined}>
        <span class="dot" style:background={look.stripe} aria-hidden="true"></span><span class="grow">{look.label}</span><span class="n">{entry.count}</span>
      </a>
    {:else}
      <p class="none">Oyun ekleyince sistemler burada listelenir.</p>
    {/each}
  </section>
  <div class="pad-card tv-hide" data-state={gamepadUI.connected ? 'on' : 'off'}>
    <Icon name="gamepad" size={22} />
    <span>
      <strong>{gamepadUI.connected ? 'Gamepad bağlı' : 'Gamepad bağlı değil'}</strong>
      <small>{gamepadUI.connected ? 'Menüler gamepad ile gezilebilir' : 'USB/Bluetooth ile bağla, bir tuşa bas'}</small>
    </span>
  </div>
</aside>

<style>
  .sidebar { display: none; }
  @media (min-width: 960px) {
    .sidebar {
      position: fixed; left: 0; top: 0; bottom: 0; width: var(--sidebar-w); z-index: 40;
      display: flex; flex-direction: column; gap: 28px; padding: 28px 20px; overflow-y: auto;
      border-right: 1px solid var(--surface-3); background: var(--bg);
    }
  }
  .brand { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 8px; color: var(--text); text-decoration: none; font-stretch: 125%; font-weight: 800; font-size: 18px; letter-spacing: 0.06em; }
  .mark { width: 10px; height: 10px; border-radius: 2px; background: var(--accent); box-shadow: 0 0 12px var(--accent); }
  .nav { display: flex; flex-direction: column; gap: 2px; }
  .nav a { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 12px; border-radius: 10px; color: var(--text-2); text-decoration: none; font-weight: 600; font-size: 15px; }
  .nav a:hover { color: var(--text); background: var(--surface); }
  .nav a[aria-current='page'] { background: var(--surface-3); color: var(--text); font-weight: 700; }
  .systems { display: flex; flex-direction: column; gap: 4px; }
  .systems h2 { margin: 0 0 4px; padding: 0 12px; }
  .systems a { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 0 12px; border-radius: 10px; color: var(--text); text-decoration: none; font-size: 14px; }
  .systems a:hover, .systems a[aria-current='page'] { background: var(--surface); }
  .dot { width: 10px; height: 10px; border-radius: 2px; }
  .grow { flex: 1; }
  .n { font-family: var(--mono); font-size: 12px; color: var(--text-2); }
  .none { padding: 0 12px; font-size: 13px; color: var(--text-3); line-height: 1.5; }
  .pad-card { margin-top: auto; display: flex; align-items: center; gap: 10px; padding: 12px; border-radius: 14px; background: var(--surface); border: 1px solid var(--line-soft); color: var(--text-3); }
  .pad-card[data-state='on'] { color: var(--ok-fg); }
  .pad-card span { display: flex; flex-direction: column; gap: 2px; }
  .pad-card strong { font-size: 14px; font-weight: 600; color: var(--text); }
  .pad-card small { font-size: 12px; color: var(--text-2); }
</style>
