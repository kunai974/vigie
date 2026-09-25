// Le tour guidé des corrections, par lots (process : audit/PROCESS.md).
//
//   node audit lot creer [--lots <n>] [--depuis <passage>]
//     À partir des décisions « Inclure » de la revue du passage (le dernier par défaut), découpe les
//     corrections en lots. Sans --lots : explique le choix et propose un découpage, sans rien créer.
//   node audit lot verifier [<n>] [--no-build]
//     Le lot (le suivant par défaut) est corrigé : recompile toutes les plateformes qu'il touche,
//     refait un passage sur ses écrans et tailles, le compare au passage de départ (réutilisé comme
//     « avant »), et note le résultat : prouvé, incomplet ou régression.
//   node audit lot relire
//     Après relecture du passage « après » par l'interprète (faux positifs écartés, constats vus à l'œil
//     confirmés corrigés, dans son interpretation.json) : recalcule le verdict, sans nouveau passage.
//   node audit lot scinder
//     Lot en partie réussi : garde les défauts corrigés (acquis) et met ceux qui résistent dans un
//     nouveau lot, à reprendre plus tard.
//   node audit lot clore <n> --raison "<texte>"
//     Clôt un lot non prouvé, par décision de l'utilisateur (ex. correction reportée), pour passer au suivant.
//   node audit lot etat
//     Où en est le cycle : lots, résultats, prochaine commande.
//
// Les commandes refusent de sauter une étape : pas de lot sans revue tranchée, pas de vérification
// sans correction dans le code, pas de lot suivant tant que le précédent n'est ni prouvé ni clos.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { loadApp, outRoot, cmd } from './core/app.mjs';
import { codeId } from './core/build-id.mjs';
import { mesureId } from './core/mesure.mjs';
import { rebuild, emulatorsFor, planOf } from './core/rebuild.mjs';

const require = createRequire(import.meta.url);
const registry = require('./review/registry.cjs');
const TOOL = path.dirname(fileURLToPath(import.meta.url)); // dossier de l'outil, quel que soit son nom
const ROOT = path.resolve(TOOL, '..'); // projet audité
const OUT = outRoot(ROOT);
const LOTS = path.join(OUT, 'lots');
const CURRENT = path.join(LOTS, 'courant.txt');
const LAST = path.join(OUT, 'dernier-passage.txt');
const { files: APP, config: app } = await loadApp(ROOT);
const cfg = require(APP.review);

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !['--lots', '--depuis', '--raison', '--app'].includes(argv[i - 1]));
const [step, arg] = positional;
const fail = (msg) => { console.error(`✖ ${msg}`); process.exit(1); };
const PLATFORM = { tv: 'Android TV', phone: 'Téléphone', desktop: 'Bureau', web: 'Web' };
const GRAVITY_WEIGHT = { bloquant: 4, important: 3, mineur: 1, 'a-trancher': 0, info: 0 };
const PRIORITY_WEIGHT = { forte: 3, moyenne: 2, faible: 1, decider: 0 };
const ETAT = { 'a-corriger': 'à corriger', prouve: 'corrigé et prouvé', 'a-confirmer': 'corrigé, constats vus à l’œil à confirmer', incomplet: 'pas entièrement corrigé', regression: 'régression', clos: 'clos sans preuve' };
// Au-delà, on s'arrête et on en parle avec l'utilisateur : pas de boucle de correction infinie.
const MAX_ESSAIS = 3;
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const cycleFile = (id) => path.join(LOTS, id, 'cycle.json');
const currentCycle = () => {
  if (!existsSync(CURRENT)) return null;
  const id = readFileSync(CURRENT, 'utf8').trim();
  return existsSync(cycleFile(id)) ? readJson(cycleFile(id)) : null;
};
const saveCycle = (c) => { mkdirSync(path.join(LOTS, c.id), { recursive: true }); writeFileSync(cycleFile(c.id), JSON.stringify(c, null, 1) + '\n'); writeFileSync(CURRENT, c.id); };
const currentCode = () => { try { return codeId(ROOT, app.APP_CODE.paths, app.APP_CODE.exclude); } catch { return null; } };

