# RetroPlay — personal retro console PWA

RetroPlay is a static PWA for Netlify. Game files are imported into the browser's IndexedDB on the
device; nothing is uploaded. All emulation runs through EmulatorJS 4.2.3, which RetroPlay now
serves from its own site together with the cores it uses (no CDN at runtime).

| System | Files | Core (EmulatorJS 4.2.3 build) | Notes |
|---|---|---|---|
| NES | `.nes` | Nestopia UE 1.53.1 | If Nestopia cannot open a file, FCEUmm is offered and remembered; `?nescore=fceumm` forces FCEUmm |
| SNES | `.sfc`, `.smc` | Snes9x 1.63 | |
| Mega Drive / Genesis | `.md`, `.gen`, `.bin` (SEGA header only) | Genesis Plus GX 1.7.4 | |
| Arcade | `.zip` (ROM set) | FinalBurn Neo v1.0.0.03, FB Alpha 2012 CPS2, MAME 2003-Plus | Set checked against the core's own list; Neo Geo needs `neogeo.zip`; old CPS2 sets without `.key` run on FB Alpha 2012 CPS2 |

`src/emulator-systems.js` defines each system (extensions, EmulatorJS system ID); the touch pads
are in `src/touch-layout.js`.
N64 can appear in the library but is not playable (see `docs/` and the emulator research: N64 in a
phone browser has no dynamic recompiler and is not expected to reach full speed).

## Local development

Requires Node.js 20+ and access to the npm registry.

```bash
npm install
npm run dev        # serves the app and /emulatorjs/ from the local runtime build
npm run check && npm test && npm run build && npm run preview
```

Netlify runs `npm install`, `npm run check`, `npm test` and `npm run build` (Node 20) before
publishing `dist/`.

## Self-hosted EmulatorJS runtime

`scripts/emulatorjs-runtime.mjs` (used by `vite.config.js`) builds `/emulatorjs/4.2.3/data/`:

- The exact npm tarballs of `@emulatorjs/emulatorjs` and the seven cores are fetched with `npm pack`
  and checked against pinned sha512 integrity values (installing them as normal dependencies would
  pull every core of every system, ~300 MB). They are cached in `node_modules/.cache/`.
- The npm package has no minified runtime, so the build bundles the unmodified 4.2.3 sources into
  `emulator.min.<hash>.js` and appends a small RetroPlay addition: extra `retroarch.cfg` keys,
  files written next to the game before it loads (arcade BIOS/parent zips), and a fix that makes
  RetroArch size its canvas in device pixels when the browser reports the device-pixel box in CSS
  pixels.
- WebGL1 (`-legacy`) and WebGL2 builds of Nestopia, FCEUmm, Snes9x, Genesis Plus GX, FinalBurn Neo,
  FB Alpha 2012 CPS2 and MAME 2003-Plus are shipped with their build reports (EmulatorJS needs the reports to cache
  cores). Thread builds are not shipped; they need cross-origin isolation.
- `/emulatorjs/runtime-manifest.json` lists the files for the service worker.

## Offline and updates

The service worker stores the app shell, every built asset (including lazily loaded chunks and the
arcade game lists), the EmulatorJS runtime and the NES, SNES and Mega Drive cores when the app is
installed; arcade cores are stored on first use. After one online visit a game starts with no
network at all (E2E-tested). Settings shows how many cores are on the device.

The build stamps a build ID into the service worker, so every release installs a new worker. It
never takes over on its own: the app shows **Yeni sürüm hazır · Yenile** (never over a running
game) and reloads when the player taps it.

## Playing

1. Import files (or a ZIP of console ROMs, or an arcade set zip) with **Oyun ekle**.
2. Choose **Oyna**. On phones and tablets the player becomes a handheld (see *Touch controls and
   controllers*); on a computer keyboard and controllers work.
