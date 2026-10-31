# Stage 05 — test report

> **Current state:** Stage 27 below supersedes the historical SMB3 fallback behavior described in Stages 25–26. In the current launch policy, unknown SMB3 payload fingerprints are blocked before any emulator player is constructed. Do not treat earlier stage notes as the current launch policy.

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


## Stage 22 — immersive game view and NES core hardening (2026-10-22)

- Reworked native fullscreen and the no-Fullscreen-API fallback so the visual surface shows the game image, touch controls, and one small exit-fullscreen control. The title/header, toolbar, gamepad status, hints, and disclaimer are hidden in immersive mode.
- The emulator canvas now uses a centered 4:3 display box with pixel-preserving scaling instead of CSS forcing both width and height to 100%, which could stretch the image when the parent was not 4:3.
- The NES registry explicitly selects EmulatorJS's documented `nestopia` core while retaining the NES input scheme. Core ID and controller scheme are now independent, with a system/core allow-list to prevent mismatched configuration.
- Added regression checks for immersive fullscreen UI, aspect-ratio sizing, and the NES core/control-scheme separation.
- This is a code-level remediation, not proof that every ROM dump is valid or that every visual artifact has disappeared. Super Mario Bros. 3 has documented PPU/scroll-split visual quirks; verify the user's own ROM against a known-good dump/reference on the deployed preview. CI cannot establish real gameplay visuals without that manual check.


## Stage 23 — Super Mario Bros. 3 ROM identity diagnostics (2026-10-22)

- Added title-scoped diagnostic checks when a NES file is named `Super Mario Bros. 3` or `SMB3`: the header mapper is compared with the standard game's Mapper 4, and an iNES payload with the reference U.S. Rev-A layout is CRC-32 checked against PRG+CHR fingerprint `2E6301ED`.
- A mismatch never edits, blocks or silently replaces the user's ROM. It presents a non-blocking warning because another region/revision or a ROM hack can be legitimate; a mismatch is not conclusive proof of corruption.
- CRC-32 implementation has a canonical test vector; tests cover mapper mismatch, payload-fingerprint mismatch and avoiding unrelated file names.
- Reference profile: https://nescartdb.com/profile/view/870/super-mario-bros-3. Automated tests still cannot replace playing the user's ROM in Android/desktop browsers and comparing actual scrolling/graphics to a known-good reference.


## Stage 22 — immersive game viewport and SMB3 ROM guard (2026-10-23)

- Fullscreen requests now ask browsers to hide navigation UI where supported. If the Fullscreen API exists but rejects the request, the app switches to its visual immersive fallback instead of leaving the user in the ordinary modal.
- Immersive layout keeps the emulator iframe edge-to-edge, removes frame padding, and retains touch controls as an overlay with safe-area-aware placement.
- EmulatorJS canvas CSS now clamps the picture to a centered 4:3 viewport using dynamic viewport units and clamps overflow. The canvas is intentionally sized to the NES display aspect ratio; this is not a claim that every game's ROM/render output has been verified against original hardware.
- Super Mario Bros. 3 ROMs that do not match the known USA Rev-A fingerprint or show mapper/size anomalies now require an explicit confirmation before launch. Alternate regions/revisions and hacks can trigger this warning, so it does not automatically reject them.
- Regression tests added for fullscreen navigation UI request/fallback, immersive iframe/control layout, and the SMB3 Nestopia/4:3 configuration. Actual browser fullscreen behavior, touch controls, and gameplay still require manual acceptance on the target phone.


- Follow-up: immersive state is now sent to the isolated EmulatorJS iframe through a source-checked parent message. Emulator-owned menus/toolbars are hidden only while immersive mode is active, then restored on exit; touch controls remain in the parent overlay.


## Stage 23 — SMB3 NES 2.0 fingerprint uncertainty

- Closed a diagnostic gap: when a filename identifies Super Mario Bros. 3 but the ROM uses the NES 2.0 header format, the current diagnostic cannot safely compare its encoded payload against the USA Rev-A reference profile. It now emits a review warning rather than treating the mapper check as sufficient.
- Added a regression test that exercises the NES 2.0 path and asserts that the warning is non-blocking at the diagnostic layer. In the player UI, a review status requires explicit confirmation before game startup.
- Automated verification passed on the current change set: **97/97 tests passed, 0 failures**, JavaScript syntax checks and production build passed. CI: https://github.com/emircangencer-ctrl/retroteo1/actions/runs/39905211539. Netlify preview is ready; real ROM/browser visual acceptance is still outstanding.


- Additional fullscreen guard: if a Fullscreen API promise resolves but the browser does not actually report the player as fullscreen, the app now activates the edge-to-edge fallback instead of claiming the transition worked. A regression test covers this branch.


## Stage 24 — Diagnose the Super Mario Bros. 3 graphics incident (2026-10-23)