/** Corrections à faire : fiches de la revue décidées « Inclure » (au registre), pas encore corrigées. */
function unitsOf(depart) {
  const reg = registry.load(cfg.REGISTRY);
  const rev = readJson(path.join(depart, 'revue.json'));
  const decisions = registry.decisions(reg);
  const pass = existsSync(path.join(depart, 'decisions.json')) ? readJson(path.join(depart, 'decisions.json')) : {};
  for (const [id, d] of Object.entries(pass)) if (!decisions[id]?.updatedAt || (d.updatedAt || '') >= decisions[id].updatedAt) decisions[id] = d;
  const statusOf = (id) => decisions[reg.renamed[id] || id]?.status || null;
  const fixed = (id) => reg.items[reg.renamed[id] || id]?.lastStatus === 'corrige';
  const units = [];
  const undecided = [];
  const seen = new Set();
  for (const f of rev.fiches) {
    for (const id of f.ids) seen.add(id);
    if (f.faux) continue;
    const st = f.ids.map(statusOf);
    // « Pour information » : seulement si l'utilisateur l'a incluse (la revue le lui permet). Avant, une
    // telle fiche incluse était écartée sans le dire (tour de sortie du 24/09, point 28).
    if (f.family.info && !st.includes('inclure')) continue;
    if (st.every((s) => !s)) { undecided.push(f.name); continue; }
    const ids = f.ids.filter((id, i) => st[i] === 'inclure' && !fixed(id));
    if (ids.length) units.push({ fiche: f.id, name: f.name, ids, platforms: [...new Set(f.parts.filter((p) => ids.includes(p.id)).map((p) => p.kind))], gravity: f.gravity, priority: f.priority.level, family: f.family.title });
  }
  // Décisions « Inclure » d'avant, pour des défauts que ce passage n'a pas regardés : gardées, signalées.
  for (const it of Object.values(reg.items)) {
    if (seen.has(it.id) || it.decision?.status !== 'inclure' || it.lastStatus === 'corrige' || !it.history.length) continue;
    units.push({ fiche: it.id, name: it.name || it.id, ids: [it.id], platforms: [it.kind], gravity: it.gravity || 'mineur', priority: 'moyenne', family: 'Hors de ce passage', outside: true });
  }
  units.sort((a, b) => a.family.localeCompare(b.family, 'fr') || GRAVITY_WEIGHT[b.gravity] - GRAVITY_WEIGHT[a.gravity] || PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]);
  return { units, undecided };
}

/** Découpe en n lots de tailles proches, sans séparer une famille quand c'est possible (ordre gardé). */
function split(units, n) {
  const lots = Array.from({ length: n }, () => []);
  const per = units.length / n;
  units.forEach((u, i) => lots[Math.min(n - 1, Math.floor(i / per))].push(u));
  return lots;
}

function explain(units, suggested) {
  const nIds = units.reduce((s, u) => s + u.ids.length, 0);
  const plats = [...new Set(units.flatMap((u) => u.platforms))].map((k) => PLATFORM[k]).join(', ');
  return `${units.length} correction${units.length > 1 ? 's' : ''} à faire (${nIds} défaut${nIds > 1 ? 's' : ''} du registre ; ${plats}).

En combien de lots les découper ?
- Un lot = toutes ses corrections faites, puis UNE recompilation et UN avant / après (passage ciblé
  sur ses écrans et tailles, comparé au passage de départ, qui sert d'« avant » à tous les lots).
- Plus un lot est gros, moins l'avant / après est parlant : un changement d'image peut avoir plusieurs
  causes, et une régression est plus dure à attribuer à une correction précise.
- Plus un lot est petit, plus il coûte de passages : compter 15 à 30 minutes par lot (recompilation
  des plateformes touchées, passage ciblé), sans intervention.

Proposition : ${suggested} lot${suggested > 1 ? 's' : ''} d'environ ${Math.ceil(units.length / suggested)} correction${units.length / suggested > 1 ? 's' : ''}, une famille de défauts à la fois.
${split(units, suggested).map((l, i) => `  Lot ${i + 1} : ${l.map((u) => `${u.name} (${u.platforms.map((k) => PLATFORM[k]).join('+')})`).join(' ; ')}`).join('\n')}

Pour créer : ${cmd('lot creer')} --lots <nombre>   (entre 1 et ${units.length})`;
}