3. **Görüntü** switches the display mode live: **Keskin** (default; sharp-bilinear shader, every
   pixel the same size), **Piksel** (nearest neighbour), **CRT** (crt-easymode), **Tam sayı**
   (integer scale on both axes; applied when a game starts). The game is drawn at the screen's real
   resolution; RetroArch letterboxes with each core's own aspect ratio, and vertical arcade games
   get a portrait screen.
4. **⏱ Performans** measures how many times real speed the device runs the current game (the core
   runs unthrottled for four seconds) and also checks the normal pace (a game following a 120 Hz
   screen would run too fast). Results are kept on the device and listed in Settings with a copy
   button.

For files named like Super Mario Bros. 3, an unrecognised payload (usually a ROM hack) is never
started silently: the player explains the risk and asks **Yine de oyna / Vazgeç**; the choice is
remembered.

## Touch controls and controllers

On touch devices (`(hover: none) and (pointer: coarse)`, or `?touch=1`) the player fills the screen
like a handheld: in portrait the picture sits edge to edge under a slim bar (☰ menu, title,
Kaydet, Yükle) and the pad is below it; in landscape the picture is centred at full height and the
pad sits in the side areas, reaching over the picture only on narrow (16:9) screens, where the
Saydamlık setting applies. Fullscreen only hides the browser's bars. `src/touch-layout.js` computes
the geometry (screen size, orientation, safe-area insets, pad size setting) and is unit-tested on
phone and tablet sizes for every pad: on screen, thumb-sized, no overlaps, clear of the edge-swipe
zone, never over the picture in portrait.

Each console has its own pad: NES B·A (A a little higher), Super Nintendo X/Y/A/B diamond in its
colours with L/R shoulders, Mega Drive A·B·C under X·Y·Z (Genesis Plus GX 6-button mapping),
arcade Y X L / B A R panel with JETON/START, Neo Geo A·B·C·D in SNK's colours. FinalBurn Neo games
show only the buttons their cabinet had (1942: 2, Galaga: 1, Pac-Man: none; counts and joystick
type from the MAME 2003-Plus list, FinalBurn Neo numbers buttons positionally: 1 = B, 2 = A,
3 = Y, 4 = X); 4-way joystick games (Pac-Man, Donkey Kong) get a 4-way d-pad. "Altısı da" in the
settings brings the full panel back.

`src/touch-controller.js` handles the input:
- The d-pad is one surface: 8 sectors by angle (cardinals 50°, diagonals 40°; "Çapraz basma"
  Zor/Normal/Kolay = 30/40/52°), a small dead zone, 8° hysteresis so a resting thumb does not
  flicker between neighbours, and the thumb may roll between directions and slide past the drawn
  cross without lifting. 4-way mode and a floating d-pad (centred where the thumb lands) are
  options.
- Face buttons react ~25 % beyond their edge; sliding switches buttons; a thumb in the gap between
  two buttons presses both.
- Every pointer is tracked separately and presses act on touch-down; the core gets the union of
  all fingers. Each new press vibrates briefly (8 ms directions, 14 ms buttons; Android).
- Menu, app switch and rotation lift every finger. The menu pauses the game and resumes it on
  close; the Android back button closes the menu first.

Controllers (`src/gamepad-input.js`): RetroPlay polls the Gamepad API once per frame and maps a
standard controller by position like RetroArch (bottom = RetroPad B, right = A, left = Y, top = X,
bumpers L/R, triggers L2/R2), the left stick as an 8-way d-pad with a dead zone, a hat switch on
non-standard controllers, the guide button opens the menu. EmulatorJS's own gamepad loop is stopped
when the game starts so a press is never delivered twice. While a controller is in use the touch
pad steps aside (🎮 in the bar brings it back; setting "Kontrolcü kullanılınca … gizle").

## Arcade sets and BIOS files

