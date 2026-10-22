export function fullscreenElement(documentLike = globalThis.document) {
  return documentLike?.fullscreenElement || documentLike?.webkitFullscreenElement || null;
}

export function isFullscreen(documentLike = globalThis.document, element = null) {
  const active = fullscreenElement(documentLike);
  return Boolean(active && (!element || active === element));
}

export async function enterFullscreen(element, documentLike = globalThis.document) {
  if (!element) return { supported: false, entered: false };
  const request = element.requestFullscreen || element.webkitRequestFullscreen;
  if (typeof request !== 'function') return { supported: false, entered: false };
  try {
    await request.call(element);
    return { supported: true, entered: isFullscreen(documentLike, element) };
  } catch (error) {
    return { supported: true, entered: false, error };
  }
}

export async function leaveFullscreen(documentLike = globalThis.document) {
  const exit = documentLike?.exitFullscreen || documentLike?.webkitExitFullscreen;
  if (typeof exit !== 'function' || !fullscreenElement(documentLike)) {
    return { supported: typeof exit === 'function', exited: !fullscreenElement(documentLike) };
  }
  try {
    await exit.call(documentLike);
    return { supported: true, exited: !fullscreenElement(documentLike) };
  } catch (error) {
    return { supported: true, exited: false, error };
  }
}
