// Select the default engine centrally so the performance fallback stays testable.
// JSNES is the default because the current @nesjs/core software-rendering path
// is too expensive on lower-powered mobile devices. Keep the newer core opt-in
// for visual comparison until its frame pipeline is optimized.
export function resolveNesCore(search = '') {
  const params = new URLSearchParams(search);
  return params.get('nescore') === 'nesjs' ? 'nesjs' : 'jsnes';
}
