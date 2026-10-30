<script lang="ts">
  // A QR code drawn as one SVG path (sharp at any size, no canvas).
  import qrcode from 'qrcode-generator';

  interface Props { text: string; size?: number; label?: string }
  let { text, size = 168, label = '' }: Props = $props();

  const code = $derived.by(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { n: n + 8, d };
  });
</script>

<svg class="qr" width={size} height={size} viewBox={`0 0 ${code.n} ${code.n}`} role="img" aria-label={label || text} shape-rendering="crispEdges">
  <rect width={code.n} height={code.n} fill="#fff" />
  <path d={code.d} fill="#0B0C0F" />
</svg>

<style>
  .qr { display: block; border-radius: 12px; }
</style>
