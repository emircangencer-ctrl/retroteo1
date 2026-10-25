# RetroPlay — multi-system EmulatorJS rollout

RetroPlay is a static PWA intended for Netlify. ROM files are imported into the browser's local IndexedDB; the application does not upload ROM bytes to a game-hosting service. In this branch, gameplay is wired through a shared EmulatorJS player for:

| System | Accepted gameplay extensions | EmulatorJS system ID | Default core |
|---|---|---|---|
| NES | `.nes` | `nes` | Nestopia (FCEUmm only via explicit `?nescore=fceumm` comparison) |
| SNES | `.sfc`, `.smc` | `snes` | Snes9x |
| Sega Mega Drive / Genesis | `.md`, `.gen`, `.bin` (only with a SEGA header) | `segaMD` | Genesis Plus GX |

The system registry is in `src/emulator-systems.js`. It defines platform identity, supported extensions, EmulatorJS system IDs and per-system touch-button layouts. The player runtime is shared; per-platform configuration selects the system ID and controller layout. SNES and Mega Drive integration is a newly wired path and still needs real-ROM validation across representative games and devices before it should be considered release-ready. EmulatorJS is pinned to version `4.2.3` instead of the moving `stable` alias, so a CDN update cannot silently change gameplay behavior; upgrade it deliberately after regression tests.

N64, CPS1, CPS2 and Neo Geo can appear in the library, but their gameplay emulators are not wired in this branch. Extension support in the import dialog alone does not imply that a file can be played. A `.bin` file is assigned to Mega Drive only when its header carries the `SEGA` system name at offset `0x100` (`src/rom-detect.js`); other `.bin` files stay unassigned because the extension is ambiguous.

## Local development

Requires Node.js 20+ and internet access for dependency installation.

```bash
npm install
npm run dev
```

Production verification:

```bash
npm run check
npm test
npm run build
npm run preview
```

Netlify runs `npm install`, `npm run check`, `npm test`, and `npm run build` in sequence (Node.js 20) before publishing `dist/`. Use a Git-connected Netlify deployment so the verification pipeline runs; uploading this source tree as already-built static files skips those checks.

## Playing games

1. Open RetroPlay on HTTPS (or localhost).
2. Import a local ROM file, or a ZIP containing supported ROM files.
3. Choose **Oyna** on a supported game card.
4. Use the arrow keys and keyboard buttons shown in the player, or the per-system touch layout.
5. For a USB/Bluetooth controller, launch a supported game and open the visible EmulatorJS gamepad button to review or remap controller inputs. RetroPlay sets the matching control scheme for NES, SNES, or Mega Drive. Actual hardware compatibility still needs a desktop/mobile acceptance test; controller layouts can vary by device and browser.
7. Use **⛶ Tam ekran** in the player toolbar to expand the game and controls to the screen. Press **Esc** or the same button to leave fullscreen. On browsers that do not expose the Fullscreen API, RetroPlay uses an expanded immersive layout; browser chrome may remain visible.
6. The player also shows whether the browser currently detects a controller. If it does not appear, connect it, press a button once, and choose **Yeniden tara**. This status is a browser-level detection check only; it does not replace testing actual in-game buttons. For the hands-on check, follow [`docs/gamepad-acceptance-checklist.md`](docs/gamepad-acceptance-checklist.md).

On NES, append `?nescore=jsnes` to compare the legacy JSNES player or `?nescore=nesjs` to compare `@nesjs/core`; remove the parameter to use the default EmulatorJS system. Those diagnostic routes apply to NES only.

For files whose name identifies Super Mario Bros. 3, RetroPlay checks the PRG+CHR payload against known clean retail fingerprints. A recognized clean profile starts directly (Nestopia). An unknown fingerprint (typically a ROM hack) or an unverifiable NES 2.0 image is never started silently: before any emulator is created, the player explains that graphics may differ and asks **Yine de oyna / Vazgeç**; the choice is remembered for that game. There is no automatic FCEUmm fallback. This check is filename-scoped and will be replaced by a general hash-based game identity layer. No emulator can repair corrupted or intentionally changed game data.

