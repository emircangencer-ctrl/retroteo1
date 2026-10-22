# Stage 05 — test report

## Passed locally

- `node --test tests/*.test.mjs`: ROM validator unit tests pass.
- `node --check src/app.js` and `node --check src/nes-rom.js`: syntax pass.
- HTML and package/configuration files are present; Vite entry imports the local stylesheet and JSNES API.
- The player UI wires `NesBrowser` load/start/destroy, pause/resume, keyboard/gamepad support supplied by JSNES, and pointer-driven touch controls.
- The service worker cache name is bumped to `retroplay-shell-v5`.

## Not verified in this environment

The container cannot resolve `registry.npmjs.org` (DNS `EAI_AGAIN`), so `npm install`, the Vite production bundle, and live emulation could not be executed here. Netlify's build is configured to install the pinned JSNES dependency and Vite before publishing. Do not call this a fully end-to-end verified release until the Netlify build and at least one real `.nes` ROM are tested in desktop and Android browsers.

## Scope

Actual emulation is connected for NES `.nes` files only. Other platforms remain unsupported for gameplay. Save-state and SRAM UI are future work.


## Stage 06 ZIP import tests (2026-10-20)

- ZIP containing a valid `.nes` and an unrelated text file: PASS.
- Invalid/non-ZIP input: PASS (readable rejection).
- ZIP with no supported ROM entries: PASS (readable rejection).
- Multiple supported ROM entries: PASS.
- Corrupt ZIP payload/CRC mismatch: PASS (rejected).
- `node --test tests/*.test.mjs`: 13 tests passed.
- JavaScript syntax checks for `app.js`, `nes-rom.js`, and `zip-rom.js`: PASS.
- Live Netlify/browser test after deploying this revision: NOT YET RUN.
- Deflate compression in a real browser and mobile Safari: NOT YET verified live.

## Stage 07 — EmulatorJS migration validation (2026-10-22)

- Latest app and technical-documentation commit validated by CI: `267ce3af632978bf9d5f254a99e6dcdee57a759f`.
- GitHub Actions CI passed: https://github.com/emircangencer-ctrl/retroteo1/actions/runs/39758230246. Syntax checks, unit tests, production bundle build, and output-artifact checks all passed.
- Added a regression test verifying that when the emulator iframe receives keyboard focus, arrow-key press and release are forwarded to the emulator input adapter.
- Netlify Deploy Preview: https://deploy-preview-2--retroteo1.netlify.app. Netlify confirmed that commit `267ce3af632978bf9d5f254a99e6dcdee57a759f` was deployed successfully; deploy log: https://app.netlify.com/projects/retroteo1/deploys/6ad9dbde2e5a2a68f3cbf446.
- **Not verified:** no real commercial ROM was launched by this CI run; no screenshot comparison, gameplay timing measurement, or Android device test has been performed. SMB3 graphics and original SMB speed remain open acceptance checks.
- **Known trade-offs:** the default EmulatorJS/FCEUmm runtime is fetched from the official stable CDN, so first launch needs network access and offline playback is not guaranteed. EmulatorJS is GPL-3.0 licensed; distribution implications need review before public release.


## Stage 08 — shared EmulatorJS player for NES, SNES and Mega Drive (2026-10-22)

- Added `src/emulator-systems.js` as a registry for each playable system's ROM extensions, EmulatorJS system ID, and touch-controller layout.
- Generalized the player bootstrap to accept the documented EmulatorJS system IDs `nes`, `snes`, and `segaMD`; the existing `EmulatorJsNesPlayer` export remains as a backward-compatible wrapper for tests/callers.
- Wired `.sfc/.smc` to SNES and `.md/.gen` to Sega Mega Drive; N64/arcade items remain library-only. Unknown `.bin` files are not automatically mapped to a console.
- Added expanded SNES/Mega Drive touch layouts and keyboard shortcuts; updated UI copy and changed the service-worker cache version to v8 so the updated app shell is not confused with a stale cache.
- Updated the offline status to make clear that caching the app shell does not mean the CDN-hosted EmulatorJS runtime is available offline.
- CI passed on `20efd8c14cd388a8dc03eb1c1a757b9437e56d41`: syntax checks, unit tests and production bundle build. Run: https://github.com/emircangencer-ctrl/retroteo1/actions/runs/39807143207
- Netlify Deploy Preview reports the branch head is ready: https://deploy-preview-2--retroteo1.netlify.app
- **Not proven by CI:** real SNES/Mega Drive ROM playback, frame accuracy, real-time speed/audio, mobile device performance, SRAM persistence, save states, and fully offline launch. Test each real-ROM/system path before merging or promoting to production.


