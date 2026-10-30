// Which core(s) to try for a game, the file name the core must see and extra files (arcade BIOS
// and parent sets) — or why the game cannot start. Kept apart from the player so it can be tested.
import { ARCADE_CORES, onlyKeysMissing, isCps2KeyMissing, keyFindings, arcadeCoreSupported } from '../arcade.js';
import { STAND_IN_PARENT_ZIP } from '../lib/arcade-records.ts';
import type { BiosRecord, Game } from '../lib/types.ts';

export const SYSTEM_CORE_LABELS: Readonly<Record<string, string>> = Object.freeze({ NES: 'Nestopia', SNES: 'Snes9x', MD: 'Genesis Plus GX', ARCADE: 'FinalBurn Neo / MAME 2003-Plus' });

export interface CoreChoice { coreId: string; systemId: string; name: string; label: string; gameName?: string }
export interface ExtraFile { name: string; url: string }
export interface Blocked { status: string; message: string; bios?: string }
export type Launch = { cores: CoreChoice[]; gameName: string; extraFiles: ExtraFile[]; blocked?: undefined } | { blocked: Blocked; cores?: undefined; gameName?: undefined; extraFiles?: undefined };

export interface LaunchDeps {
  games: Game[];
  getBios: (id: string) => Promise<BiosRecord | null>;
  loadCatalogs: () => Promise<Record<string, unknown>>;
  readZipDirectory: (blob: Blob) => Promise<Array<{ name: string; crc?: string; size?: number }>>;
  makeUrl?: (blob: Blob) => string;
  revokeUrl?: (url: string) => void;
  /** ?nescore=fceumm (compare FCEUmm with Nestopia). */
  forcedNesCore?: string | null;
  /** Whether this browser can run an arcade core (default: arcadeCoreSupported). */
  coreSupported?: (coreId: string) => boolean;
}

interface SystemInfo { shortLabel: string; emulatorJsCoreId: string; emulatorJsSystemId: string }

const cores = ARCADE_CORES as Record<string, { label: string; systemId: string; opensParentZip?: boolean; requiresSimd?: boolean }>;

export async function resolveLaunch(game: Game, system: SystemInfo, { coreOverride = '' }: { coreOverride?: string }, deps: LaunchDeps): Promise<Launch> {
  const makeUrl = deps.makeUrl || (blob => URL.createObjectURL(blob));
  const revoke = deps.revokeUrl || (url => URL.revokeObjectURL(url));
  const prefer = (launch: Launch): Launch => {
    if (!coreOverride || launch.blocked) return launch;
    const chosen = launch.cores.find(core => core.coreId === coreOverride);
    return chosen ? { ...launch, cores: [chosen] } : launch;
  };
  if (game.platform === 'NES') {
    const forced = deps.forcedNesCore === 'fceumm';
    const nestopia: CoreChoice = { coreId: 'nestopia', systemId: 'nes', name: 'Nestopia', label: system.shortLabel };
    const fceumm: CoreChoice = { coreId: 'fceumm', systemId: 'nes', name: 'FCEUmm', label: forced ? `${system.shortLabel} / FCEUmm karşılaştırma modu` : `${system.shortLabel} / FCEUmm` };
    const list = forced ? [fceumm] : game.nesCore === 'fceumm' ? [fceumm, nestopia] : [nestopia, fceumm];
    return prefer({ cores: list, gameName: game.title, extraFiles: [] });
  }
  if (game.platform !== 'ARCADE') {
    return { cores: [{ coreId: system.emulatorJsCoreId, systemId: system.emulatorJsSystemId, name: SYSTEM_CORE_LABELS[game.platform] || system.shortLabel, label: system.shortLabel }], gameName: game.title, extraFiles: [] };
  }
  const arcade = game.arcade;
  if (!arcade?.set) return { blocked: { status: 'Başlatılamadı · set tanınmadı', message: 'Bu arcade dosyası tanınmadı. Dosyayı kütüphaneden kaldırıp yeniden içe aktar.' } };
  // Each core may know the zip under its own set name (a renamed zip matched by checksums).
  const choices = [{ core: arcade.core, set: arcade.set }, ...(arcade.alternatives || []).filter(alt => alt.status !== 'incomplete')]
    .filter((choice, i, all) => cores[choice.core] && all.findIndex(other => other.core === choice.core) === i);
  if (onlyKeysMissing(arcade)) return { blocked: await keyBlock(game, deps) };
  // A core this browser cannot run is left out; the game goes to the next core that knows its set.
  const supported = deps.coreSupported || ((id: string) => arcadeCoreSupported(id));
  const runnable = choices.filter(choice => supported(choice.core));
  if (!runnable.length) {
    const label = cores[choices[0]?.core]?.label || 'Bu çekirdek';
    return { blocked: { status: 'Başlatılamadı · tarayıcı güncel değil', message: `${label} bu tarayıcıda çalışamıyor: tarayıcının WebAssembly SIMD desteği yok. Tarayıcını güncelle (Chrome 91, Firefox 89, Safari 16.4 ya da daha yenisi) ve oyunu yeniden aç.` } };
  }
  const list: CoreChoice[] = runnable.map(choice => ({ coreId: choice.core, systemId: cores[choice.core].systemId, name: cores[choice.core].label, label: `Arcade · ${cores[choice.core].label}`, gameName: `${choice.set || arcade.set}.zip` }));
  const extraFiles: ExtraFile[] = [];
  const parentGame = () => deps.games.find(g => g.platform === 'ARCADE' && g.arcade?.set === arcade.parent && g.blob instanceof Blob);
  if (arcade.bios) {
    const bios = await deps.getBios(`${arcade.bios}.zip`).catch(() => null);
    if (!(bios?.blob instanceof Blob)) {
      return { blocked: { bios: `${arcade.bios}.zip`, status: `Başlatılamadı · ${arcade.bios}.zip gerekli`, message: `Bu oyun ${arcade.bios}.zip BIOS dosyasını istiyor. Aşağıdaki düğmeyle seç ya da oyun ekler gibi içe aktar (Ayarlar → BIOS dosyaları). Dosya cihazında kalır; bir kez eklemen yeter.` } };
    }
    extraFiles.push({ name: `${arcade.bios}.zip`, url: makeUrl(bios.blob) });
  }
  if (arcade.status === 'needs-parent' && arcade.parent) {
    const parent = parentGame();
    if (!parent?.blob) {
      for (const file of extraFiles) revoke(file.url);
      return { blocked: { status: `Başlatılamadı · ${arcade.parent}.zip gerekli`, message: `Bu set bir klon ve ana set ${arcade.parent}.zip olmadan açılamaz. ${arcade.parent}.zip dosyasını da içe aktar ya da her zip'in tek başına yettiği "non-merged" seti kullan.` } };
    }
    extraFiles.push({ name: `${arcade.parent}.zip`, url: makeUrl(parent.blob) });
  } else if (arcade.parent && list.some(core => cores[core.coreId]?.opensParentZip)) {
    // A complete clone: give FB Alpha 2012 the parent zip it insists on opening (a stand-in if absent).
    const parent = parentGame();
    extraFiles.push({ name: `${arcade.parent}.zip`, url: makeUrl(parent?.blob || new Blob([STAND_IN_PARENT_ZIP], { type: 'application/zip' })) });
  }
  return prefer({ cores: list, gameName: `${arcade.set}.zip`, extraFiles });
}

