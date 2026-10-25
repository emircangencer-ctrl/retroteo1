# NES emulator compatibility remediation

Status: **migration spike under validation**. The branch defaults to EmulatorJS with the Nestopia core (FCEUmm only via explicit `?nescore=fceumm`), but that does not prove the reported graphics or timing issues are fixed.

**2026-10-25 evidence:** blargg's public `mmc3_test_2` ROMs, run through the app's own import and EmulatorJS 4.2.3 pipeline in desktop Chromium, pass 6/6 with Nestopia (FCEUmm fails `4-scanline_timing` #2). The reported SMB3 payload CRC `7388BEBD` is absent from the libretro No-Intro NES database. A separate, game-independent issue was measured: the emulator canvas is rendered at CSS-pixel resolution and then scaled by the device pixel ratio with nearest-neighbour filtering, which produces uneven pixel widths on high-DPI phones. These findings point away from a core MMC3 defect; the user's latest screenshot is still needed to classify the reported symptom.

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

The launch path validates filenames that identify *Super Mario Bros. 3* or *SMB3* against the full PRG+CHR payload CRC-32, plus the iNES mapper and expected 256 KiB PRG + 128 KiB CHR layout. Verified clean release fingerprints are U.S. original `A0B0B742`, U.S. Rev-A `2E6301ED`, Japan original `E7DDFEE3`, Japan Rev-A `52E2B5E0`, and Europe/PAL `1ED5C801`. References: [NES Directory — U.S. original](https://nesdir.github.io/A0B0B742_USA.html), [NesCartDB — U.S. Rev-A](https://nescartdb.com/profile/view/870/super-mario-bros-3), [NES Directory — Japan](https://nesdir.github.io/E7DDFEE3_Japan.html), [NES Directory — Europe/PAL](https://nesdir.github.io/1ED5C801_Germany.html).

An unknown fingerprint, nonstandard header, unverifiable NES 2.0 image, or invalid/truncated file is **blocked before the emulator player is constructed**. A mismatch alone does not prove corruption: the file may be a hack or another revision. RetroPlay does not rewrite, download or silently replace it. The reported payload CRC `7388BEBD` is not among the known clean fingerprints, so it must not be launched as a verified retail build.

For a controlled core A/B comparison, the default stays Nestopia; an explicitly selected `?nescore=fceumm` uses EmulatorJS/FCEUmm. Run that comparison only with a known, fingerprint-matched clean SMB3 dump, then test representative other NES games. The alternate core is not an automatic fallback for unrecognized SMB3 files.

SMB3 has documented PPU/scroll-split and attribute artifacts on original hardware (https://www.nesdev.org/wiki/Game_bugs). Compare the exact reported visual symptom and the ROM identity against a known-good reference; do not add title-specific visual hacks merely to hide a cartridge's authentic behavior.
