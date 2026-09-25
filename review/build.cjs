// Revue d'un passage d'audit : défauts dédoublonnés entre écrans, tailles et plateformes (une fiche par
// défaut, avec ses plateformes), rangés selon une grille fixe (GRILLE.md), avec gravité, priorité de
// correction et conseil ; toutes les captures en galerie.
// Usage : node audit refaire-revue <passage> [réglages, défaut : review.cjs de la personnalisation choisie]
//   --sans-registre : revue d'essai, registre intact ; --sans-planches : sans planches de relecture.
// Produit, dans le dossier du passage (formats : audit/FORMATS.md) :
//   revue/        la page (revue.html) et ses planches d'images (img/) : se publie telle quelle ;
//   revue/relire/ planches de relecture pour l'interprète, et revue/a-relire.md (sa liste de travail) ;
//   revue.json    toutes les données de la revue (lisibles par n'importe quel outil ou IA) ;
//   revue.md      le résumé lisible : fiches dans l'ordre de la grille, décisions, statuts.
// Lus s'ils existent : interpretation.json (avis, recommandations, regroupements, faux positifs, constats
// vus à l'œil), decisions.json (décisions prises dans ce passage, revue locale).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const registry = require('./registry.cjs');
const { buildReadingSheets } = require('./relire.cjs');
const { thumbWidth, shrinkCached, packSheets, signature, sameImage } = require('./images.cjs');

const ARGS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const noRegistry = process.argv.includes('--sans-registre');
// Le passage : son chemin, ou son seul nom (dossier du même nom dans le dossier des passages), comme
// pour node audit revue (tour de sortie du 24/09, point 25).
const SRC = ARGS[0] && !fs.existsSync(path.resolve(ARGS[0])) && fs.existsSync(path.join(require('./paths.cjs').outRoot(), ARGS[0]))
  ? path.join(require('./paths.cjs').outRoot(), ARGS[0]) : path.resolve(ARGS[0] || '');
const cfg = require(path.resolve(ARGS[1] || require('./paths.cjs').reviewConfig()));
const OUT = path.join(SRC, 'revue');
const report = require(path.join(SRC, 'report.json'));
const INTERP_FILE = path.join(SRC, 'interpretation.json');
const interp = fs.existsSync(INTERP_FILE) ? JSON.parse(fs.readFileSync(INTERP_FILE, 'utf8')) : { items: {}, constats: [] };
const DECISIONS_FILE = path.join(SRC, 'decisions.json');
const PLATFORM = { tv: 'Android TV', phone: 'Téléphone', desktop: 'Bureau', web: 'Web' };
const KINDS = Object.keys(PLATFORM);
const kindOf = (key) => key.split('-')[0];
const sizeKey = (key) => key.replace(/^(tv|phone|desktop|web)-?/, '');
const sizeLabel = (key) => cfg.SIZE_LABEL[sizeKey(key)] || sizeKey(key) || 'taille d\'origine';

