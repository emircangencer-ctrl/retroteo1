import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
async function sources(dir = '../src/') {
  const out = [];
  for (const entry of await readdir(new URL(dir, import.meta.url), { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...await sources(`${dir}${entry.name}/`));
    else if (/\.(ts|js|svelte)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(await read(`${dir}${entry.name}`));
  }
  return out;
}

test('EmulatorJS is the only engine and nothing is loaded from a CDN at run time', async () => {
  const pkg = JSON.parse(await read('../package.json'));
  assert.equal(pkg.dependencies, undefined, 'no runtime npm dependencies: Svelte compiles into the bundle');
  assert.equal(pkg.scripts.postinstall, undefined);
  const all = (await sources()).join('\n');
  assert.doesNotMatch(all, /jsnes|nesjs|nes-core-player|nes-engine|requestedNesCore/);
  assert.doesNotMatch(all, /fonts\.googleapis|fonts\.gstatic|cdn\.emulatorjs\.org/, 'fonts and the emulator are served by the app itself');
  const fonts = await read('../src/styles/fonts.css');
  assert.match(fonts, /@fontsource-variable\/archivo\/files\/archivo-latin-ext-wdth-normal\.woff2/, 'Turkish letters (ğ, ş, İ) are in the bundled fonts');
});

test('the library renders one page at a time and loads more on scroll; filtering is derived, not a full rebuild', async () => {
  const library = await read('../src/views/Library.svelte');
  assert.match(library, /const PAGE_SIZE = 48;/);
  assert.match(library, /const visible = \$derived\(filtered\.slice\(0, limit\)\);/);
  assert.match(library, /new IntersectionObserver/);
  assert.match(library, /id="library-load-more"/);
  assert.match(library, /const filtered = \$derived\(sortGames\(filterGames\(/);
  const store = await read('../src/lib/library.svelte.ts');
  assert.match(store, /games = \$state\.raw<Game\[\]>\(\[\]\)/, 'the game list is not deeply proxied');
});

test('Drive import is opt-in and does not store OAuth access tokens in persistent storage', async () => {
  const [drive, panel] = await Promise.all([read('../src/google-drive.js'), read('../src/components/DrivePanel.svelte')]);
  assert.match(panel, /id="drive-connect"/);
  assert.match(panel, /id="drive-files"/);
  assert.match(drive, /https:\/\/www\.googleapis\.com\/auth\/drive\.readonly/);
  assert.doesNotMatch(drive + panel, /localStorage|sessionStorage|indexedDB/);
  assert.match(panel, /const tokenPromise = requestDriveAccessToken\(\{ clientId, googleLike: google \}\);/);
  assert.match(panel, /Preload Google Identity before the user clicks/);
  assert.ok(panel.indexOf('const tokenPromise = requestDriveAccessToken') < panel.indexOf('token = await tokenPromise'), 'the popup opens inside the click');
});
