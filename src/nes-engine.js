// Keep engine selection explicit. EmulatorJS/FCEUmm is the primary core;
// lightweight JavaScript engines remain available only for A/B diagnosis.
export function resolveNesCore(search = '') {
  const requested = new URLSearchParams(search).get('nescore');
  if (requested === 'jsnes' || requested === 'nesjs') return requested;
  return 'emulatorjs';
}
