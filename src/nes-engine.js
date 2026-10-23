// EmulatorJS is the default NES engine; RetroPlay's default NES core is Nestopia.
// FCEUmm is selected explicitly by ?nescore=fceumm for controlled A/B comparison.
// Legacy JavaScript engines remain available only for A/B diagnosis.
export function resolveNesCore(search = '') {
  const requested = new URLSearchParams(search).get('nescore');
  if (requested === 'jsnes' || requested === 'nesjs') return requested;
  return 'emulatorjs';
}
