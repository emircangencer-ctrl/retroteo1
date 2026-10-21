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

### Licensing gate

The libretro Nestopia core is GPL-2.0. Before distributing its compiled core with RetroPlay, review and satisfy the applicable license/source-notice obligations. Keep the core and its license notices identifiable. Do not download a third-party binary from an untrusted source. If the distribution/licensing implications are unsuitable, compare another legally compatible core before choosing.

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