ROMs remain in local browser storage. Use only ROM files you own or are authorized to use. A recognized header or accepted extension is not proof that a game dump is complete or compatible.

## Offline behavior and its current limit

The service worker caches the app shell and same-origin assets. It now also keeps a separate, cache-first store for requests under the pinned EmulatorJS `4.2.3/data/` path on `cdn.emulatorjs.org`. Other cross-origin requests are not intercepted. Once a runtime file or a system core has been fetched successfully while online, a later request may be served from the runtime cache when offline; each system's core must have been downloaded at least once.

**Treat this as an offline improvement, not yet as a guaranteed offline release.** The current cache test simulates the worker and network failure, but it does not prove that every browser sends EmulatorJS iframe requests through the worker, that every runtime asset is cacheable, or that storage quota is sufficient. A first launch of a system whose core is not cached still requires a connection.

The runtime and service-worker cache now both target EmulatorJS `4.2.3`; the service worker removes older cache generations when activated. This reduces drift and stale-cache collisions but does not guarantee offline launch. The next hardening step is to test cold-start/offline behavior in desktop Chromium and Android Chrome (and iOS Safari if it is a target), verify the actual core/resource requests in each case, and decide whether a self-hosted runtime/core bundle is needed. Measure the required file set and size before preloading assets. Do not precache every core; it would inflate the PWA download for systems a user may never use.

## Save-data status

The app's library metadata, favorites and ROM blobs are stored in IndexedDB; an app-level JSON backup can restore library metadata, but it does not include ROM bytes. Re-importing a ROM whose content hash matches a restored metadata-only record relinks the ROM to that record (favourites, play history and saves are kept).

