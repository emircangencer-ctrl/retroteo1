# RetroPlay — personal retro console PWA

RetroPlay is a static PWA for Netlify. Game files are imported into the browser's IndexedDB on the
device; nothing is uploaded. All emulation runs through EmulatorJS 4.2.3, which RetroPlay now
serves from its own site together with the cores it uses (no CDN at runtime).

| System | Files | Core (EmulatorJS 4.2.3 build) | Notes |
|---|---|---|---|
| NES | `.nes` | Nestopia UE 1.53.1 | If Nestopia cannot open a file, FCEUmm is offered and remembered; `?nescore=fceumm` forces FCEUmm |
| SNES | `.sfc`, `.smc` | Snes9x 1.63 | |
| Mega Drive / Genesis | `.md`, `.gen`, `.bin` (SEGA header only) | Genesis Plus GX 1.7.4 | |
| Arcade | `.zip` (ROM set) | FinalBurn Neo v1.0.0.03, FB Alpha 2012 CPS2, MAME 2003-Plus (2025 and, for Namco System 12, current) | Set checked against the core's own list; Neo Geo needs `neogeo.zip`; old CPS2 sets without `.key` run on FB Alpha 2012 CPS2 |

The interface (Faz 2) is written in Svelte 5 and TypeScript: a home screen that continues the last
game, a library with search, system filters, sorting and three layouts, a page per game (save
slots with pictures, play time, files, emulator), an import screen that shows every file before
it is added, settings and help. It works with touch, mouse and keyboard, and with a game
controller from the couch. On a computer a sidebar replaces the bottom bar.

`src/emulator-systems.js` defines each system (extensions, EmulatorJS system ID); the touch pads
are in `src/touch-layout.js`.
N64 can appear in the library but is not playable (see `docs/` and the emulator research: N64 in a
phone browser has no dynamic recompiler and is not expected to reach full speed).

## Local development

Requires Node.js 22.18+ (unit tests import TypeScript modules directly) and access to the npm
registry.

```bash
npm install
npm run dev        # serves the app and /emulatorjs/ from the local runtime build
npm run check && npm test && npm run build && npm run preview
```

`npm run check` runs `node --check` on the JavaScript modules and `svelte-check` (TypeScript and
Svelte, warnings fail). Netlify runs `npm install`, `npm run check`, `npm test` and
`npm run build` (Node 22) before publishing `dist/`.

Source layout:

- `src/App.svelte`, `src/views/` (Home, Library, GameDetail, Import, Settings, Help) and
  `src/components/` — the screens. Hash routes: `#/`, `#/library`, `#/game/<id>`, `#/import`,
  `#/settings`, `#/help`; browser back stays inside the app.
- `src/lib/` — state and logic in TypeScript: IndexedDB access (`db.ts`), the library store,
  import scanning and review (`import-scan.ts`, `importer.svelte.ts`), settings, controller
  navigation (`gamepad-nav.ts`, `gamepad-ui.svelte.ts`), play time (`playtime.ts`).
- `src/player/` — the game session (`session.svelte.ts`: start, saves, menu, display, touch pad,
  controller), core choice (`launch.ts`), the player and pause menu components.
- `src/*.js` — the emulator, input, save, arcade and ROM modules from Faz 1, unchanged in behaviour
  and typed by the `.d.ts` file next to each.