Arcade emulators identify a game by its set name (the zip name) and the ROM files inside, and a set
only works with the ROM set version of the core. `scripts/build-arcade-catalogs.mjs` turns the DATs
of the commits the EmulatorJS 4.2.3 cores were built from into compact lists of set names, titles
and ROM sizes/CRC32s (no game data): FinalBurn Neo v1.0.0.03 (EmulatorJS/FBNeo `dedd04f2`, 7889
sets), MAME 2003-Plus (`3a72dae`, 5257 sets) and FB Alpha 2012 CPS2 (EmulatorJS/fbalpha2012_cps2
`3fb5b89`, 284 sets; it ships no DAT, so its ROM tables are read from `d_cps2.c`).

- On import a zip without console ROMs is read from its central directory only and matched by set
  name, or by checksums if it was renamed. FinalBurn Neo is preferred; FB Alpha 2012 CPS2 runs CPS2
  sets from before MAME 0.178 (2016), which lack the 20-byte `.key` file FinalBurn Neo and MAME
  2003-Plus need (it has the keys built in; a self-contained clone gets a stand-in parent zip because
  its loader opens one); MAME 2003-Plus covers sets the others lack. Incomplete sets already in the
  library are checked again when the cores change, keeping the ROM, saves and record ID. The import result says whether the set is complete, needs its parent zip
  (split sets; prefer "non-merged" sets) or which files are missing or different.
- `neogeo.zip` and other BIOS sets are stored in the `bios` store (IndexedDB version 4; the upgrade
  only adds this store) and checked for the files FinalBurn Neo cannot start without
  (`sp-s3.sp1`, `sm1.sm1`, `sfix.sfix`, `000-lo.lo`). A Neo Geo game without it offers
  **neogeo.zip ekle** in the player and starts as soon as it is added. Settings → BIOS dosyaları
  lists what is installed.
- If a core cannot open a file (RetroArch keeps running its own menu; an empty save state reveals
  it), the next core is offered instead of switching silently — a core given a file it cannot
  handle can crash the page.

## Save data

Library records, ROM blobs, battery saves (`batterySaves`), save states (`saveStates`) and BIOS
files (`bios`) live in IndexedDB `retroplay-local-v1`. Migrations only add stores.

**Battery saves (SRAM) are owned by the app.** EmulatorJS 4.2.3 writes SRAM to its own storage only
every 5 minutes and on unload, so RetroPlay copies the live SRAM out of the core when the player is
paused or closed, when the page is hidden or unloaded, and every 30 seconds; unchanged data is not
rewritten (`src/save-sync.js`). On start a differing app copy is written into the core and the game
is soft-reset; an emulator-only save is adopted. Cards offer **SRAM yedeği indir**.

**Save states and resume.** **Kaydet / Yükle** keeps one quick state per game; closing or
backgrounding stores a resume point, the next launch continues from it (same core only) and offers
**Baştan başla**.

The JSON library backup contains metadata only; re-importing a ROM whose hash matches a restored
record relinks it (favourites, history and saves are kept).

## Automated verification

GitHub Actions runs syntax checks, unit tests and the production build, then a browser E2E job
(`e2e/`) that runs `dist/` in Chromium with every request to `cdn.emulatorjs.org` blocked. It uses
self-authored test cartridges and CRC-matched placeholder arcade sets (all zeros except four bytes
solved so the file has the listed CRC32; no game data) and covers saves, states and resume, back
button and backdrop, backup relink, Mega Drive `.bin`, offline start through the service worker,
device-pixel rendering with no lost NES pixels, integer scaling, the performance meter, arcade
recognition (by name and by checksums), incomplete sets, Neo Geo with BIOS added from the player, a
MAME-only set, and the FCEUmm offer.

Run it locally: `npm run build`, then `cd e2e && npm install && npx playwright install chromium && npm test`.

Real-device acceptance (Android Chrome, the user's phone) is still required for every release:
automated tests and a successful deploy do not prove behaviour on the device.

## Licensing

EmulatorJS and RetroArch are GPL-3.0; the cores carry their own licenses (FinalBurn Neo, MAME
2003-Plus, Snes9x and Genesis Plus GX are non-commercial). See `public/THIRD-PARTY-NOTICES.txt`.
RetroPlay is a personal, non-commercial project and ships no ROM, BIOS or game file.