**Battery saves (SRAM) are owned by the app.** EmulatorJS 4.2.3 writes SRAM to its own IndexedDB only every 5 minutes and on page unload, and it does not implement `EJS_onSaveUpdate`/`EJS_fixedSaveInterval` (those exist only on EmulatorJS's unreleased `main` branch). RetroPlay therefore copies the live SRAM out of the core (`EmulatorJsPlayer.readSaveData`) when the player is paused, closed (button, Esc or back), when the page is hidden or unloaded, and every 30 seconds while playing; unchanged data is not rewritten (`src/save-sync.js`). The copy lives in the `batterySaves` store, keyed by the library record. When a game starts, an app copy that differs from what EmulatorJS loaded is written into the core and the game is soft-reset; if only EmulatorJS has a save (for example from before this change), it is adopted rather than discarded. Each game card then offers **SRAM yedeği indir**. Removing a game also removes its save record.

**Save states and resume.** Many games have no in-game save, so the player offers **Kaydet / Yükle** (a quick save state per game) in the toolbar and, in fullscreen, at the top-left. When a game is closed or the app goes to the background, RetroPlay also stores a resume point; the next launch continues from it (same core only) and shows **Baştan başla** to reset instead. States live in the `saveStates` store (IndexedDB version 3; the upgrade only adds this store) and are removed with the game. Library cards show **Devam et** when a resume point exists.

Not implemented yet: multiple save slots with thumbnails, importing a `.srm` file, cross-device sync. Browser E2E tests (`e2e/`) verify battery-save capture/restore, quick save/load and resume with a self-authored test cartridge; real-device validation on Android is still required.

## Automated verification and release guardrails

GitHub Actions runs dependency installation, JavaScript syntax checks, unit tests and the Vite production build, then a browser E2E job (`e2e/`) that runs the production build in Chromium with the real EmulatorJS 4.2.3 runtime served locally from its npm packages. The E2E suite uses self-authored test cartridges only and covers save capture/restore, non-fatal runtime warnings, back-button and backdrop behavior, backup relinking and Mega Drive `.bin` detection. It does not compare commercial game frames; real-device acceptance remains manual.

Run it locally: `npm run build`, then `cd e2e && npm install && npx playwright install chromium && npm test`.

Before the multi-system branch is marked release-ready, test at least one known-good local ROM per system on desktop and Android Chrome, verify audio and pause/resume, and test close/reopen. The prior NES reports of graphics and speed issues should remain part of this regression pass. Do not claim visual accuracy based on a successful build alone.

## Licensing and upstream references

- EmulatorJS is GPL-3.0 licensed and loaded from its official CDN: https://github.com/EmulatorJS/EmulatorJS. Review the licensing implications before distributing the app.
- [EmulatorJS CDN configuration](https://emulatorjs.org/docs/cdn/)
- [EmulatorJS options and documented save callbacks](https://emulatorjs.org/docs/options/)
- [NES system details](https://emulatorjs.org/docs/getting-started/)
- [SNES system details](https://emulatorjs.org/docs/systems/snes/)
- [Sega Mega Drive system details](https://emulatorjs.org/docs/systems/sega-mega-drive/)

## Import and backup hardening

- The NES preflight reads only the 16-byte iNES header and validates it against the original file size.
- JSON library backups are type-checked with bounded strings and valid hexadecimal cover colors; duplicate IDs and IDs reserved for sample cards are rejected. Cover colors are sanitized at render time as well, protecting older IndexedDB records.
- Platform and emulator registries use own-property checks so metadata such as `__proto__` and `constructor` cannot masquerade as supported systems.
- The PWA shell uses a new cache generation, refreshes `index.html` when installing the worker, and uses content-hashed Vite assets to reduce stale-bundle collisions. The pinned EmulatorJS runtime cache is versioned separately.

## ZIP import behavior

- Accepts ordinary non-encrypted ZIP archives and extracts supported ROM entries in memory without uploading them.
- Supports ZIP methods 0 (stored) and 8 (deflate); checks end-of-central-directory and directory bounds; compares local and central file names, CRCs and sizes; and verifies CRC-32. Decompression is streamed into a bounded buffer so a forged uncompressed-size field cannot trigger unbounded output allocation. Limits: 512 MiB compressed archive, 1,000 entries, 256 MiB per ROM, 512 MiB total expanded ROM data.
- ZIP64, multi-volume, encrypted archives, unsupported compression methods and nested ZIPs are not supported. If the browser lacks `DecompressionStream('deflate-raw')`, use a current browser or extract the ROM first.

## Optional Google Drive game archive

Google Drive support is opt-in. To enable it on a personal Netlify deployment:

1. In Google Cloud Console, create/select a project, enable **Google Drive API**, and configure the OAuth consent screen.
2. Create an OAuth client ID of type **Web application**. Add the exact RetroPlay Netlify domain under **Authorized JavaScript origins** (also add your local development origin if needed). Do not create or place a client secret in the frontend.
3. Add the build environment variable `VITE_GOOGLE_CLIENT_ID` in Netlify and trigger a new deploy. The value is the OAuth **client ID**, not a client secret.
4. If the consent screen is in testing mode, add the Google account you will use as a test user.
5. Open **Oyun ekle → Google Drive arşivin → Drive'a bağlan**. Authorize read-only Drive access, navigate folders, and select a supported ROM or ZIP. Only the selected file is downloaded into this browser's local library.

The integration requests the read-only `drive.readonly` scope. Google may require consent-screen verification for an app offered to the public; for personal use, keep the app restricted to your account/test users. Access tokens remain in memory and are not written to local storage. ROM data is fetched directly from Google Drive to the browser; RetroPlay does not relay ROMs through its server. Large downloads still consume device memory/storage and network data. Files are not available offline until downloaded into the local library.

## Performance notes

The initial page no longer eagerly imports the legacy NES diagnostic engines; those are dynamically loaded only when the corresponding diagnostic route is selected. Library search is scheduled to the next animation frame and updates only the library result area rather than rebuilding every view for every keystroke. These changes reduce avoidable startup and interaction work, but actual speed improvements must be measured on representative low-end mobile devices and with a large library. Do not treat a passing build as a Lighthouse or real-device performance result.


Large game grids are rendered in pages of 48 cards. Search and sort update only the library result grid, while off-screen game cards use browser content-visibility where supported. Use the “Daha fazla göster” controls to progressively render more library, favorite, and recent-game cards instead of building thousands of card nodes at once.
