// Pilotage d'un appareil Android (émulateur) par Playwright : branchement sur la WebView, touches,
// attente de stabilité, captures. Générique : le nom du paquet est passé en paramètre.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import path from 'node:path';
import { pageActions, guard } from './page.mjs';

const require = createRequire(import.meta.url);
const { _android } = require('@playwright/test');

// Codes des touches Android (télécommande et bouton retour).
const KEYCODES = { up: 19, down: 20, left: 21, right: 22, ok: 23, back: 4 };

const { PNG } = require('pngjs');

/**
 * Confidentialité : noircit le bandeau de suggestions du clavier système (Gboard y montre le
 * presse-papiers, partagé avec le PC par l'émulateur : e-mail, mot de passe copié…).
 * `keyboardTop` : haut du clavier en pixels de la capture ; bande de 50 dp sous ce bord.
 */
export function maskKeyboardStrip(file, keyboardTop, density) {
  const png = PNG.sync.read(readFileSync(file));
  const y0 = Math.max(0, Math.round(keyboardTop));
  const y1 = Math.min(png.height, y0 + Math.round(50 * density));
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      png.data[i] = 24; png.data[i + 1] = 26; png.data[i + 2] = 36; png.data[i + 3] = 255;
    }
  }
  writeFileSync(file, PNG.sync.write(png));
}

export function adbPath() {
  const sdk = process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
  return path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
}

/**
 * adb, en attendant la fin. `serial` null : adb sans appareil désigné. Options facultatives en
 * premier argument ({ timeout } en ms, 60 s par défaut) : un émulateur figé ne bloque jamais
 * l'outil, la commande rend alors une réponse vide.
 */
export function adb(serial, ...args) {
  const opts = args[0] && typeof args[0] === 'object' ? args.shift() : {};
  const r = spawnSync(adbPath(), [...(serial ? ['-s', serial] : []), ...args], { encoding: 'utf8', timeout: opts.timeout ?? 60000 });
  return (r.stdout || '').trim();
}

/**
 * adb sans bloquer : les appels lourds (captures, lecture de l'écran) laissent tourner l'autre
 * appareil pendant qu'ils attendent. `binary` : sortie brute (image), sinon texte. Délai maximum :
 * un émulateur figé fait échouer la commande au lieu de tout bloquer.
 */
export function adbAsync(serial, args, { binary = false, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(adbPath(), ['-s', serial, ...args]);
    const chunks = [];
    const timer = setTimeout(() => { p.kill(); reject(new Error(`adb ${args.join(' ')} : pas de réponse en ${timeout / 1000} s`)); }, timeout);
    p.stdout.on('data', (c) => chunks.push(c));
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(chunks);
      if (binary && (code !== 0 || !out.length)) return reject(new Error(`adb ${args.join(' ')} : code ${code}`));
      resolve(binary ? out : out.toString('utf8').trim());
    });
  });
}

/**
 * Émulateurs branchés, avec leur type (tv / phone) et le nom de leur appareil virtuel.
 * `serials` : seulement ceux-là (les autres émulateurs en marche sont ignorés).
 */
export async function listDevices(serials = null) {
  process.env.PATH = `${path.dirname(adbPath())}${path.delimiter}${process.env.PATH}`;
  let timer;
  const devices = await Promise.race([
    _android.devices(),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('adb ne répond pas (liste des appareils)')), 60000); }),
  ]).finally(() => clearTimeout(timer));
  return devices.filter((device) => !serials || serials.includes(device.serial())).map((device) => {
    const features = adb(device.serial(), 'shell', 'pm', 'list', 'features');
    const avd = adb(device.serial(), 'emu', 'avd', 'name').split(/\r?\n/)[0].trim();
    return { device, serial: device.serial(), model: device.model(), avd, kind: features.includes('android.software.leanback') ? 'tv' : 'phone' };
  });
}

/** Branche Playwright sur la WebView de l'app. Échoue clairement si l'APK n'autorise pas le débogage. */
export async function attach(device, pkg, timeout = 20000) {
  try {
    const webview = await device.webView({ pkg }, { timeout });
    return await webview.page();
  } catch (e) {
    throw new Error(`Impossible de se brancher sur la WebView de ${pkg} (${device.serial()}). ` +
      'L\'app est-elle ouverte, et est-ce bien l\'APK d\'audit (option « audit ») ? ' + e.message.split('\n')[0]);
  }
}

/** Identifiant de l'écran principal (l'émulateur téléphone à taille variable en déclare plusieurs). */
function displayId(serial) {
  const out = adb(serial, 'shell', 'dumpsys', 'SurfaceFlinger', '--display-id');
  return out.match(/Display (\d+)/)?.[1] || null;
}

