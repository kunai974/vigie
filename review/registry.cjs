// Registre des défauts : la mémoire de l'audit d'un passage à l'autre.
// Le mécanisme est générique (ce fichier) ; le contenu appartient au projet (ex. <outil>/<app>/registre.json) :
// décisions, remarques et historique de chaque défaut, versionnés avec le code.
//
// Identité d'un défaut : plateforme | règle | élément (stable d'un passage à l'autre). Lieu : taille |
// écran (ex. « tv-tv-16-10|live »). Un défaut absent n'est dit « corrigé » que si l'un de ses lieux a été
// audité à nouveau ; sinon il est « non vérifié ».
//
// Usage en ligne de commande (registre de l'app choisie par --app ou AUDIT_APP, sinon celle présente) :
//   node audit decisions <décisions.json> [--app <nom>]
//     décisions.json : { id: { status: 'inclure'|'plus-tard'|'exclure'|null, note, updatedAt } }
//     (export de la page de revue, ou decisions.json d'un passage). La décision la plus récente l'emporte.
//   node audit recalculer [--app <nom>]
//     Remet à jour le dernier statut connu de chaque défaut (après une correction de l'outil).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Identité stable d'un défaut : plateforme | famille (règle, ou « info:règle ») | élément. */
const defectId = (kind, famKey, el) => crypto.createHash('sha1').update([kind, famKey, el].join('|')).digest('hex').slice(0, 12);

const STATUS_LABEL = {
  nouveau: 'Nouveau', 'toujours-la': 'Toujours là', reapparu: 'Réapparu', corrige: 'Corrigé', 'non-verifie': 'Non vérifié',
};
const DECISIONS = ['inclure', 'plus-tard', 'exclure'];

function load(file) {
  if (!fs.existsSync(file)) return { version: 1, passes: [], items: {}, renamed: {} };
  const reg = JSON.parse(fs.readFileSync(file, 'utf8'));
  reg.renamed = reg.renamed || {};
  return reg;
}

function save(file, reg) {
  fs.writeFileSync(file, JSON.stringify(reg, null, 1) + '\n');
}

/** Identités remplacées (ex. constat vu à l'œil devenu mesurable) : décision et historique suivent. */
function rename(reg, map) {
  for (const [from, to] of Object.entries(map || {})) {
    reg.renamed[from] = to;
    const old = reg.items[from];
    if (!old) continue;
    const cur = reg.items[to] || (reg.items[to] = { ...old, id: to, history: [] });
    cur.decision = cur.decision || old.decision;
    cur.history = [...old.history, ...cur.history];
    delete reg.items[from];
  }
}

/**
 * Moment d'un passage, pour les ranger dans l'ordre où ils ont été faits (pas dans l'ordre de leur nom :
 * « 2026-09-23-lot1-apres », fait le matin, passait après le passage Windows du soir, 23/09).
 * `at` (ISO) s'il est connu ; sinon la date française « jj/mm/aaaa hh:mm(:ss) » (la première heure
 * trouvée), sinon le nom du dossier « aaaa-mm-jj-hh-mm ».
 */
function passTime(p) {
  if (p.at) return Date.parse(p.at);
  const d = /(\d{2})\/(\d{2})\/(\d{4})/.exec(p.date || '');
  if (d) {
    const t = /(\d{2}):(\d{2})(?::(\d{2}))?/.exec(p.date);
    return Date.UTC(+d[3], d[2] - 1, +d[1], t ? +t[1] : 0, t ? +t[2] : 0, t && t[3] ? +t[3] : 0);
  }
  const n = /^(\d{4})-(\d{2})-(\d{2})(?:-(\d{2})-(\d{2}))?/.exec(p.id || '');
  return n ? Date.UTC(+n[1], n[2] - 1, +n[3], +(n[4] || 0), +(n[5] || 0)) : 0;
}

/** Range les passages du registre dans l'ordre où ils ont été faits (à égalité, par nom) ; retourne leurs identifiants. */
function sortPasses(reg) {
  reg.passes.sort((a, b) => passTime(a) - passTime(b) || (a.id < b.id ? -1 : 1));
  return reg.passes.map((p) => p.id);
}