function lotsMarkdown(c) {
  const L = [`# Cycle de corrections — passage ${c.id}`, '', `Créé le ${new Date(c.created).toLocaleString('fr-FR')} · ${c.lots.length} lot${c.lots.length > 1 ? 's' : ''} · passage de départ (« avant » de chaque lot) : \`${c.depart}\``, '',
    `Process : PROCESS.md de l'outil. Un lot = ses corrections, puis \`${cmd('lot verifier')}\` (une recompilation, un avant / après).`, ''];
  for (const lot of c.lots) {
    const last = lot.verifications.at(-1);
    L.push(`## Lot ${lot.n} — ${ETAT[lot.etat]}`, '');
    for (const u of lot.units) L.push(`- **${u.name}** (${u.platforms.map((k) => PLATFORM[k]).join(' + ')}, ${u.gravity}) — ${u.family}${u.outside ? ' — pas regardé par le passage de départ' : ''} — \`${u.ids.join('`, `')}\``);
    if (last) L.push('', `Dernière vérification : ${new Date(last.date).toLocaleString('fr-FR')}, passage \`${last.apres}\` — ${ETAT[last.etat]}${last.page ? ` — page : ${last.page}` : ''}`);
    if (lot.raison) L.push('', `Clos par décision : ${lot.raison}`);
    if (lot.scinde) L.push('', `Scindé : ${lot.scinde.ids.length} défaut(s) qui résistaient mis dans le lot ${lot.scinde.vers}`);
    if (lot.origine) L.push('', `Reprend ce qui résistait dans le lot ${lot.origine.lot}`);
    L.push('');
  }
  return L.join('\n');
}

/**
 * Compare le passage « après » au passage de départ, et note le verdict du lot : prouvé, à confirmer à
 * l'œil, incomplet ou régression. `relecture` : remplace le verdict de la dernière vérification (après
 * relecture par l'interprète) au lieu d'en ajouter une.
 */
