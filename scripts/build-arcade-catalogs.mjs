// Builds RetroPlay's compact arcade catalogs from the DAT files of the exact core builds shipped
// with EmulatorJS 4.2.3. The output holds set names, titles and ROM sizes/CRC32s only — no game
// data. Run when the cores change:
//
//   node scripts/build-arcade-catalogs.mjs <fbneo-arcade.dat> <mame2003-plus.xml>
//
// Sources:
//   FinalBurn Neo:  EmulatorJS/FBNeo @ dedd04f2 — dats/FinalBurn Neo (ClrMame Pro XML, Arcade only).dat (v1.0.0.03)
//   MAME 2003-Plus: EmulatorJS/mame2003-plus-libretro @ 3a72dae — metadata/mame2003-plus.xml
// (the commits the EmulatorJS 4.2.3 cores were built from on 2025-06-14).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(root, 'public', 'assets');

const decode = text => text.replace(/&(amp|lt|gt|quot|apos|#(\d+));/g, (_, name, code) => code ? String.fromCharCode(Number(code)) : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name]);
const attrs = tag => Object.fromEntries([...tag.matchAll(/([a-z_]+)="([^"]*)"/g)].map(([, key, value]) => [key, decode(value)]));
const text = (body, name) => { const match = body.match(new RegExp(`<${name}>([^<]*)</${name}>`)); return match ? decode(match[1]).trim() : ''; };

/**
 * Compact form per game: [title, year, manufacturer, cloneof, romof, flags, roms]
 * flags: 1 = BIOS set, 2 = vertical screen, 4 = not runnable
 * roms:  [name, size, crc32 hex, merge-name or ''] — ROMs without a dump (no CRC) are left out.
 */
export function compactDat(xml) {
  const games = {};
  for (const match of xml.matchAll(/<(game|machine)\s([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const meta = attrs(match[2]);
    const body = match[3];
    if (!meta.name) continue;
    let flags = 0;
    if (meta.isbios === 'yes') flags |= 1;
    const video = body.match(/<video\s([^>]*)\/>/);
    if (video && attrs(video[1]).orientation === 'vertical') flags |= 2;
    if (meta.runnable === 'no') flags |= 4;
    const roms = [];
    for (const rom of body.matchAll(/<rom\s([^>]*)\/>/g)) {
      const info = attrs(rom[1]);
      if (!info.crc || info.status === 'nodump') continue;
      roms.push([info.name, Number(info.size) || 0, info.crc.toLowerCase().padStart(8, '0'), info.merge || '']);
    }
    games[meta.name] = [text(body, 'description') || meta.name, text(body, 'year'), text(body, 'manufacturer'), meta.cloneof || '', meta.romof || '', flags, roms];
  }
  return games;
}

function write(file, catalog) {
  const json = JSON.stringify(catalog);
  fs.writeFileSync(path.join(OUT_DIR, file), json);
  return json.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [fbneoDat, mameXml] = process.argv.slice(2);
  if (!fbneoDat || !mameXml) {
    console.error('usage: node scripts/build-arcade-catalogs.mjs <fbneo-arcade.dat> <mame2003-plus.xml>');
    process.exit(2);
  }
  const fbneo = { core: 'fbneo', label: 'FinalBurn Neo', version: 'FinalBurn Neo v1.0.0.03 (EmulatorJS/FBNeo dedd04f2)', games: compactDat(fs.readFileSync(fbneoDat, 'utf8')) };
  const mame = { core: 'mame2003_plus', label: 'MAME 2003-Plus', version: 'MAME 2003-Plus (EmulatorJS/mame2003-plus-libretro 3a72dae, MAME 0.78 tabanlı)', games: compactDat(fs.readFileSync(mameXml, 'utf8')) };
  const a = write('arcade-fbneo.json', fbneo);
  const b = write('arcade-mame2003plus.json', mame);
  console.log(`fbneo: ${Object.keys(fbneo.games).length} sets, ${(a / 1e6).toFixed(2)} MB; mame2003_plus: ${Object.keys(mame.games).length} sets, ${(b / 1e6).toFixed(2)} MB`);
}
