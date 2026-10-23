export function inspectGamepads(navigatorLike = globalThis.navigator) {
  if (!navigatorLike || typeof navigatorLike.getGamepads !== 'function') {
    return { state: 'unsupported', supported: false, connected: [] };
  }

  let pads;
  try {
    pads = navigatorLike.getGamepads.call(navigatorLike);
  } catch {
    return { state: 'unavailable', supported: true, connected: [] };
  }

  const connected = Array.from(pads || [])
    .filter(pad => pad && pad.connected === true)
    .map(pad => ({
      index: Number.isInteger(pad.index) && pad.index >= 0 ? pad.index : -1,
      id: typeof pad.id === 'string' ? pad.id.trim().slice(0, 80) : '',
      mapping: pad.mapping === 'standard' ? 'standard' : 'custom'
    }));

  return {
    state: connected.length ? 'connected' : 'disconnected',
    supported: true,
    connected
  };
}

export function describeGamepads(status) {
  if (!status || status.state === 'unsupported') {
    return 'Gamepad API algılanamadı. Emülatör menüsündeki kontrolcü ayarını yine de deneyebilirsin.';
  }
  if (status.state === 'unavailable') {
    return 'Gamepad durumu okunamadı. Yeniden tara.';
  }
  if (!Array.isArray(status.connected) || status.connected.length === 0) {
    return 'Gamepad algılanmadı · USB/Bluetooth ile bağla, bir tuşa bas ve yeniden tara.';
  }

  const names = status.connected
    .slice(0, 2)
    .map((pad, index) => {
      const name = String(pad.id || '').trim();
      return name || `Gamepad ${pad.index >= 0 ? pad.index + 1 : index + 1}`;
    });
  const extra = status.connected.length > names.length
    ? ` +${status.connected.length - names.length}`
    : '';
  return `Gamepad bağlı (${status.connected.length}) · ${names.join(', ')}${extra}`;
}