function conclude(c, lot, apres, code, relecture) {
  const cmp = spawnSync(process.execPath, [path.join(TOOL, 'review', 'compare.cjs'), c.depart, apres, APP.review, '--ids', lot.ids.join(','), '--titre', `Lot ${lot.n}`], { stdio: 'inherit' });
  if (cmp.status !== 0) fail('la comparaison a échoué : rien n\'a été noté.');
  const aa = readJson(path.join(apres, 'avant-apres.json'));
  // Régression causée par le lot : un état perdu, ou un constat apparu (hors faux positifs écartés), sur
  // un écran que le lot touche.
  const regNow = registry.load(cfg.REGISTRY);
  const places = new Set(Object.values(regNow.items).filter((it) => lot.ids.includes(it.id)).flatMap((it) => it.history.flatMap((h) => h.where)));
  const onLot = (p) => places.has(`${p.run}|${p.group}`);
  const regressions = aa.pairs.filter((p) => onLot(p) && (p.reached === 'perdu' || p.new.length)).map((p) => `${p.label} (${p.size})${p.new.length ? ` : ${p.new.map((x) => x.el).join(', ')}` : ' : état perdu'}`);
  const done = aa.targets.filter((t) => t.status === 'corrige').length;
  const etat = regressions.length || aa.targets.some((t) => t.status === 'a-verifier') ? 'regression'
    : done === aa.targets.length ? 'prouve'
      : aa.targets.every((t) => t.status === 'corrige' || t.status === 'a-confirmer') ? 'a-confirmer' : 'incomplet';
  const entry = { date: new Date().toISOString(), apres, code, etat, page: path.join(apres, 'avant-apres', 'avant-apres.html'), targets: aa.targets.map((t) => ({ id: t.id, name: t.name, status: t.status })), regressions };
  if (relecture) lot.verifications[lot.verifications.length - 1] = { ...lot.verifications.at(-1), ...entry, relu: true };
  else lot.verifications.push(entry);
  lot.etat = etat;
  saveCycle(c);
  writeFileSync(path.join(LOTS, c.id, 'lots.md'), lotsMarkdown(c));
  // Revue de départ refaite : chaque fiche du lot y porte son état (corrigé et prouvé, régression…).
  spawnSync(process.execPath, [path.join(TOOL, 'review', 'build.cjs'), c.depart, APP.review, '--sans-planches'], { stdio: 'ignore' });
  console.log(`\nLot ${lot.n} : ${ETAT[etat]} (${done}/${aa.targets.length} défauts corrigés)${regressions.length ? `\n  Régression sur les écrans du lot : ${regressions.join(' ; ')}` : ''}`);
  const lostKeys = aa.pairs.filter((p) => onLot(p) && p.reached === 'perdu').map((p) => `"${p.run}|${p.id}"`);
  if (lostKeys.length) console.log(`  État perdu parce que la correction a réussi (ex. plus rien à dérouler) ? L'interprète le constate sur les captures « après » : interpretation.json du passage « après », « etats » : { ${lostKeys.map((k) => `${k}: "raison"`).join(', ')} }, puis « ${cmd('lot relire')} ». Sinon, c'est une régression à corriger dans le lot.`);
  const eye = aa.targets.filter((t) => t.status === 'a-confirmer').map((t) => t.name);
  if (eye.length) console.log(`  À confirmer à l'œil par l'interprète (capture « après ») : ${eye.join(' ; ')} → interpretation.json du passage « après » (« corriges »), puis « ${cmd('lot relire')} ».`);
  console.log(`Avant / après : ${path.join(apres, 'avant-apres', 'avant-apres.html')}\n${nextStep(c)}`);
}

function nextStep(c) {
  const lot = c.lots.find((l) => l.etat !== 'prouve' && l.etat !== 'clos');
  if (!lot) return 'Cycle terminé : tous les lots sont prouvés ou clos.';
  if (!lot.verifications.length) return `Lot ${lot.n} : faire ses corrections (${lot.units.map((u) => u.name).join(' ; ')}), puis « ${cmd('lot verifier')} ».`;
  const last = lot.verifications.at(-1);
  const done = last.targets.filter((t) => t.status === 'corrige').length;
  const head = `Lot ${lot.n} : ${ETAT[lot.etat]} (${done}/${last.targets.length} défauts corrigés, ${lot.verifications.length}/${MAX_ESSAIS} vérification${lot.verifications.length > 1 ? 's' : ''}).`;
  if (lot.etat === 'a-confirmer') return `${head} L'interprète confirme à l'œil sur la capture « après », puis « ${cmd('lot relire')} ».`;
  return `${head} Au choix :
  - « ${cmd('lot scinder')} » : garder les ${done} corrigés (acquis) et mettre ce qui résiste dans un nouveau lot, à reprendre plus tard ;
  - reprendre la correction, puis « ${cmd('lot verifier')} » (le lot entier est revérifié) ;
  - « ${cmd(`lot clore ${lot.n}`)} --raison "…" ».`;
}