- The Android screenshot shows the ROM filename `Super Mario Bros. 3 (U) (PRG 1) [h2]` and computed PRG+CHR CRC-32 `7388BEBD`. This signature is not a known clean retail payload; `[h2]` is consistent with a ROM hack tag in common GoodTools-style naming. A CRC mismatch alone does not prove whether a ROM is corrupted or intentionally modified.
- Added ROM-content diagnostics that validate the header, mapper, PRG/CHR layout and the PRG+CHR CRC-32 independently of the filename. Registered known clean profiles: U.S. original `A0B0B742`, U.S. Rev-A `2E6301ED`, Japan original `E7DDFEE3`, Japan Rev-A `52E2B5E0`, and Europe/PAL `1ED5C801`. These are payload fingerprints, not checks of a file's name alone.
- Reference sources: [NES Directory — U.S. original](https://nesdir.github.io/A0B0B742_USA.html), [NesCartDB — U.S. Rev-A](https://nescartdb.com/profile/view/870/super-mario-bros-3), [NES Directory — Japan](https://nesdir.github.io/E7DDFEE3_Japan.html), [NES Directory — Europe/PAL](https://nesdir.github.io/1ED5C801_Germany.html).

## Stage 25 — SMB3 compatibility fallback and fail-closed invalid-ROM handling (2026-10-23)

- **Known payload:** a recognized clean release continues to use Nestopia as the default NES core.
- **Unknown but structurally consistent iNES payload:** when the header is valid and reports Mapper 4 plus the expected 256 KiB PRG / 128 KiB CHR layout, the app now automatically tries the alternative EmulatorJS FCEUmm core. This gives valid nonstandard revisions/hacks a chance to render correctly if the issue is core-specific. The UI explains that the ROM is not a recognized clean retail release and shows the selected compatibility core.
- **Untrustworthy structure:** unknown mapper/layout, an unverifiable NES 2.0 SMB3 image, or an invalid/truncated iNES header is blocked before the game core starts. The rejected canvas, touch controls and gamepad status are hidden; the screen/control state resets before the next game.
- No ROM is silently changed, downloaded or replaced. The FCEUmm fallback is a compatibility attempt, not proof that damaged or incompatible ROM data can be repaired.
- Regression coverage includes all five clean signatures, the screenshot's unknown `7388BEBD` value, `[h2]` tag detection, invalid mapper/size and NES 2.0 handling, the fallback decision, FCEUmm core configuration, control-scheme preservation and restoring the player surface after a rejected file.
- GitHub Actions passed on current tested head `7dafed7`: **101/101 tests passed**, syntax checks, production build and output-artifact checks passed. Run: https://github.com/emircangencer-ctrl/retroteo1/actions/runs/39911561280. Netlify status for the preview is successful. Netlify Deploy Preview reported success: https://deploy-preview-2--retroteo1.netlify.app.
- **Remaining acceptance limit:** the screenshot provided a CRC but not the ROM bytes, so the actual payload was not visually tested. The FCEUmm fallback must still be checked against the user's ROM on Android; if its graphics remain corrupted, the underlying bytes are likely incompatible/damaged and a known clean ROM is needed. PR #2 stays draft/unmerged and `main` remains unchanged.


## Stage 26 — force stale PWA shell/runtime invalidation after the SMB3 fallback fix (2026-10-23)

- Increased the app-shell cache generation from `retroplay-shell-v11` to `retroplay-shell-v12` and the EmulatorJS runtime cache from `retroplay-emulatorjs-runtime-v3` to `retroplay-emulatorjs-runtime-v4`. The service worker removes prior generations on activation, reducing the chance that a phone continues loading the pre-fallback bundle.
- Kept `public/service-worker.js` and the root `service-worker.js` byte-identical and added regression tests for both the cache bump and the app's explicit FCEUmm fallback wiring.
- GitHub Actions passed on commit `92b367e630650810af39a56342bd9e84a67b2f87`: **104/104 tests passed**, syntax checks passed, production build passed, and output-artifact checks passed. Run: https://github.com/emircangencer-ctrl/retroteo1/actions/runs/39912730590.
- Netlify Deploy Preview reported ready for the same commit: https://deploy-preview-2--retroteo1.netlify.app. PR #2 remains draft/unmerged; `main` is unchanged.
- **Visual acceptance remains open:** the supplied screenshot gives a PRG+CHR CRC (`7388BEBD`) but not the ROM bytes. CI proves the unknown-signature route selects FCEUmm and deploys the fresh app/runtime cache, but it cannot prove this specific hack/ROM payload renders correctly on the user's Android phone. A real run of the updated preview is still required to confirm the actual frame output.


## Stage 27 — fail closed on unverified SMB3 payloads (2026-10-23)

- Changed the SMB3 identity gate so only a full PRG+CHR CRC-32 match to a known clean release profile is allowed to launch. The supplied screenshot's `7388BEBD` signature is not a known clean profile and is blocked before `EmulatorJsPlayer` construction.
- Removed the automatic FCEUmm fallback for unknown-but-structurally-plausible ROMs. FCEUmm is available only as an explicit controlled A/B selection via `?nescore=fceumm`; use this with a fingerprint-matched clean SMB3 ROM so ROM integrity and emulator-core behavior can be distinguished.
- Updated ROM decision, core-selection, fullscreen and player-wiring regression tests. On code commit `99e1efc`, GitHub Actions reported success for JavaScript syntax, unit tests, production build and output-artifact checks. The overall workflow had not closed at the time this report was written; see the [Actions run](https://github.com/emircangencer-ctrl/retroteo1/actions/runs/39916950809) for its final state.
- Netlify commit status for `99e1efc` reported **Deploy Preview ready**: https://deploy-preview-2--retroteo1.netlify.app.
- **Still open:** no verified clean SMB3 ROM has been run and visually compared on the user's Android device in this session. Automated tests and successful deployment do not prove the reported black/corrupt gameplay frame is fixed. Keep PR #2 draft and do not merge to `main` before real-device acceptance.


## Stage 28 — Faz 0: save ownership, safe close, backup relink, Mega Drive fixes (2026-10-26)

Historical note: Stage 25 and Stage 26 describe an automatic FCEUmm fallback that Stage 27 removed. They are kept as history; the current behavior is documented in README.md.

- **Battery saves were being lost.** Measured with a self-authored battery-backed MMC1 test cartridge: closing the player with the app's own button left both EmulatorJS's store and the app's `batterySaves` store empty; in uninterrupted play EmulatorJS 4.2.3 first wrote SRAM at ~300 s. `EJS_onSaveUpdate`/`EJS_fixedSaveInterval` are not implemented in 4.2.3 (only on EmulatorJS's unreleased `main`), so the app's previous SRAM mirror never received data.
- **Fix:** `EmulatorJsPlayer.readSaveData/writeSaveData/restartGame` plus `src/save-sync.js`. The app copies SRAM on pause, close (button/Esc/back), page hide/unload and every 30 s, skipping unchanged data, and restores its copy into the core on launch (soft reset). An emulator-only save is adopted, never discarded.
- **False "Oturum durduruldu":** post-start runtime rejections (observed: denied screen wake lock) are now warnings; the iframe may request `screen-wake-lock`.
- **Close safety:** tapping the backdrop no longer closes a game; the player and import dialog use History API entries, so Android/browser back closes them instead of leaving the app; every close path saves first. A running game auto-pauses (and saves) when the page is hidden and resumes when it returns.
- **Backup relink:** re-importing a ROM that matches a restored metadata-only record attaches it to that record (`src/import-match.js`) instead of rejecting it as a duplicate.
- **Mega Drive:** touch A/C were swapped relative to EmulatorJS's own `segaMD` layout (A=1, C=8); fixed and tested against the layout. `.bin` files with a `SEGA` header are imported as Mega Drive (`src/rom-detect.js`).
- **Text corrections:** settings (default NES core is Nestopia), systems page and home tiles for playable systems, README and remediation doc; backup files carry the real app version (0.7.0).
- **Tests:** unit tests 122/122 locally. New browser E2E suite (`e2e/`, 7 scenarios) runs the production build with EmulatorJS 4.2.3 served from npm; 7/7 pass on this change and 0/7 on the previous commit (control run), i.e. the suite detects every fixed defect. Added as a CI job.
- **Not verified here:** real Android device behavior (save on app switch, back button in an installed PWA, wake lock). PR #2 stays draft; `main` unchanged.


## Stage 29 — save states and resume (2026-10-26)

- User report: there was no way to save during play. Battery saves only help games with their own save menus; the EmulatorJS save-state buttons were hidden by the app.
- Added `EmulatorJsPlayer.saveState/loadState/supportsStates` (host-owned copies of the core's state). The player now has **Kaydet / Yükle** (quick save state) in the toolbar and in fullscreen, with an in-player notice that stays visible in fullscreen.
- Closing a game, backgrounding the page or unloading it stores a resume point; the next launch continues from it when the core matches and offers **Baştan başla**. Library cards show **Devam et**.
- IndexedDB version 2 → 3 adds a `saveStates` store only; existing stores and records are untouched. Removing a game removes its states.
- Tests: unit 123/123. E2E 10/10, including quick save/load (the saved moment is restored after a reset) and close/reopen resume (the machine state at close is restored; "Baştan başla" resets).
- Not verified here: real Android device behavior, state size/performance on SNES and Mega Drive games.


## Stage 30 — unverified SMB3 dump: explicit consent instead of a hard block (2026-10-26)

- User report (Android, deploy preview): the user's own `Super Mario Bros. 3 (U) (PRG 1) [h2]` file (CRC32 `7388BEBD`) was refused with a long technical error, so the game could not be played or its graphics evaluated on the current Nestopia pipeline.
- Policy change: an unrecognized SMB3 payload is still never started silently, but instead of blocking, the player shows a plain explanation (not a clean copy, likely a hack, graphics may differ) with **Yine de oyna / Vazgeç**, before any emulator is created. The choice is stored on the game record (`unverifiedDumpAccepted`) and a short reminder appears after start. Declining keeps the game closed with a one-line reason.
- Disabled player buttons are now visibly disabled; the empty screen frame is hidden while the question is shown.
- Tests: unit 123/123 (wiring tests updated to the new policy, ordering before player construction still asserted). E2E 12/12, including consent → start → remembered on relaunch, and decline → no emulator.


## Stage 31 — Faz 1: self-hosted EmulatorJS, offline play, legacy engines removed (2026-10-26)

- EmulatorJS 4.2.3 and the Nestopia, FCEUmm, Snes9x, Genesis Plus GX, FinalBurn Neo and MAME 2003-Plus cores are built into `dist/emulatorjs/4.2.3/data/` from npm tarballs fetched with `npm pack` and checked against pinned sha512 integrity values. The npm runtime has no minified files; the build bundles the unmodified sources plus a small documented addition (`scripts/emulatorjs-runtime.mjs`). Build reports are shipped (without them EmulatorJS disables its core cache).
- Found while testing offline: lazily imported chunks were never precached, so an offline start failed ("Failed to fetch dynamically imported module"). The build now stamps every asset and a build ID into the service worker. Updates wait and are offered with "Yeni sürüm hazır · Yenile", never over a running game.
- Removed the duplicate root `service-worker.js` and the JSNES / `@nesjs` engines, their AudioWorklet, mapper patch and dependencies.
- E2E blocks every request to `cdn.emulatorjs.org`; 14/14 passed, including a new scenario that starts a game with the network off after one online visit. Unit 127/127. CI and Netlify Deploy Preview green.

## Stage 32 — device-pixel rendering and display modes (2026-10-26)

- Measured with a self-authored checkerboard ROM in a phone-sized view (devicePixelRatio 2.75): the canvas backing store was 329×247 (CSS pixels) and NES pixels were 2, 3, 5 or 6 screen pixels wide, some merged/lost. Cause: RetroArch sizes the canvas from `devicePixelContentBoxSize`, which arrived in CSS pixels. The core glue is patched to use CSS size × devicePixelRatio when the two disagree; RetroArch then renders at 905×679 (pixels 3–4 wide, all 256 columns present).
- Display modes: Keskin (sharp-bilinear shader, equal pixel sizes), Piksel, CRT (crt-easymode), Tam sayı (`video_scale_integer` on both axes: every pixel exactly 3×3 in the test). The canvas fills the player; RetroArch letterboxes with the core's aspect ratio. EmulatorJS's menu bar no longer covers the game.
- E2E 16/16 (device-pixel backing store, no merged columns, integer mode uniform). Unit 132/132.

## Stage 33 — performance meter (2026-10-26)

- "⏱ Performans" runs the core unthrottled for 4 s (fast-forward without limit, vsync off, muted) and reports frames per second / 60, plus the normal pace (a game following a 120 Hz screen is flagged). Results are kept on the device and listed in Settings with a copy button. In headless Chromium on the CI-class machine Nestopia ran ~295 fps unthrottled; this number says nothing about the phone.
- E2E 17/17 (result stored, fast-forward off afterwards). Unit 137/137.

## Stage 34 — arcade: FinalBurn Neo, MAME 2003-Plus, set checking, BIOS manager (2026-10-26)

- Catalogs from the DATs of the commits the EmulatorJS 4.2.3 cores were built from: FinalBurn Neo v1.0.0.03 (EmulatorJS/FBNeo `dedd04f2`, 7889 sets) and MAME 2003-Plus (`3a72dae`, 5257 sets); set names, titles, ROM sizes and CRC32s only.
- Zip import reads the central directory, matches by set name or by checksums, prefers FinalBurn Neo, reports complete / needs parent / missing files. BIOS sets go to a new `bios` store (DB v4, additive) and `neogeo.zip` is checked for `sp-s3.sp1`, `sm1.sm1`, `sfix.sfix`, `000-lo.lo` (the non-optional files in FBNeo's `d_neogeo.cpp`). BIOS and parent zips are written next to the game in the emulator.
- A core that cannot open a file is detected (RetroArch reports a zero-size state while running its own menu). Measured: FCEUmm crashes the page on synthetic ROMs with mappers 220/239/247, so the next core is offered ("FCEUmm ile dene"), not started silently.
- E2E with CRC-matched placeholder sets (zeros + four solved bytes; no game data) runs the real cores: FinalBurn Neo start, renamed zip, incomplete set, Neo Geo started after adding `neogeo.zip` from the player (both zips present in the emulator's file system, game loaded), MAME-only set, FCEUmm offer. 23/23 E2E, 148/148 unit.
- **Not verified here:** real arcade sets on the user's phone (speed, memory with ~100 MB Neo Geo sets, audio), real-device offline start and update banner. PR #2 stays draft; `main` unchanged.

## Stage 35 — CPS2 sets without their decryption key (2026-10-26)

- Reported from the phone: X-Men Vs. Street Fighter (`xmvsf`, CPS2) failed with "Çekirdek bu oyun dosyasını açamadı.. Set bu çekirdek sürümüyle uyuşmuyor (1 dosya eksik veya farklı): xmvsf.key". Every other file of the set matched; only the 20-byte CPS2 key was missing. MAME moved CPS2 keys into the ROM sets in 0.178 (2016), and both cores RetroPlay serves list the key (FinalBurn Neo `xmvsf.key` d5c07311, same in MAME 2003-Plus), so a set from an older collection cannot start in either.
- Now: import says "CPS2 şifre anahtarı eksik: xmvsf.key", the card says "Eksik set · CPS2 anahtarı yok", and starting explains the cause (absent key vs. a key with other contents, read from the zip) and the fix (same game from FinalBurn Neo 1.0.0.03 or a MAME 0.178+ set) without loading a core. Records saved by the previous build (without the new fields) get the same explanation. Importing a complete copy points at the old incomplete card. Missing files are now split into "eksik" and "farklı sürüm". The doubled full stop in arcade/ROM errors is fixed.
- No key data is shipped; tests use the published CRC only. Unit 152/152, E2E 24/24 (new: old `spf2t` set without `spf2t.key`, record rewritten to the previous format, then the complete set imported).

## Stage 36 — old CPS2 sets play without a .key: FB Alpha 2012 CPS2 (2026-10-26)

- Follow-up to Stage 35, asked for a fix that needs nothing from the user. FB Alpha 2012 CPS2 (EmulatorJS 4.2.3 core `fbalpha2012_cps2`, built from EmulatorJS/fbalpha2012_cps2 `3fb5b89`, ~1 MB) carries the CPS2 decryption keys in its source (`cps2_crpt.c`, e.g. `xmvsf`) and its sets have no `.key`. Its `xmvsf` ROM table is exactly the user's zip (19 files, same CRCs). Of its 284 sets, 253 are FinalBurn Neo's same-name set minus the key.
- Added as a third arcade core (self-hosted, integrity-pinned, cached on first use). Order: FinalBurn Neo, FB Alpha 2012 CPS2, MAME 2003-Plus. The catalog is read from `d_cps2.c` the way the core's loader reads it (CRC-based; optional/undumped ROMs not required).
- Existing library records: incomplete arcade sets are checked again on start-up and before playing when the core list changes (`checkedWith`); only the arcade metadata changes. The user's X-Men card becomes playable without re-importing ("1 arcade oyunu artık açılabiliyor").
- Found while testing: the core's loader opens a clone's parent zip even when the clone zip holds every file, and a zip with no entries makes it close the archive twice. A self-contained clone gets a stand-in parent zip holding one empty file.
- E2E (placeholder sets, real core): old `megaman2` without key imported as FB Alpha 2012 CPS2 · tam set; the same record rewritten to the previous build's format is fixed on reload and starts (game loaded, six-button pad); a self-contained `megaman2a` clone starts with the stand-in parent; `spf2t` (Europe 960529, not in FB Alpha 2012) is still explained without loading a core. Unit 155/155, E2E 26/26.
- **Not verified here:** real CPS2 sets on the phone (picture, sound, speed).

## Stage 37 — touch controls and controllers rebuilt; handheld layout (2026-10-26)

- Reported from the phone: controls hard to use, d-pad especially bad, fullscreen layout unusable. Measured on the previous build (393×873 phone view): the d-pad was four separate 48 px buttons with pointer capture on each, so the thumb could not roll between directions and there were no diagonals; in portrait the controls sat below the toolbar and gamepad card (scrolling needed); in fullscreen portrait the picture was at the top, a large empty area in the middle and 34–38 px buttons crammed at the bottom edge, A cut off at the right.
- New handheld layout on touch devices (portrait: picture edge to edge under a slim bar, pad below; landscape: picture centred at full height, pad in the side areas) and fullscreen that only hides the browser bars. Geometry in `src/touch-layout.js`, unit-tested for every pad on 5 portrait and 5 landscape sizes (phones and tablets): on screen, thumb-sized (d-pad ≥ 110 px, face buttons ≥ 40 px), no overlaps, ≥ 14 px from the edge-swipe zone, never over the picture in portrait, beside the picture in landscape when it fits, safe-area insets respected.
- Per-console pads: NES B·A; Super Nintendo diamond (colours) + L/R; Mega Drive A·B·C under X·Y·Z (Genesis Plus GX mapping); arcade 2×3 panel + JETON/START; Neo Geo A·B·C·D. FinalBurn Neo games show only the cabinet's buttons and 4-way games get a 4-way d-pad (from MAME 2003-Plus `<input>` data: Pac-Man 0 buttons/4-way, Galaga 1, 1942 2, Final Fight 3, Metal Slug 4; FinalBurn Neo's positional numbering checked in `retro_input.cpp` at `dedd04f2`; FB Alpha 2012's name-based mapping checked in its `libretro.cpp`, so its games keep the full panel).
- Input (`src/touch-controller.js`): one d-pad surface with 8 angle sectors, dead zone and hysteresis, rolling and sliding past the cross; face buttons with generous edges, slide-between and both-in-the-gap; independent fingers; short vibration per new press; 4-way, floating d-pad, size, transparency and diagonal-ease settings (persisted). Menu pauses/resumes; Android back closes the menu first.
- Controllers (`src/gamepad-input.js`): positional RetroPad mapping, stick as d-pad, hat switch, guide = menu; EmulatorJS's own gamepad loop is stopped at game start (verified: no double press); touch pad steps aside while a controller is used.
- Verified in Chromium with real multi-touch (DevTools touch events → pointer events) and a scripted Gamepad API: up → up-right → right → down-right → down without lifting, past the cross still right, second finger B, thumb between B/A = both, slide to A, release; START; vibration calls; controller A/B/stick/guide; rotation re-lays out and RetroArch re-renders at the new size; fullscreen keeps the layout. Unit 226/226, E2E 31/31.
- **Not verified here:** feel and latency on the user's phone, vibration strength, real controllers (only the browser Gamepad API was scripted).

## Stage 38 — Faz 2: new interface in Svelte 5 + TypeScript (2026-10-26)

- The approved design is implemented as a Svelte 5 + TypeScript app (vite 6, `svelte-check` with warnings as errors, Node 22.18+ so unit tests import `.ts` directly; CI and Netlify moved to Node 22). Screens: home (continue the last game with its picture, recently played, recently added), library (search, system filters, favourites, saves, four sort orders, grid/row/list, endless scroll), game page, import, settings, help. Desktop gets a sidebar and a full-window player; phones keep the handheld player from Stage 37 and every pad.
- Import shows each file before it is added: playable, flagged (unrecognised SMB3 dump, incomplete arcade set, BIOS with files missing), already in the library, chosen twice, not supported (a `.bin` without a SEGA header is explained). Folder scans include sub-folders and count the files that are not games. A zip without games now says so instead of "ZIP açılamadı".
- Saves: resume point, quick slot and three slots, each with a picture taken when the game paused (the core only draws one while running, so the picture is taken just before pausing; a menu closed in the meantime does not leave the game paused). The game page lists them, continues from any and deletes slots; saving over a filled slot asks first. Play time counts only while the game runs on screen. New fields are optional (`thumb`, `playtimeMs`, `crc32`); the database version is unchanged and no record is rewritten.
- Pause menu: top sheet on a phone held upright, side panel held sideways and on a computer; Ekran ve ses (Keskin/Piksel/Tam sayı + Yok/CRT/LCD filter, volume), Kontroller (pad settings over the picture so the pad stays visible), Tam ekran, Performansı ölç, Yeniden başlat, Oyundan çık. Esc, ☰, the guide button or Select+Start open it.
- Controller navigation of the whole interface: nearest item in the pressed direction, A/B/X/Y/L/R as documented in the README, focus kept inside dialogs and the menu, the game never sees Select+Start. With touch there is no focus ring; with keyboard or controller there is.
- Visual review in Chromium at phone (390×844, 393×873), tablet (820×1180) and desktop (1440×960) sizes. Fixed while reviewing: the player covering the app on phones (a `display` rule beat `hidden`); a page 1347 px wide on phones (screen-reader text inside scrolling rails); class collisions between components; titles upper-cased with a Turkish dotted İ ("MARİO"); the favourite heart overlapping cover titles; the pause menu header saying "Duraklatıldı" twice and letting the bar show through.
- Measured in headless Chromium (software WebGL): the performance meter gives the same result as the previous build on a phone-sized view (1081×811 canvas: 0.72 vs 0.71–0.73, alternating runs); the app's own JavaScript is under 0.1 % of the main thread while a game runs. The desktop picture is now larger (959×720 instead of 776×582 at 1280×860), which software WebGL draws much more slowly; the E2E scenario for the meter therefore runs at a window size that gives a ~800×600 picture. This says nothing about real devices.
- Bundled fonts (Archivo, IBM Plex Mono; SIL OFL 1.1) and Svelte (MIT) are listed in `THIRD-PARTY-NOTICES.txt` with their license texts in `/licenses/`. Service worker cache `retroplay-shell-v14`.
- Tests: unit 260/260 (new: formatting, routes, play clock, library views, controller navigation, core choice, import scan; display modes and controller input extended). E2E 39/39: the 31 earlier scenarios adapted to the new screens plus import review, folder scan, slots with pictures, slot delete, play time and the home screen, controller navigation with Select+Start, desktop layout with Esc, settings that are kept (accent, LCD filter, resume point off).
- **Not verified here:** anything on the user's phone or computer (layout on the real screen, touch feel, real controllers, offline start after installing, the update banner). PR #2 stays draft; `main` unchanged.

## Stage 39 — arcade coin and start on a computer (2026-10-26)

- Reported from a desktop browser: arcade games could not be started because there was no coin button. Checked on the Faz 2 build: on a computer there is no touch pad, the only coin key was Right Ctrl (shown as "Sağ Ctrl Select", nowhere called a coin; many laptops have no Right Ctrl), and V inserted a coin only while the emulator frame had focus, through EmulatorJS's own key handler. Found while checking: with the frame focused, EmulatorJS's own bindings were live as well (1/2/3 save, load and change EmulatorJS's own state slots, E = R, Tab = L2); Enter could not activate an item in the pause menu (the game took it); a key held while Ctrl went down stayed pressed.
- Now: Select = 5, Right Shift, V or Right Ctrl; Start = 1, Enter or numpad Enter (MAME's coin/start keys, RetroArch's Select key, EmulatorJS's old key, the earlier RetroPlay key). Arcade games on a computer get **Jeton 5** and **Başla 1** in the bar, a start hint "Jeton: 5 · Başla: 1" with a **Jeton at** button (hidden when the menu opens), and per-game key hints under the picture built from the game's pad (Pac-Man: joystick, coin, start; Neo Geo: Z X A S = A B C D; Mega Drive: its A B C / X Y Z), using the letters this keyboard prints when Chrome reports the layout. The controls panel and Help say the same.
- Select and Start stay down at least 100 ms whatever the source (key tap, one-frame controller press, touch, bar click): a shorter coin pulse can be missed by arcade games. Other buttons are never delayed.
- RetroPlay is the only keyboard handler of the game: keys typed in the emulator frame stop before EmulatorJS. While the pause menu is open the keyboard drives the menu; a closed menu gives up focus so Esc reopens it at once. A key coming up always releases its button.
- Tests: unit 272/272 (keys for coin and start, frame keys never reach EmulatorJS, minimum press, bar tap, release with modifiers, menu keeps Enter; key hints per pad and layout key caps). E2E 40/40, new scenario on a desktop window with a placeholder Pac-Man set on FinalBurn Neo: hint and bar buttons shown, 5 / 1 / Right Shift / V each give a press of ≥ 95 ms on the right input only, the Jeton and Başla buttons give ≥ 130 ms and leave focus, Digit2 / E / Tab in the focused frame press nothing, a 30 ms controller Select gives ≥ 95 ms without opening the menu. The desktop scenario now also checks NES key hints, no coin button, and Enter on "Oyuna dön".
- **Not verified here:** coins on real arcade sets (the placeholder sets have no program; the input path is the same one the phone's JETON button uses), on the user's computer and keyboard.

## Stage 40 — desktop fullscreen, Google TV / Android TV app (2026-10-26)

- Reported: on a desktop browser the game turned black in fullscreen. Measured: in fullscreen the bar floats over the picture (out of the grid), so the picture took the bar's empty first grid row and was 0 px high. Every part of the desktop player now has its own row; the fullscreen button shows an exit icon. E2E: fullscreen keeps a 4:3 picture at full screen height with the game drawn, and returns to the window size.
- Asked: play on Google TV and Android TV. Google TV has no Chrome, so a browser or an installed PWA is not an option there. Built **RetroPlay TV** (`tv/android`, Java, no libraries, 76 KB): a leanback launcher app with banner that shows the site full screen in a WebView. The remote's d-pad and OK reach the page as keys; Back and Menu are handed to the page (`window.RetroPlayTVHost`). Controllers are read natively (key and motion events) and polled by the page as standard gamepads through `window.RetroPlayTV`, so a controller d-pad never also arrives as arrow keys and its B never turns into Back; a controller appears after its first press, so remotes and virtual devices that claim the gamepad source do not; Back stays Back unless it comes from a real controller. The screen stays on while a game runs. Requests to other sites are not loaded (this also keeps out the toolbar Netlify adds to deploy previews, which covered the bottom of the screen in the first emulator run). An offline page covers a first start without network.
- Getting games onto the TV: Oyun ekle → Telefondan gönder shows a QR code, the TV's address (`http://<tv>:8686`) and a 4-digit code. The app runs a small HTTP upload page while it is open (one raw file per request, wrong code 10 times → one-minute pause); files wait in its inbox and the page reads them from `/__tv/inbox/<id>`, answered by the app (the service worker skips `/__tv/`), then the usual review adds them and they leave the inbox. Tested locally on the JVM: page, wrong code (403), a 300 KB upload byte for byte, UTF-8 names, path traversal refused, delete.
- Web TV mode (the app, or `?tv=1`): TV safe area (48 × 27 px at 960 × 540), focus always shown, arrows move the focus with up/down kept in the sidebar or the page, OK selects, Back = previous screen or game menu (home screen: the app steps aside), always-full-screen player whose bar steps away, Jeton / Başla in the pause menu for arcade games, TV sections in Settings and Help, `/tv` → APK. Old WebViews get fallbacks for container query units and `color-mix()`.
- CI (`.github/workflows/tv.yml`): Gradle 8.11 / AGP 8.7 build; the APK is checked (`leanback-launchable-activity`, banner, min SDK 24, target 35) and published as `tv-latest` when the app's code changes. The signing key never lives in the repository: with the `TV_KEYSTORE_*` secrets every build has the same key, otherwise each run makes one (not set yet). Then the app runs on two emulators through Playwright's Android support against this commit's deploy.
- First emulator run, both images passed every step: install, TV layout 960 × 540 @2, remote focus, controller key event through the bridge, upload page address and code, a real HTTP upload into the inbox, import through `/__tv/inbox`, a game running in the WebView, Back opening and closing the game menu, Back on the home screen leaving the app. Found there and fixed: on the Android TV 13 image (WebView 101) the picture was 0 × 0 because container query units arrived in Chrome 105 (Google TV 14, WebView 113: 720 × 540, correct). The emulator now fails if the picture is not full height at 4:3. Speed in the emulator (software GPU) is 0.2–0.4× and says nothing about a TV.
- Tests: unit 275/275 (new: TV bridge detection and gamepad conversion), E2E 41/41 (new: the TV app with a stand-in bridge: QR/address/code, inbox import, remote focus, Back, full-screen player, controller from the bridge, screen-on).
- **Not verified here:** a real Google TV / Android TV device (speed, remote feel, Bluetooth controllers, sound, sideloading), uploads from a real phone over Wi-Fi.
- Second emulator run (1.0.2): both images passed, Android TV 13 now 720 × 540. Its home screenshot still showed an empty white box at the bottom: the toolbar's frame that Netlify adds to previews stays even with its contents refused. On the TV nothing outside RetroPlay's root is shown now, and the emulator check fails on anything visible outside it (before, it only looked for "netlify" in names).
- The TV app's WebView cannot save files, so "ROM'u indir", "Kayıtları indir" and "Yedek al" claimed a download that never happened. In the app they are gone; Settings says why and that removing the app removes the TV's games and saves. E2E checks both.
- Also seen in the emulator screenshots: a notice shown while the game menu was open (the speed result) covered the top of the menu. On a computer and on the TV a notice now sits over the picture beside the open menu, on the TV inside the safe area (E2E). The menu's last item reached with the remote and focused cards on the pages scroll clear of the TV's 27 px bottom edge (E2E: the last menu item). The workflows use the Node 24 versions of their actions (checkout 5, setup-node 5, setup-java 5, setup-gradle 5, upload-artifact 6, download-artifact 7), which ends the deprecation warnings. Signing: once the `TV_KEYSTORE_*` secrets exist, a manual or push run replaces a per-run-signed `tv-latest` with the permanently signed APK (even without app changes), and never the other way round (decision logic checked for all seven cases).

## Stage 41 — arcade: Tekken 3 at full speed and with sound (2026-10-26)

- Reported: Tekken 3 (arcade) very slow. Measured with the user's set (TET1/VER.E, the 2025 MAME 2003-Plus `tekken3`) in the production build, with the game's own frame rate counted as distinct frames reaching WebGL. In a fight, the emulator ran at 60 fps but only 30.9 of those frames per second were new (ratio 0.515): the game itself ran at half speed, on any device. Cause: the MAME 2003-Plus core in the EmulatorJS 4.2.3 packages (built 2025-06-14, EmulatorJS/mame2003-plus-libretro `3a72dae`) runs Namco System 12's main CPU at 33.8688 MHz / 2 = 16.9 MHz and has no sound for the board (`GAME_NO_SOUND`). libretro's current sources (October 2026) run it at 100 MHz / 4 = 25 MHz as current MAME does, emulate the H8/3002 sound CPU and the C352, and skip the CPU's wait loops exactly (including Tekken 3's VBLANK wait).
- RetroPlay now builds that core itself: `.github/workflows/cores.yml` compiles libretro/mame2003-plus-libretro `64b3c38a` with the toolchain of the 4.2.3 cores (emsdk 3.1.74, EmulatorJS/RetroArch `6dd43539` = the "next" branch at the 4.2.3 core build), so the exported functions are identical to the shipped core's and the runtime patches apply unchanged; the release is pinned by sha512 in `scripts/emulatorjs-runtime.mjs` (`BUILT_CORES`) and served as `mame2003_plus_next`. The runtime patch registers it as a MAME core. Its game list holds the 53 Namco System 12 sets, read from `namcos12.c` (the core's own DAT lags behind the driver; for the 29 sets in both, the lists are identical).
- Routing: a set the current build can run goes to it, found by checksums under its current name (the user's TET1/VER.E zip is `tekken3je1` there; the core loads files by CRC, so the older file names work), with the 2025 build kept as the alternative. Records imported earlier are checked again once (MAME 2003-Plus and incomplete sets) and moved; ROM, saves and record ID stay. Save states from the 2025 build are tagged with that core and are not loaded into the new one (existing behaviour for core mismatches).
- Same fight, current build: 59.5 of 59.5 frames new (ratio 1.00), sound on. Speed headroom in this container (2 vCPU Xeon 2.1 GHz, small canvas so SwiftShader does not dominate): attract mode 2025 build 108–117 fps (no sound, half the CPU clock), current build 89–99 fps with the core's -O2, 98–108 fps with the interpreter's inline helpers forced inline (release build); in a fight 64–77 fps (-O2) vs 70–89 fps (release). Measured and not used: -O3 (no gain), the GPU's NEON span code compiled to WebAssembly SIMD via emscripten's NEON headers (correct: the GPU's own PSX_TEXSPAN_VERIFY check passed 34 million spans, but 10 % slower).
- Profile of the current build in a fight: CPU interpreter about 44 %, GPU rasterizer 21 %, sound CPU and C352 5 %, browser/WebGL the rest. The upstream MIPS recompiler (sljit) cannot be used in WebAssembly. Frameskip brings nothing here (the GPU draws when the game sends its commands, not when a frame is shown).
- Final check with the user's set through the app's own flow (production build, release core `core-mame2003_plus_next-64b3c38a-r6`): import says "Tekken 3 (Japan, TET1/VER.E1) · MAME 2003-Plus (2026) · tam set · dosya adı tekken3je1.zip olarak tanındı"; in a round every frame is new (ratio 1.00 vs 0.50 on the 2025 core) and sound plays (54 % of audio buffers above silence, peak 0.18; the 2025 core: all silent).
- Tests: unit 284/284 (new: System 12 routing by name and checksum, the closest set among incomplete matches, the driver-source list and the shipped list running the user's set, record re-check rule, launch order, the core registered as MAME, pinned downloads), E2E 42/42 (new: a CRC-matched placeholder of the 2025 Tekken 3 set is imported and started on the current build as tekken3je1, and a record in the earlier build's form is moved to it on reload with the ROM kept). No ROM or game data is in the repository or CI.
- **Not verified here:** speed on the user's phone or computer. The game's own speed no longer depends on the device; whether a device keeps 60 fps does (this container: 1.1–1.5× in a fight with a small canvas). If a device cannot, Oyun menüsü → Performansı ölç shows it.

## Stage 42 — arcade: Tekken 3 fast enough for phones (2026-10-30)

- Reported from the phone (Redmi, 8 cores, 8 GB): Tekken 3 on the 2026 core at 0.5× (30 fps) in a fight. Same in this container under CDP CPU throttling ×3 (paced play 28–33 fps), so that setting stands in for the phone below.
- The core is now patched by RetroPlay (`cores/mame2003_plus_next/`): a PSX CPU to WebAssembly recompiler (`psxwasm.c`: one module per block, chained with tail calls, exact load-delay and branch-delay handling, COP2 loads in delay slots, inline branch targets), GPU spans with WebAssembly SIMD, interlaced field drawing (only the field shown in 480i; core option *PSX Interlaced Drawing*, default fields), no GPU drawing on skipped frames, and RetroArch's 0RGB1555→RGB565 conversion compiled with SIMD (CI checks the object really has SIMD code).
- Correctness: the `jitverify` build runs every block and the interpreter side by side and compares registers and memory writes: 12 million blocks through boot, attract mode and a fight, 0 differences, no stall. The `jitstats` build: 99.4 % of CPU instructions run as recompiled code (about 1 800 interpreted per frame).
- Speed in a fight (release `core-mame2003_plus_next-64b3c38a-r23`): unthrottled 92 fps (r6) → 184–200 fps; throttled ×3 at normal speed 28–33 fps (r6) → 49–51 fps, every frame new.
- Browsers without WebAssembly SIMD: the 2026 core is skipped and the 2025 build starts; with no alternative the player says the browser must be updated (Chrome 91, Firefox 89, Safari 16.4).
- **Not verified here:** speed on the user's phone. The throttled run suggests about 50 fps, not yet 60; frameskip and further work (texture spans, GTE, sound CPU) are left for a later stage.

## Stage 43 — several players on every console (2026-10-30)

- Reported: whatever the console, the game was built for one player. Cause: every input (touch, keyboard, every controller) was sent to the core as player 1 (`simulateInput(0, …)`); the poller combined all controllers into one.
- Now every input plays as a player and EmulatorJS passes each player's buttons on that player's port (`src/players.js`, `GamepadPoller` per player, `pressButton(name, source, player)`). A controller gets a player when it is first used (the lowest free one) and keeps it until it is disconnected; a controller never pressed holds none; touch and keyboard are player 1; one controller alone is player 1 as before. Players per game: 2 on NES, Super Nintendo and Mega Drive; on arcade boards the cabinet's count from MAME 2003-Plus's `<input players>` (catalog regenerated from the same XML at `3a72dae`: only the player count added to the 5 241 entries with controls, every other value unchanged), up to 4.
- Menu → **Kontroller ve oyuncular**: who plays as whom (touch pad or keyboard, and each connected controller with its name), for the app session. The touch pad steps aside only for a controller of its own player. A joining second controller shows "Oyuncu 2 · <name>". Arcade: each player's Select/Start is that player's coin/start; keyboard 2/6, 3/7, 4/8 are players 2–4's start/coin (MAME's keys). Help has a card on it; controller names lose the browser's vendor/product suffix.
- Real core check (E2E): a self-made NES cartridge reads both controller ports and turns red for player 1's A, green for player 2's A. With two controllers: first controller red, second green ("Oyuncu 2 · Second Pad"); after the menu makes the second controller player 1 and the keyboard player 2, the controller turns it red and X turns it green. Phone: touch pad and a controller as players 1 and 2, the touch pad stays on screen while player 2 plays. TV app: a second bridge controller presses on the second port.
- With the user's own Tekken 3 set (local only, not in the repository): player 2's coin and start (6, 2) start the game on the 2P side ("PUSH P1 START"), then player 1's coin and start bring player 1 in: both cursors on the character select.
- Tests: unit 299/299 (new: assignment order, disconnect, unused controllers, menu choices, player counts; poller per player, combination per player, release before press when a controller moves; per-port input, minimum coin press for player 2, keyboard player, arcade keys). E2E: new two-player scenarios (desktop, phone), TV and arcade scenarios extended.
- **Not verified here:** real controllers on the user's phone, computer and TV; Super Nintendo and Mega Drive player 2 with a real game (same input path as the NES check; their cores have a standard pad on port 2). More than two players on consoles (NES Four Score, Super Nintendo multitap) is not offered.

## Stage 44 — two players on one keyboard, controllers with no setting (2026-10-30)

- Asked: two people on one keyboard from the moment the game opens, each with their own Start/Select (coin/start); controllers working with no setting; simpler than the menu choices of stage 43.
- Keyboard split in two (the usual layout for a shared keyboard, and MAME's sides): player 1 on the right — arrows, J K L / U I O, Enter or 1 Start, Right Shift, 5 or Right Ctrl Select; player 2 on the left — W A S D, F G H / R T Y, 2 Start, 6 Select (MAME's player 2 keys). The 2×3 blocks follow the on-screen pads (lower row = main buttons; Mega Drive A B C / X Y Z in place, `BUTTON_BLOCKS`). Letters only. Z X A S Q W and V no longer play (they were player 1's; they sit in player 2's half). The lines under the picture list both players' keys; the arcade start hint names 2P's 6 / 2.
- Controllers: players in connection (slot) order, kept until disconnected, no press needed and no menu choice; non-standard devices only after a press, known phone sensors never. The menu's selectors are gone: it lists the controllers with their players.
- Real core check (E2E, two-port NES test cartridge): the second controller pressed first is still player 2 (green); the first is player 1 (red); K plays player 1 and G player 2 at the same time. Phone: second controller is player 2 and the touch pad stays; touch is player 1; the first controller takes over from the touch pad. TV: second bridge controller on the second port.
- With the user's own Tekken 3 set (local only): 5, 1 then 6, 2 bring both players in; → moves 1P's cursor, A moves 2P's; J and F pick; the fight starts (Nina vs King).
- Tests: unit 300/300 (keyboard map of both players and every system, no shared keys, halves do not cross, hints per player, automatic controller order, sensor filter). E2E: two-player, phone, desktop, arcade and TV scenarios updated.
- **Not verified here:** a real laptop keyboard with two people (key rollover differs per keyboard), real controllers on the user's devices.

## Stage 45 — simpler, faster, safer: the "Hemen" package (2026-10-30)

- From the audit and research (summary given to the user): six small changes with direct effect.
- Library = start screen: Home merged into the library (three tabs: Kütüphane, Oyun ekle, Ayarlar); "Kaldığın yerden" card on top of the unfiltered library; the first-run welcome is the empty library. One tap on a cover plays (records that cannot start open their page); ⋯ on the cover (Y on a controller, I on the keyboard) opens the page.
- Clean titles: "Tekken 3 (Japan, TET1/VER.E1)" shows as "Tekken 3" with "Japan, TET1/VER.E1" underneath (cards, game page, player bar); "[!]" marks dropped; search keeps the full title.
- Arcade start: the 3.4 MB MAME catalog is no longer downloaded and parsed to start a game; a 95 KB controls table generated from it (identical values, unit-tested) is read instead. E2E: after a reload, starting Puck Man requests `arcade-input.json` and none of the full lists.
- Storage the browser keeps: persistence was already requested at start, but a refusal was final. Now asked again after games are added and from Settings (**Kalıcı yap**), with the state shown. (Correction to the audit summary, which said it was never requested.)
- Fast forward and rewind: verified on the real core first (colour-cycle test cartridge): fast forward 60 → 166 fps in this container; rewind runs the colour sequence backwards exactly and the game continues afterwards; rewind cost measured on Super Nintendo: a state every frame ~25–35 % more work per frame, every 2nd frame ~15 % → consoles start with `rewind_granularity = 2`, arcade without rewind. Bar: ⏩ toggle, ⏪ hold; keyboard Space (toggle) and Backspace (hold).
- Also checked and left out: run-ahead (compiled into the cores but no effect with EmulatorJS 4.2.3: 2 frames from press to picture with and without it, in four configurations).
- Tests: unit 305/305 (titles, controls table vs catalog, fast forward/rewind and their keys). E2E: new scenarios (start screen and one tap, fast forward and rewind on the real core, arcade start without the catalog); updated: controller focus, arcade, TV.
- **Not verified here:** on the user's phone and computer (feel of the new card, rewind smoothness on real games, whether Chrome grants persistence there).

## Stage 46 — real cover art (2026-10-31)

- Box art from libretro-thumbnails (RetroArch's archive), lists pinned to a commit per repository. Consoles are recognised by No-Intro ROM checksum first (NES headerless, SNES without copier header), then by name; arcade by name. Matched at list-build time: NES 5327 checksums, SNES 3416, Mega Drive 1863; name lists NES 5452/8158 (box art/title screens), SNES 3676/3641, MD 2350/2084, FBNeo 6283/11062, MAME 6029/12401. Lists load only for systems in the library (gzip 54–172 KB each).
- Pictures fetched once, made 320 px WebP and kept in Cache Storage `retroplay-covers-v1`; IndexedDB unchanged (still version 4, same stores — checked in E2E). No lookups while a game runs. Setting to turn covers off; ⋯ → **Kapak resmini kaldır** on a game's page.
- Titles: "Legend of Zelda, The (USA)" now reads "The Legend of Zelda".
- Real network (this container, Chromium): five NES test cartridges — one carrying Super Mario Bros.'s No-Intro checksum under the name "my game", three named like releases, one unknown — got four covers in ~2.3 s; the unknown one keeps the drawn cover.
- Tests: unit 315/315 (matching against the shipped lists, checksums, list builder, addresses, article titles). E2E: new scenario with raw.githubusercontent.com answered locally — checksum and name matches, exactly one request per game at the pinned commit, 320 px pictures, nothing fetched after a reload, setting off/on, removal stays after a reload, deleting a game deletes its picture. All other scenarios run with covers on.
- **Not verified here:** on the user's phone (look of the covers, first fetch over mobile data).

## Stage 47 — arcade lists in small pieces (2026-10-31)

- Before: recognising one arcade zip downloaded and parsed all four lists (10.9 MB JSON, 1.9 MB gzip; FinalBurn Neo alone 67 ms to parse in this container, several times that on a phone), again after every app update.
- Now: the full lists moved to `data/arcade/`; the build cuts them into pieces (FinalBurn Neo 256 by name + 256 by checksum, MAME 2003-Plus 128 + 256, the small cores 1–8). A ROM shared with the parent/BIOS is a reference (set pieces are half the full lists). A renamed or incomplete zip is scored from the checksum index alone, then only the best-fitting set is read.
- Measured per import (pieces · JSON read, against 10.9 MB before): sf2.zip 14 · 147 KB; kof98.zip 16 · 174 KB; puckman.zip 28 · 231 KB (MAME 2003-Plus has no "puckman": its Pac-Man sets are found for the alternatives and the 4-way joystick); tekken3.zip 36 · 305 KB; mslug.zip 58 · 468 KB (Neo Geo zips carry the BIOS files); a renamed sf2 76 · 660 KB. Pieces are fetched in parallel, once per session, and kept by the service worker.
- Same results: an exhaustive comparison of every set of every core, named and renamed (19,864 cases), against identifyArcadeZip over the full lists: 0 differences. Unit test keeps a sample (named, renamed, split, one file missing, BIOS) plus a round trip of every stored set.
- Service worker shell cache `retroplay-shell-v15`: drops the full lists earlier versions kept (up to 11 MB per device).
- **Not verified here:** on the user's phone (import speed of a real arcade zip).

## Stage 48 — player code split; multi-core emulation evaluated (2026-10-31)

- `src/player/session.svelte.ts` (1126 lines) split: `controls.svelte.ts` (touch pad and layout, controllers and players, keyboard hints; components read `player.controls.*`) and `battery.ts` (in-game saves kept by the app). The session keeps starting, menu, slots, play time, speed, fullscreen, leaving (891 lines). No behaviour change: unit 319/319, E2E 47/47.
- Multi-core emulation (Document-Isolation-Policy + EmulatorJS thread cores), measured in Chromium 153 with `Document-Isolation-Policy: isolate-and-require-corp`: the page and the player frame are cross-origin isolated, SharedArrayBuffer is there, and EmulatorJS 4.2.3's `-thread` cores load and run. Speed: Nestopia headroom 7.73× without threads vs 7.74× with (average of 4 runs each, 7.25–8.53 spread) — no gain, because the libretro cores emulate on one thread; RetroArch's threaded video (`video_threaded`) makes the game fail to start. Shipping it would add the thread cores (~10 MB offline) and an isolation header every embedded resource must satisfy, for nothing. **Not shipped**; worth revisiting only for a core that itself runs on several threads (for example RetroPlay's own MAME 2003-Plus build — Tekken is on hold).

## Stage 49 — RetroPlay TV brought up to date (2026-10-31)

- Covers on the TV: the app refused every request to other sites with an empty 204, so cover lookups got an empty "picture" — and the web app then remembered "no cover" for every game. The app now lets `https://raw.githubusercontent.com/libretro-thumbnails/…` through (nothing else), and the web app treats an empty answer or a non-picture (204, a captive portal page) as a network problem: nothing is stored, the next start tries again (E2E: 204, then an HTML page, then the real picture after a restart).
- Speed on the TV (the bar is out of the remote's reach): on consoles a controller's R2 switches fast forward, L2 held rewinds (everywhere, not only on the TV); arcade boards keep L2/R2 for the game (E2E: R2 reaches the arcade core). The TV game menu has **Hızlı ileri**. E2E: R2/L2 through the TV bridge, the menu item, the remote's order in the menu.
- Workflow: a branch build opens its pull request's deploy preview (it opened the stale `deploy-preview-2` before) and is checked there; only `main` publishes `tv-latest`. Version names 1.1.x. Emulator check: the cover comes from GitHub through the app; R2 through Android's gamepad input turns fast forward on and off.
- Signing: the GitHub Actions secrets API is not reachable from here, so the permanent key (`TV_KEYSTORE_*`, tv/README.md) can only be added by the owner. Without it the APK is signed per build; that matters only when the app's own code changes (a new APK then needs one reinstall), never for changes to the site.
- **Not verified here:** a real Google TV / Android TV device.

