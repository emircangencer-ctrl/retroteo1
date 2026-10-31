# RetroPlay TV — Android TV / Google TV

A small Android app (`tv/android`, Java, no libraries) that shows RetroPlay full screen on a TV:
Chromecast with Google TV, Google TV Streamer, Nvidia Shield, Xiaomi Mi Box / TV Box S, and TVs
with Google TV or Android TV built in.

## What it does

- Opens the RetroPlay site in a WebView: `https://retroteo1.netlify.app/` (the APK published from
  `main`); a branch build opens its pull request's deploy preview, for the emulator check only.
  Updates of the site reach the TV on their own; after the first start games open without
  internet, like the web app.
- Nothing from other sites is loaded, except the cover pictures (box art from
  `raw.githubusercontent.com/libretro-thumbnails/…`), which the page fetches once per game.
- The web app sees `RetroPlayTV/<version>` in the user agent and `window.RetroPlayTV`, and switches
  to its TV layout: content inside the TV safe area, focus always shown, the remote's d-pad moves
  the focus to the nearest item, OK selects, Back goes back (in a game Back opens the game menu;
  on the home screen it leaves the app), the player is always full screen.
- **Controllers**: the app reads Bluetooth/USB controllers natively and the page polls them as
  standard gamepads (`navigator.getGamepads()` is replaced in the page). Controller buttons never
  arrive as arrow keys or Back, so nothing is pressed twice. Buttons by position (bottom = B,
  right = A, left = Y, top = X), stick and d-pad, Select = coin on arcade games, guide button or
  Select+Start = menu. Each controller is a player, in the order they are first used. On consoles
  R2 switches fast forward on and off and L2 held rewinds; the game menu has **Hızlı ileri** too.
- **Getting games onto the TV**: Oyun ekle → *Telefondan gönder* shows a QR code, an address
  (`http://<tv>:8686`) and a 4-digit code. On a phone or computer in the same network, open it,
  enter the code and pick files; they wait in the app's inbox (`files/inbox`) and are added
  through the usual review ("Gelenleri incele ve ekle"). The page reads them from
  `https://<site>/__tv/inbox/<id>`, which the app answers itself (never the network; the service
  worker skips `/__tv/`). The upload page runs only while the app is open; after 10 wrong codes it
  pauses for a minute. Many Google TV devices have no file picker; where one exists, *Dosya seç*
  is offered too (USB drives).
- Keeps the screen on while a game runs (not while paused or browsing).
- Saves nothing outside itself: the library and saves live in the app's WebView storage on the TV,
  there is no ROM download or backup export there, and uninstalling the app removes them.

## Installing on the TV

1. On the TV, install **Downloader** (by AFTVnews) from Google Play.
2. Settings → System → About → click *Android TV OS build* 7 times (developer options), then
   Settings → Apps → Security & restrictions → Unknown sources → allow **Downloader**.
3. In Downloader, enter `retroteo1.netlify.app/tv`. It redirects to
   `https://github.com/emircangencer-ctrl/retroteo1/releases/download/tv-latest/RetroPlayTV.apk`.
4. Install, open *RetroPlay* from the apps row.

Other ways: send the APK with "Send Files to TV", or `adb connect <tv-ip>` then
`adb install -r RetroPlayTV.apk` (developer options → USB/network debugging).

Google announced developer verification for sideloaded apps (first countries September 2026,
others from 2027, with an "install without verifying" path for advanced users). It does not apply
in Turkey yet; if it does later, the APK may need to be registered or installed with ADB.

## Updating and the signing key

The signing key is never stored in the repository. The workflow signs with the
`TV_KEYSTORE_BASE64` (a PKCS#12 keystore, base64) and `TV_KEYSTORE_PASSWORD` repository secrets
when they exist, so every build has the same key and a new APK installs over the old one, keeping
the library, saves and settings stored in the app. Without the secrets each run makes its own key;
then the published `tv-latest` APK is replaced only when the app's own code (`tv/android`) changes,
because an APK with another key does not install over an existing one (it would have to be
uninstalled first, which deletes the app's data). Changes to the site never need a new APK.

To set the secrets once: create a keystore (`keytool -genkeypair -keystore tv.p12 -storetype
pkcs12 -alias retroplay-tv -keyalg RSA -keysize 3072 -validity 36500`), then in GitHub →
Settings → Secrets and variables → Actions add `TV_KEYSTORE_BASE64` (`base64 -w0 tv.p12`) and
`TV_KEYSTORE_PASSWORD`. Keep the keystore file somewhere safe. Then run the workflow once
(Actions → RetroPlay TV → Run workflow, on `main`): an APK signed for a single run is replaced
by the permanently signed one even without app changes, and a permanently signed APK is never
replaced by a per-run one. Best before the first install on the TV; otherwise the switch needs one
uninstall (which deletes the app's data on the TV).

## Building

GitHub Actions (`.github/workflows/tv.yml`) builds it with Gradle 8.11 / AGP 8.7 (JDK 17), checks
the APK (signature, `leanback-launchable-activity`), publishes it as the `tv-latest` release (from
`main` only) and runs it on Android TV emulators (Google TV API 34 and Android TV API 33) against
the deploy of the same commit: install, the TV layout, the remote, a controller key event, a real
HTTP upload into the inbox, the import, the game's cover from GitHub, a game started in the
WebView, R2 switching fast forward, Back opening the game menu, Back on the home screen.
Screenshots and results of `main` runs are attached to the release as `ci-*` files.

Locally: `gradle -p tv/android assembleRelease -PretroplayUrl=https://…/` with the Android SDK.

## Not verified by the emulator

Speed on a real TV (the emulator draws with a software GPU), real Bluetooth controllers, the TV
remote's feel, sound, and sideloading on the owner's TV.
