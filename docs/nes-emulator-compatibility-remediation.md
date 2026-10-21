# NES emulator compatibility remediation

Status: investigation / migration spike. This document is not a claim that the graphics bug is fixed.

## Observed symptom

Several unrelated NES games show tile/background corruption on desktop and mobile. The current app imports `Browser` and `Controller` from `jsnes@2.1.0`. A game starting and producing audio/input does not prove that its PPU and cartridge mapper are emulated correctly.

## Evidence

- JSNES 2.1.0 implements a finite mapper set (0, 1, 2, 3, 4, 5, 7, 9, 11, 34, 38, 66, 71, 79, 94, 118, 119, 140, 180, 240, 241).
- The upstream JSNES issue tracker has reports of graphics corruption in Mapper 2 games, sprite layer issues, disappearing graphics, and PPU accuracy gaps. This is not proof that every reported RetroPlay failure is a JSNES bug, but it makes a per-game ROM-only diagnosis insufficient.
- Current `inspectNesRom` explicitly notes that a valid header does not guarantee compatibility. Runtime does not currently expose a preflight report to the player UI.
- The reported Batman Returns screenshot alone cannot identify whether the cause is mapper/PPU accuracy, a bad dump, or a parsing problem.

## Candidate direction

Run a small integration spike for a more accurate browser-compatible core, prioritizing a self-hosted WebAssembly build of Nestopia/libretro (or FCEUmm as a comparison). Nestopia's project documentation describes it as cycle-accurate and claims compatibility with all officially released titles and most homebrew/hacks. This is a candidate, not a final adoption decision until the artifact, browser API, and performance are tested.

### Candidate comparison and licensing gate

- **Primary candidate: Nestopia JG / libretro Nestopia built locally with Emscripten.** Upstream documentation describes the core as cycle-accurate and reports compatibility with all officially released titles and most homebrew/hacks. This is a claim to validate against our test matrix, not a guarantee for every dump or mapper. A browser build is technically feasible, but the integration work is significant: build the core from pinned source, create a small host adapter for ROM loading/frame/audio/input, and keep the generated WASM/JS assets local.
- **Fallback / comparison candidate: wasm-nes (C compiled to WebAssembly, MIT).** The public project documents a browser build and reports the `nestest` diagnostic as passed. Its visible test evidence and maturity are much narrower, so its permissive license alone is not enough to select it as the main engine.
- **Do not embed the full RetroArch Web Player UI as the first solution.** It proves that browser-based libretro cores can run, but it brings a much larger frontend and asset bundle than RetroPlay needs. We should reuse the core/build approach where licensing permits, not replace RetroPlay's UI with a second frontend.

The libretro Nestopia core is GPL-2.0. Before distributing its compiled core with RetroPlay, review and satisfy the applicable license/source-notice obligations. Keep the core and its license notices identifiable. Do not download a third-party binary from an untrusted source. If the distribution/licensing implications are unsuitable, compare another legally compatible core before choosing.

## Current branch changes (not yet a confirmed full fix)

- The dependency remains pinned to `jsnes@2.1.0`. A guarded `postinstall` patch now corrects the MMC3 R0/R1 2 KB CHR-bank alignment rule: register bit 0 is ignored and the following 1 KB bank is selected from the aligned even bank. The patch is idempotent and fails the install if the upstream source no longer matches the expected pinned version, rather than silently editing different code.
- The player canvas no longer applies an independent CSS maximum height that could scale its width and height inconsistently. It refits on viewport resize.
- These are concrete correctness improvements, not evidence that every reported visual symptom is resolved. The actual ROM screenshot must still be inspected in-browser and compared with known gameplay. In particular, the reported Batman Returns frame's green diagonal wall and repeated brick/window tiles resemble published gameplay imagery; that one frame alone does not prove a rendering fault.
- CI can validate the patching logic, syntax, and build. It cannot substitute for visual validation of commercial ROMs, which must stay local and must not be committed to the repository.

## Second core path added for comparison

- The default player now uses the framework-agnostic `@nesjs/core@2.7.0` API, which supports a substantially broader published mapper set and contains an MMC3 implementation that aligns R0/R1 2 KB CHR bank indices. The existing JSNES engine remains available with `?nescore=jsnes` for side-by-side comparison in the same deploy preview.
- The new core gets a dedicated Canvas RGBA renderer, scoped keyboard/touch/gamepad input, a requestAnimationFrame timing loop, and a self-hosted AudioWorklet. It does not call a third-party CDN at runtime. The worklet is cached by the existing same-origin service worker after it is fetched.
- A synthetic mapper-4 smoke test now verifies ROM loading and one rendered 256×240 RGBA frame without storing or publishing a commercial ROM.
- This is an integration candidate, **not a claim of cycle-accurate emulation or proof that all games are fixed**. The core's own PPU/mapper accuracy still needs real-game visual validation. Keep this PR in draft until the Batman Returns frame and unrelated games are checked in the preview on desktop and mobile.

## Migration constraints

- Do not overwrite or migrate existing IndexedDB ROM blobs merely to change emulator engines.
- Keep all core/WASM assets self-hosted; no mandatory CDN request during gameplay or offline launch.
- Preserve current player UI, touch controls, keyboard/gamepad controls, pause/resume, and audio behavior.
- Do not add title-specific graphics hacks as the primary fix.
- Keep changes on this branch until build, automated tests, and manual browser validation pass. Do not deploy automatically from this investigation.

## Required test matrix

1. Build and unit tests pass from a clean dependency install.
2. Run public-domain/homebrew diagnostic ROMs (e.g. NES test ROMs with compatible licenses) and compare documented output/results.
3. Run a curated set spanning NROM, UxROM, CNROM, MMC1, MMC3, MMC5, and other mappers actually supported by the selected core. Use user-owned ROMs locally for real-game checks; do not commit commercial ROMs.
4. Confirm that known-bad images are not silently marked as compatible; show mapper/format diagnostics where the parser can establish them.
5. Desktop Chromium and mobile Safari/Chrome: import, launch, visual output, controls, sound, pause/resume, close/reopen.
6. Offline: after one successful install/load, launch the app and core without network access.
7. Confirm IndexedDB library records and ROM export remain intact across the engine change.

## Acceptance criteria

- No per-game patching as the main strategy.
- A documented core, source, version, and license.
- No runtime CDN dependency.
- Malformed or unsupported ROMs fail with a useful explanation.
- Automated build/tests pass and representative games are visually checked before deployment.
