// Avant / après d'une correction : deux passages sur les mêmes écrans, comparés capture par capture.
// Usage : node audit comparer <passage avant> <passage après> [réglages] [--ids a,b] [--titre "Lot 1"] [--forcer]
//   réglages : défaut, le review.cjs de la personnalisation choisie ;
//   --ids    : défauts visés (sinon : tous les défauts « Inclure » du registre) ;
//   --forcer : compare même deux passages mesurés avec des versions différentes de l'outil (déconseillé).
// Les deux passages doivent déjà avoir leur revue (node audit refaire-revue), qui a mis le registre à jour.
// Produit <après>/avant-apres/ (avant-apres.html et ses planches d'images, se publie tel quel) et
// <après>/avant-apres.json (données, formats : audit/FORMATS.md). Seules les captures qui changent sont
// montrées, une seule fois quand plusieurs tailles ou états changent à l'identique.
const fs = require('fs');
const path = require('path');
const registry = require('./registry.cjs');
const { thumbWidth, shrinkCached, pixelDiff, signature, sameImage } = require('./images.cjs');
const { targetCards } = require('./cibles.cjs');

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !['--ids', '--titre', '--corrections'].includes(argv[i - 1]));
const [A, B] = positional.slice(0, 2).map((d) => path.resolve(d || ''));
const cfg = require(path.resolve(positional[2] || require('./paths.cjs').reviewConfig()));
const OUT = path.join(B, 'avant-apres');
const ra = require(path.join(A, 'report.json'));
const rb = require(path.join(B, 'report.json'));

// Même mesure des deux côtés (core/mesure.mjs), sinon la comparaison ment.
const mesure = { avant: ra.mesure || null, apres: rb.mesure || null };
if (mesure.avant && mesure.apres && mesure.avant !== mesure.apres && !argv.includes('--forcer')) {
  console.error(`✖ Les deux passages n'ont pas été mesurés avec la même version de l'outil (avant ${mesure.avant}, après ${mesure.apres}) :
  un constat pourrait apparaître ou disparaître à cause de l'outil. Refaire le passage « avant » avec l'outil actuel
  (ou --forcer pour comparer quand même, déconseillé).`);
  process.exit(3);
}
const mesureNote = !mesure.avant || !mesure.apres ? 'Version de la mesure inconnue pour un des passages (fait avant le 23/09) : comparaison à lire avec prudence.'
  : mesure.avant !== mesure.apres ? `Mesures différentes (avant ${mesure.avant}, après ${mesure.apres}), comparaison forcée : à lire avec prudence.` : null;

const elOf = (sel) => {
  const last = (sel || '').split(' > ').slice(-1)[0];
  if (last.startsWith('#') || !last.includes('.')) return last;
  const [tag, first] = last.split('.');
  return `${tag}.${first}`;
};
const label = (s) => cfg.LABELS[s] || s;
const sizeLabel = (key) => { const s = key.replace(/^(tv|phone|desktop|web)-?/, ''); return cfg.SIZE_LABEL[s] || s || 'taille d\'origine'; };
// Constat réduit à son identité sur une capture : règle + élément. Faux positifs connus de l'outil
// (réglages du projet) écartés, comme dans la revue. Marche à la télécommande comprise (même traduction
// que la revue) : sinon une sélection qui part dans la barre latérale passerait inaperçue (23/09).
const walkRule = (w) => (/sort de l'écran/.test(w.note) ? 'walk-offscreen' : /perdu/.test(w.note) ? 'walk-lost' : /barre latérale/.test(w.note) ? 'walk-sidebar' : 'focus-invisible');
// Faux positifs mémorisés dans le registre (écartés par l'interprète) : ignorés ici aussi, sinon un faux
// positif apparu après une correction passerait pour une régression (épreuve du 23/09, lot 1).
const reg = registry.load(cfg.REGISTRY);
// Seulement s'il a été écarté avec la même version de la mesure que le passage « après ».
const isFalse = (kind, rule, sel) => { const f = reg.items[registry.defectId(kind, rule, elOf(sel))]?.faux; return !!f && (f.mesure || null) === (rb.mesure || null); };
const keysOf = (kind, s) => new Map([
  ...(s.issues || []).filter((i) => i.severity !== 'info' && !cfg.toolArtifact(kind, s.id, i)),
  ...(s.walk || []).filter((w) => w.severity).map((w) => ({ rule: walkRule(w), selector: w.to, message: `Touche ${w.key} : ${w.note}` })),
].filter((i) => !isFalse(kind, i.rule, i.selector)).map((i) => [`${i.rule}|${elOf(i.selector)}`, i]));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });

// Capture réduite, lue dans la banque d'images de son passage (images.cjs), ou null : zone sensible, absente.
const reduced = (dir, s, kind) => {
  if (!s?.shot || cfg.SENSITIVE.test(s.id) || !fs.existsSync(path.join(dir, s.shot))) return null;
  return shrinkCached(dir, s.shot, thumbWidth(kind, s));
};

const pairs = [];
const entries = []; // images gardées pour la page : [nom, capture d'origine]
const shown = []; // paires montrées, pour écarter celles qui changent à l'identique : { pair, sigA, sigB, keys }
for (const runB of rb.runs) {
  const runA = ra.runs.find((r) => r.key === runB.key);
  if (!runA) continue;
  const ids = [...new Set([...runA.screens, ...runB.screens].map((s) => s.id))];
  for (const id of ids) {
    const sa = runA.screens.find((s) => s.id === id), sb = runB.screens.find((s) => s.id === id);
    // Écran absent d'un des deux passages (passage « avant » plus large, par exemple) : rien à comparer
    if (!sa || !sb) continue;
    const kind = runB.key.split('-')[0];
    const pair = { run: runB.key, size: sizeLabel(runB.key), kind, id, group: sb.group || sa.group || id, label: sb.label || sa.label };
    const skipA = sa.skipped || sa.failed, skipB = sb.skipped || sb.failed;
    const ka = skipA ? new Map() : keysOf(kind, sa), kb = skipB ? new Map() : keysOf(kind, sb);
    pair.gone = [...ka.keys()].filter((k) => !kb.has(k)).map((k) => ({ rule: k.split('|')[0], el: label(k.split('|')[1]), message: ka.get(k).message }));
    pair.new = [...kb.keys()].filter((k) => !ka.has(k)).map((k) => ({ rule: k.split('|')[0], el: label(k.split('|')[1]), message: kb.get(k).message }));
    pair.kept = [...kb.keys()].filter((k) => ka.has(k)).length;
    const imA = skipA ? null : reduced(A, sa, kind), imB = skipB ? null : reduced(B, sb, kind);
    pair.diff = imA && imB ? pixelDiff(imA, imB) : null;
    // État atteint avant et plus après : régression, quel que soit le reste (23/09 : le clavier de la
    // Recherche TV ne s'ouvrait plus, et la page annonçait pourtant « Corrigé »)
    pair.reached = !!skipA !== !!skipB ? (skipB ? 'perdu' : 'atteint') : null;
    pair.before = skipA ? { skipped: skipA } : { img: null };
    pair.after = skipB ? { skipped: skipB } : { img: null };
    pair.changed = pair.gone.length + pair.new.length > 0 || !!pair.reached || (pair.diff ?? 0) >= 2;
    // Images : seulement pour ce qui change, et une seule fois quand le même changement se répète
    // (remarque de l'utilisateur, 23/09). Changement de constats : même écran (tous ses états), même
    // plateforme, mêmes constats disparus et apparus, à n'importe quelle taille : une carte. Changement
    // d'image seul : seulement si les images avant et après sont elles-mêmes identiques (contenu vivant).
    if (pair.changed && (imA || imB)) {
      const sigA = imA && signature(imA), sigB = imB && signature(imB);
      const keys = `${pair.gone.map((g) => g.rule + g.el).sort()}|${pair.new.map((g) => g.rule + g.el).sort()}|${pair.reached}`;
      const byFindings = pair.gone.length + pair.new.length > 0 || !!pair.reached;
      const twin = shown.find((x) => x.pair.kind === kind && x.keys === keys && (byFindings
        ? x.pair.group === pair.group
        : !!x.sigA === !!sigA && !!x.sigB === !!sigB && (!sigA || sameImage(x.sigA, sigA)) && (!sigB || sameImage(x.sigB, sigB))));
      if (twin) {
        (twin.pair.also || (twin.pair.also = [])).push(`${pair.label} (${pair.size})`);
        pair.twinOf = `${twin.pair.label} (${twin.pair.size})`;
      } else {
        if (imA) { pair.before.img = `avant-${runB.key}-${id}`; entries.push([pair.before.img, path.join(A, sa.shot)]); }
        if (imB) { pair.after.img = `apres-${runB.key}-${id}`; entries.push([pair.after.img, path.join(B, sb.shot)]); }
        shown.push({ pair, sigA, sigB, keys });
      }
    }
    pairs.push(pair);
  }
}
// Images de la page : une par capture montrée, nette (pleine résolution, réduite à 1280 px de large, 540
// pour un écran en hauteur), au lieu des planches très compressées (remarque de l'utilisateur, 23/09).
const IMG = {};
const { load: loadPng, scale: scalePng, save: saveJpg } = require('./relire.cjs');
for (const [name, file] of entries) {
  const src = loadPng(file);
  const maxW = src.height > src.width ? 540 : 1280;
  const img = src.width > maxW ? scalePng(src, maxW) : src;
  saveJpg(path.join(OUT, 'img', `${name}.jpg`), img);
  IMG[name] = { f: `img/${name}.jpg`, x: 0, y: 0, w: img.width, h: img.height, W: img.width, H: img.height };
}
const sheets = entries;
// Lecture de l'interprète sur les captures « après » (interpretation.json) : constats vus à l'œil
// confirmés corrigés (« corriges »), et états disparus pour une bonne raison (« etats » : { "taille|état":
// raison }, ex. plus rien à dérouler parce que le texte tient désormais en entier). Un état perdu ainsi
// constaté n'est plus une régression (tour de sortie du 24/09, point 29).
const interpB = fs.existsSync(path.join(B, 'interpretation.json')) ? JSON.parse(fs.readFileSync(path.join(B, 'interpretation.json'), 'utf8')) : {};
const confirmed = interpB.corriges || {};
for (const p of pairs) {
  const why = (interpB.etats || {})[`${p.run}|${p.id}`];
  if (p.reached === 'perdu' && why) Object.assign(p, { reached: 'perdu-constate', lostWhy: why });
}
const lost = pairs.filter((p) => p.reached === 'perdu');
const lostOk = pairs.filter((p) => p.reached === 'perdu-constate');

