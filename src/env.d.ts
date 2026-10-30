/// <reference types="svelte" />
/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __EJS_RUNTIME__: { dataPath: string; script: string; style: string; buildId: string };

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}
