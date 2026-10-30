<script lang="ts">
  import Icon from './Icon.svelte';
  import { router } from '../lib/router.svelte.ts';

  const tabs = [
    { href: '#/', label: 'Ana ekran', icon: 'home', match: ['home'] },
    { href: '#/library', label: 'Kütüphane', icon: 'grid', match: ['library', 'game'] },
    { href: '#/import', label: 'Oyun ekle', icon: 'plus', match: ['import'] },
    { href: '#/settings', label: 'Ayarlar', icon: 'sliders', match: ['settings', 'help'] }
  ];
</script>

<nav class="bottom-nav" aria-label="Ana menü">
  {#each tabs as tab (tab.href)}
    {@const current = tab.match.includes(router.route.name)}
    <a href={tab.href} aria-current={current ? 'page' : undefined} data-nav-tab={tab.match[0]}>
      <Icon name={tab.icon} size={24} />
      <span>{tab.label}</span>
      <i aria-hidden="true"></i>
    </a>
  {/each}
</nav>

<style>
  .bottom-nav {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 50; height: var(--nav-h);
    padding: 6px 12px max(var(--safe-b), 12px);
    display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
    background: rgba(11, 12, 15, 0.94); border-top: 1px solid var(--line-faint);
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  }
  a { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: var(--text-3); text-decoration: none; font-size: 12px; font-weight: 600; border-radius: var(--r); }
  a[aria-current='page'] { color: var(--text); }
  i { width: 4px; height: 4px; border-radius: 1px; }
  a[aria-current='page'] i { background: var(--accent); }
  @media (min-width: 960px) { .bottom-nav { display: none; } }
</style>