- Fonts (Archivo, IBM Plex Mono; latin and latin-ext) are bundled and cached for offline use.

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
- One core is built by RetroPlay itself: the current libretro MAME 2003-Plus (`mame2003_plus_next`,
  commit `64b3c38a`) for Namco System 12 (Tekken 3, Tekken Tag Tournament, Soul Calibur …). The
  2025 build in the EmulatorJS packages runs that board's main CPU at 16.9 MHz instead of 25 MHz
  and without sound, so Tekken 3 drops to half its frame rate in a fight and plays in slow motion on
  any device. `.github/workflows/cores.yml` builds the pinned source with the toolchain of the 4.2.3
  cores (emsdk 3.1.74, EmulatorJS/RetroArch `6dd43539`), so the runtime and RetroPlay's patches work
  with it unchanged; the result is published as a release of this repository and the build pins
  its files by sha512 (`BUILT_CORES` in `scripts/emulatorjs-runtime.mjs`). RetroPlay's patches in
  `cores/mame2003_plus_next/` make it fast enough for phones: the PSX CPU is recompiled to
  WebAssembly at run time (`psxwasm.c`, checked instruction by instruction against the interpreter in
  the `jitverify` build), the GPU draws with WebAssembly SIMD and, in 480i, only the field on screen
  (core option *PSX Interlaced Drawing*), and RetroArch's pixel conversion uses SIMD. The core needs
  WebAssembly SIMD (Chrome 91, Firefox 89, Safari 16.4); without it the 2025 build starts instead.
- `/emulatorjs/runtime-manifest.json` lists the files for the service worker.

## Offline and updates

Games, saves and slots live in IndexedDB. The app asks the browser to keep them when the device runs
low on space (`navigator.storage.persist()`: at start, again after games are added, and from
Settings → Depolama with **Kalıcı yap**); browsers decide by use (Chrome grants installed or
often-used apps, Firefox asks), and Settings says which it is. Starting an arcade game reads only
the cabinet controls (`/assets/arcade-input.json`, ~95 KB, generated from the MAME 2003-Plus catalog
by `scripts/build-arcade-catalogs.mjs --input`) instead of the 3.4 MB catalog.

The service worker stores the app shell, every built asset (including lazily loaded chunks and the
arcade game lists), the EmulatorJS runtime and the NES, SNES and Mega Drive cores when the app is
installed; arcade cores are stored on first use. After one online visit a game starts with no
network at all (E2E-tested). Settings shows how many cores are on the device.

The build stamps a build ID into the service worker, so every release installs a new worker. It
never takes over on its own: the app shows **Yeni sürüm hazır · Yenile** (never over a running
game) and reloads when the player taps it.

## Playing

1. **Oyun ekle**: choose files, a ZIP of console ROMs, an arcade set zip or a whole folder
   (sub-folders included; files that are not games are passed over and counted). Every file is
   checked first and listed — playable, flagged (for example an unrecognised SMB3 dump), already in
   the library or chosen twice, not supported — and only the ticked ones are added.
2. The library is the start screen (three tabs: Kütüphane, Oyun ekle, Ayarlar). A tap on a cover
   plays the game; the cover's ⋯ corner (controllers: Y; keyboard: I) opens its page. A record that
   cannot start yet (no ROM, an incomplete set, a missing BIOS) opens its page, which says why. The
   last game played leads the unfiltered library as **Kaldığın yerden** with its last picture.
   Titles show the name only ("Tekken 3"); versions and regions from the DATs ("Japan, TET1/VER.E1",
   "USA · Rev 1") sit on the line underneath (`src/lib/title.ts`); search still uses the full title.
   On phones and tablets the player becomes a handheld (see *Touch controls and controllers*); on a
   computer the game fills the window at 4:3 and keyboard and controllers work. The bar's ⏩ (or
   Space) switches fast forward on and off (RetroArch's 3×, as far as the device keeps up); on NES,
   Super Nintendo and Mega Drive ⏪ held (or Backspace held) rewinds: those games start with
   RetroArch's rewind buffer, a state every 2nd frame (about 15 % more work per frame on Super
   Nintendo, measured); arcade boards' states are too large for it.
