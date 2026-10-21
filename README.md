# RetroPlay — Stage 06 (ZIP ROM import + NES core compatibility)

RetroPlay is a static PWA intended for Netlify. It imports standard ZIP archives locally and can play `.nes` files. The default player now uses `@nesjs/core@2.7.0`; the earlier `jsnes@2.1.0` engine is retained for side-by-side comparison with `?nescore=jsnes`. This is a compatibility test stage, not a claim that every NES title is now accurate.

SNES, Mega Drive, N64 and arcade entries remain library-only; they are not emulated yet.

## Local development

Requires Node.js 20+ and internet access for the first dependency install.

```bash
npm install
npm run dev
```

For a production build:

```bash
npm run check
npm test
npm run build
npm run preview
```

The install step applies a version-guarded compatibility patch to JSNES's MMC3 R0/R1 CHR-bank selection for the retained comparison engine. It fails closed if the pinned upstream source is different from the expected version.

Vite outputs the deployable static site to `dist/`. Netlify is configured to run `npm install && npm run build` and publish `dist`. Use a Git-connected Netlify deployment so Netlify can install the dependencies and build the site; uploading this source ZIP directly as a prebuilt static folder will not run the build command.

## Playing a game

1. Open RetroPlay on HTTPS (or localhost for development).
2. Import a `.nes` ROM file you own or are authorized to use.
3. In the game card, press **Oyna**.
4. Use the arrow keys, Z/X, Enter, Right Ctrl, a compatible gamepad, or the on-screen touch controls.
5. Use pause or exit in the player window.

To compare the two engines for the same locally stored ROM, open the deploy preview with `?nescore=jsnes`. Remove that query parameter to use the default `@nesjs/core` path.

ROMs stay in the browser's local IndexedDB. The app does not download or distribute commercial ROMs. A valid iNES/NES 2.0 header does not guarantee that a game dump, mapper, or PPU behavior is compatible. The new core publishes a broader mapper list, but the target games must still be visually tested on real ROMs.

## Offline behavior

The service worker caches the built application shell and same-origin assets as they are fetched. Install the PWA while online first. The new core's AudioWorklet is self-hosted at `/nes-audio-processor.js` and is cached after it is fetched during the first play session; open one NES game while online before expecting audio to work offline.

## Verification status

- CI runs dependency installation, syntax checks, unit tests, and the Vite production build.
- The test suite includes a synthetic mapper-4/NES 2.0 cartridge smoke test that checks ROM loading and a complete 256×240 RGBA frame, plus touch-button normalization and the JSNES patch guard.
- **Automated tests are not a substitute for visual validation.** The current PR remains a draft until the user-owned Batman Returns ROM and several unrelated games are compared in the Netlify preview on desktop and mobile. Nothing in this branch has been merged into the production site.
- Only `.nes` files are currently wired to an emulator. Save states and battery-backed SRAM persistence are not yet connected to the player UI. Other platforms can be added to the library but are not emulated.

## Third-party notices

The production bundle uses `@nesjs/core` (MIT) and retains `jsnes` (Apache-2.0) for comparison. License texts are included in [THIRD-PARTY-NOTICES.txt](./public/THIRD-PARTY-NOTICES.txt) and served at `/THIRD-PARTY-NOTICES.txt`.

## ZIP import behavior

- Accepts ordinary, non-encrypted ZIP archives; extracts supported ROM entries in memory without uploading them to a server.
- Supports ZIP methods 0 (stored) and 8 (deflate), verifies CRC-32 and declared uncompressed size, and limits archives to 1,000 entries, 256 MiB per ROM, and 512 MiB total expanded ROM data.
- ZIP64, multi-volume archives, encrypted archives, unsupported compression methods, and nested ZIPs are not supported. If the browser does not support `DecompressionStream('deflate-raw')`, use a current browser or extract the ROM file before importing.
