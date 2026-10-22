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
  assert.match(app, /\$\('#search-input'\)\.addEventListener\('input',\(\)=>\{if\(\$\('#view-library'\)\.classList\.contains\('active'\)\)scheduleLibraryRender\(\);\}\)/);
  assert.doesNotMatch(app, /\$\('#search-input'\)\.addEventListener\('input',[^;]*renderAll\(\)/);
});

test('Drive import is opt-in and does not store OAuth access tokens in persistent storage', () => {
  assert.match(html, /id="drive-connect"/);
  assert.match(html, /id="drive-files"/);
  assert.match(drive, /https:\/\/www\.googleapis\.com\/auth\/drive\.readonly/);
  assert.doesNotMatch(drive, /localStorage|sessionStorage|indexedDB/);
  assert.match(app, /driveAccessToken=await requestDriveAccessToken/);
});