// Familles : titre et conseil (ce qu'il faut obtenir, pas comment). L'ordre est celui d'affichage.
const FAMILIES = {
  ...(cfg.FAMILIES || {}),
  visual: { title: 'Vu sur les captures', advice: 'Défauts repérés à l\'œil sur les captures, que les mesures automatiques n\'ont pas signalés.' },
  'keyboard-auto': { title: 'Clavier qui s\'ouvre tout seul', advice: 'À l\'arrivée sur l\'écran, le champ ne doit pas ouvrir le clavier : il s\'ouvre seulement quand on appuie sur OK.' },
  'page-overflow-x': { title: 'Page plus large que l\'écran', advice: 'Rien ne doit dépasser la largeur de l\'écran : les éléments se resserrent ou passent à la ligne.' },
  'offscreen-x': { title: 'Éléments qui sortent de l\'écran', advice: 'Garder l\'élément entier à l\'écran, à toutes les largeurs.' },
  'focus-invisible': { title: 'Sélection invisible à la télécommande', advice: 'L\'élément sélectionné doit toujours montrer son liseré.' },
  'focus-clipped': { title: 'Liseré de sélection coupé', advice: 'Laisser la place au liseré, ou faire défiler pour montrer l\'élément sélectionné en entier.' },
  'walk-offscreen': { title: 'Sélection qui sort de l\'écran à la télécommande', advice: 'En se déplaçant aux flèches, l\'élément sélectionné doit rester entièrement visible : la liste défile avec lui.' },
  'walk-lost': { title: 'Sélection perdue à la télécommande', advice: 'Chaque flèche doit laisser un élément sélectionné, visible.' },
  'walk-sidebar': { title: 'Haut / Bas qui entre dans la barre latérale', advice: 'Règle de parcours de l\'app : on n\'entre dans la barre latérale que par la gauche.' },
  'text-line-cut': { title: 'Lignes de texte coupées en deux', advice: 'Une ligne est entière ou absente : le cadre montre un nombre entier de lignes, ou le texte s\'affiche en entier.' },
  'text-faded': { title: 'Texte caché sous un fondu', advice: 'Décider si ce texte doit se lire en entier sans manipulation, ou s\'il peut rester dans un petit cadre qui défile.' },
  'text-tiny': { title: 'Textes trop petits', advice: 'Remonter ces textes à au moins 12 px à l\'écran, de préférence par une taille de base commune plutôt qu\'au cas par cas.' },
  'text-clipped': { title: 'Textes coupés', advice: 'Laisser le texte passer à la ligne, ou le raccourcir proprement avec « … ».' },
  'text-overflow': { title: 'Textes qui débordent', advice: 'Le texte doit tenir dans son cadre : passage à la ligne ou cadre qui s\'agrandit.' },
  'size-bounds': { title: 'Cartes hors des tailles encadrées', advice: 'Choisir le nombre de colonnes selon la largeur disponible, pour garder chaque carte dans les tailles décidées.' },
  'bottom-hidden': { title: 'Fin de page cachée sous la barre du bas', advice: 'Le dernier élément doit pouvoir remonter au-dessus de la barre de navigation.' },
  covered: { title: 'Éléments masqués par un autre', advice: 'Un élément cliquable ne doit pas être caché par un autre : les écarter ou revoir leur superposition.' },
  overlap: { title: 'Éléments qui se chevauchent', advice: 'Écarter ces éléments pour que chacun reste lisible et facile à viser.' },
  'touch-target': { title: 'Zones tactiles trop petites', advice: 'Agrandir la zone qui réagit au doigt jusqu\'à 44 points, sans forcément changer le dessin (marge tactile invisible).' },
  'axe-color-contrast': { title: 'Contraste insuffisant', advice: 'Éclaircir le texte ou assombrir son fond, jusqu\'à un contraste d\'au moins 4,5:1.' },
  'expected-missing': { title: 'Éléments attendus absents', advice: 'Cet élément doit être affiché à toutes les tailles d\'écran (règle du parcours de l\'app).' },
  'image-broken': { title: 'Images qui ne s\'affichent pas', advice: 'Prévoir une image de secours quand l\'image du fournisseur manque.' },
  // Pour information : pas des défauts en soi, à regarder.
  'text-ellipsis': { title: 'Textes raccourcis par « … »', advice: 'Normal pour un titre long ; à revoir si le texte raccourci est important.', info: true },
  'image-blurry': { title: 'Images étirées (floues)', advice: 'Demander une image plus grande au fournisseur quand elle existe.', info: true },
  'image-oversized': { title: 'Images trop lourdes', advice: 'Demander une image à la taille d\'affichage : chargement plus rapide.', info: true },
};

// Gravité par défaut de chaque règle. Bloquant : empêche d'utiliser l'écran. Important : se voit et
// gêne. Mineur : gêne peu ou rarement. À trancher : question de conception plus que défaut.
const GRAVITY = {
  'walk-lost': 'bloquant', 'focus-invisible': 'bloquant', 'walk-offscreen': 'bloquant',
  visual: 'important', 'keyboard-auto': 'important', 'page-overflow-x': 'important', 'offscreen-x': 'important',
  'focus-clipped': 'important', 'walk-sidebar': 'important', 'text-line-cut': 'important', 'text-tiny': 'important',
  'text-clipped': 'important', 'text-overflow': 'important', 'bottom-hidden': 'important', 'image-broken': 'important',
  'expected-missing': 'important', covered: 'mineur', overlap: 'mineur', 'touch-target': 'mineur', 'axe-color-contrast': 'mineur', 'size-bounds': 'mineur',
  'text-faded': 'a-trancher',
};
const GRAVITY_WEIGHT = { bloquant: 4, important: 3, mineur: 1, 'a-trancher': 0, info: 0 };
const PRIORITY_WEIGHT = { forte: 3, moyenne: 2, faible: 1, decider: 0 };
// Effort de correction estimé : simple (une valeur à changer), moyen, lourd (mise en page à revoir).
const EFFORT = {
  'text-tiny': 'simple', 'touch-target': 'simple', 'axe-color-contrast': 'simple', 'text-line-cut': 'simple', 'focus-clipped': 'moyen',
  'keyboard-auto': 'moyen', 'size-bounds': 'moyen', overlap: 'moyen', covered: 'moyen', visual: 'moyen', 'text-clipped': 'simple',
  'text-overflow': 'simple', 'walk-sidebar': 'moyen', 'walk-lost': 'moyen', 'walk-offscreen': 'moyen', 'focus-invisible': 'simple',
  'page-overflow-x': 'moyen', 'offscreen-x': 'moyen', 'expected-missing': 'moyen', 'bottom-hidden': 'simple', 'image-broken': 'simple', 'text-faded': 'moyen',
};