## Stage 09 — targeted EmulatorJS runtime caching (2026-10-22)

- The service worker now uses a separate `retroplay-emulatorjs-runtime-v1` cache for requests from `https://cdn.emulatorjs.org/stable/data/` only; unrelated third-party requests remain outside this policy.
- Runtime resources use cache-first behavior after the first successful fetch. The runtime cache is retained when the app-shell cache is replaced.
- Added `tests/service-worker-offline.test.mjs` to verify that a previously cached EmulatorJS loader response is returned with the network disabled, and that unrelated CDN paths/hosts are not intercepted.
- **Not proven:** the unit test emulates service-worker behavior; it does not prove that every browser routes the srcdoc iframe's real EmulatorJS resources through the service worker, nor that every system core will be cached reliably under mobile-browser storage limits.
- A browser-level offline pass remains required: launch each system once while online, confirm its runtime/core resources were cached, disable network entirely, reopen the app and verify gameplay. For systems whose core has not been downloaded, first launch still requires a connection.


## Stage 10 — EmulatorJS SRAM/battery-save backup foundation (2026-10-22)

- Migrated IndexedDB schema from version 1 to 2 without replacing or rebuilding the existing `games` object store; created a separate `batterySaves` store keyed by the existing local game ID.
- Added a stable numeric EmulatorJS game ID derived from platform plus ROM content hash (or the persisted local game ID when a content hash is unavailable), so EmulatorJS can keep per-game saves distinct.
- Wired the documented `EJS_onSaveUpdate` callback and configured `EJS_fixedSaveInterval = 15000` so the runtime can flush changed save data and signal changes. SRAM/battery-save bytes are copied into the parent page and mirrored locally as a typed byte array with hash, platform/system, ROM identity, length and timestamp metadata.
- Added tests for stable game IDs, byte-buffer copying/range handling, empty saves, callback bootstrap configuration, transfer of save buffers, and ignoring save messages from other iframes.
- **Scope limit:** this is a secondary local mirror only; there is no save-file export/import, restoring the mirrored copy into EmulatorJS, cloud sync, or save-state slot UI yet. The live CDN/core save pipeline has not been tested with a game that actually writes battery-backed SRAM.


## Stage 11 — pin the EmulatorJS runtime and align offline cache (2026-10-22)

- Changed the runtime URL from the moving `stable` alias to the versioned CDN path `https://cdn.emulatorjs.org/4.2.3/data/`. The official CDN documentation distinguishes `stable` (which changes on releases) from version-specific paths; this avoids an unreviewed core/runtime change from a CDN alias update.
- Aligned the service worker to cache only `/4.2.3/data/`, moved its runtime cache generation to `retroplay-emulatorjs-runtime-v2`, and the app shell to `retroplay-shell-v10`.
- Service-worker activation removes older RetroPlay shell caches and older EmulatorJS runtime-cache generations, so the previous mutable `stable` cache is not retained as a conflicting fallback.
- Added regression assertions that the generated player bootstrap and service worker use the same pinned release.
- CI passed for the runtime/cache pin: https://github.com/emircangencer-ctrl/retroteo1/actions/runs/39813074899 (syntax checks, unit tests, production build and output checks).
- **Still unproven:** the cache test is a simulated Service Worker test, not browser-level proof of offline playback; multi-system real-ROM behavior and Android controls still require a real-device acceptance pass.


## Stage 12 — export per-game SRAM backups (2026-10-22)

- Game cards now show **SRAM yedeği indir** when EmulatorJS has emitted and RetroPlay has stored battery-backed save data for that game.
- The action exports a raw `.srm` file from the local IndexedDB copy. It does not upload the data.
- Removing a game removes its associated mirrored SRAM record in the same IndexedDB transaction. The deletion confirmation explicitly warns that the SRAM backup will also be removed.
- **Scope limit:** importing an `.srm` into the running emulator remains unimplemented; save-state slots and cross-device sync are also not provided. The callback and file-export path still need real core validation with a game that changes battery-backed SRAM.
- CI passed on commit `bd2e512e69fad681f80dd7c380bb02887d141a2a`: https://github.com/emircangencer-ctrl/retroteo1/actions/runs/39813569467. Syntax checks, unit tests, production build and output checks succeeded.
- **Still unproven:** live SRAM generation/export in a browser; SNES and Mega Drive real-ROM compatibility; complete offline playback on physical browsers; Android touch/audio performance.
