// Préparer le banc d'essai avant un passage : démarrer les émulateurs utiles, recompiler les versions
// d'audit qui ne correspondent plus au code (et seulement elles). Le passage suivant arrête les
// émulateurs démarrés ici. Avant le 23/09 au soir, il fallait un script à part (épreuve, points 1 et 2).
//
// Usage : node audit banc [mêmes options qu'un passage : --profile, --device, --sizes, --app] [--forcer-build]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadApp, outRoot } from './core/app.mjs';
import { codeId } from './core/build-id.mjs';
import { rebuild, emulatorsFor, planOf, versionsFile, installStamp, androidStale } from './core/rebuild.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { config: app } = await loadApp(ROOT);
const args = process.argv.slice(2).filter((a) => a !== '--forcer-build');
const { kinds } = planOf(ROOT, args);
console.log(`Plateformes du passage : ${kinds.join(', ') || 'aucune'}`);

// 1. Émulateurs (Android) : démarrés s'ils ne tournent pas ; notés pour que le passage les arrête.
const emus = emulatorsFor(app, kinds);
let started = [];
let serials = {};
if (Object.keys(emus).length) {
  const { ensureEmulators } = await import('./core/emulators.mjs');
  ({ started, serials } = await ensureEmulators(emus, { log: console.log }));
  writeFileSync(path.join(outRoot(ROOT), 'banc.json'), JSON.stringify({ started, at: new Date().toISOString() }, null, 1));
}

// 2. Versions d'audit : recompilées seulement si le code a changé depuis leur dernière compilation, ou
// (Android) si un émulateur du passage n'a pas reçu la dernière installation.
const code = app.APP_CODE ? codeId(ROOT, app.APP_CODE.paths, app.APP_CODE.exclude) : null;
const built = existsSync(versionsFile(ROOT)) ? JSON.parse(readFileSync(versionsFile(ROOT), 'utf8')) : {};
const forced = process.argv.includes('--forcer-build');
const stamps = {};
for (const [kind, serial] of Object.entries(serials)) stamps[emus[kind]] = app.PACKAGE ? await installStamp(serial, app.PACKAGE) : null;
const androidWhy = code ? androidStale(built, code, stamps) : null;
const stale = code ? kinds.filter((k) => k !== 'web' && (forced || (k === 'desktop' ? built.desktop !== code : !!androidWhy))) : [];
if (stale.length) {
  console.log(`Versions d'audit à recompiler (code ${code}) : ${[...new Set(stale.map((k) => (k === 'desktop' ? 'bureau' : `Android${androidWhy && !forced ? ` (${androidWhy})` : ''}`)))].join(', ')}`);
  const r = await rebuild(app, stale, { root: ROOT });
  if (!r.ok) { console.error(`✖ ${r.error}`); process.exit(1); }
} else console.log(code ? `Versions d'audit à jour (code ${code}).` : 'Pas de version d\'audit à compiler (web).');
console.log(`Banc prêt${started.length ? ` ; émulateurs démarrés ici, arrêtés à la fin du prochain passage : ${started.join(', ')}` : ''}. Le passage vérifiera encore l'empreinte de chaque version.`);
