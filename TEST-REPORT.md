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

## Stage 07 — hardening and verification (2026-10-22)

- NES import now checks the 16-byte header against the actual file length, so large valid ROMs are not rejected because only a header sample was read.
- ZIP extraction now enforces archive and expansion caps, streams decompression into a bounded buffer, validates the EOCD and central-directory boundaries, compares local and central headers/file names/CRC/size fields, verifies CRC-32, and uses table-driven CRC for much lower per-byte CPU cost.
- Library-backup JSON is checked for metadata types, bounded strings, color values, and duplicate or reserved demo game IDs before restore. Cover colors are also sanitized at render time to protect against malformed records saved by older versions.
- Unsupported `.7z` files were removed from the file-picker filters; this build supports standard ZIP only.
- PWA updates use a versioned shell cache, hashed Vite assets, HTML revalidation headers, and a Netlify build pipeline that runs `npm run check`, `npm test`, and `npm run build`.
- Regression suite currently contains 31 tests across NES validation, ZIP extraction, backup validation, and platform lookup. It covers runtime cover-color sanitization, reserved demo-ID rejection, local ZIP header consistency, and inherited object-property platform names.
- The Netlify Deploy Preview is the main deployment check; the configured build command is `npm install && npm run check && npm test && npm run build` (chained with `&&`). A successful Preview confirms the full syntax/test/build chain for that revision.
- Still required: manually open the latest Preview, import a real licensed/homebrew NES ROM, test keyboard and touch controls, test stored and deflate ZIP files, and verify the app shell opens offline after at least one online visit. This environment cannot reach the public Preview URL directly, so I have not claimed those browser/mobile checks passed.