3. The menu (☰, Esc, the controller's guide button or Select+Start) pauses the game: Oyuna dön,
   Hızlı kaydet / Hızlı yükle, Kayıt yuvaları, Ekran ve ses, Kontroller, Tam ekran, Performansı ölç,
   Yeniden başlat, Oyundan çık. On a phone held upright it opens from the top; held sideways and on
   a computer it is a side panel.
4. **Ekran ve ses** changes the picture live. Scaling: **Keskin** (default; sharp-bilinear shader,
   every pixel the same size), **Piksel** (nearest neighbour), **Tam sayı** (integer scale on both
   axes). Filter: **Yok**, **CRT** (crt-easymode), **LCD** (pixel grid). The game is drawn at the
   screen's real resolution; RetroArch letterboxes with each core's own aspect ratio, and vertical
   arcade games get a portrait screen. The volume slider is kept per device.
5. **Performansı ölç** measures how many times real speed the device runs the current game (the core
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
non-standard controllers, the guide button or Select+Start (within 90 ms; the game never sees the
pair) opens the menu. EmulatorJS's own gamepad loop is stopped when the game starts so a press is
never delivered twice. While a controller is in use the touch pad steps aside (🎮 in the bar
brings it back; setting "Kontrolcü kullanılınca … gizle").

Keyboard (`KEYBOARD_PLAYERS` in `src/emulatorjs-nes-player.js`, matched by key position): one
keyboard plays two players at once, from the start, split in two so two people do not get in each
other's way. Player 1 is on the right: arrows (as on RetroArch and MAME), buttons on J K L (lower row)
and U I O (upper row), Start Enter or 1, Select Right Shift, 5 or Right Ctrl. Player 2 is on the left:
W A S D, buttons on F G H and R T Y, Start 2, Select 6 (MAME's player 2 keys). The two 2×3 blocks are
laid out like the on-screen pads: the lower row holds the pad's main buttons (NES B A; arcade panels
and the Super Nintendo B A R below, Y X L above; the Mega Drive A B C below, X Y Z above). Only letter
keys, so places and printed labels hold on Q, F, AZERTY and QWERTZ keyboards. On arcade games Select is
the coin: 5 / 6 insert a coin and 1 / 2 start, as on MAME; on a computer the bar also has **Jeton**
and **Başla** buttons, the game opens with a hint naming the keys, and the lines under the picture list
each player's keys for that game's own buttons, with the letters this keyboard prints on those keys
when the browser reports its layout. Select and Start stay down at least 100 ms however short the
press (a key tap, a one-frame controller press, a click), because many arcade games ignore a shorter
coin pulse. RetroPlay is the only keyboard handler of the game: EmulatorJS's own bindings (where 1/2/3
save and load its own states) never see a key. While the pause menu is open the keyboard drives the
menu. Many laptop keyboards drop keys when several are held at once (key rollover), which two players
can reach in a hectic game.

Several players (`src/players.js`), with no setting: every input plays as a player, and EmulatorJS
passes each player's buttons to the core on that player's own port (RetroArch users 1–4). Controllers
are players in the order they are connected (the browser's controller slots) and keep their player
until they are disconnected; one connected later takes the lowest free player. A device the browser
does not map as a standard gamepad takes a player only once a button is pressed on it, so a phone
sensor listed as a joystick (Pixel fingerprint sensors, "uinput-fpc") never takes player 1. The touch
pad is player 1 and steps aside only for player 1's controller. Games have two players on the consoles
and the cabinet's count on arcade boards (MAME's `<input players>`, kept in the arcade catalog; up to
four); a game with fewer players gives extra controllers to player 1, so any controller plays a
one-player game. A second controller says who it plays as when it joins, and the menu's **Kontroller
ve oyuncular** lists the controllers with their players. On arcade boards each player's Select and
Start are that player's coin and start. The TV app's bridge hands every controller over in its own
slot, so two Bluetooth controllers on the TV are two players.

The whole interface can be used with a controller: the d-pad or stick moves the focus to the
nearest item in that direction, A opens or confirms, B goes back, X adds to favourites, Y opens
the game page, L/R change the system filter, Start opens the pause menu in a game. Dialogs and
the pause menu keep the focus inside them.

## Google TV / Android TV

`tv/android` is a small Android TV app (RetroPlay TV) that shows the site full screen on a TV;
see `tv/README.md`. The web app switches to a TV layout when it runs there (or with `?tv=1`):
content inside the TV safe area, focus always shown, the remote's arrows move the focus, Back goes
back and opens the game menu in a game, the player is always full screen. Controllers are read by
the app and polled by the page as standard gamepads. Games get onto the TV with Oyun ekle →
**Telefondan gönder**: a QR code, the TV's address and a 4-digit code for an upload page on the
home network; the files then go through the usual review. The site's `/tv` address redirects to
the latest APK (`tv-latest` release, built by `.github/workflows/tv.yml`, which also runs the app
on Google TV and Android TV emulators).

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
  its loader opens one); MAME 2003-Plus covers sets the others lack. Namco System 12 sets go to the
  current MAME 2003-Plus build whenever it can run them (its list is read from `namcos12.c`, since the
  core's DAT lags behind the driver), found by checksums under its current set names: the 2025 build's
  `tekken3` (TET1/VER.E) is `tekken3je1` there; the 2025 build stays as the alternative. Incomplete
  sets and MAME 2003-Plus sets already in the library are checked again when the cores change,
  keeping the ROM, saves and record ID. The import result says whether the set is complete, needs its parent zip
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
is soft-reset; an emulator-only save is adopted. The game page offers **Kayıtları indir** (the
SRAM file) and **ROM'u indir**.

**Save states and resume.** Each game has a resume point (**Devam noktası**, stored when the game
is closed or sent to the background; can be turned off in Settings), a quick slot (**Kaydet /
Yükle** in the bar) and three slots in the menu. Every save keeps a picture of the moment it was
taken; the game page shows them and continues from any of them, and a slot can be deleted there.
Saving over a filled slot asks first. A resume point is used only with the core that made it;
**Baştan başla** starts over.

**Play time** counts only while the game runs on screen (not paused or in the background) and is
shown on the game page and the home screen. Pictures (`saveState.thumb`), play time
(`game.playtimeMs`) and the file's CRC32 (`game.crc32`) are optional fields on existing records;
the database version is unchanged.

The JSON library backup contains metadata only; re-importing a ROM whose hash matches a restored
record relinks it (favourites, history and saves are kept).

## Automated verification

GitHub Actions runs syntax checks, unit tests and the production build, then a browser E2E job
(`e2e/`) that runs `dist/` in Chromium with every request to `cdn.emulatorjs.org` blocked. It uses
self-authored test cartridges and CRC-matched placeholder arcade sets (all zeros except four bytes
solved so the file has the listed CRC32; no game data) and covers saves, states and resume, back
button and backdrop, backup relink, Mega Drive `.bin`, offline start through the service worker,
device-pixel rendering with no lost NES pixels, integer scaling, the performance meter, arcade
recognition (by name and by checksums), incomplete sets, CPS2 sets without a key, Neo Geo with BIOS
added from the player, a MAME-only set, the FCEUmm offer, the touch pads (8-way roll, several
fingers), controllers, the import review and folder scan, save slots with pictures, play time,
controller navigation of the interface with Select+Start, the desktop layout, coin and start on a
computer (keyboard, bar buttons, controller) and settings that are kept (40 scenarios).

Run it locally: `npm run build`, then `cd e2e && npm install && npx playwright install chromium && npm test`.

Real-device acceptance (Android Chrome, the user's phone) is still required for every release:
automated tests and a successful deploy do not prove behaviour on the device.

## Licensing

EmulatorJS and RetroArch are GPL-3.0; the cores carry their own licenses (FinalBurn Neo, MAME
2003-Plus, Snes9x and Genesis Plus GX are non-commercial). See `public/THIRD-PARTY-NOTICES.txt`.
RetroPlay is a personal, non-commercial project and ships no ROM, BIOS or game file.
