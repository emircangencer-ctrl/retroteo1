// Builds RetroPlay's compact arcade catalogs from the DAT files of the exact core builds shipped
// with EmulatorJS 4.2.3. The output holds set names, titles and ROM sizes/CRC32s only — no game
// data. Run when the cores change:
//
//   node scripts/build-arcade-catalogs.mjs <fbneo-arcade.dat> <mame2003-plus.xml> <fba2012-d_cps2.c>
//   node scripts/build-arcade-catalogs.mjs --next <mame2003-plus src/drivers>   (RetroPlay's own MAME 2003-Plus build)
//
// Sources:
//   FinalBurn Neo:  EmulatorJS/FBNeo @ dedd04f2 — dats/FinalBurn Neo (ClrMame Pro XML, Arcade only).dat (v1.0.0.03)
//   MAME 2003-Plus: EmulatorJS/mame2003-plus-libretro @ 3a72dae — metadata/mame2003-plus.xml
//   FB Alpha 2012 CPS2: EmulatorJS/fbalpha2012_cps2 @ 3fb5b89 — src/burn/drv/capcom/d_cps2.c (the
//                   core ships no DAT; its ROM tables are read from the driver source)
// (the commits the EmulatorJS 4.2.3 cores were built from on 2025-06-14).
//   MAME 2003-Plus (2026): libretro/mame2003-plus-libretro @ 64b3c38a — src/drivers/namcos12.c
//                   (NEXT_DRIVERS; read from the driver source, the core's DAT lags behind it).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(root, 'public', 'assets');