if (step === 'creer') {
  const depart = path.resolve(opt('--depuis') || (existsSync(LAST) ? readFileSync(LAST, 'utf8').trim() : ''));
  if (!existsSync(path.join(depart, 'report.json'))) fail('passage de départ introuvable (--depuis audit-out/<date>).');
  if (!existsSync(path.join(depart, 'revue.json'))) fail(`ce passage n'a pas de revue au format actuel : ${cmd(`refaire-revue "${depart}"`)}`);
  const report = readJson(path.join(depart, 'report.json'));
  if (report.mesure !== mesureId() && !argv.includes('--forcer')) {
    fail(`le passage de départ n'a pas été mesuré avec la version actuelle de l'outil (${report.mesure || 'inconnue'}, actuelle ${mesureId()}) : il ne peut pas servir d'« avant ». Refaire un passage (${cmd('passage')}).`);
  }
  const cur = currentCycle();
  if (cur && cur.lots.some((l) => l.etat !== 'prouve' && l.etat !== 'clos') && !argv.includes('--remplacer')) {
    fail(`un cycle est en cours (${cur.id}) : ${nextStep(cur)}\n  Pour l'abandonner et en créer un autre : --remplacer.`);
  }
  const { units, undecided } = unitsOf(depart);
  // Fiches laissées sans décision : l'usage réel est de choisir quelques corrections et de garder le
  // reste pour plus tard (épreuve du 23/09, point 9). Pas de refus : elles restent dans la prochaine revue.
  if (undecided.length) console.log(`${undecided.length} fiche${undecided.length > 1 ? 's' : ''} de la revue sans décision : ${undecided.length > 1 ? 'elles restent' : 'elle reste'} dans la prochaine revue (pas de correction pour ${undecided.length > 1 ? 'elles' : 'elle'} dans ce cycle).\n`);
  if (!units.length) fail('aucune correction à faire : aucun défaut « Inclure » encore à corriger.');
  const suggested = Math.max(1, Math.min(units.length, Math.ceil(units.length / 5)));
  const n = Number(opt('--lots'));
  if (!n) { console.log(explain(units, suggested)); process.exit(0); }
  if (!Number.isInteger(n) || n < 1 || n > units.length) fail(`--lots : entre 1 et ${units.length}.`);
  const cycle = {
    id: path.basename(depart), created: new Date().toISOString(), app: APP.name, depart, mesure: report.mesure || null, code: report.code || null,
    lots: split(units, n).map((l, i) => ({ n: i + 1, etat: 'a-corriger', units: l, ids: l.flatMap((u) => u.ids), platforms: [...new Set(l.flatMap((u) => u.platforms))], verifications: [] })),
  };
  saveCycle(cycle);
  writeFileSync(path.join(LOTS, cycle.id, 'lots.md'), lotsMarkdown(cycle));
  console.log(`Cycle créé : ${n} lot${n > 1 ? 's' : ''} → ${path.join(LOTS, cycle.id, 'lots.md')}\n`);
  for (const lot of cycle.lots) console.log(`Lot ${lot.n} (${lot.platforms.map((k) => PLATFORM[k]).join(', ')}) : ${lot.units.map((u) => u.name).join(' ; ')}`);
  console.log(`\n${nextStep(cycle)}`);
} else if (step === 'verifier') {
  const c = currentCycle();
  if (!c) fail(`aucun cycle de corrections en cours : ${cmd('lot creer')}.`);
  const pending = c.lots.find((l) => l.etat !== 'prouve' && l.etat !== 'clos');
  if (!pending) fail('cycle terminé : tous les lots sont prouvés ou clos.');
  const lot = arg ? c.lots.find((l) => l.n === Number(arg)) : pending;
  if (!lot) fail(`lot ${arg} introuvable (1 à ${c.lots.length}).`);
  if (lot.n !== pending.n) fail(`le lot ${pending.n} passe d'abord (${ETAT[pending.etat]}) : un lot après l'autre, pour que chaque avant / après ne montre que ses propres corrections.`);
  if (lot.verifications.length >= MAX_ESSAIS && !argv.includes('--forcer')) fail(`lot ${lot.n} déjà vérifié ${lot.verifications.length} fois : on s'arrête pour en parler (pas de boucle de correction infinie). « ${cmd(`lot clore ${lot.n}`)} --raison "…" » pour passer au suivant.`);
  // Une correction doit exister dans le code depuis la dernière référence (départ, ou dernière vérification).
  const ref = c.lots.flatMap((l) => l.verifications).map((v) => v.code).filter(Boolean).at(-1) || c.code;
  const code = currentCode();
  if (code && ref && code === ref && !argv.includes('--forcer')) fail('le code de l\'app n\'a pas changé depuis le dernier passage : faire les corrections du lot d\'abord.');
  const mesure = mesureId();
  if (c.mesure && c.mesure !== mesure && !argv.includes('--forcer')) fail(`l'outil a changé de mesure depuis le passage de départ (${c.mesure} → ${mesure}) : l'avant / après serait faux. Refaire un passage de départ et un cycle.`);

  // Seulement les écrans et tailles du passage de départ : c'est à lui que l'avant / après compare.
  // Ce qui a été changé, écrit par l'interprète (affiché sous chaque défaut dans la page avant / après).
  const corrFile = path.join(LOTS, c.id, 'corrections.json');
  const corr = existsSync(corrFile) ? readJson(corrFile) : {};
  const missingCorr = lot.ids.filter((id) => !corr[id]);
  if (missingCorr.length) console.log(`! « Ce qui a été changé » manque pour ${missingCorr.length} défaut(s) du lot : ${corrFile} (la page avant / après le signalera).`);
  const args = ['--cible-ids', lot.ids.join(','), '--dans', c.id, '--app', APP.name];
  const { kinds } = planOf(ROOT, args);
  console.log(`Lot ${lot.n} : ${lot.units.map((u) => u.name).join(' ; ')}\nPlateformes : ${kinds.map((k) => PLATFORM[k]).join(', ')}`);
  const { ensureEmulators, stopEmulator } = await import('./core/emulators.mjs');
  const { started } = await ensureEmulators(emulatorsFor(app, kinds));
  process.on('exit', () => { for (const s of started) stopEmulator(s); });
  if (!argv.includes('--no-build')) {
    const b = await rebuild(app, kinds, { root: ROOT });
    if (!b.ok) fail(`${b.error} : rien n'a été vérifié.`);
  }
  const before = existsSync(LAST) ? readFileSync(LAST, 'utf8') : '';
  const r = spawnSync(process.execPath, [path.join(TOOL, 'run.mjs'), ...args], { stdio: 'inherit' });
  const apres = existsSync(LAST) ? readFileSync(LAST, 'utf8').trim() : '';
  if (r.status !== 0 || !apres || apres === before.trim()) fail('le passage a échoué ou est incomplet (voir le journal) : rien n\'a été noté.');
  conclude(c, lot, apres, code, false);
} else if (step === 'relire') {
  // Après la vérification, l'interprète a relu le passage « après » (interpretation.json : faux
  // positifs écartés, constats vus à l'œil confirmés corrigés) : le verdict est recalculé, sans nouveau
  // passage ni nouvel essai.
  const c = currentCycle();
  if (!c) fail('aucun cycle en cours.');
  const lot = c.lots.find((l) => l.verifications.length && l.etat !== 'prouve' && l.etat !== 'clos');
  if (!lot) fail('aucun lot vérifié à relire.');
  const last = lot.verifications.at(-1);
  if (!existsSync(path.join(last.apres, 'interpretation.json'))) fail(`pas d'interprétation du passage « après » (${path.join(last.apres, 'interpretation.json')}) : rien de nouveau à relire.`);
  const b = spawnSync(process.execPath, [path.join(TOOL, 'review', 'build.cjs'), last.apres, APP.review, '--sans-planches'], { stdio: 'inherit' });
  if (b.status !== 0) fail('revue du passage « après » impossible.');
  conclude(c, lot, last.apres, last.code, true);
} else if (step === 'scinder') {
  // Lot en partie réussi : ce qui est corrigé est acquis (le lot est prouvé pour ces défauts), ce qui
  // résiste part dans un nouveau lot, à la fin du cycle. Un seul défaut récalcitrant ne bloque plus
  // tout le lot, ni ne fait tout recompiler à chaque retouche (demande de l'utilisateur, 23/09).
  const c = currentCycle();
  if (!c) fail('aucun cycle en cours.');
  const lot = c.lots.find((l) => l.etat !== 'prouve' && l.etat !== 'clos');
  if (!lot || !lot.verifications.length) fail(`aucun lot vérifié à scinder : « ${cmd('lot verifier')} » d'abord.`);
  const last = lot.verifications.at(-1);
  const ok = new Set(last.targets.filter((t) => t.status === 'corrige').map((t) => t.id));
  if (!ok.size) fail(`aucun défaut du lot ${lot.n} n'est corrigé : rien à garder (reprendre la correction, ou clore le lot).`);
  const rest = lot.ids.filter((id) => !ok.has(id));
  if (!rest.length) fail(`tous les défauts du lot ${lot.n} sont corrigés : rien à scinder.`);
  const part = (keep) => lot.units.map((u) => ({ ...u, ids: u.ids.filter((id) => ok.has(id) === keep) })).filter((u) => u.ids.length);
  const kinds = (units) => [...new Set(units.flatMap((u) => u.platforms))];
  const n = Math.max(...c.lots.map((l) => l.n)) + 1;
  const moved = part(false);
  c.lots.push({ n, etat: 'a-corriger', units: moved, ids: rest, platforms: kinds(moved), verifications: [], origine: { lot: lot.n, regressions: last.regressions } });
  lot.units = part(true);
  lot.ids = lot.ids.filter((id) => ok.has(id));
  lot.platforms = kinds(lot.units);
  lot.etat = 'prouve';
  lot.scinde = { vers: n, ids: rest, date: new Date().toISOString() };
  saveCycle(c);
  writeFileSync(path.join(LOTS, c.id, 'lots.md'), lotsMarkdown(c));
  spawnSync(process.execPath, [path.join(TOOL, 'review', 'build.cjs'), c.depart, APP.review, '--sans-planches'], { stdio: 'ignore' });
  console.log(`Lot ${lot.n} : prouvé pour ${ok.size} défaut${ok.size > 1 ? 's' : ''} (acquis). Lot ${n} créé pour ce qui résiste : ${moved.map((u) => u.name).join(' ; ')}${last.regressions?.length ? `\n  Régression constatée, à traiter dans le lot ${n} : ${last.regressions.join(' ; ')}` : ''}\n${nextStep(c)}`);
} else if (step === 'clore') {
  const c = currentCycle();
  if (!c) fail('aucun cycle en cours.');
  const lot = c.lots.find((l) => l.n === Number(arg));
  if (!lot) fail(`${cmd('lot clore')} <n> --raison "…"`);
  if (!opt('--raison')) fail('--raison obligatoire : c\'est une décision de l\'utilisateur, elle se note.');
  lot.etat = 'clos';
  lot.raison = opt('--raison');
  saveCycle(c);
  writeFileSync(path.join(LOTS, c.id, 'lots.md'), lotsMarkdown(c));
  console.log(`Lot ${lot.n} clos. ${nextStep(c)}`);
} else if (step === 'etat') {
  const c = currentCycle();
  if (!c) { console.log(`Aucun cycle de corrections en cours (${cmd('lot creer')}).`); process.exit(0); }
  console.log(`Cycle ${c.id} (départ : ${c.depart})`);
  for (const lot of c.lots) console.log(`  Lot ${lot.n} — ${ETAT[lot.etat]}${lot.verifications.length ? ` (${lot.verifications.length} vérification${lot.verifications.length > 1 ? 's' : ''})` : ''} : ${lot.units.map((u) => u.name).join(' ; ')}`);
  console.log(nextStep(c));
} else {
  console.log(`Usage : ${cmd('lot creer')} [--lots <n>] [--depuis <passage>] | verifier [<n>] [--no-build] | relire | scinder | clore <n> --raison "…" | etat`);
  process.exit(step ? 1 : 0);
}
