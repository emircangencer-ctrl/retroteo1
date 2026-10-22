import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const drive = await readFile(new URL('../src/google-drive.js', import.meta.url), 'utf8');

test('legacy NES diagnostic engines are loaded on demand, not in the initial app module', () => {
  assert.doesNotMatch(app, /import\s+\{\s*Browser\s+as\s+NesBrowser[^\n]*\}\s+from\s+['"]jsnes['"]/);
  assert.doesNotMatch(app, /import\s+\{\s*BrowserNesPlayer\s*\}\s+from\s+['"]\.\/nes-core-player\.js['"]/);
  assert.match(app, /await import\(['"]jsnes['"]\)/);
  assert.match(app, /await import\(['"]\.\/nes-core-player\.js['"]\)/);
  assert.match(app, /await import\(['"]\.\/nes-engine\.js['"]\)/);
});

test('library search schedules only the library results instead of rebuilding every view per keystroke', () => {
  assert.match(app, /function scheduleLibraryRender\(\)/);
  assert.match(app, /requestAnimationFrame\(\(\)=>\{libraryRenderFrame=0;renderLibraryResults\(\);\}\)/);
  const searchHandler = app.match(/\$\('#search-input'\)\.addEventListener\('input',([\s\S]*?)\);\$\('#sort-select'/)?.[1] || '';
  assert.ok(searchHandler, 'search input handler should exist');
  assert.match(searchHandler, /scheduleLibraryRender\(\)/);
  assert.doesNotMatch(searchHandler, /renderAll\(\)/);
  assert.match(app, /const GRID_PAGE_SIZE = 48/);
  assert.match(app, /lib\.slice\(0,libraryVisibleLimit\)/);
  assert.match(html, /id="library-load-more"/);
  assert.match(html, /id="favorites-load-more"/);
  assert.match(html, /id="recent-load-more"/);
});
test('Drive import is opt-in and does not store OAuth access tokens in persistent storage', () => {
  assert.match(html, /id="drive-connect"/);
  assert.match(html, /id="drive-files"/);
  assert.match(drive, /https:\/\/www\.googleapis\.com\/auth\/drive\.readonly/);
  assert.doesNotMatch(drive, /localStorage|sessionStorage|indexedDB/);
  assert.match(app, /driveAccessToken=await requestDriveAccessToken/);
});