const decode = text => text.replace(/&(amp|lt|gt|quot|apos|#(\d+));/g, (_, name, code) => code ? String.fromCharCode(Number(code)) : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name]);
const attrs = tag => Object.fromEntries([...tag.matchAll(/([a-z_]+)="([^"]*)"/g)].map(([, key, value]) => [key, decode(value)]));
const text = (body, name) => { const match = body.match(new RegExp(`<${name}>([^<]*)</${name}>`)); return match ? decode(match[1]).trim() : ''; };

/**
 * Compact form per game: [title, year, manufacturer, cloneof, romof, flags, roms, input?]
 * flags: 1 = BIOS set, 2 = vertical screen, 4 = not runnable
 * roms:  [name, size, crc32 hex, merge-name or ''] — ROMs without a dump (no CRC) are left out.
 * input: [buttons, joystick ways, players] when the DAT describes the controls (MAME XML does, FBNeo's not).
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
    const game = [text(body, 'description') || meta.name, text(body, 'year'), text(body, 'manufacturer'), meta.cloneof || '', meta.romof || '', flags, roms];
    // MAME lists the cabinet's controls: [buttons, joystick ways (4 or 8; 0 for dials, guns …), players].
    const input = body.match(/<input\s([^>]*)\/?>/);
    if (input) {
      const info = attrs(input[1]);
      const control = info.control || '';
      game.push([Number(info.buttons) || 0, /4way/.test(control) ? 4 : /joy|stick/.test(control) ? 8 : 0, Number(info.players) || 0]);
    }
    games[meta.name] = game;
  }
  return games;
}


/**
 * Same compact form from an FB Alpha driver source (BurnRomInfo tables + BurnDriver structs).
 * Like the core's loader (libretro.cpp open_archive), entries with no CRC/length and optional or
 * undumped ROMs are not required. Clone files with the parent's CRC get the parent's name as merge.
 */
export function compactFbaDriverSource(source) {
  const descs = {};
  for (const match of source.matchAll(/static\s+struct\s+BurnRomInfo\s+(\w+)RomDesc\[\]\s*=\s*\{([\s\S]*?)\n\};/g)) {
    const roms = [];
    for (const entry of match[2].matchAll(/\{\s*"([^"]*)"\s*,\s*(0x[0-9a-fA-F]+|\d+)\s*,\s*(0x[0-9a-fA-F]+|\d+)\s*,\s*([^}]*)\}/g)) {
      const [, name, size, crc, type] = entry;
      const length = Number(size), checksum = Number(crc) >>> 0;
      if (!name || !length || !checksum || /^\s*0\s*$/.test(type)) continue;
      if (/BRF_OPT|BRF_NODUMP/.test(type)) continue;
      roms.push([name, length, checksum.toString(16).padStart(8, '0')]);
    }
    descs[match[1]] = roms;
  }
  const picks = {};
  for (const match of source.matchAll(/STD_ROM_PICK\((\w+)\)/g)) picks[`${match[1]}RomInfo`] = match[1];
  const drivers = [];
  for (const match of source.matchAll(/struct\s+BurnDriver\s+\w+\s*=\s*\{([\s\S]*?)\n\};/g)) {
    const body = match[1];
    const strings = [...body.matchAll(/NULL|"((?:[^"\\]|\\.)*)"/g)].slice(0, 9).map(item => (item[0] === 'NULL' ? '' : item[1]));
    const [name, parent, board, , year, fullName, , maker] = strings;
    const romInfo = (body.match(/(\w+RomInfo)\b/) || [])[1];
    const flags = (body.match(/(BDF_[A-Z_|\s]+)/) || [''])[0];
    if (!name || !romInfo || !picks[romInfo] || !descs[picks[romInfo]]) continue;
    drivers.push({ name, parent, board, year, title: fullName.replace(/\\0.*$/, '').replace(/\\(.)/g, '$1').trim(), maker, vertical: /BDF_ORIENTATION_VERTICAL/.test(flags), bios: /BDF_BOARDROM/.test(flags), roms: descs[picks[romInfo]] });
  }
  const byName = Object.fromEntries(drivers.map(driver => [driver.name, driver]));
  const games = {};
  for (const driver of drivers) {
    const parentRoms = new Map((byName[driver.parent]?.roms || []).map(([name, , crc]) => [crc, name]));
    const roms = driver.roms.map(([name, size, crc]) => [name, size, crc, parentRoms.get(crc) || '']);
    games[driver.name] = [driver.title || driver.name, driver.year, driver.maker, driver.parent || '', driver.parent || driver.board || '', (driver.bios ? 1 : 0) | (driver.vertical ? 2 : 0), roms];
  }
  return games;
}

function write(file, catalog) {
  const json = JSON.stringify(catalog);
  fs.writeFileSync(path.join(OUT_DIR, file), json);
  return json.length;
}

/**
 * Same compact form from MAME driver sources (ROM_START … ROM_END blocks and GAMEX lines), for
 * RetroPlay's own MAME 2003-Plus build: its shipped DAT (metadata/mame2003-plus.xml) lags behind
 * the drivers, so the sets are read from the source the core is compiled from. Undumped ROMs are
 * left out; bad dumps are kept (the core loads them by CRC). A clone file with a CRC of its parent's
 * gets the parent's name as merge.
 */
export function compactMameDriverSource(source) {
  const sets = {};
  for (const match of source.matchAll(/ROM_START\(\s*(\w+)\s*\)([\s\S]*?)ROM_END/g)) {
    const roms = [];
    for (const rom of match[2].matchAll(/ROMX?_LOAD\w*\(\s*"([^"]+)"\s*,\s*[^,]+,\s*(0x[0-9a-fA-F]+|\d+)\s*,\s*([^)]*?CRC\(([0-9a-fA-F]{1,8})\)|NO_DUMP)/g)) {
      if (!rom[4]) continue; // NO_DUMP
      roms.push([rom[1], Number(rom[2]), rom[4].toLowerCase().padStart(8, '0')]);
    }
    sets[match[1]] = roms;
  }
  const games = {};
  const entries = [];
  for (const match of source.matchAll(/GAMEX?\(\s*(\d{4}|\?{4}|19\?\?)\s*,\s*(\w+)\s*,\s*(\w+)\s*,\s*\w+\s*,\s*\w+\s*,\s*\w+\s*,\s*(ROT\d+)\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*(?:,\s*([^)]*))?\)/g)) {
    const [, year, name, parent, rot, maker, title, flags = ''] = match;
    if (!sets[name] || /NOT_A_DRIVER/.test(flags)) continue;
    entries.push({ year, name, parent: parent === '0' ? '' : parent, vertical: rot === 'ROT90' || rot === 'ROT270', maker, title });
  }
  for (const entry of entries) {
    const parentRoms = new Map((sets[entry.parent] || []).map(([name, , crc]) => [crc, name]));
    const roms = sets[entry.name].map(([name, size, crc]) => [name, size, crc, parentRoms.get(crc) || '']);
    games[entry.name] = [entry.title.replace(/\\(.)/g, '$1'), entry.year, entry.maker, entry.parent, entry.parent, entry.vertical ? 2 : 0, roms];
  }
  return games;
}

/**
 * Drivers RetroPlay runs with its own build of the current MAME 2003-Plus (mame2003_plus_next,
 * .github/workflows/cores.yml) instead of the 2025 EmulatorJS build. Namco System 12 (Tekken 3,
 * Tekken Tag Tournament, Soul Calibur …): the 2025 build runs its main CPU at two thirds of the
 * board's clock and has no sound; the current sources run it at the clock of current MAME, emulate
 * the sound CPU and C352, and skip the CPU's wait loops.
 */
export const NEXT_DRIVERS = Object.freeze(['namcos12.c']);
export const NEXT_SOURCE = 'libretro/mame2003-plus-libretro 64b3c38a';

/**
 * The cabinet controls alone, for starting a game: set → [buttons, joystick ways, players] from the
 * MAME 2003-Plus catalog (about 1/30 of its size, so a game does not wait for the whole list).
 */
export function inputTable(mameGames) {
  const games = {};
  for (const [name, game] of Object.entries(mameGames)) if (Array.isArray(game[7])) games[name] = game[7];
  return { source: 'MAME 2003-Plus input data (arcade-mame2003plus.json)', games };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === '--input') {
  // node scripts/build-arcade-catalogs.mjs --input   (from the shipped MAME 2003-Plus catalog)
  const mame = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'arcade-mame2003plus.json'), 'utf8'));
  const table = inputTable(mame.games);
  const size = write('arcade-input.json', table);
  console.log(`arcade-input: ${Object.keys(table.games).length} sets, ${(size / 1e3).toFixed(1)} KB`);
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === '--next') {
  // node scripts/build-arcade-catalogs.mjs --next <src/drivers directory of the pinned commit>
  const dir = process.argv[3];
  if (!dir) { console.error('usage: node scripts/build-arcade-catalogs.mjs --next <mame2003-plus src/drivers>'); process.exit(2); }
  const games = Object.assign({}, ...NEXT_DRIVERS.map(file => compactMameDriverSource(fs.readFileSync(path.join(dir, file), 'utf8'))));
  const next = { core: 'mame2003_plus_next', label: 'MAME 2003-Plus (2026)', version: `MAME 2003-Plus (${NEXT_SOURCE}; ${NEXT_DRIVERS.join(', ')})`, games };
  const size = write('arcade-mame2003plus-next.json', next);
  console.log(`mame2003_plus_next: ${Object.keys(next.games).length} sets, ${(size / 1e3).toFixed(1)} KB`);
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [fbneoDat, mameXml, fbaCps2Source] = process.argv.slice(2);
  if (!fbneoDat || !mameXml || !fbaCps2Source) {
    console.error('usage: node scripts/build-arcade-catalogs.mjs <fbneo-arcade.dat> <mame2003-plus.xml> <fba2012-d_cps2.c>');
    process.exit(2);
  }
  const fbneo = { core: 'fbneo', label: 'FinalBurn Neo', version: 'FinalBurn Neo v1.0.0.03 (EmulatorJS/FBNeo dedd04f2)', games: compactDat(fs.readFileSync(fbneoDat, 'utf8')) };
  const mame = { core: 'mame2003_plus', label: 'MAME 2003-Plus', version: 'MAME 2003-Plus (EmulatorJS/mame2003-plus-libretro 3a72dae, MAME 0.78 tabanlı)', games: compactDat(fs.readFileSync(mameXml, 'utf8')) };
  const fba = { core: 'fbalpha2012_cps2', label: 'FB Alpha 2012 CPS2', version: 'FB Alpha 2012 CPS2 (EmulatorJS/fbalpha2012_cps2 3fb5b89, FB Alpha 0.2.97.28 tabanlı)', games: compactFbaDriverSource(fs.readFileSync(fbaCps2Source, 'utf8')) };
  const a = write('arcade-fbneo.json', fbneo);
  const b = write('arcade-mame2003plus.json', mame);
  const c = write('arcade-fba2012-cps2.json', fba);
  write('arcade-input.json', inputTable(mame.games));
  console.log(`fbneo: ${Object.keys(fbneo.games).length} sets, ${(a / 1e6).toFixed(2)} MB; mame2003_plus: ${Object.keys(mame.games).length} sets, ${(b / 1e6).toFixed(2)} MB; fbalpha2012_cps2: ${Object.keys(fba.games).length} sets, ${(c / 1e6).toFixed(2)} MB`);
}
