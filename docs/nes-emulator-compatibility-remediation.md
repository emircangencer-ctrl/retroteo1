# NES emulator compatibility remediation

Status: **migration spike under validation**. The branch now defaults to EmulatorJS/FCEUmm, but that does not prove the reported graphics or timing issues are fixed.

## Observed symptoms

Earlier screenshots showed severe graphical corruption in *Super Mario Bros. 3* and apparently excessive speed in the original *Super Mario Bros.* Merely starting a game, receiving input, or producing audio does not prove that the graphics pipeline, cartridge mapper, and frame timing are correct.

## Evidence and diagnosis

- The previous default was `jsnes@2.1.0`, with a guarded post-install MMC3 patch. A targeted mapper fix cannot address every PPU, mapper, or frame-timing limitation.
- The upstream JSNES tracker contains reports of sprite-layer corruption and audio/timing problems. These reports support testing an alternate core, but do not individually prove the root cause of every RetroPlay screenshot.
- `inspectNesRom` validates the recognized header and the legacy iNES length fields where possible. A valid header is not a compatibility guarantee and cannot verify that a ROM dump is correct.
- The latest CI build validates JavaScript syntax, unit tests, and the production bundle only. It does **not** launch a commercial game or confirm the rendered pixels, real-time speed, audio, or controls in a browser.

## Current migration approach

- The default engine is EmulatorJS, loaded from the official version-pinned CDN in a dedicated iframe. NES now explicitly selects `EJS_core = 'nestopia'`; the NES-specific EmulatorJS documentation lists both `fceumm` and `nestopia` as supported cores. SNES and Mega Drive retain their system-matched cores. The chosen core is not, by itself, proof of correct graphics for every ROM dump or game.
- ROM bytes stay in the browser and are handed to the iframe using a local Blob URL. RetroPlay does not upload the ROM to a third-party ROM service.
- The existing JSNES player remains selectable with `?nescore=jsnes`; `@nesjs/core` remains selectable with `?nescore=nesjs`. These are comparison paths, not evidence that either engine is the correct fallback for every title.
- The application preserves its own player shell and touch controls. Immersive mode now hides surrounding player UI and leaves the game image, touch controls, and one exit-fullscreen control visible; canvas scaling is constrained to a centered 4:3 display box rather than stretched to arbitrary parent dimensions. Keyboard events are registered on the outer page and on the emulator iframe so controls can still be captured when the iframe owns focus. A unit test verifies the forwarded key-down/key-up calls.
- EmulatorJS and its core assets are requested from the version-pinned official CDN path `https://cdn.emulatorjs.org/4.2.3/data/`. The versioned path was chosen over the moving `stable` alias so upstream releases do not silently change the runtime. Initial setup needs network access. Browser caching may help subsequent launches, but **offline playback is not guaranteed** by this integration.
- EmulatorJS is GPL-3.0 licensed. Review the licensing and distribution implications before public release.

## Required validation before merge or production deployment

1. Confirm the Netlify Deploy Preview is built from the exact latest branch commit.
2. Test user-owned local ROMs for *Super Mario Bros.*, *Super Mario Bros. 3*, and *Batman Returns*; compare graphics against known-good reference images or gameplay.
3. On Android Chrome, verify gameplay speed, sprite/background layers, touch inputs, keyboard input when applicable, audio, pause/resume, and close/reopen.
4. Repeat the key checks in desktop Chromium. Record the browser/device, ROM dump/source, and observed result so a failure can be reproduced.
5. Test malformed, unsupported, and truncated ROM files for clear failure behavior; header validation alone must not label a game as compatible.
6. Confirm that existing IndexedDB ROM records and ROM export remain intact across the engine change.
7. Test offline startup separately. The current CDN-based default is not expected to guarantee offline playback; if offline operation is a release requirement, test the current version-pinned cache behavior on actual browsers, then decide whether to package or self-host the runtime and core assets and re-evaluate licensing/distribution before release.

## Guardrails

- Do not add per-game graphics patches as the primary solution.
- Keep commercial ROM files out of the repository and CI artifacts.
- Do not migrate or overwrite existing IndexedDB ROM blobs merely to change emulator engines.
- Keep this pull request in draft until representative real-ROM visual checks and Android/desktop tests pass.
- Do not describe the issue as fixed based on a successful bundle build alone.


## Super Mario Bros. 3 ROM identity checks

The launch path now performs a **non-blocking** diagnostic for filenames containing `Super Mario Bros. 3` or `SMB3`. It expects Mapper 4 for the original cartridge family and, when the iNES header reports the standard 256 KiB PRG + 128 KiB CHR layout, compares the payload CRC-32 against `2E6301ED`, a documented U.S. Rev-A PRG+CHR reference (https://nescartdb.com/profile/view/870/super-mario-bros-3). A mismatch can indicate a different region/revision, a hack, or an incorrect/corrupt dump; it is only a warning and does not block, rewrite or replace the file. NES 2.0 and non-reference sizes receive header-level checks only.

Super Mario Bros. 3 itself has documented PPU/scroll-split and attribute artifacts on original hardware (https://www.nesdev.org/wiki/Game_bugs). Therefore, the correct acceptance test is to compare the exact visual symptom and ROM identity on a known-good reference. Do not add title-specific visual hacks merely to hide a cartridge's authentic behavior.