/** Priorité de la correction : gravité, étendue (écrans, tailles, plateformes) et effort. */
function priorityOf(it) {
  if (it.gravity === 'a-trancher' || it.gravity === 'info') return { level: 'decider', why: 'à décider d\'abord' };
  let score = GRAVITY_WEIGHT[it.gravity];
  const why = [];
  const plats = it.platforms?.length || 1;
  const wide = it.screens.length >= 4 || it.sizes.length >= 2 || plats >= 2;
  if (wide) {
    why.push([`${it.screens.length} écran${it.screens.length > 1 ? 's' : ''}`, it.sizes.length > 1 ? `${it.sizes.length} tailles` : '', plats > 1 ? `${plats} plateformes` : ''].filter(Boolean).join(', '));
    score++;
  }
  const effort = it.effort || EFFORT[it.rule] || 'moyen'; // l'interprète peut le préciser
  if (effort === 'simple') { score++; why.push('correction simple'); }
  if (effort === 'lourd') { score--; why.push('correction lourde'); }
  // Important seul : moyenne ; important et étendu ou simple : forte ; mineur seul : faible.
  const level = score >= 4 ? 'forte' : score >= 2 ? 'moyenne' : 'faible';
  return { level, why: why.join(', ') };
}

// Élément = balise + première classe (ou id) : le même bouton actif ou inactif reste un seul défaut.
const elOf = (sel) => {
  const last = (sel || '').split(' > ').slice(-1)[0];
  if (last.startsWith('#') || !last.includes('.')) return last;
  const [tag, first] = last.split('.');
  return `${tag}.${first}`;
};
// Noms lisibles : ceux de l'app, puis quelques noms génériques, puis la classe (ou l'id) de l'élément.
const GENERIC_LABELS = { body: 'Page entière', html: 'Page entière', a: 'Liens', button: 'Boutons', input: 'Champs de saisie', img: 'Images', h1: 'Titres', h2: 'Titres', h3: 'Titres' };
const labelOf = (el) => cfg.LABELS[el] || GENERIC_LABELS[el] || el.replace(/^[a-z0-9]+\./, '').replace(/^#/, '').replace(/[-_]+/g, ' ');
const idOf = (...parts) => crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
const walkRule = (w) => (/sort de l'écran/.test(w.note) ? 'walk-offscreen' : /perdu/.test(w.note) ? 'walk-lost' : /barre latérale/.test(w.note) ? 'walk-sidebar' : 'focus-invisible');

// Cadre d'un constat en % de la capture (la WebView n'occupe pas forcément tout l'écran).
const toPct = (s, rc) => {
  const [vw, vh] = s.metrics.viewport.split(' × ').map(Number);
  const f = s.frame;
  return (f
    ? [(f.x + (rc.x * f.w) / vw) / s.image.w, (f.y + (rc.y * f.h) / vh) / s.image.h, (rc.w * f.w) / vw / s.image.w, (rc.h * f.h) / vh / s.image.h]
    : [rc.x / vw, rc.y / vh, rc.w / vw, rc.h / vh]).map((v) => +(v * 100).toFixed(2));
};

// Registre : lu d'abord (décisions, faux positifs mémorisés), écrit à la fin (sauf --sans-registre).
const reg = cfg.REGISTRY ? registry.load(cfg.REGISTRY) : null;
if (reg) registry.rename(reg, cfg.RENAMED);
const regItem = (id) => reg?.items[reg.renamed[id] || id];

fs.rmSync(path.join(OUT, 'img'), { recursive: true, force: true });
fs.rmSync(path.join(OUT, 'data.json'), { force: true }); // ancien emplacement (avant le 23/09) : revue.json
fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
// Banque d'images du passage : chaque capture est réduite une fois ; une capture identique à une autre
// déjà retenue (même écran à une autre taille, défilement qui ne change rien) renvoie à celle-ci au lieu
// d'être gardée deux fois. `twin[nom]` : nom de l'image retenue.
const thumbs = new Map(); // nom → { img, sheet: clé de la planche }
const twin = {};
const sigIndex = []; // { name, kind, sig } des images retenues
function useImage(kind, run, s) {
  if (cfg.SENSITIVE.test(s.id) || !s.shot) return null;
  const name = `${run.key}-${s.id}`;
  if (twin[name]) return twin[name];
  if (thumbs.has(name)) return name;
  const img = shrinkCached(SRC, s.shot, thumbWidth(kind, s));
  const sig = signature(img);
  const same = sigIndex.find((x) => x.kind === kind && sameImage(x.sig, sig));
  if (same) { twin[name] = same.name; return same.name; }
  thumbs.set(name, { img, sheet: run.key, file: path.join(SRC, s.shot) });
  sigIndex.push({ name, kind, sig });
  return name;
}

// Constats par plateforme (identité du registre : plateforme | règle | élément).
const perKind = {}; // kind → { key: { rule, info, title, advice, items: { id: item } } }
function addItem(kind, fam, rule, el, patch) {
  const id = registry.defectId(kind, fam.rule, el); // fam.rule = règle, ou « info:règle » pour un constat rangé en information
  const g = fam.info ? 'info' : cfg.GRAVITY[`${kind}|${rule}|${el}`] || cfg.GRAVITY[`${rule}|${el}`] || GRAVITY[rule] || 'mineur';
  const it = fam.items[id] || (fam.items[id] = { id, kind, rule, famKey: fam.rule, el, name: labelOf(el), gravity: g, sev: 'warning', messages: new Set(), screens: new Set(), sizes: new Set(), where: new Set(), states: new Set(), example: null, advice: cfg.SPECIFIC[el] || null });
  Object.assign(it, patch);
  return it;
}
const famOf = (kind, key, rule) => {
  const fams = perKind[kind] || (perKind[kind] = {});
  return fams[key] || (fams[key] = { rule: key, ...FAMILIES[rule], ...(key !== rule && { info: true }), items: {} });
};

const data = {
  format: 2, date: report.date, at: report.at || null, app: cfg.APP_NAME || report.app || '', appId: report.appId || process.env.AUDIT_APP || null,
  profile: report.profile, durationMin: report.durationMin, mesure: report.mesure || null, platforms: [],
};
const audited = new Set();
// États d'écran non atteints dans ce passage (« taille|état ») : les défauts vus dans ces états n'ont pas
// pu être cherchés, ils ne sont pas « corrigés » (tour de sortie du 24/09, point 29). Sauf si l'interprète
// a constaté sur les captures que l'état a disparu pour une bonne raison (interpretation.json, « etats »).
const missed = new Set();
for (const kind of KINDS) {
  const runs = report.runs.filter((r) => kindOf(r.key) === kind);
  if (!runs.length) continue;
  const plat = { kind, title: PLATFORM[kind], model: '', sizes: [], compare: {}, paths: {}, skipped: [], captures: 0 };
  const sizeOfImage = {}; // taille d'où vient chaque image retenue (pour « identique en 1080p »)
  for (const run of runs) {
    const label = sizeLabel(run.key);
    plat.sizes.push(label);
    plat.model = plat.model || (run.title || '').split(' · ')[1] || '';
    const walk = plat.paths[label] = { size: label, duration: run.durationMin ?? null, restarts: run.restarts || 0, retried: !!run.retried, shots: [] };
    for (const s of run.screens) {
      if (s.skipped || s.failed) {
        plat.skipped.push({ size: label, label: s.label, why: s.skipped || s.failed });
        walk.shots.push({ label: s.label, missing: s.skipped ? `non atteint : ${s.skipped}` : `échec : ${s.failed}` });
        if (!(interp.etats || {})[`${run.key}|${s.id}`]) missed.add(`${run.key}|${s.id}`);
        continue;
      }
      plat.captures++;
      const group = s.group || s.id;
      audited.add(`${run.key}|${group}`);
      const img = useImage(kind, run, s);
      if (img && !sizeOfImage[img]) sizeOfImage[img] = label;
      const own = img === `${run.key}-${s.id}`;
      const counted = (s.issues || []).filter((i) => FAMILIES[i.rule] && !FAMILIES[i.rule].info && !cfg.toolArtifact(kind, s.id, i)).length + (s.walkIssues || 0);
      walk.shots.push({
        img, group, label: s.label, issues: counted,
        same: img && !own ? (sizeOfImage[img] === label ? 'identique à une capture précédente' : `identique en ${sizeOfImage[img]}`) : '',
        note: [s.fitsScreen ? 'tient en un écran, rien à faire défiler' : '', s.recovered ? `app ramenée au premier plan (${s.recovered})` : '', s.keyboardVia ? `clavier ouvert par : ${s.keyboardVia}` : '', s.masked ? `${s.masked} zone${s.masked > 1 ? 's' : ''} sensible${s.masked > 1 ? 's' : ''} masquée${s.masked > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · '),
      });
      if (group === s.id) {
        const c = plat.compare[s.id] || (plat.compare[s.id] = { label: s.label, cells: {} });
        c.cells[label] = { img };
      }
      const issues = [...(s.issues || [])];
      for (const w of s.walk || []) if (w.severity) issues.push({ rule: walkRule(w), severity: 'error', message: `Touche ${w.key} : ${w.note}`, selector: w.to, rects: [] });
      for (const i of issues) {
        if (!FAMILIES[i.rule] || cfg.toolArtifact(kind, s.id, i)) continue;
        const el = elOf(i.selector);
        // Un constat que la mesure classe elle-même en information (ex. clavier ouvert à l'arrivée sur
        // téléphone, voulu au toucher) va dans « Pour information », même si sa règle est un défaut.
        const key = i.severity === 'info' && !FAMILIES[i.rule].info ? `info:${i.rule}` : i.rule;
        const it = addItem(kind, famOf(kind, key, i.rule), i.rule, el, {});
        it.where.add(`${run.key}|${group}`);
        it.states.add(`${run.key}|${s.id}`);
        if (i.severity === 'error') it.sev = 'error';
        it.messages.add(i.message);
        it.screens.add(s.label.split(' · ').slice(0, 2).join(' · '));
        it.sizes.add(label);
        if (!it.example && img) it.example = { img, label: `${s.label} (${label})`, boxes: (i.rects || (i.rect ? [i.rect] : [])).filter((r) => r.w > 0).slice(0, 6).map((r) => toPct(s, r)) };
      }
    }
  }
  // Constats vus à l'œil (réglages du projet, puis interprétation du passage) : seulement si la
  // capture qui les montre fait partie du passage.
  for (const m of [...(cfg.MANUAL[kind] || []), ...(interp.constats || []).filter((x) => x.kind === kind)]) {
    const run = report.runs.find((r) => r.key === m.shot.run);
    const s = run?.screens.find((x) => x.id === m.shot.id && x.shot);
    if (!s) { console.warn(`Constat « ${m.name} » : capture ${m.shot.run}/${m.shot.id} absente du passage, ignoré`); continue; }
    const key = FAMILIES[m.fam] ? m.fam : 'visual';
    const size = sizeLabel(run.key);
    const img = useImage(kind, run, s);
    const it = addItem(kind, famOf(kind, key, key), key, m.el, {
      where: new Set((m.where || [s.group || s.id]).map((g) => (g.includes('|') ? g : `${run.key}|${g}`))), name: m.name, sev: m.sev || 'error',
      messages: new Set([m.message]), screens: new Set(m.screens || [s.label.split(' · ').slice(0, 2).join(' · ')]), sizes: new Set(m.sizes || [size]), advice: m.advice || null,
      example: img ? { img, label: `${s.label} (${size})`, boxes: m.boxes || [] } : null,
    });
    if (m.gravity) it.gravity = m.gravity;
    for (const k of ['avis', 'reco', 'effort', 'etat']) if (m[k]) it[k] = m[k];
  }
  plat.compare = Object.values(plat.compare);
  const ORDER = Object.values(cfg.SIZE_LABEL);
  plat.sizes.sort((x, y) => ORDER.indexOf(x) - ORDER.indexOf(y));
  plat.paths = plat.sizes.map((s) => plat.paths[s]);
  data.platforms.push(plat);
}

// Constats d'une plateforme, avec l'interprétation. Faux positifs : écartés à la relecture de ce passage
// (interpretation.json), ou d'un passage précédent (mémorisés dans le registre, pour ne plus les signaler).
const allItems = [];
for (const [kind, fams] of Object.entries(perKind)) {
  for (const f of Object.values(fams)) {
    for (const raw of Object.values(f.items)) {
      const it = { ...raw, family: { rule: f.rule, title: f.title, advice: f.advice, info: !!f.info }, messages: [...raw.messages].slice(0, 3), screens: [...raw.screens], sizes: [...raw.sizes], where: [...raw.where], states: [...raw.states] };
      const note = interp.items?.[it.id];
      if (note) {
        if (note.gravity) it.gravity = note.gravity;
        for (const k of ['avis', 'reco', 'effort', 'faux', 'etat']) if (note[k]) it[k] = note[k];
      }
      const known = regItem(it.id);
      // Faux positif mémorisé avec la version de la mesure qui l'a produit : si la mesure a changé (la
      // règle fautive a peut-être été corrigée), il redevient visible pour être revérifié une fois, au
      // lieu d'être caché pour toujours (un vrai défaut au même endroit le serait aussi).
      if (note?.faux && known) known.faux = { raison: note.faux, pass: path.basename(SRC), mesure: report.mesure || null };
      else if (!note && known?.faux && (known.faux.mesure || null) === (report.mesure || null)) it.faux = `${known.faux.raison} (écarté à la relecture du passage ${known.faux.pass})`;
      else if (!note && known?.faux) it.etat = `Écarté comme faux positif au passage ${known.faux.pass}, avec une autre version de la mesure : à revérifier`;
      // Interprétation d'un passage précédent (identité stable du défaut) : reproposée, marquée « à
      // revérifier » ; l'interprète la confirme ou la corrige (épreuve du 23/09, points 5 et 12).
      if (note && known && (note.avis || note.reco)) known.interp = { avis: note.avis || null, reco: note.reco || null, effort: note.effort || null, gravity: note.gravity || null, pass: path.basename(SRC) };
      else if (!note && known?.interp && known.interp.pass !== path.basename(SRC)) {
        if (known.interp.gravity) it.gravity = known.interp.gravity;
        if (known.interp.effort) it.effort = known.interp.effort;
        it.avis = known.interp.avis ? `${known.interp.avis}\n(Interprétation du passage ${known.interp.pass}, à revérifier sur ce passage.)` : null;
        it.reco = known.interp.reco;
      }
      it.priority = priorityOf(it);
      allItems.push(it);
    }
  }
}

// Cycles de corrections partis de ce passage (audit/lots.mjs) : chaque défaut d'un lot porte son état.
const LOT_ETAT = { 'a-corriger': 'Dans le lot {n} : à corriger', prouve: 'Corrigé et prouvé (lot {n})', 'a-confirmer': 'Lot {n} : corrigé, à confirmer à l’œil', incomplet: 'Lot {n} : pas encore corrigé', regression: 'Lot {n} : régression, à vérifier', clos: 'Lot {n} : clos sans preuve' };
const cycleFile = path.join(require('./paths.cjs').outRoot(), 'lots', path.basename(SRC), 'cycle.json');
if (fs.existsSync(cycleFile)) {
  const cycle = JSON.parse(fs.readFileSync(cycleFile, 'utf8'));
  for (const lot of cycle.lots) for (const id of lot.ids) {
    const it = allItems.find((x) => x.id === id);
    if (it) it.etat = LOT_ETAT[lot.etat].replace('{n}', lot.n);
  }
}

// Registre (mémoire entre passages) : statut de chaque défaut, décisions déjà prises, défauts corrigés.
let status = {};
if (reg && !noRegistry) {
  status = registry.recordPass(reg, {
    // Constats vus à l'œil que l'interprète a vus corrigés sur les captures de ce passage (interpretation.json).
    confirmed: Object.keys(interp.corriges || {}),
    id: path.basename(SRC), date: report.date, at: report.at, mesure: report.mesure, audited: [...audited].sort(), missed: [...missed].sort(),
    items: allItems.map((it) => ({ id: it.id, kind: it.kind, rule: it.rule, el: it.el, name: it.name, gravity: it.gravity, where: it.where, states: it.states })),
  });
  // Définition des constats vus à l'œil de ce passage, gardée au registre : aux passages suivants, la
  // liste de l'interprète les reprend pour qu'il les revérifie (sinon ils sont oubliés, épreuve, point 5).
  for (const m of interp.constats || []) {
    const cur = reg.items[registry.defectId(m.kind, FAMILIES[m.fam] ? m.fam : 'visual', m.el)];
    if (cur) cur.constat = { name: m.name, message: m.message, screens: m.screens || null, shot: m.shot, pass: path.basename(SRC) };
  }
  registry.save(cfg.REGISTRY, reg);
  // Constats vus à l'œil d'avant, pas repris dans ce passage : à revérifier par l'interprète.
  // Seulement ceux vus à une taille que ce passage a regardée (un constat du téléphone de 320 ne se
  // revérifie pas sur la tablette : mini-tour du 23/09).
  const runsHere = new Set(report.runs.map((r) => r.key));
  data.aRevoir = Object.values(reg.items).filter((x) => x.rule === 'visual' && x.constat && runsHere.has(x.constat.shot?.run) && !allItems.some((it) => it.id === x.id)
    && x.decision?.status !== 'exclure' && x.lastStatus !== 'corrige')
    .map((x) => ({ id: x.id, kind: x.kind, el: x.el, name: x.name, message: x.constat.message, shot: x.constat.shot, pass: x.constat.pass, decision: x.decision?.status || null }));
  // Corrigés : rattachés au lot qui les a corrigés quand il y en a un (la correction d'un lot, prouvée
  // sur les tailles de son passage de départ, se constate ici sur les autres tailles).
  const lotOf = {};
  const lotsDir = path.join(require('./paths.cjs').outRoot(), 'lots');
  if (fs.existsSync(lotsDir)) {
    for (const dir of fs.readdirSync(lotsDir)) {
      const f = path.join(lotsDir, dir, 'cycle.json');
      if (!fs.existsSync(f)) continue;
      for (const lot of JSON.parse(fs.readFileSync(f, 'utf8')).lots) for (const id of lot.ids) if (lot.verifications.length) lotOf[id] = `lot ${lot.n} du ${dir}`;
    }
  }
  data.fixed = Object.entries(status).filter(([, st]) => st === 'corrige')
    .map(([id]) => ({ id, name: reg.items[id].name, kind: reg.items[id].kind, platform: PLATFORM[reg.items[id].kind], rule: reg.items[id].rule, ...(lotOf[id] && { lot: lotOf[id] }) }));
  data.unverified = Object.values(status).filter((st) => st === 'non-verifie').length;
  data.passes = reg.passes.length;
}
for (const it of allItems) it.status = status[reg?.renamed[it.id] || it.id] || (reg && !noRegistry ? 'nouveau' : null);

// Décisions : celles du registre, puis celles prises dans ce passage (decisions.json) ; la plus récente
// l'emporte. Une décision prise sous une ancienne identité est retrouvée sous la nouvelle.
data.decisions = {};
if (reg) {
  const known = registry.decisions(reg);
  for (const it of allItems) { const d = known[reg.renamed[it.id] || it.id]; if (d) data.decisions[it.id] = d; }
}
if (fs.existsSync(DECISIONS_FILE)) {
  for (const [id, d] of Object.entries(JSON.parse(fs.readFileSync(DECISIONS_FILE, 'utf8')))) {
    if (!data.decisions[id]?.updatedAt || (d.updatedAt || '') >= data.decisions[id].updatedAt) data.decisions[id] = d;
  }
}

// Fiches : un défaut vu sur plusieurs plateformes (même règle, même élément) = une seule fiche, avec
// ses pastilles de plateforme ; les regroupements de l'interprète (même cause, une correction) aussi.
// La décision d'une fiche s'applique à tous ses défauts (le registre garde une identité par plateforme).
const byFiche = new Map();
const groupOf = {};
for (const g of interp.groupes || []) for (const id of g.ids || []) groupOf[id] = g;
for (const it of allItems) {
  const g = groupOf[it.id];
  const key = g ? `groupe|${g.ids.slice().sort().join(',')}` : `${it.faux ? 'faux' : 'ok'}|${it.family.rule}|${it.el}`;
  (byFiche.get(key) || byFiche.set(key, []).get(key)).push(it);
}
const distinct = (parts, k) => {
  const vals = parts.filter((p) => p[k]);
  const uniq = [...new Set(vals.map((p) => p[k]))];
  if (uniq.length <= 1) return uniq[0] || null;
  return vals.map((p) => `${PLATFORM[p.kind]} : ${p[k]}`).join('\n');
};
const fiches = [...byFiche.entries()].map(([key, parts]) => {
  parts.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
  const g = key.startsWith('groupe|') ? groupOf[parts[0].id] : null;
  const gravity = g?.gravity || parts.reduce((x, p) => (GRAVITY_WEIGHT[p.gravity] > GRAVITY_WEIGHT[x] ? p.gravity : x), parts[0].gravity);
  const f = {
    id: parts.length === 1 ? parts[0].id : `f${idOf(...parts.map((p) => p.id).sort())}`,
    ids: parts.map((p) => p.id), group: g ? { titre: g.titre, n: parts.length } : null,
    name: g?.titre || parts[0].name, rule: parts[0].rule, family: parts[0].family, gravity,
    platforms: [...new Set(parts.map((p) => p.kind))],
    sev: parts.some((p) => p.sev === 'error') ? 'error' : 'warning',
    messages: [...new Set(parts.flatMap((p) => p.messages))].slice(0, 4),
    screens: [...new Set(parts.flatMap((p) => p.screens))],
    sizes: parts.flatMap((p) => p.sizes.map((s) => `${PLATFORM[p.kind]} · ${s}`)),
    advice: distinct(parts, 'advice'), avis: g?.avis || distinct(parts, 'avis'), reco: g?.reco || distinct(parts, 'reco'),
    effort: g?.effort || parts.find((p) => p.effort)?.effort || null, etat: distinct(parts, 'etat'),
    faux: parts.every((p) => p.faux) ? distinct(parts, 'faux') : null,
    parts: parts.map((p) => ({ id: p.id, kind: p.kind, name: p.name, sizes: p.sizes, screens: p.screens, where: p.where, example: p.example, status: p.status, messages: p.messages })),
  };
  f.priority = priorityOf(f);
  return f;
});
// Grille fixe (audit/GRILLE.md) : famille (ordre des familles), puis gravité, priorité, nombre de
// plateformes, d'écrans, puis nom.
const famRank = (r) => { const i = Object.keys(FAMILIES).indexOf(r.replace(/^info:/, '')); return i < 0 ? 999 : i; };
fiches.sort((a, b) => GRAVITY_WEIGHT[b.gravity] - GRAVITY_WEIGHT[a.gravity] || PRIORITY_WEIGHT[b.priority.level] - PRIORITY_WEIGHT[a.priority.level]
  || b.platforms.length - a.platforms.length || b.screens.length - a.screens.length || a.name.localeCompare(b.name, 'fr'));
data.fiches = fiches;
// Familles dans l'ordre d'affichage : la plus grave d'abord, « À trancher » après les défauts.
const famGravity = {};
for (const f of fiches) if (!f.faux) famGravity[f.family.rule] = Math.max(famGravity[f.family.rule] ?? -1, f.gravity === 'a-trancher' ? -0.5 : GRAVITY_WEIGHT[f.gravity]);
data.families = Object.keys(famGravity).sort((a, b) => famGravity[b] - famGravity[a] || famRank(a) - famRank(b))
  .map((r) => { const f = fiches.find((x) => x.family.rule === r).family; return { rule: r, title: f.title, advice: f.advice, info: f.info }; });
data.summary = interp.resume || null;

// Planches d'images : les images retenues de chaque taille d'écran, en quelques fichiers.
const { IMG, sheets } = packSheets([...thumbs].map(([name, t]) => [name, t.img, t.sheet]), path.join(OUT, 'img'));
// Version nette de chaque image, chargée seulement à l'agrandissement (les vignettes des planches sont
// très réduites et compressées : illisibles une fois agrandies, remarque de l'utilisateur, 23/09).
// --sans-grand : sans ces images (revue plus légère à publier).
if (!process.argv.includes('--sans-grand')) {
  const { load: loadPng, scale: scalePng, save: saveJpg } = require('./relire.cjs');
  fs.mkdirSync(path.join(OUT, 'img', 'grand'), { recursive: true });
  for (const [name, t] of thumbs) {
    const src = loadPng(t.file);
    const maxW = src.height > src.width ? 540 : 1280;
    saveJpg(path.join(OUT, 'img', 'grand', `${name}.jpg`), src.width > maxW ? scalePng(src, maxW) : src);
    IMG[name].g = `img/grand/${name}.jpg`;
  }
}
data.images = Object.keys(IMG).length;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const theme = fs.readFileSync(path.join(__dirname, 'theme.css'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8')
  .replace('/*__THEME__*/', () => theme)
  .replace('__DATA__', () => JSON.stringify(data).replace(/</g, '\\u003c')).replace('__IMG__', () => JSON.stringify(IMG))
  .replaceAll('__APP__', () => esc(data.app));
fs.writeFileSync(path.join(OUT, 'revue.html'), page);
fs.writeFileSync(path.join(SRC, 'revue.json'), JSON.stringify(data, null, 1));

// Planches de relecture (--sans-planches pour s'en passer) : défaut encadré et agrandi, écrans à toutes les tailles.
const readingData = {
  platforms: data.platforms.map((p) => ({ ...p, families: [{ items: allItems.filter((it) => it.kind === p.kind && !it.family.info) }], info: [{ items: allItems.filter((it) => it.kind === p.kind && it.family.info) }] })),
};
const reading = process.argv.includes('--sans-planches') ? { items: {}, screens: [] } : buildReadingSheets(SRC, OUT, readingData);
require('./summary.cjs').write(SRC, OUT, data, { reading, interpFile: INTERP_FILE });

const total = sheets.reduce((n, s) => n + fs.statSync(path.join(OUT, 'img', s.file)).size, 0);
console.log(`${thumbs.size} images retenues (${Object.keys(twin).length} doublons écartés), ${sheets.length} planches ${Math.round(total / 1024)} Ko, revue.html ${Math.round(fs.statSync(path.join(OUT, 'revue.html')).size / 1024)} Ko → ${path.join(OUT, 'revue.html')}`);
const main = fiches.filter((f) => !f.faux && !f.family.info);
console.log(`${main.length} fiches (${main.filter((f) => f.platforms.length > 1).length} sur plusieurs plateformes), ${fiches.filter((f) => f.family.info).length} pour information, ${fiches.filter((f) => f.faux).length} écartées ; ${allItems.length} défauts au registre`);
