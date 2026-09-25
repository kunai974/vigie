// Avant / après d'une correction, en deux commandes.
//
//   node audit avant-apres avant [options du passage]
//     Passage « avant » et sa revue. Sans option : --cible (écrans et tailles des défauts « Inclure »
//     du registre). Pour élargir au contrôle de non-régression, donner les options à la main
//     (--only, --sizes, --device : voir node audit passage --list). Le périmètre est mémorisé.
//
//   node audit avant-apres avant --depuis <dossier audit-out/...> [options du passage « après »]
//     Pas de nouveau passage : un passage déjà fait (celui de la revue) sert d'« avant ». Le passage
//     « après » suit les options données (par défaut --cible) ; la comparaison porte sur ce que les
//     deux passages ont en commun. Il faut que l'outil n'ait pas changé de mesure entre-temps.
//
//   (correction faite et validée)
//
//   node audit avant-apres apres [--no-build]
//     Recompile et installe l'APK d'audit (sauf --no-build), refait exactement le même passage, sa
//     revue, puis la comparaison. La page avant / après est ouverte à la fin du journal.
//
// Générique : la recompilation est fournie par l'app (BUILD_AUDIT_APP, BUILD_AUDIT_DESKTOP : core/rebuild.mjs).
// Pour un cycle de corrections en plusieurs lots, préférer le tour guidé : node audit lot (PROCESS.md).
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cmd } from './core/app.mjs';

const TOOL = path.dirname(fileURLToPath(import.meta.url)); // dossier de l'outil, quel que soit son nom
const ROOT = path.resolve(TOOL, '..'); // projet audité
const { loadApp } = await import('./core/app.mjs');
const { config: app } = await loadApp(ROOT);
const { outRoot } = await import('./core/app.mjs');
const STATE = path.join(outRoot(ROOT), 'avant-apres.json');
const LAST = path.join(outRoot(ROOT), 'dernier-passage.txt');

const [step, ...rest] = process.argv.slice(2);
const fail = (msg) => { console.error(`✖ ${msg}`); process.exit(1); };

/** Un passage d'audit (avec sa revue) ; retourne son dossier. */
function pass(args) {
  const before = existsSync(LAST) ? readFileSync(LAST, 'utf8') : '';
  const r = spawnSync(process.execPath, [path.join(TOOL, 'run.mjs'), ...args], { stdio: 'inherit' });
  const dir = existsSync(LAST) ? readFileSync(LAST, 'utf8') : '';
  if (r.status !== 0 || !dir || dir === before) fail('le passage a échoué (voir le journal ci-dessus).');
  return dir;
}

if (step === 'avant' && rest.includes('--depuis')) {
  const i = rest.indexOf('--depuis');
  const dir = rest[i + 1] && path.resolve(rest[i + 1]);
  if (!dir || !existsSync(path.join(dir, 'report.json'))) fail('--depuis : dossier de passage introuvable (audit-out/<date>).');
  const others = rest.filter((_, j) => j !== i && j !== i + 1);
  const args = others.length ? others : ['--cible'];
  writeFileSync(STATE, JSON.stringify({ avant: dir, args, reused: true, date: new Date().toISOString() }, null, 1));
  console.log(`« Avant » : passage existant ${dir}
Passage « après » prévu : ${args.join(' ')}`);
  console.log(`Faire la correction, puis : ${cmd('avant-apres apres')}`);
} else if (step === 'avant') {
  const args = rest.length ? rest : ['--cible'];
  console.log(`Passage « avant » : ${args.join(' ')}`);
  const dir = pass(args);
  writeFileSync(STATE, JSON.stringify({ avant: dir, args, date: new Date().toISOString() }, null, 1));
  console.log(`\n« Avant » prêt : ${dir}\nRevue : ${path.join(dir, 'revue', 'revue.html')}`);
  console.log(`Faire la correction, puis : ${cmd('avant-apres apres')}`);
} else if (step === 'apres') {
  if (!existsSync(STATE)) fail(`aucun passage « avant » en attente : commencer par « ${cmd('avant-apres avant')} ».`);
  const state = JSON.parse(readFileSync(STATE, 'utf8'));
  // Émulateurs démarrés avant la recompilation, qui installe l'APK sur ceux qui tournent : le passage
  // « avant » arrête ceux qu'il a démarrés, et l'APK ne serait installé nulle part (23/09). Ceux que
  // cette étape démarre sont arrêtés à la fin, même en cas d'échec.
  const { ensureEmulators, stopEmulator } = await import('./core/emulators.mjs');
  const { rebuild, emulatorsFor, planOf } = await import('./core/rebuild.mjs');
  // Plateformes du passage « après » (Windows compris : avant le 23/09, seul l'APK était recompilé).
  const { kinds } = planOf(ROOT, state.args);
  const { started } = await ensureEmulators(emulatorsFor(app, kinds));
  process.on('exit', () => { for (const s of started) stopEmulator(s); });
  if (!rest.includes('--no-build')) {
    const b = await rebuild(app, kinds, { root: ROOT });
    if (!b.ok) fail(`${b.error} : rien n'a été comparé (--no-build pour comparer sans recompiler).`);
  }
  console.log(`Passage « après » : ${state.args.join(' ')}`);
  const dir = pass(state.args);
  const c = spawnSync(process.execPath, [path.join(TOOL, 'review', 'compare.cjs'), state.avant, dir], { stdio: 'inherit' });
  if (c.status !== 0) fail('la comparaison a échoué.');
  rmSync(STATE);
  console.log(`\nAvant / après : ${path.join(dir, 'avant-apres', 'avant-apres.html')}`);
} else {
  console.log(`Usage : ${cmd('avant-apres avant')} [options du passage]   puis   ${cmd('avant-apres apres')} [--no-build]`);
  process.exit(step ? 1 : 0);
}
