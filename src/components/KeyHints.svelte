<script lang="ts">
  // The keyboard keys for the game being played, as printed on this keyboard.
  import { keyboardLabels } from '../lib/keyboard-labels.svelte.ts';
  import type { KeyHint } from '../lib/key-hints.ts';

  interface Props { hints: KeyHint[] }
  let { hints }: Props = $props();
  $effect(() => { keyboardLabels.load(); });
  // Four direction keys are one cap: ↑↓←→ for the arrows, the letters as printed for WASD (ZQSD on AZERTY).
  const caps = (codes: string[]) => (codes.length === 4 ? [codes[0] === 'ArrowUp' ? '↑↓←→' : codes.map(code => keyboardLabels.cap(code)).join('')] : codes.map(code => keyboardLabels.cap(code)));
</script>

{#each hints as hint, i (i)}
  <span class="key-hint" data-kind={hint.kind} data-codes={hint.codes.join(' ')}>{#each caps(hint.codes) as cap}<kbd>{cap}</kbd>{/each}{#if hint.label}{` ${hint.label}`}{/if}</span>
{/each}
