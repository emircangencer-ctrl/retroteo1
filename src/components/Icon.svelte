<script lang="ts" module>
  // Line icons from the approved design (24×24 grid, 1.8 stroke).
  interface Shape { t: 'circle' | 'rect'; cx?: number; cy?: number; r?: number; x?: number; y?: number; width?: number; height?: number; rx?: number }
  const PATHS: Record<string, { d: string; fill?: boolean; cap?: boolean; join?: boolean; shapes?: Shape[] }> = {
    home: { d: 'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z', join: true },
    grid: { d: '', shapes: [{ t: 'rect', x: 4, y: 4, width: 7, height: 7, rx: 1.5 }, { t: 'rect', x: 13, y: 4, width: 7, height: 7, rx: 1.5 }, { t: 'rect', x: 4, y: 13, width: 7, height: 7, rx: 1.5 }, { t: 'rect', x: 13, y: 13, width: 7, height: 7, rx: 1.5 }] },
    list: { d: 'M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1', cap: true },
    plus: { d: 'M12 5v14M5 12h14', cap: true },
    sliders: { d: 'M4 7h10M18 7h2M4 17h4M12 17h8', cap: true, shapes: [{ t: 'circle', cx: 16, cy: 7, r: 2 }, { t: 'circle', cx: 10, cy: 17, r: 2 }] },
    search: { d: 'M20 20l-4.5-4.5', cap: true, shapes: [{ t: 'circle', cx: 11, cy: 11, r: 6 }] },
    heart: { d: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z', join: true },
    'heart-fill': { d: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z', fill: true },
    more: { d: '', fill: true, shapes: [{ t: 'circle', cx: 5, cy: 12, r: 1.6 }, { t: 'circle', cx: 12, cy: 12, r: 1.6 }, { t: 'circle', cx: 19, cy: 12, r: 1.6 }] },
    back: { d: 'M15 6l-6 6 6 6', cap: true, join: true },
    chevron: { d: 'M9 6l6 6-6 6', cap: true },
    close: { d: 'M6 6l12 12M18 6L6 18', cap: true },
    play: { d: 'M8 5v14l11-7z', fill: true },
    pause: { d: 'M9 6v12M15 6v12', cap: true },
    download: { d: 'M12 4v11M7 10l5 5 5-5M5 20h14', cap: true, join: true },
    upload: { d: 'M12 20V9M7 14l5-5 5 5M5 4h14', cap: true, join: true },
    save: { d: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6', cap: true, join: true },
    load: { d: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4', cap: true, join: true },
    slots: { d: 'M7 3h10', join: true, shapes: [{ t: 'rect', x: 4, y: 6, width: 16, height: 12, rx: 2 }] },
    monitor: { d: 'M9 21h6M12 17v4', cap: true, shapes: [{ t: 'rect', x: 3, y: 5, width: 18, height: 12, rx: 2 }] },
    gamepad: { d: 'M6 9h12a3 3 0 0 1 3 3l-.6 4a2.5 2.5 0 0 1-4.4 1.2L14.5 15h-5L8 17.2A2.5 2.5 0 0 1 3.6 16L3 12a3 3 0 0 1 3-3zM8 11v3M6.5 12.5h3', cap: true, join: true },
    exit: { d: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10', cap: true, join: true },
    trash: { d: 'M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13', cap: true, join: true },
    file: { d: 'M7 3h7l5 5v13H7zM14 3v5h5', join: true },
    folder: { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', join: true },
    cloud: { d: 'M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z', join: true },
    check: { d: 'M5 12.5l4.5 4.5L19 7.5', cap: true, join: true },
    warn: { d: 'M12 4l9 16H3zM12 10v4M12 17v.5', cap: true, join: true },
    sort: { d: 'M7 5v14M4 16l3 3 3-3M17 19V5M14 8l3-3 3 3', cap: true, join: true },
    clock: { d: 'M12 8v4l3 2', cap: true, shapes: [{ t: 'circle', cx: 12, cy: 12, r: 8 }] },
    info: { d: 'M12 11v5M12 8v.5', cap: true, shapes: [{ t: 'circle', cx: 12, cy: 12, r: 8.5 }] },
    fullscreen: { d: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', cap: true, join: true },
    volume: { d: 'M4 10v4h4l5 4V6L8 10zM16 9.5a3.5 3.5 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10', cap: true, join: true },
    refresh: { d: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4', cap: true, join: true },
    gauge: { d: 'M12 14l4-4M5.5 18a8 8 0 1 1 13 0', cap: true, join: true },
    chip: { d: 'M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3', cap: true, shapes: [{ t: 'rect', x: 6, y: 6, width: 12, height: 12, rx: 2 }] },
    help: { d: 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17v.5', cap: true, join: true, shapes: [{ t: 'circle', cx: 12, cy: 12, r: 8.5 }] },
    storage: { d: 'M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3', join: true },
    restart: { d: 'M4 4v6h6M4.6 15a8 8 0 1 0 1.8-8.4L4 9', cap: true, join: true }
  };
</script>

<script lang="ts">
  interface Props { name: string; size?: number; stroke?: number; class?: string; title?: string }
  let { name, size = 20, stroke = 1.8, class: className = '', title = '' }: Props = $props();
  const icon = $derived(PATHS[name] || PATHS.info);
</script>

<svg
  class={`icon ${className}`}
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={icon.fill ? 'currentColor' : 'none'}
  stroke={icon.fill ? 'none' : 'currentColor'}
  stroke-width={stroke}
  stroke-linecap={icon.cap ? 'round' : undefined}
  stroke-linejoin={icon.join ? 'round' : undefined}
  aria-hidden={title ? undefined : 'true'}
  role={title ? 'img' : undefined}
  focusable="false"
>
  {#if title}<title>{title}</title>{/if}
  {#if icon.d}<path d={icon.d} />{/if}
  {#each icon.shapes || [] as shape, i (i)}
    {#if shape.t === 'circle'}<circle cx={shape.cx} cy={shape.cy} r={shape.r} />{:else}<rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} />{/if}
  {/each}
</svg>

<style>
  .icon { flex: none; display: block; }
</style>
