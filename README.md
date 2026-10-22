# RetroPlay — Stage 07 (NES core replacement / compatibility)

RetroPlay is a static PWA intended for Netlify. It imports standard ZIP archives locally and can play `.nes` files. The default NES player uses EmulatorJS with the FCEUmm Libretro core, loaded from the official stable EmulatorJS CDN inside a dedicated iframe. This replaces per-game JSNES mapper patches as the primary compatibility strategy. Legacy JSNES (`?nescore=jsnes`) and `@nesjs/core` (`?nescore=nesjs`) remain available only for A/B comparison. This is a compatibility test stage, not a claim that every NES title is now accurate.

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

The install step retains the version-guarded JSNES MMC3 patch only for the optional legacy comparison engine. The default EmulatorJS runtime and FCEUmm core are fetched from `https://cdn.emulatorjs.org/stable/data/` and cached by EmulatorJS in browser storage after the first online load. Initial use of a new core requires an internet connection.

Vite outputs the deployable static site to `dist/`. Netlify is configured to run `npm install && npm run build` and publish `dist`. Use a Git-connected Netlify deployment so Netlify can install the dependencies and build the site; uploading this source ZIP directly as a prebuilt static folder will not run the build command.

## Playing a game

1. Open RetroPlay on HTTPS (or localhost for development).
2. Import a `.nes` ROM file you own or are authorized to use.
3. In the game card, press **Oyna**.
4. Use the arrow keys, Z/X, Enter, Right Ctrl, a compatible gamepad, or the on-screen touch controls.
5. Use pause or exit in the player window.

The default uses JSNES. To compare the newer engine for the same locally stored ROM, open the preview with `?nescore=nesjs`. Remove that query parameter to return to the faster JSNES path.

ROMs stay in the browser's local IndexedDB. The app does not download or distribute commercial ROMs. A valid iNES/NES 2.0 header does not guarantee that a game dump, mapper, or PPU behavior is compatible. The new core publishes a broader mapper list, but the target games must still be visually tested on real ROMs.

## Offline behavior

The service worker caches the built application shell and same-origin assets as they are fetched. Install the PWA while online first. EmulatorJS downloads and caches its core binaries on first use. Test offline play only after the EmulatorJS runtime and FCEUmm core have successfully started at least once while online.

## Verification status

- CI runs dependency installation, syntax checks, unit tests, and the Vite production build.
- The test suite includes a synthetic mapper-4/NES 2.0 cartridge smoke test that checks ROM loading and a complete 256×240 RGBA frame, plus touch-button normalization and the JSNES patch guard.
- **Automated tests are not a substitute for visual validation.** The current PR remains a draft until the user-owned Batman Returns ROM and several unrelated games are compared in the Netlify preview on desktop and mobile. Nothing in this branch has been merged into the production site.
- Only `.nes` files are currently wired to an emulator. Save states and battery-backed SRAM persistence are not yet connected to the player UI. Other platforms can be added to the library but are not emulated.

## Third-party notices

The production bundle uses `jsnes` (Apache-2.0) by default and retains `@nesjs/core` (MIT) for comparison. License texts are included in [THIRD-PARTY-NOTICES.txt](./public/THIRD-PARTY-NOTICES.txt) and served at `/THIRD-PARTY-NOTICES.txt`.

## ZIP import behavior

- Accepts ordinary, non-encrypted ZIP archives; extracts supported ROM entries in memory without uploading them to a server.
- Supports ZIP methods 0 (stored) and 8 (deflate), verifies CRC-32 and declared uncompressed size, and limits archives to 1,000 entries, 256 MiB per ROM, and 512 MiB total expanded ROM data.
- ZIP64, multi-volume archives, encrypted archives, unsupported compression methods, and nested ZIPs are not supported. If the browser does not support `DecompressionStream('deflate-raw')`, use a current browser or extract the ROM file before importing.


## EmulatorJS licensing and network behavior

RetroPlay loads EmulatorJS as a separately hosted runtime from the official stable CDN; it does not copy the EmulatorJS runtime into this repository. EmulatorJS is GPL-3.0 licensed: https://github.com/EmulatorJS/EmulatorJS. Review the licensing implications for your distribution before publishing. The emulator downloads the FCEUmm core when a NES game is first opened; this first launch therefore needs network access. ROM bytes are passed to the runtime through a local Blob URL and are not uploaded to a ROM hosting service by this integration.
