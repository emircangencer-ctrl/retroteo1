// Svelte action: shows a Blob in an <img> and frees its object URL when it changes or goes away.
export function blobSrc(node: HTMLImageElement, blob: Blob | null | undefined) {
  let url = '';
  const set = (next: Blob | null | undefined) => {
    if (url) URL.revokeObjectURL(url);
    url = next instanceof Blob ? URL.createObjectURL(next) : '';
    if (url) node.src = url; else node.removeAttribute('src');
  };
  set(blob);
  return {
    update: set,
    destroy() { if (url) URL.revokeObjectURL(url); url = ''; }
  };
}