// Défauts visés : ceux du lot (--ids), sinon les « Inclure » du registre ; leur statut au passage après
// (le registre fait foi). Un défaut dont un écran a perdu un de ses états n'est pas déclaré corrigé :
// « à vérifier ».
const idB = path.basename(B);
const wanted = opt('--ids') ? new Set(opt('--ids').split(',').map((i) => reg.renamed[i] || i)) : null;
const targets = Object.values(reg.items).filter((it) => (wanted ? wanted.has(it.id) : it.decision?.status === 'inclure')).map((it) => {
  const seenB = it.history.some((h) => h.pass === idB);
  const passB = reg.passes.find((p) => p.id === idB);
  const places = new Set(it.history.flatMap((h) => h.where));
  const checked = passB && passB.audited.some((l) => places.has(l));
  const lostHere = lost.filter((p) => places.has(`${p.run}|${p.group}`));
  // États où le défaut a été vu, disparus pour une bonne raison selon l'interprète : c'est sa relecture
  // qui fait foi, comme pour un constat vu à l'œil.
  const states = new Set(it.history.flatMap((h) => h.states || []));
  const okHere = lostOk.filter((p) => states.has(`${p.run}|${p.id}`));
  // Vu à l'œil : la machine ne peut pas le prouver ; corrigé seulement si l'interprète l'a constaté.
  const eye = it.rule === 'visual';
  const status = seenB ? 'toujours-la' : !checked ? 'non-verifie' : lostHere.length ? 'a-verifier' : eye && !confirmed[it.id] ? 'a-confirmer' : 'corrige';
  const oeil = eye && confirmed[it.id] ? confirmed[it.id] : okHere.length ? okHere.map((p) => `« ${p.label} » (${p.size}) n'est plus atteint : ${p.lostWhy}`).join(' ; ') : null;
  return { id: it.id, name: it.name || it.id, kind: it.kind, note: it.decision?.note || '', status, ...(oeil && { oeil }), lost: lostHere.map((p) => `${p.label} (${p.size})`) };
});

// Lecture de l'interprète (facultative) : synthèse, et ce qui a été repéré en chemin sans être corrigé
// (on ne corrige que ce qui a été décidé : le reste attend la décision de l'utilisateur).
const notesFile = path.join(B, 'avant-apres-notes.json');
const notes = fs.existsSync(notesFile) ? JSON.parse(fs.readFileSync(notesFile, 'utf8')) : {};

