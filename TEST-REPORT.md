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


## Stage 13 — preserve multi-system gameplay while applying import/PWA hardening (2026-10-22)

- Continued from the existing shared EmulatorJS branch rather than the NES-only `main` baseline. NES, SNES and Mega Drive registry entries, per-system input layouts, EmulatorJS runtime pin `4.2.3`, the NES diagnostic engines, and the SRAM/battery-save path were preserved.
- NES import preflight now reads just the 16-byte header and checks it against the original file size.
- ZIP extraction now caps compressed archive size, expanded output per entry and overall expansion; streams deflate output into a bounded buffer; validates EOCD and central-directory bounds; compares local and central filenames, CRC and size fields; and verifies CRC-32. Table-driven CRC32 reduces CPU work on large ROM entries.
- Library backup restore now validates bounded metadata strings/types/colors, rejects duplicate and demo-reserved IDs, and sanitizes cover colors again during rendering for older IndexedDB records. Platform/emulator registry lookups use own-property checks to reject inherited keys such as `__proto__` and `constructor`.
- Removed the unsupported `.7z` extension from file pickers. Vite uses content-hashed asset names; HTML is revalidated; the app-shell cache was bumped to `retroplay-shell-v11` and EmulatorJS runtime cache to `retroplay-emulatorjs-runtime-v3` without changing the pinned runtime release.
- Netlify's build command now runs `npm install && npm run check && npm test && npm run build` on Node.js 20 before publishing `dist`.
- **Automated checks passed on source commit `4f80a17`: 65/65 tests passed, JavaScript syntax check passed, production build passed, and CI output-artifact checks passed. Netlify Deploy Preview was ready for the same revision.**
- Preview: https://deploy-preview-2--retroteo1.netlify.app.
- **Still not verified by automation:** launch and play actual NES, SNES and Mega Drive ROMs in desktop/mobile browsers; test controls, audio, pause/resume, SRAM writing/export, and offline relaunch after caching each system core. Keep the multi-system PR as a draft until these acceptance checks pass.

## Stage 14 — expose controller mapping in the multi-system player (2026-10-22)

- The player explicitly sets EmulatorJS control schemes per active system: `nes`, `snes`, and `segaMD`; the EmulatorJS interface language is set to Turkish.
- Made the EmulatorJS gamepad/controller-mapping toolbar control visible. The unrelated toolbar controls remain hidden and RetroPlay's own touch controls remain in use.
- Added regression coverage confirming that all three supported systems retain the correct control scheme and expose the gamepad-mapping control.
- GitHub Actions passed on code/test commit `2d955496d20be038a6049bd62bc2108b2cbb07fe`: syntax checks, 66/66 unit tests, production build, and output-artifact checks. The later documentation-only commit `5afd3acb11b59d61bb1e21dd7f0dd8c4399041d3` also passed CI.
- **Still unverified:** physical USB/Bluetooth controller connection, real button input and remapping behavior in a live browser. EmulatorJS provides the gamepad functionality, but RetroPlay should not be declared hardware-tested until a real controller has been tried on desktop and Android Chrome.

## Stage 15 — browser-level gamepad detection status (2026-10-22)

- Added `src/gamepad-status.js` to safely read the browser Gamepad API, ignore disconnected/empty slots, bound controller IDs and format user-facing Turkish status text.
- Added a live controller status row to the player. It refreshes on connect/disconnect, window focus, return to the visible tab, and the user's **Yeniden tara** action.
- The status makes a deliberate distinction between a browser-detected controller and a controller that has not been detected. It does **not** claim a controller can control a game simply because the browser reports it.
- Added unit tests for unsupported APIs, permission/API exceptions, empty/disconnected slots, multiple controllers and bounded IDs. Added the new module to the syntax-check pipeline.
- **Acceptance still required:** test a real USB/Bluetooth controller in desktop Chrome and Android Chrome, including directional input, action buttons, remapping, disconnect/reconnect, and close/reopen. Browser-level status and EmulatorJS config tests cannot simulate a physical controller.

- GitHub Actions passed on code/test commit `4e8334a5d7bfa61b306c4e548d799f6f341b5285`: syntax checks, **70/70 unit tests**, production build and output-artifact checks. The following acceptance-checklist/README/report changes are documentation-only.
  
## Stage 16 — real-device gamepad acceptance checklist (2026-10-22)

- Added `docs/gamepad-acceptance-checklist.md` with per-system NES/SNES/Mega Drive test rows for D-pad, analog stick, action inputs, Start/Select, key release, pause/resume, close/reopen, disconnect/reconnect, audio, speed and graphics.
- The checklist separates browser detection from actual in-game inputs and records device/browser/controller model so any failure can be reproduced.
- Linked the checklist from the README.
- **No real-device tests were run by adding this checklist.** Until someone completes it on hardware, physical controller support remains pending acceptance.

## Stage 17 — fullscreen gameplay controls (2026-10-22)