/** Position de la WebView à l'écran, en pixels réels (hors barres système), via uiautomator. */
async function webviewFrame(serial) {
  await adbAsync(serial, ['shell', 'uiautomator', 'dump', '/sdcard/audit-ui.xml']);
  const xml = await adbAsync(serial, ['shell', 'cat', '/sdcard/audit-ui.xml']);
  const m = xml.match(/class="android\.webkit\.WebView"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!m) return null;
  const [x1, y1, x2, y2] = m.slice(1).map(Number);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * Pilote d'un appareil Android : gestes communs de la page (page.mjs) + touches, clavier système,
 * toucher et captures par Android. `bridge` : nom de l'objet global du pont d'audit de l'app, ou null.
 */
export function makeDriver(entry, page, { bridge = null, scope = null, loading = [] } = {}) {
  const { serial } = entry;
  const display = entry.kind === 'phone' ? displayId(serial) : null;
  const d = {
    ...pageActions(page, bridge, { scope, loading }),
    serial,
    kind: entry.kind,
    /** Touche de télécommande ou bouton retour, comme un vrai appui. */
    key: async (name, settleMs = 450) => {
      adb(serial, 'shell', 'input', 'keyevent', String(KEYCODES[name]));
      await page.waitForTimeout(settleMs);
    },
    /** Le clavier système (Gboard) est-il affiché ? Invisible depuis la page, d'où la question à Android. */
    keyboardShown: async () => /mInputShown=true/.test(await adbAsync(serial, ['shell', 'dumpsys', 'input_method'])),
    /** Ouvre le clavier système sur un champ, comme un utilisateur : OK à la télécommande, appui au doigt. */
    openKeyboard: async (selector) => {
      if (entry.kind === 'tv') {
        await page.evaluate((s) => document.querySelector(s)?.focus(), selector);
        adb(serial, 'shell', 'input', 'keyevent', String(KEYCODES.ok));
      } else {
        await d.tap(selector); // un vrai toucher : l'appui simulé par Playwright n'ouvre pas le clavier
      }
      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(300);
        if (await d.keyboardShown()) break;
      }
      // Comment le clavier s'est ouvert : noté sur la capture (TV : OK doit suffire, le toucher n'est qu'un secours).
      d.memo.keyboardVia = (await d.keyboardShown()) ? (entry.kind === 'tv' ? 'OK' : 'toucher') : null;
      // TV : après un démarrage à froid, le clavier de l'émulateur peut ignorer OK tant qu'un premier
      // toucher ne l'a pas réveillé (vu le 22/09). Le toucher sert alors de secours.
      if (entry.kind === 'tv' && !(await d.keyboardShown())) {
        await d.tap(selector);
        for (let i = 0; i < 10 && !(await d.keyboardShown()); i++) await page.waitForTimeout(300);
        if (await d.keyboardShown()) d.memo.keyboardVia = 'toucher de secours (OK sans effet)';
      }
      await page.waitForTimeout(600); // la fenêtre finit de se redimensionner
      return d.keyboardShown();
    },
    /** Vrai toucher Android au centre d'un élément (coordonnées : WebView à l'écran + densité). */
    tap: async (selector) => {
      const c = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, vw: innerWidth };
      }, selector);
      const f = await webviewFrame(serial);
      if (!c || !f) return false;
      // Échelle réelle de la page dans l'écran (largeur de la WebView / largeur de la page) : la densité
      // seule est fausse quand la page est mise à l'échelle (toile TV de 1280 de large, 23/09).
      const k = f.w / c.vw;
      adb(serial, 'shell', 'input', 'tap', String(Math.round(f.x + c.x * k)), String(Math.round(f.y + c.y * k)));
      return true;
    },
    /** Paquet de l'app au premier plan (une fenêtre du système peut surgir par-dessus l'app auditée). */
    foreground: async () => {
      const out = await adbAsync(serial, ['shell', 'dumpsys', 'activity', 'activities']);
      return out.match(/(?:topResumedActivity|mResumedActivity)[=:]\s*ActivityRecord\{\S+ \S+ ([^/\s]+)\//)?.[1] || null;
    },
    /** Emplacement de la WebView dans la capture (pour y placer les cadres des constats). */
    frame: () => webviewFrame(serial),
    /** Tape un texte dans le champ focalisé, comme au clavier. */
    typeText: async (text) => {
      adb(serial, 'shell', 'input', 'text', text.replace(/ /g, '%s'));
      await page.waitForTimeout(900);
    },
    // Capture de l'écran par Android : le vrai rendu. Les captures de Playwright ne sont pas fidèles
    // (mosaïque sur TV avec la toile mise à l'échelle, textes réduits sur téléphone).
    screenshot: async (file) => {
      writeFileSync(file, await adbAsync(serial, ['exec-out', 'screencap', '-p', ...(display ? ['-d', display] : [])], { binary: true }));
    },
  };
  return guard(d);
}