/** Why a set whose only missing files are decryption keys cannot start, and how to fix it. */
export async function keyBlock(game: Game, deps: Pick<LaunchDeps, 'loadCatalogs' | 'readZipDirectory'>): Promise<Blocked> {
  const arcade = game.arcade!;
  let cps2: boolean | null = typeof arcade.cps2Key === 'boolean' && Array.isArray(arcade.different) ? arcade.cps2Key : null;
  if (cps2 === null) {
    try { cps2 = Boolean(isCps2KeyMissing((await deps.loadCatalogs())[arcade.core], arcade.set, arcade.missing)); } catch { cps2 = true; }
  }
  const entries = game.blob ? await deps.readZipDirectory(game.blob).catch(() => null) : null;
  const found = (entries ? keyFindings(arcade.missing, entries) : { absent: arcade.missing, different: [] }) as { absent: string[]; different: string[] };
  const keys = arcade.missing.join(', ');
  const coreLabel = cores[arcade.core]?.label || 'FinalBurn Neo';
  const what = cps2 ? 'CPS2 şifre anahtarı' : 'şifre çözme anahtarı';
  const problem = found.different.length && !found.absent.length
    ? `Bu zip'teki ${keys} bu oyunun anahtarı değil: içeriği ${coreLabel}'un beklediğinden farklı.`
    : `Bu zip'te ${keys} yok.`;
  const why = cps2
    ? "CPS2 oyunlarının programı şifreli. FinalBurn Neo ve MAME 2003-Plus bu 20 baytlık anahtarı zip'te arıyor; anahtarları kendi içinde taşıyan FB Alpha 2012 CPS2 çekirdeği ise oyunun bu sürümünü tanımıyor (2012'den sonra eklenmiş bir sürüm)."
    : 'Bu oyunun programı şifreli ve çekirdek anahtar dosyası olmadan açamaz; setin diğer dosyaları doğru, yani set eski bir sürüm.';
  const fix = `Aynı oyunun ${coreLabel === 'MAME 2003-Plus' ? 'MAME 2003-Plus' : 'FinalBurn Neo 1.0.0.03'} setini (ya da MAME 0.178 sonrası bir setini) içe aktar; yeni kopya açılınca bu oyunu "Kütüphaneden kaldır" ile silebilirsin.`;
  return { status: `Başlatılamadı · ${what} ${found.different.length && !found.absent.length ? 'uyuşmuyor' : 'eksik'}`, message: `${problem} ${why} ${fix}` };
}

/** The core that opened a game is remembered for it (NES: FCEUmm; arcade: the core and its set name). */
export function rememberCore(game: Game, coreId: string): Game {
  if (game.platform === 'NES') return { ...game, nesCore: coreId };
  if (game.platform === 'ARCADE' && game.arcade) {
    const alt = (game.arcade.alternatives || []).find(choice => choice.core === coreId);
    const previous = { core: game.arcade.core, status: game.arcade.status, set: game.arcade.set };
    return { ...game, arcade: { ...game.arcade, core: coreId, set: alt?.set || game.arcade.set, status: alt?.status || game.arcade.status, alternatives: [previous, ...(game.arcade.alternatives || []).filter(choice => choice.core !== coreId)] } };
  }
  return game;
}