// Fiche de chaque défaut visé : capture avant (défaut encadré), capture après (même zone),
// agrandissements, le souci (interprétation de la revue de départ), ce qui a été changé (écrit par
// l'interprète en corrigeant : <sortie>/lots/<passage de départ>/corrections.json, ou --corrections).
const readIf = (f) => (f && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const revueA = readIf(path.join(A, 'revue.json')) || { fiches: [] };
const avis = {}, reco = {};
for (const f of revueA.fiches) for (const id of f.ids) { if (f.avis) avis[id] = f.avis; if (f.reco) reco[id] = f.reco; }
const correctionsFile = opt('--corrections') || path.join(require('./paths.cjs').outRoot(), 'lots', path.basename(A), 'corrections.json');
const cibles = targetCards({
  targets, reg, ra, rb, cfg, sizeLabel, dirs: { A, B, out: OUT }, interpA: readIf(path.join(A, 'interpretation.json')) || {},
  texts: { avis, reco, corrections: readIf(correctionsFile) || {} },
});

const data = {
  cibles,
  format: 2, titre: opt('--titre') || null, app: cfg.APP_NAME || '', mesure, mesureNote,
  summary: notes.resume || null, spotted: notes.reperes || [], outil: notes.outil || [],
  before: { id: path.basename(A), date: ra.date }, after: { id: idB, date: rb.date }, targets,
  pairs: pairs.sort((a, b) => Number(b.reached === 'perdu') - Number(a.reached === 'perdu') || Number(b.changed) - Number(a.changed) || (b.diff ?? 0) - (a.diff ?? 0)),
  totals: {
    pairs: pairs.length, gone: pairs.reduce((n, p) => n + p.gone.length, 0), new: pairs.reduce((n, p) => n + p.new.length, 0),
    changed: pairs.filter((p) => p.changed).length, shown: shown.length, lost: lost.length, lostOk: lostOk.length,
  },
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const page = fs.readFileSync(path.join(__dirname, 'compare-template.html'), 'utf8')
  .replace('/*__THEME__*/', () => fs.readFileSync(path.join(__dirname, 'theme.css'), 'utf8'))
  .replace('__DATA__', () => JSON.stringify(data).replace(/</g, '\\u003c')).replace('__IMG__', () => JSON.stringify(IMG))
  .replaceAll('__APP__', () => esc(data.app));
fs.writeFileSync(path.join(OUT, 'avant-apres.html'), page);
fs.writeFileSync(path.join(B, 'avant-apres.json'), JSON.stringify(data, null, 1));
// Garde-fou (23/09 : la page avait perdu ses images sans que rien ne le signale) : chaque image que la
// page montre doit exister dans une planche.
const missing = pairs.flatMap((p) => [p.before.img, p.after.img]).filter((n) => n && !IMG[n]);
if (missing.length) { console.error(`✖ ${missing.length} image(s) de la page introuvables dans les planches : ${missing.slice(0, 3).join(', ')}`); process.exit(4); }
const STATUS = { ...registry.STATUS_LABEL, 'a-verifier': 'À vérifier (un état de l\'écran n\'est plus atteint)', 'a-confirmer': 'À confirmer à l\'œil (constat sans mesure : l\'interprète regarde la capture « après »)' };
console.log(`${pairs.length} captures comparées, ${data.totals.changed} changées (${shown.length} montrées, doublons écartés) ; constats disparus ${data.totals.gone}, apparus ${data.totals.new} ; ${sheets.length} images, ${cibles.length} fiches de défauts → ${path.join(OUT, 'avant-apres.html')}`);
if (mesureNote) console.log(`! ${mesureNote}`);
if (lost.length) console.log(`✖ ${lost.length} état(s) atteint(s) avant et plus après : ${lost.map((p) => `${p.label} (${p.size}) [${p.run}|${p.id}]`).join(', ')}`);
if (lostOk.length) console.log(`  ${lostOk.length} état(s) disparu(s), constaté(s) normal(aux) par l'interprète : ${lostOk.map((p) => `${p.label} (${p.size})`).join(', ')}`);
for (const t of targets) console.log(`  ${t.name} : ${STATUS[t.status]}`);