/** Ouvre l'app par son lanceur (sans connaître le nom de son activité). */
export function launchApp(serial, pkg) {
  adb(serial, 'shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1');
}

/**
 * Vérifications avant l'audit : un banc d'essai faux donne un rapport faux.
 * Retourne { ok: [...], problems: [...] } ; un problème bloque l'audit de cet appareil.
 */
export function preflight(entry, pkg) {
  const { serial, kind } = entry;
  const ok = [];
  const problems = [];
  // Réparable par un redémarrage à froid de l'émulateur (le lanceur s'en charge).
  let needsRestart = false;
  const drift = Math.abs(Number(adb(serial, 'shell', 'date', '+%s')) - Date.now() / 1000);
  if (drift > 120) {
    problems.push(`Horloge décalée de ${Math.round(drift / 60)} min : un service de comptes refusera la session. Redémarrer l'émulateur à froid (-no-snapshot-load).`);
    needsRestart = true;
  } else ok.push('horloge à l\'heure');
  // App fermée (typiquement après l'installation d'un APK) : relancée d'office, puis on attend sa WebView.
  const webviewUp = () => /webview_devtools_remote/.test(adb(serial, 'shell', 'cat', '/proc/net/unix'));
  let up = webviewUp();
  if (!up && pkg) {
    launchApp(serial, pkg);
    // Attente synchrone d'une seconde entre deux essais (au plus 30 s).
    for (let i = 0; i < 30 && !up; i++) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000); up = webviewUp(); }
    if (up) ok.push('app relancée');
  }
  if (!up) problems.push('WebView non pilotable : l\'app est-elle installée, et est-ce bien l\'APK d\'audit (option « audit ») ?');
  else ok.push('WebView pilotable');
  // App vivante mais en arrière-plan (derrière l'accueil du système, vu le 22/09 sur TV) : le
  // branchement attendait indéfiniment qu'elle se montre. Elle est ramenée au premier plan.
  if (up && pkg) {
    const top = () => adb(serial, 'shell', 'dumpsys', 'activity', 'activities').match(/(?:topResumedActivity|mResumedActivity)[=:]\s*ActivityRecord\{\S+ \S+ ([^/\s]+)\//)?.[1];
    if (top() !== pkg) {
      launchApp(serial, pkg);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
      ok.push(top() === pkg ? 'app ramenée au premier plan' : 'app peut-être en arrière-plan');
    }
  }
  if (kind === 'phone') {
    // Depuis Android 15, l'écran tactile de l'émulateur se déclare aussi « stylet » : Gboard remplace
    // alors le clavier par sa barre d'écriture au stylet (pilule flottante). Réglage d'émulateur,
    // appliqué d'office : sans lui, aucune capture « clavier ouvert » n'est représentative.
    if (adb(serial, 'shell', 'settings', 'get', 'secure', 'stylus_handwriting_enabled') !== '0') {
      adb(serial, 'shell', 'settings', 'put', 'secure', 'stylus_handwriting_enabled', '0');
      adb(serial, 'shell', 'am', 'force-stop', 'com.google.android.inputmethod.latin');
      ok.push('écriture au stylet désactivée (vrai clavier)');
    } else ok.push('écriture au stylet désactivée');
    const size = adb(serial, 'shell', 'wm', 'size');
    ok.push(`écran ${(size.match(/Override size: (\S+)/) || size.match(/Physical size: (\S+)/) || [])[1] || '?'}`);
    // Un clavier physique déclaré (hw.keyboard=yes) remplace le clavier à l'écran par une petite
    // barre flottante : lu dans la configuration de l'émulateur, seule source fiable.
    const avd = adb(serial, 'emu', 'avd', 'name').split(/\r?\n/)[0].trim();
    let config = '';
    try { config = readFileSync(path.join(process.env.USERPROFILE || process.env.HOME || '', '.android', 'avd', `${avd}.avd`, 'config.ini'), 'utf8'); } catch { /* émulateur hors du dossier habituel */ }
    if (/^hw\.keyboard\s*=\s*yes/m.test(config)) {
      problems.push(`Émulateur ${avd} : clavier physique déclaré, le vrai clavier à l'écran ne s'affichera pas. Mettre hw.keyboard=no dans sa configuration et le redémarrer (audit/README.md).`);
    } else ok.push(config ? 'clavier à l\'écran réel' : 'configuration de l\'émulateur introuvable (clavier non vérifié)');
  }
  return { ok, problems, needsRestart };
}