/**
 * Statut d'un défaut au passage `passId` : nouveau, toujours là, réapparu, corrigé, non vérifié, ou
 * undefined (le défaut n'avait pas encore été vu). `order` : passages dans l'ordre (sortPasses).
 */
function statusAt(reg, order, it, passId) {
  const rank = (id) => order.indexOf(id);
  const idx = rank(passId);
  const places = new Set(it.history.flatMap((h) => h.where));
  if (it.history.some((h) => h.pass === passId)) {
    // Jamais vu avant : nouveau (même si ses lieux ont déjà été audités : la règle qui le détecte
    // peut être plus récente que ces passages).
    const lastSeen = it.history.filter((h) => rank(h.pass) < idx).pop();
    if (!lastSeen) return 'nouveau';
    // Déjà vu : réapparu seulement s'il a été constaté corrigé entre sa dernière apparition et ce passage.
    // Un passage qui a regardé ses lieux sans pouvoir le chercher (vu à l'œil non repris, autre version
    // de la mesure) ne l'a pas vu corrigé (tour de sortie du 24/09, point 26 : six constats vus à l'œil
    // annoncés « réapparus » à cause des passages de vérification d'un lot).
    const fixedSince = order.some((p) => rank(p) < idx && rank(p) > rank(lastSeen.pass) && statusAt(reg, order, it, p) === 'corrige');
    return fixedSince ? 'reapparu' : 'toujours-la';
  }
  const seenBefore = it.history.filter((h) => rank(h.pass) < idx);
  if (!seenBefore.length) return undefined;
  const pass = reg.passes.find((p) => p.id === passId);
  if (!pass.audited.some((l) => places.has(l))) return 'non-verifie';
  // Écran regardé, mais pas l'état (défilement, menu ouvert…) où le défaut a été vu : pas cherché, donc
  // « non vérifié » (tour de sortie du 24/09, point 29 : un état perdu faisait dire « corrigé »).
  const states = new Set(it.history.flatMap((h) => h.states || []));
  if ((pass.missed || []).some((s) => states.has(s))) return 'non-verifie';
  // Absent, mais peut-être seulement parce que personne ne l'a cherché : un constat vu à l'œil
  // (interprétation d'un passage) n'est retrouvé que si ce passage est interprété à son tour ; un défaut
  // mesuré avec une autre version de l'outil peut disparaître à cause de l'outil. Dans ces deux cas,
  // « non vérifié », jamais « corrigé » (vu le 23/09 au soir : 26 « corrigés » dont une douzaine faux).
  // Vu à l'œil : corrigé seulement si l'interprète l'a constaté sur les captures de ce passage.
  if (it.rule === 'visual') return (pass.confirmed || []).includes(it.id) ? 'corrige' : 'non-verifie';
  const lastPass = reg.passes.find((p) => p.id === seenBefore[seenBefore.length - 1].pass);
  if ((lastPass?.mesure || null) !== (pass.mesure || null)) return 'non-verifie';
  return 'corrige';
}

/**
 * Dernier statut connu de chaque défaut (sert au ciblage : un défaut corrigé n'est plus visé) : celui
 * du dernier passage qui l'a vraiment regardé (vu, ou l'un de ses lieux audité). Un passage qui ne
 * regarde pas ses lieux (ex. passage Windows seul, pour un défaut TV) n'y change rien. Avant le 23/09,
 * chaque passage réécrivait « non vérifié » sur tous les défauts qu'il ne regardait pas.
 */
function refresh(reg) {
  const order = sortPasses(reg);
  for (const it of Object.values(reg.items)) {
    if (!it.history.length) continue;
    let last = null;
    for (const id of order) {
      const st = statusAt(reg, order, it, id);
      if (st && st !== 'non-verifie') last = { st, id };
    }
    Object.assign(it, last ? { lastStatus: last.st, lastPass: last.id } : { lastStatus: 'non-verifie', lastPass: order[order.length - 1] });
  }
}

