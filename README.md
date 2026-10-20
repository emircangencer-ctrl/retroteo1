# RetroPlay — Stage 06 (ZIP ROM import + NES emulation)

RetroPlay is a static PWA intended for Netlify. This stage supports importing ROM files from standard ZIP archives (stored and deflate compression) and integrates the JSNES 2.1.0 browser emulator for `.nes` files only. ZIP archives are unpacked in memory; supported ROM entries are imported individually into the local library. SNES, Mega Drive, N64 and arcade entries remain library-only; they are not emulated yet.

## Local development

Requires Node.js 20+ and internet access for the first dependency install.

```bash
npm install
npm run dev
```

For a production build:

```bash
npm run test
npm run check
npm run build
npm run preview
```

Vite outputs the deployable static site to `dist/`. Netlify is configured to run `npm install && npm run build` and publish `dist`. Use a Git-connected Netlify deployment so Netlify can install the dependency and build the site; uploading this source ZIP directly as a prebuilt static folder will not run the build command.

## Playing a game

1. Open RetroPlay on HTTPS (or localhost for development).
2. Import a `.nes` ROM file you own or are authorized to use.
3. In the game card, press **Oyna**.
4. Use keyboard controls (arrows, Z/X, Enter, Right Ctrl), a compatible gamepad, or the on-screen touch controls.
5. Use pause or exit in the player window.

ROMs stay in the browser's local IndexedDB. The app does not download or distribute commercial ROMs. A valid iNES header does not guarantee mapper or game compatibility. JSNES supports many but not all NES titles and ROM variants.

## Offline behavior

The service worker caches the built application shell and same-origin assets as they are fetched. Install the PWA while online first. If JSNES requests a separately emitted asset (such as an audio worklet) during the first play session, open one NES game while online once so the runtime can cache that asset for later offline use.

## Known limitations

- Only `.nes` files are currently wired to an emulator.
- The local execution environment used to prepare this archive had DNS/network access blocked, so `npm install` and a complete Vite production build could not be run here. Netlify must successfully install `jsnes@2.1.0` and Vite during its build. The JavaScript syntax, ROM validator tests, configuration shape and archive are checked locally, but a live Netlify/Android/browser end-to-end test remains required.
- Save states and battery-backed SRAM persistence are not yet connected to the UI.
- Game compatibility varies by mapper and ROM format.

## License notices

JSNES is licensed under Apache-2.0. Its license and copyright notices are available from the upstream project: https://github.com/bfirsh/jsnes. The dependency is installed from the published `jsnes@2.1.0` npm package at build time; this project does not bundle a modified copy of the emulator source.

## ZIP import behavior

- Accepts ordinary, non-encrypted ZIP archives; extracts supported ROM entries in memory without uploading them to a server.
- Supports ZIP methods 0 (stored) and 8 (deflate), verifies CRC-32 and declared uncompressed size, and limits archives to 1,000 entries, 256 MiB per ROM, and 512 MiB total expanded ROM data.
- ZIP64, multi-volume archives, encrypted archives, unsupported compression methods, and nested ZIPs are not supported. If the browser does not support `DecompressionStream('deflate-raw')`, use a current browser or extract the ROM file before importing.
- Only `.nes` files can be played in this version. Other supported ROM types can be added to the library but are not emulated yet.
