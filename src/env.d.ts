/// <reference types="svelte" />
/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
/** Changes with the cover lists in public/assets/covers (see src/lib/cover-art.svelte.ts). */
declare const __COVER_LISTS__: string;
declare const __EJS_RUNTIME__: { dataPath: string; script: string; style: string; buildId: string };

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}