/**
 * Enregistre un passage et retourne le statut de chaque défaut du registre pour ce passage.
 * pass = { id, date, at, mesure, audited: [lieu], missed: [taille|état non atteint], items: [{ id, kind, rule, el, name, gravity, where: [lieu], states: [taille|état] }] }
 * Idempotent : refaire la revue d'un même passage remplace son entrée.
 */
function recordPass(reg, pass) {
  reg.passes = reg.passes.filter((p) => p.id !== pass.id);
  reg.passes.push({ id: pass.id, date: pass.date, ...(pass.at && { at: pass.at }), ...(pass.mesure && { mesure: pass.mesure }), ...(pass.confirmed?.length && { confirmed: pass.confirmed }), audited: pass.audited, ...(pass.missed?.length && { missed: pass.missed }) });
  const order = sortPasses(reg);
  const seen = new Map(pass.items.map((it) => [reg.renamed[it.id] || it.id, it]));

  for (const [id, it] of seen) {
    const cur = reg.items[id] || (reg.items[id] = { id, history: [] });
    Object.assign(cur, { kind: it.kind, rule: it.rule, el: it.el, name: it.name, gravity: it.gravity });
    cur.history = cur.history.filter((h) => h.pass !== pass.id);
    cur.history.push({ pass: pass.id, where: it.where, ...(it.states?.length && { states: it.states }) });
    cur.history.sort((a, b) => order.indexOf(a.pass) - order.indexOf(b.pass));
  }

  const status = {};
  for (const [id, cur] of Object.entries(reg.items)) {
    const st = statusAt(reg, order, cur, pass.id);
    if (st) status[id] = st;
  }
  refresh(reg);
  return status;
}

/** Décisions à jour du registre, pour préremplir la page de revue. */
function decisions(reg) {
  return Object.fromEntries(Object.values(reg.items).filter((it) => it.decision).map((it) => [it.id, it.decision]));
}

/**
 * Importe des décisions (la plus récente l'emporte) ; une décision sans défaut connu est gardée à part.
 * `libre` (remarque générale d'une revue) n'est pas un défaut : ignorée ici.
 */
function importDecisions(reg, incoming) {
  let n = 0;
  for (const [rawId, d] of Object.entries(incoming)) {
    if (rawId === 'libre' || !d) continue;
    const id = reg.renamed[rawId] || rawId;
    const cur = reg.items[id] || (reg.items[id] = { id, history: [] });
    if (cur.decision?.updatedAt && d.updatedAt && cur.decision.updatedAt >= d.updatedAt) continue;
    cur.decision = { status: DECISIONS.includes(d.status) ? d.status : null, note: d.note || '', updatedAt: d.updatedAt || new Date().toISOString() };
    n++;
  }
  return n;
}

module.exports = { defectId, load, save, rename, recordPass, refresh, sortPasses, passTime, decisions, importDecisions, STATUS_LABEL, DECISIONS };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const ai = argv.indexOf('--app');
  const appDir = require('./paths.cjs').appDir((ai >= 0 && argv[ai + 1]) || undefined);
  const [cmd, src] = argv.filter((a, i) => a !== '--app' && argv[i - 1] !== '--app');
  const regFile = require(path.join(appDir, 'review.cjs')).REGISTRY;
  if (cmd === 'recalculer') {
    const reg = load(regFile);
    refresh(reg);
    save(regFile, reg);
    const c = {};
    for (const it of Object.values(reg.items)) c[it.lastStatus] = (c[it.lastStatus] || 0) + 1;
    console.log(`Statuts recalculés (${regFile}) : ${Object.entries(c).map(([k, n]) => `${STATUS_LABEL[k] || k} ${n}`).join(', ')}`);
  } else if (cmd === 'import' && src) {
    const reg = load(regFile);
    const n = importDecisions(reg, JSON.parse(fs.readFileSync(src, 'utf8')));
    save(regFile, reg);
    console.log(`${n} décision(s) importée(s) dans ${regFile}`);
  } else {
    console.log('Usage : node audit/review/registry.cjs import <décisions.json> [--app <nom>]\n        node audit/review/registry.cjs recalculer [--app <nom>]');
    process.exit(1);
  }
}
