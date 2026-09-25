// Cycle de vie des émulateurs : démarrage, attente du démarrage complet, redémarrage d'un émulateur
// bloqué, arrêt, changement de taille d'écran. Générique : noms des appareils virtuels, tailles et
// paquet sont fournis par l'app. Aucune attente sans délai maximum : un émulateur qui ne répond
// plus est redémarré, jamais attendu indéfiniment.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { adb, adbPath, launchApp } from './android.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function emulatorPath() {
  const sdk = process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
  return path.join(sdk, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator');
}

/** Émulateurs en marche : { numéro de série: nom de l'appareil virtuel }. */
export function runningEmulators() {
  const out = {};
  const lines = adb(null, 'devices').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^(emulator-\d+)\s+device$/);
    if (!m) continue;
    const name = adb(m[1], 'emu', 'avd', 'name').split(/\r?\n/)[0].trim();
    if (name) out[m[1]] = name;
  }
  return out;
}

/** L'émulateur répond-il ? (une commande simple, 15 s au plus) */
export function alive(serial) {
  return adb(serial, { timeout: 15000 }, 'shell', 'echo', 'ok') === 'ok';
}

/**
 * Démarre un appareil virtuel et attend qu'il soit prêt. Toujours à froid et sans instantané :
 * l'horloge est juste (piège de l'horloge figée) et l'instantané de l'utilisateur n'est pas touché.
 * Retourne son numéro de série.
 */
export async function startEmulator(avd, { log = console.log, bootTimeoutMin = 6 } = {}) {
  if (!existsSync(emulatorPath())) throw new Error(`Émulateur Android introuvable : ${emulatorPath()}`);
  const before = new Set(Object.keys(runningEmulators()));
  const p = spawn(emulatorPath(), ['-avd', avd, '-no-snapshot', '-no-boot-anim', '-no-audio'], { detached: true, stdio: 'ignore' });
  p.unref();
  log(`[${avd}] démarrage à froid…`);
  const deadline = Date.now() + bootTimeoutMin * 60000;
  let serial = null;
  while (Date.now() < deadline) {
    await sleep(3000);
    if (!serial) {
      serial = Object.entries(runningEmulators()).find(([s, n]) => n === avd && !before.has(s))?.[0] || null;
      continue;
    }
    if (adb(serial, { timeout: 10000 }, 'shell', 'getprop', 'sys.boot_completed') === '1') {
      // Le système est prêt ; le gestionnaire de paquets et le clavier finissent de démarrer.
      await sleep(8000);
      log(`[${avd}] prêt (${serial}) en ${Math.round((Date.now() - deadline + bootTimeoutMin * 60000) / 1000)} s`);
      return serial;
    }
  }
  if (serial) stopEmulator(serial);
  throw new Error(`${avd} n'a pas démarré en ${bootTimeoutMin} min`);
}

/** Arrête un émulateur et attend sa disparition (30 s au plus, puis on n'attend plus). */
export async function stopEmulatorAndWait(serial) {
  stopEmulator(serial);
  for (let i = 0; i < 15 && runningEmulators()[serial]; i++) await sleep(2000);
}

export function stopEmulator(serial) {
  adb(serial, { timeout: 15000 }, 'emu', 'kill');
}

/** Redémarre un émulateur bloqué ; retourne son nouveau numéro de série. */
export async function restartEmulator(serial, avd, opts = {}) {
  (opts.log || console.log)(`[${avd}] ne répond plus ou bloque : redémarrage`);
  await stopEmulatorAndWait(serial);
  await sleep(3000);
  return startEmulator(avd, opts);
}

/**
 * Émulateurs demandés en marche : démarre ceux qui manquent. `wanted` : { type: nom }.
 * Retourne { started: [numéros de série démarrés par l'outil], serials: { type: numéro } }.
 */
export async function ensureEmulators(wanted, opts = {}) {
  const running = runningEmulators();
  const serials = {};
  const started = [];
  await Promise.all(Object.entries(wanted).map(async ([kind, avd]) => {
    let serial = Object.entries(running).find(([, n]) => n === avd)?.[0];
    if (serial && !alive(serial)) serial = await restartEmulator(serial, avd, opts);
    if (!serial) { serial = await startEmulator(avd, opts); started.push(serial); }
    serials[kind] = serial;
  }));
  return { started, serials };
}

/**
 * Taille d'écran : `preset` = { size: '1080x2340', density: 480 }, ou null pour la taille d'origine.
 * L'app est relancée : elle lit la taille de l'écran au démarrage.
 */
export function applySize(serial, preset, pkg) {
  if (preset) {
    adb(serial, { timeout: 20000 }, 'shell', 'wm', 'size', preset.size);
    adb(serial, { timeout: 20000 }, 'shell', 'wm', 'density', String(preset.density));
  } else {
    adb(serial, { timeout: 20000 }, 'shell', 'wm', 'size', 'reset');
    adb(serial, { timeout: 20000 }, 'shell', 'wm', 'density', 'reset');
  }
  if (pkg) {
    adb(serial, { timeout: 20000 }, 'shell', 'am', 'force-stop', pkg);
    launchApp(serial, pkg);
  }
}

export { adbPath };