- Added a visible **Tam ekran** button to the shared player, which expands the whole game/player surface so the game image and controls remain available.
- Added standard and WebKit-prefixed Fullscreen API helpers with readable failure handling; browser fullscreen-change events update the button and trigger the emulator's resize/fit hook.
- Escape is intended to leave native fullscreen before closing the game. The toolbar also exposes a direct exit-fullscreen action.
- Added an immersive viewport-sized fallback for browsers without a Fullscreen API. It expands the player but may not hide browser chrome; this is explicitly communicated to the user.
- Added responsive fullscreen styling, safe-area padding for mobile devices, compact landscape controls, and tests for API support/failure paths and UI/resize wiring.
- **Still requires real-browser acceptance:** confirm native fullscreen, game image scaling, Escape behavior, touch controls, and return-to-normal layout on desktop Chrome and Android Chrome. iOS Safari may use the expanded fallback depending on its Fullscreen API support.


## Stage 18 — startup and large-library performance pass (2026-10-22)

- Legacy NES diagnostic engines (`jsnes`, `nes-engine.js`, and `nes-core-player.js`) are dynamically imported only when their diagnostic route is selected, rather than statically loading those paths at app startup.
- Library search now schedules rendering through `requestAnimationFrame` and updates only the library results instead of rebuilding every view for each keystroke.
- Library, favorites and recent-game grids render in pages of 48 cards. The user can progressively reveal more results; off-screen cards use `content-visibility: auto` where supported.
- Latest successful CI run: https://github.com/emircangencer-ctrl/retroteo1/actions/runs/39844564505. **86/86 tests passed**, syntax checks passed, production build passed, and output-artifact checks passed.
- Build output for the tested revision: main app JS chunk 136.94 kB (32.43 kB gzip), CSS 31.22 kB (7.61 kB gzip). These are build artifact sizes only; no Lighthouse run or real-device timing benchmark has been performed.
- **Still required:** profile on an actual low-end Android device with a large library; compare LCP/INP and memory before claiming a measured speed improvement.

## Stage 19 — optional Google Drive read-only archive (2026-10-22)

- Added `src/google-drive.js` for Google Identity Services token requests, read-only Drive folder listing with pagination, and authenticated file downloads.
- The import dialog now includes a Drive browser with folder navigation, supported ROM/ZIP filtering, file-size guardrails, and a selected-file download that feeds the existing validated local import path.
- OAuth tokens are held in memory only; no token is written to localStorage, sessionStorage, or IndexedDB. ROM bytes download directly from Google Drive into the browser and are then stored in the local library.
- Added tests for OAuth scope/token handling, Drive listing fields/pagination, download behavior, error cases, and performance regression guards.
- **Requires configuration before it can connect:** set Netlify build environment variable `VITE_GOOGLE_CLIENT_ID`, enable Google Drive API in a Google Cloud project, configure a Web OAuth client with the exact Netlify origin, and add the intended account as a test user while the consent screen is in testing mode. The app requests `drive.readonly`; public release may require Google verification.
- Latest code/test commit: `69343f6b28b800a190be6f5f8b52b772b596bcc8`. CI passed 86/86 tests and Netlify Deploy Preview is ready: https://deploy-preview-2--retroteo1.netlify.app.
- **Not yet tested live:** OAuth consent, actual Drive folder visibility, download of a real user-owned ROM, quota/large-file behavior, and importing/playing the downloaded ROM. This feature must not be called fully operational until OAuth is configured and these flows pass in a browser.


## Stage 20 — Google OAuth popup reliability review (2026-10-22)

- The Google Identity Services script is preloaded only when `VITE_GOOGLE_CLIENT_ID` is configured. The Drive connect button stays disabled until the library is ready, preventing the first click from being consumed by an asynchronous script load.
- The token request is now initiated directly in the user's click handler before awaiting its result, reducing the risk that browser popup protections block Google's authorization flow.
- Fixed an extra comma in the local import file-picker extension list.
- Regression suite checks the OAuth activation flow. Latest successful CI on code commit `30e39fa4aa51d87e7ee42de7597c1d084fa986ae`: **86/86 tests passed**, syntax checks and production build passed. The main app chunk remains 136.94 kB (32.43 kB gzip); the separate runtime chunk is 65.73 kB (22.34 kB gzip); CSS is 31.22 kB (7.61 kB gzip).
- Netlify is rebuilding the preview for this newest revision. Google OAuth and real ROM flows still require the owner to configure the client ID and test in a real browser.


## Stage 21 — bounded streaming for cloud ROM downloads (2026-10-22)

- Google Drive file downloads now read the response stream in chunks and cancel as soon as the selected format's configured size cap is exceeded, rather than buffering an unbounded response before checking its size.
- The import UI passes the 256 MiB cap for single ROM files and 512 MiB for ZIP archives. This still requires adequate browser memory and storage; those caps are upper bounds, not recommended file sizes for mobile devices.
- Added a regression test for over-limit streaming. CI run https://github.com/emircangencer-ctrl/retroteo1/actions/runs/39846817226 passed; the dedicated test run https://github.com/emircangencer-ctrl/retroteo1/actions/runs/39846808900 passed.
- Latest code commit: `803a4c26399a561982388dec75086ee0fa15449c`. The Netlify Deploy Preview is rebuilding this revision. Live OAuth, Drive downloads, and gameplay still need real-browser acceptance testing after OAuth configuration.
