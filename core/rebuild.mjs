// Recompilation des versions d'audit de l'app, pour les plateformes touchées par une correction :
// Android (TV et téléphone : un seul APK, installé sur les émulateurs qui tournent) et bureau. Les
// commandes sont fournies par l'app (BUILD_AUDIT_APP, BUILD_AUDIT_DESKTOP dans son screens.mjs).
// Avant le 23/09, l'étape « après » ne recompilait que l'APK : une correction Windows était comparée
// à l'ancien exécutable (trou connu).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { codeId } from './build-id.mjs';
import { outRoot, AUDIT_DIR } from './app.mjs';

/**
 * Dernier code compilé par plateforme ({ android, desktop }) et, pour Android, l'installation sur chaque
 * émulateur ({ installs: { <appareil virtuel>: date d'installation du paquet } }) : sert au banc (ne
 * recompiler que le périmé).
 */
export const versionsFile = (root) => path.join(outRoot(root), 'versions.json');

/**
 * Date d'installation du paquet sur un émulateur (`lastUpdateTime` d'Android), ou null s'il n'y est pas.
 * Elle change à chaque installation : c'est la trace qu'un émulateur a reçu la dernière version.
 */
export async function installStamp(serial, pkg) {
  const { adb } = await import('./android.mjs');
  const m = adb(serial, { timeout: 20000 }, 'shell', 'dumpsys', 'package', pkg).match(/lastUpdateTime=([^\r\n]+)/);
  return m ? m[1].trim() : null;
}

/**
 * La version Android d'audit est-elle périmée pour ces émulateurs ? `stamps` : { appareil virtuel: date
 * d'installation lue sur l'émulateur }. Périmée si le code a changé, ou si un émulateur n'a pas reçu la
 * dernière installation (épreuve du 24/09, point 22 : l'APK n'avait été installé que sur le téléphone,
 * seul allumé lors d'un lot, et le banc avait cru la TV à jour).
 */
export function androidStale(versions, code, stamps) {
  if (versions.android !== code) return 'code changé';
  const missing = Object.entries(stamps).filter(([avd, s]) => !s || versions.installs?.[avd] !== s).map(([avd]) => avd);
  return missing.length ? `pas installée sur ${missing.join(', ')}` : null;
}

/**
 * Recompile pour `kinds` (ex. ['tv', 'desktop']). Retourne { ok, done: [libellés], error }.
 * Android : les émulateurs doivent tourner (l'APK s'installe sur ceux qui sont branchés).
 */
export async function rebuild(app, kinds, { root, log = console.log } = {}) {
  const done = [];
  const android = kinds.some((k) => k === 'tv' || k === 'phone');
  const steps = [];
  if (android) steps.push(['Android (APK d\'audit, TV et téléphone)', app.BUILD_AUDIT_APP]);
  if (kinds.includes('desktop')) steps.push(['bureau (version d\'audit Windows)', app.BUILD_AUDIT_DESKTOP]);
  for (const [label, cmd] of steps) {
    if (!cmd) return { ok: false, done, error: `l'app ne fournit pas de commande de recompilation pour ${label} (screens.mjs)` };
    log(`Recompilation : ${label}…`);
    const r = spawnSync(cmd[0], cmd[1], { stdio: 'inherit', cwd: root });
    if (r.status !== 0) return { ok: false, done, error: `recompilation échouée : ${label}` };
    done.push(label);
    // Code compilé noté (le banc ne recompile ensuite que si le code a changé).
    if (app.APP_CODE) {
      const f = versionsFile(root);
      const v = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
      const isDesktop = cmd === app.BUILD_AUDIT_DESKTOP;
      v[isDesktop ? 'desktop' : 'android'] = codeId(root, app.APP_CODE.paths, app.APP_CODE.exclude);
      // Android : les émulateurs qui ont reçu cette version (ceux qui tournaient), avec la trace de l'installation.
      if (!isDesktop && app.PACKAGE) {
        const { runningEmulators } = await import('./emulators.mjs');
        v.installs = {};
        for (const [serial, avd] of Object.entries(runningEmulators())) v.installs[avd] = await installStamp(serial, app.PACKAGE);
      }
      writeFileSync(f, JSON.stringify(v, null, 1));
    }
  }
  return { ok: true, done };
}

/** Émulateurs à démarrer avant de recompiler (l'APK s'installe sur ceux qui tournent). */
export function emulatorsFor(app, kinds) {
  return Object.fromEntries(Object.entries(app.EMULATORS || {}).filter(([k]) => kinds.includes(k)));
}

/** Plan d'un passage (run.mjs --plan) : { kinds, sizes, screens }, sans rien lancer. */
export function planOf(root, args) {
  const r = spawnSync(process.execPath, [path.join(AUDIT_DIR, 'run.mjs'), ...args, '--plan'], { encoding: 'utf8' });
  const last = (s) => (s || '').trim().split(/\r?\n/).pop();
  if (r.status !== 0) throw new Error(`plan du passage impossible : ${last(r.stderr || r.stdout)}`);
  return JSON.parse(last(r.stdout));
}
