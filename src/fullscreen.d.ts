export function fullscreenElement(documentLike?: Document): Element | null;
export function isFullscreen(documentLike?: Document, element?: Element | null): boolean;
export function enterFullscreen(element: Element | null, documentLike?: Document): Promise<{ supported: boolean; entered: boolean; error?: unknown }>;
export function leaveFullscreen(documentLike?: Document): Promise<{ supported: boolean; exited: boolean; error?: unknown }>;
