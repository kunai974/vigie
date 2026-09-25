// Audit automatique de l'affichage d'une app (WebView Android) sur émulateurs, TV et téléphone.
// Personnalisation de l'app : <outil>/<nom>/ (--app <nom>, sinon celle présente ; core/app.mjs).
// Usage : node audit passage [--profile rapide|complet] [--device tv|phone] [--only id1,id2] [--sizes s1,s2]
//                       [--cible] [--no-axe] [--no-review] [--list] [--reprendre <dossier>]
// Enchaîne le passage puis sa revue (registre mis à jour). Mode d'emploi : audit/README.md ;
// conception : audit/CONCEPTION.md.
import { mkdirSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { measurePage, focusState } from './core/measure.js';
import { listDevices, attach, makeDriver, adb, maskKeyboardStrip, preflight, launchApp } from './core/android.mjs';
import { ensureEmulators, restartEmulator, stopEmulatorAndWait, applySize, alive } from './core/emulators.mjs';
import { codeId } from './core/build-id.mjs';
import { mesureId } from './core/mesure.mjs';
import { launchDesktop, attachDesktop, makeDesktopDriver, killDesktop } from './core/desktop.mjs';
import { ensureWebServer, stopWebServer, openWeb, makeWebDriver } from './core/web.mjs';
import { writeReport } from './core/report.mjs';
import { sensitiveRects, maskRects } from './core/masque.mjs';
import { loadApp, outRoot, cmd } from './core/app.mjs';

const TOOL = path.dirname(fileURLToPath(import.meta.url)); // dossier de l'outil, quel que soit son nom
const ROOT = path.resolve(TOOL, '..'); // projet audité
const { files: APP, config: app } = await loadApp(ROOT);
const { PACKAGE = null, SCREENS, SIZE_RULES = {}, PROFILES, SIZES, EMULATORS = {}, APP_CODE = null } = app;
// Écran de choix du profil (facultatif) : passé en entrant dans le premier profil.
const passProfileScreen = app.passProfileScreen || (async () => false);
const enterFirstProfile = app.enterFirstProfile || (async () => {});
// Appareils de l'app : émulateurs Android, app de bureau (DESKTOP), navigateurs (WEB).
const allKinds = () => [...Object.keys(EMULATORS), ...(app.DESKTOP ? ['desktop'] : []), ...(app.WEB ? ['web'] : [])];
const TITLE = { tv: 'Android TV', phone: 'Téléphone', desktop: 'Bureau', web: 'Web' };
// Pont d'audit de l'app (objet global de sa version d'audit) : forçages d'état et empreinte du code.
const BRIDGE = app.BRIDGE || null;
// Éléments sensibles à noircir dans chaque capture (core/masque.mjs) : sélecteurs déclarés par l'app.
const MASK = app.MASK || [];
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : null; };
let onlyDevice = opt('--device');
let only = typeof opt('--only') === 'string' ? opt('--only').split(',') : null;
const useAxe = !args.includes('--no-axe');
const withReview = !args.includes('--no-review');

// --list : ce qu'on peut cibler (écrans, profils, tailles), sans rien lancer.
if (args.includes('--list')) {
  console.log('Écrans (--only) :');
  for (const sc of SCREENS) console.log(`  ${sc.id.padEnd(22)} ${sc.label}${sc.platforms ? ` (${sc.platforms.join(', ')} seulement)` : ''}`);
  console.log('\nProfils (--profile) :');
  const KIND = { tv: 'TV', phone: 'téléphone', desktop: 'bureau', web: 'web' };
  for (const [name, pr] of Object.entries(PROFILES)) console.log(`  ${name.padEnd(16)} ${Object.entries(pr).map(([k, l]) => `${KIND[k] || k} : ${l.map((x) => x || 'taille d\'origine').join(', ')}`).join(' ; ')}`);
  console.log('\nTailles (--sizes) :');
  for (const [name, s] of Object.entries(SIZES)) console.log(`  ${name.padEnd(14)} ${KIND[s.kind] || s.kind} · ${s.label}`);
  if (Object.keys(EMULATORS).length) console.log(`\nÉmulateurs (démarrés d'office s'ils ne tournent pas) : ${Object.entries(EMULATORS).map(([k, n]) => `${k} = ${n}`).join(', ')}`);
  if (app.WEB) console.log(`\nWeb : ${app.WEB.url}${app.WEB.start ? ` (serveur démarré au besoin : ${app.WEB.start.flat().join(' ')})` : ''}`);
  process.exit(0);
}
// Profil de passage (screens.mjs de l'app) : tailles d'écran par appareil, préréglages de
// tailles déclarées par l'app (null = taille actuelle). --sizes remplace les tailles du profil.
const profileName = typeof opt('--profile') === 'string' ? opt('--profile') : 'rapide';
if (!PROFILES[profileName]) throw new Error(`Profil inconnu : ${profileName} (${Object.keys(PROFILES).join(', ')})`);
let customSizes = typeof opt('--sizes') === 'string' ? opt('--sizes').split(',') : null;
// Tailles par appareil venues du registre (--cible) ; null dans la liste = taille d'origine.
let targetSizes = null;
// --cible [registre.json] : seulement les écrans et tailles où ont été vus les défauts « Inclure » du
// registre (passage avant / après d'une correction). Lieu enregistré « clé|écran », clé = appareil-taille.
// --cible-ids a,b : seulement les écrans et tailles de ces défauts (un lot de corrections, audit/lots.mjs).
const cibleIds = typeof opt('--cible-ids') === 'string' ? opt('--cible-ids').split(',') : null;
if (opt('--cible') || cibleIds) {
  const regFile = typeof opt('--cible') === 'string' ? opt('--cible') : createRequire(import.meta.url)(APP.review).REGISTRY;
  if (!existsSync(regFile)) throw new Error(`Registre introuvable : ${regFile}`);
  const reg = JSON.parse(readFileSync(regFile, 'utf8'));
  // Seulement les défauts encore à corriger : un défaut déjà « corrigé » au dernier passage n'est plus visé.
  const wanted = cibleIds && new Set(cibleIds.map((i) => reg.renamed?.[i] || i));
  let places = Object.values(reg.items).filter((it) => (wanted ? wanted.has(it.id) : it.decision?.status === 'inclure' && it.lastStatus !== 'corrige')).flatMap((it) => it.history.flatMap((h) => h.where));
  // --dans <passage> : seulement les lieux (taille | écran) que ce passage a regardés. La vérification
  // d'un lot se compare au passage de départ : viser d'autres tailles (vues un jour, dans l'historique)
  // allongeait le passage sans rien prouver (épreuve du 23/09, point 14 du journal).
  if (typeof opt('--dans') === 'string') {
    const pass = reg.passes.find((p) => p.id === path.basename(opt('--dans')));
    if (!pass) throw new Error(`--dans : passage inconnu du registre (${opt('--dans')})`);
    const inPass = new Set(pass.audited);
    places = places.filter((l) => inPass.has(l));
  }
  if (!places.length) { console.error(wanted ? 'Rien à cibler : ces défauts ne sont situés nulle part dans le registre.' : 'Rien à cibler : aucun défaut « Inclure » encore à corriger et déjà situé dans le registre.'); process.exit(1); }
  // Lieu « appareil-taille|écran » ; clé sans taille = taille d'origine de l'émulateur (ex. TV 1080p).
  // Tailles gardées par appareil (22/09 : une seule taille d'origine faisait retomber sur le profil rapide).
  const byKind = {};
  for (const l of places) {
    const key = l.split('|')[0];
    const kind = key.split('-')[0];
    (byKind[kind] || (byKind[kind] = new Set())).add(key.slice(kind.length + 1) || null);
  }
  const order = [...PROFILES.complet?.tv || [], ...PROFILES.complet?.phone || [], ...Object.keys(SIZES)];
  targetSizes = Object.fromEntries(Object.entries(byKind).map(([k, set]) => [k, [...set].sort((a, b) => order.indexOf(a) - order.indexOf(b))]));
  if (Object.keys(targetSizes).length === 1) onlyDevice = Object.keys(targetSizes)[0];
  only = [...new Set(places.map((l) => l.split('|')[1]))];
  console.log(`Cible (registre) : écrans ${only.join(', ')} ; tailles ${Object.entries(targetSizes).map(([k, l]) => `${k} ${l.map((x) => x || 'origine').join(', ')}`).join(' ; ')}`);
}
for (const s of [...(customSizes || []), ...Object.values(targetSizes || {}).flat().filter(Boolean)]) if (!SIZES[s]) throw new Error(`Taille inconnue : ${s} (${cmd('liste')})`);
const sizesFor = (kind) => (targetSizes ? targetSizes[kind] || [] : customSizes ? customSizes.filter((s) => SIZES[s].kind === kind) : PROFILES[profileName][kind] || []);
// --plan : ce que le passage ferait (appareils, tailles, écrans), en JSON, sans rien lancer. Sert aux
// enchaînements (lots, avant / après) pour savoir quelles plateformes recompiler.
if (args.includes('--plan')) {
  const planKinds = allKinds().filter((k) => (!onlyDevice || k === onlyDevice) && sizesFor(k).length);
  console.log(JSON.stringify({ kinds: planKinds, sizes: Object.fromEntries(planKinds.map((k) => [k, sizesFor(k)])), screens: only }));
  process.exit(0);
}
// Garde-fous (22/09 : la TV s'est bloquée une heure sans que rien ne le signale). Un écran bloqué
// fait relancer l'app ; une taille bloquée fait redémarrer l'émulateur, puis elle est refaite une fois.
const SIZE_TIMEOUT_MIN = Number(opt('--delai-taille')) || 30;
const keepEmulators = args.includes('--garder-emulateurs');
const acceptApk = args.includes('--accepter-apk');

// Un dossier par passage, daté à la minute ; deux passages dans la même minute ne se mélangent pas.
// --reprendre <dossier> : complète un passage interrompu, seulement les tailles qui y manquent.
const resumeDir = typeof opt('--reprendre') === 'string' ? path.resolve(opt('--reprendre')) : null;
if (resumeDir && !existsSync(path.join(resumeDir, 'report.json'))) throw new Error(`Passage à reprendre introuvable : ${resumeDir}`);
// Heure locale (l'heure UTC décalait les dossiers d'un jour la nuit).
const now = new Date();
let stamp = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace(/[:T]/g, '-');
for (let n = 2; existsSync(path.join(outRoot(ROOT), stamp)); n++) stamp = stamp.replace(/-v\d+$/, '') + `-v${n}`;
const OUT = resumeDir || path.join(outRoot(ROOT), stamp);
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const SCREEN_TIMEOUT_MIN = Number(opt('--delai-ecran')) || 6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Promesse limitée dans le temps ; `onTimeout` arrête ce qui tourne encore. L'erreur porte `timeout`. */
function withTimeout(promise, ms, what, onTimeout) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { onTimeout?.(); } catch { /* rien à arrêter */ }
      const e = new Error(`${what} : délai dépassé (${Math.round(ms / 60000)} min)`);
      e.timeout = true;
      reject(e);
    }, ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}
// Largeur et hauteur d'une image PNG (en-tête IHDR).
const pngSize = (file) => { const b = readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };


/** Capture et mesure de l'écran tel qu'il est affiché. */
// `scrolled` : capture prise après un défilement fait par l'outil, qui laisse le focus en haut de la
// page : le focus n'y est pas contrôlé (il le serait à tort comme sorti de l'écran).
async function capture(d, run, id, label, { expectFocus = false, keyboardRule = true, atScrollEnd = false, group = null, scrolled = false } = {}) {
  const res = { id, label, group: group || id, shot: `${run.key}-${id}.png` };
  // Une fenêtre du système a pu surgir (ex. Google TV qui refuse une résolution) : l'app est ramenée
  // au premier plan, et c'est noté ; si elle n'y revient pas, l'écran échoue au lieu d'être faux.
  const top = await d.foreground();
  if (top && top !== PACKAGE) {
    launchApp(d.serial, PACKAGE);
    await d.wait(2500);
    const again = await d.foreground();
    if (again && again !== PACKAGE) throw new Error(`l'app n'est plus au premier plan (écran du système : ${again})`);
    res.recovered = top;
  }
  const file = path.join(OUT, res.shot);
  await d.screenshot(file);
  res.image = pngSize(file);
  res.frame = await d.frame(); // WebView dans la capture : sert à placer les cadres des constats
  // Zones sensibles déclarées par l'app (MASK) : noircies aussitôt, la capture n'est jamais gardée en clair.
  if (MASK.length) {
    const zones = await d.page.evaluate(sensitiveRects, MASK);
    const n = maskRects(file, zones, res.frame);
    if (n) res.masked = n;
  }
  if (await d.keyboardShown()) {
    // Le clavier commence sous la WebView (réduite à la hauteur restante). Sans position connue,
    // on masque toute la moitié basse : jamais de presse-papiers dans une capture.
    const cssWidth = await d.page.evaluate(() => innerWidth);
    const density = res.frame ? res.frame.w / cssWidth : 3;
    if (res.frame) maskKeyboardStrip(file, res.frame.y + res.frame.h, density);
    else maskKeyboardStrip(file, res.image.h / 2, res.image.h / 2 / 64);
    res.keyboardMasked = true;
  }
  const m = await d.page.evaluate(measurePage, {
    touchMin: d.kind === 'phone' || d.touch ? 44 : 0,
    checkFocus: d.kind === 'tv' && !scrolled,
    expectFocus: d.kind === 'tv' && expectFocus && !scrolled,
    sizeRules: SIZE_RULES[d.kind] || [],
    popups: app.POPUPS || [],
    atScrollEnd,
  });
  res.metrics = m.metrics;
  res.issues = m.issues;
  // Règle TV : arriver sur un champ n'ouvre pas le clavier, seul OK l'ouvre (le clavier réduirait la fenêtre).
  if (keyboardRule && (await d.keyboardShown())) {
    res.issues.unshift(d.kind === 'tv'
      ? { rule: 'keyboard-auto', severity: 'error', message: 'Le clavier système s\'est ouvert tout seul (il ne doit s\'ouvrir qu\'avec OK) ; il réduit la fenêtre de l\'app', selector: 'clavier système', rect: null }
      : { rule: 'keyboard-auto', severity: 'info', message: 'Le clavier système est ouvert à l\'arrivée sur l\'écran', selector: 'clavier système', rect: null });
  }
  if (useAxe) {
    try { res.issues.push(...(await d.axe())); } catch (e) { res.issues.push({ rule: 'axe', severity: 'info', message: 'axe-core indisponible : ' + e.message.split('\n')[0], selector: '', rect: null }); }
  }
  return res;
}

/**
 * Défile le contenu et capture chaque pas : 'once' = un pas, 'full' = jusqu'en bas (6 pas au plus).
 * Le dernier pas d'un défilement complet contrôle aussi le bas de page. Revient en haut à la fin.
 */
async function scrollSteps(d, run, screen, base, mode, out) {
  if (!mode) return;
  // Positions déjà capturées : un pas qui retombe au même endroit (TV : fin de page atteinte dès
  // les carrousels) ne refait pas la même capture.
  const seen = new Set();
  // Accueil : une capture calée juste après la bannière, qui ne montre que les carrousels.
  if (screen.past) {
    const s = await d.scroll(`past:${screen.past}`, screen.scroller);
    if (s.moved) {
      seen.add(Math.round(s.pos));
      await d.wait(500);
      await d.settle(5000);
      out.push(await capture(d, run, `${base.id}-carrousels`, `${base.label} · carrousels`, { keyboardRule: false, group: screen.id, scrolled: true }));
      await d.scroll('top', screen.scroller);
      await d.wait(400);
    }
  }
  const max = mode === 'full' ? 6 : 1;
  for (let n = 1; n <= max; n++) {
    const s = await d.scroll('next', screen.scroller);
    // Rien à faire défiler : la page tient en un écran (noté, pour ne pas le prendre pour un oubli).
    if (!s.moved) { if (n === 1) base.fitsScreen = true; break; }
    await d.wait(500);
    await d.settle(5000);
    const end = s.pos >= s.max - 2;
    if (seen.has(Math.round(s.pos))) { if (end) break; continue; }
    const label = `${base.label} · ${end && mode === 'full' ? 'bas de page' : `défilement ${n}`}`;
    out.push(await capture(d, run, `${base.id}-defil${n}`, label, { keyboardRule: false, atScrollEnd: end && mode === 'full', group: screen.id, scrolled: true }));
    if (end) break;
  }
  await d.scroll('top', screen.scroller);
  await d.wait(400);
}

/** Un écran et tous ses états : haut, défilement, clavier, saisie, variantes. Retourne une liste d'entrées. */
async function measureScreen(d, screen, run) {
  const t0 = Date.now();
  const reason = await screen.go(d);
  if (reason) return [{ id: screen.id, label: screen.label, group: screen.id, skipped: reason }];
  const res = await capture(d, run, screen.id, screen.label, { expectFocus: !!screen.expectFocus });
  res.settleMs = Date.now() - t0;
  // Éléments attendus par le parcours (propre à l'app) : absents ou invisibles = défaut.
  for (const x of screen.expect?.[d.kind] || []) {
    const shown = await d.page.evaluate((sel) => [...document.querySelectorAll(sel)].some((el) => {
      const r = el.getBoundingClientRect(), st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && r.right > 0 && r.left < innerWidth;
    }), x.selector);
    if (!shown) res.issues.unshift({ rule: 'expected-missing', severity: 'error', message: `${x.label} absente de l'écran`, selector: x.selector, rect: null });
  }
  if (d.kind === 'tv' && screen.walk) await walkFocus(d, screen, run, res);
  const out = [res];

  // Une page de résultats (saisie) se fait défiler après la saisie, pas avant.
  if (!screen.type) await scrollSteps(d, run, screen, res, screen.scroll, out);

  if (screen.keyboard) {
    const kLabel = `${screen.label} · clavier ouvert`;
    // Déjà ouvert (défaut « clavier ouvert tout seul ») : ne pas appuyer sur OK, qui taperait une lettre.
    d.memo.keyboardVia = (await d.keyboardShown()) ? 'déjà ouvert' : null;
    const opened = d.memo.keyboardVia || (await d.openKeyboard(screen.keyboard));
    if (!opened) out.push({ id: `${screen.id}-clavier`, label: kLabel, group: screen.id, skipped: 'le clavier système ne s\'est pas ouvert' });
    else {
      const kRes = await capture(d, run, `${screen.id}-clavier`, kLabel, { keyboardRule: false, group: screen.id });
      kRes.keyboardVia = d.memo.keyboardVia;
      out.push(kRes);
      if (screen.type) {
        await d.typeText(screen.type);
        await d.settle(6000);
        out.push(await capture(d, run, `${screen.id}-saisie-clavier`, `${screen.label} · « ${screen.type} » · clavier ouvert`, { keyboardRule: false, group: screen.id }));
      }
      await d.blur();
      if (screen.type) {
        const r = await capture(d, run, `${screen.id}-saisie`, `${screen.label} · « ${screen.type} » · résultats`, { keyboardRule: false, group: screen.id });
        out.push(r);
        await scrollSteps(d, run, screen, r, screen.scroll, out);
      }
    }
  }

  for (const v of screen.variants || []) {
    const id = `${screen.id}-${v.id}`;
    const label = `${screen.label} · ${v.label}`;
    const applied = await v.apply(d);
    if (!applied || typeof applied === 'string') {
      out.push({ id, label, group: screen.id, skipped: typeof applied === 'string' ? applied : (await d.hasBridge()) ? 'état non atteignable ici' : 'pont d\'audit absent de cette version de l\'app (BRIDGE)' });
      continue;
    }
    await d.wait(600);
    await d.settle(5000);
    out.push(await capture(d, run, id, label, { keyboardRule: false, group: screen.id, scrolled: !!v.noFocus }));
    await v.undo(d);
    await d.wait(500);
  }

  if (screen.type) await d.clearField(screen.keyboard);
  if (screen.after) await screen.after(d);
  return out;
}

// Marche à la télécommande : chaque flèche doit laisser un focus visible, à l'écran, et respecter
// les règles de parcours (Haut / Bas ne passent jamais dans la barre latérale).
async function walkFocus(d, screen, run, res) {
  res.walk = [];
  res.walkShots = [];
  let before = await d.page.evaluate(focusState);
  res.walk.push({ key: 'arrivée', to: before?.selector ?? '(aucun)', zone: before?.zone ?? '', note: before ? (before.indicator ? '' : 'sans liseré') : 'aucun élément sélectionné', severity: before && !before.indicator ? 'error' : '' });
  for (const [n, key] of screen.walk.entries()) {
    await d.key(key, 550);
    let after = await d.page.evaluate(focusState);
    // Défilement animé encore en cours : la sélection paraît hors de l'écran alors que la liste la ramène
    // (faux positif du 23/09). On attend la fin du défilement (1,5 s au plus) avant de conclure.
    for (let i = 0; i < 6 && after && !after.inViewport; i++) {
      await d.wait(250);
      after = await d.page.evaluate(focusState);
    }
    let note = '', severity = '';
    if (!after) { note = 'focus perdu'; severity = 'error'; }
    else if (!after.inViewport) { note = 'le focus sort de l\'écran'; severity = 'error'; }
    else if (!after.indicator) { note = 'sans liseré visible'; severity = 'error'; }
    else if ((key === 'up' || key === 'down') && before && before.zone !== 'sidebar' && after.zone === 'sidebar') { note = 'Haut/Bas entre dans la barre latérale (règle TV)'; severity = 'error'; }
    else if (before && after.selector === before.selector && after.rect.x === before.rect.x && after.rect.y === before.rect.y) note = 'pas de déplacement (bord)';
    res.walk.push({ key, to: after?.selector ?? '(aucun)', zone: after?.zone ?? '', note, severity });
    if (severity && res.walkShots.length < 3) {
      const f = `${run.key}-${screen.id}-walk${n + 1}.png`;
      await d.screenshot(path.join(OUT, f));
      res.walkShots.push(f);
    }
    before = after;
  }
  res.walkIssues = res.walk.filter((w) => w.severity).length;
}

/** Branchement sur l'app, pilote, et vérification que l'APK est bien compilé depuis le code en cours. */
async function connect(entry, ctl) {
  let page;
  if (entry.kind === 'desktop') {
    await entry.browser?.close().catch(() => {});
    ({ browser: entry.browser, page } = await attachDesktop(entry.port));
  } else if (entry.kind === 'web') page = entry.page;
  else page = await attach(entry.device, PACKAGE);
  const opts = { bridge: BRIDGE, scope: app.SCROLL_SCOPE || null, loading: app.LOADING || [] };
  const d = entry.kind === 'desktop' ? makeDesktopDriver(entry, page, opts)
    : entry.kind === 'web' ? makeWebDriver(entry, page, { ...opts, touch: !!(entry.size?.touch ?? entry.size?.mobile) })
      : makeDriver(entry, page, opts);
  ctl.d = d;
  // Web : pas de version d'audit compilée à vérifier (sauf si l'app expose son empreinte par le pont).
  if (CODE_ID && !acceptApk && (entry.kind !== 'web' || (await d.build()))) {
    const build = await d.build();
    if (build !== CODE_ID) {
      const e = new Error(`APK d'audit compilé depuis un autre code (APK : ${build || 'sans empreinte'}, code en cours : ${CODE_ID}). ` +
        `Le recompiler et l'installer (${cmd('banc')}), ou --accepter-apk pour auditer quand même.`);
      e.fatal = true;
      throw e;
    }
  }
  return d;
}

/**
 * Relance de l'app après un écran bloqué : arrêt forcé, lancement, nouveau branchement, entrée dans le
 * profil. Échoue (la taille est alors refaite après redémarrage de l'émulateur) si l'app ne revient pas.
 */
async function reopen(entry, ctl) {
  ctl.d?.stop();
  if (entry.kind === 'desktop') await openDesktop(entry, entry.window);
  else if (entry.kind === 'web') await openWebSize(entry, entry.size);
  else {
    adb(entry.serial, { timeout: 20000 }, 'shell', 'am', 'force-stop', PACKAGE);
    launchApp(entry.serial, PACKAGE);
    await sleep(4000);
  }
  const d = await connect(entry, ctl);
  if (await passProfileScreen(d)) await enterFirstProfile(d);
  return d;
}

async function auditDevice(entry, sizeLabel, ctl) {
  const key = `${entry.kind}${sizeLabel ? '-' + sizeLabel : ''}`;
  const run = { key, title: `${TITLE[entry.kind]} · ${entry.model}${sizeLabel ? ' · ' + sizeLabel : ''}`, screens: [] };
  const L = (...a) => log(`[${key}]`, ...a); // appareils en parallèle : chaque ligne dit qui parle
  // Démarrage (branchement, profil) : 3 minutes au plus.
  let d = await withTimeout((async () => {
    const drv = await connect(entry, ctl);
    L(run.title);
    // Session fermée : écrans d'avant la connexion seulement (jamais de saisie dans les champs)
    // Session fermée ? L'app dit à quoi elle se reconnaît (SIGNED_OUT.detect), et à quoi se reconnaît une
    // session ouverte (SIGNED_OUT.signedIn : on n'attend pas plus longtemps).
    const signedIn = app.SIGNED_OUT?.signedIn;
    for (let i = 0; i < 20 && app.SIGNED_OUT && !(signedIn && (await drv.exists(signedIn))); i++) {
      if (await app.SIGNED_OUT.detect(drv)) { run.signedOut = true; break; }
      await drv.wait(500);
    }
    if (run.signedOut) { L("session fermée : écrans d'avant la connexion"); return drv; }
    if (await passProfileScreen(drv)) {
      await drv.settle();
      const res = await capture(drv, run, 'profiles', 'Choix du profil', { expectFocus: true });
      res.settleMs = 0;
      run.screens.push(res);
      L('profils', res.issues.length, 'constats');
      await enterFirstProfile(drv);
    }
    // TV : juste après le lancement, Android garde la première touche pour donner la main à la WebView
    // (elle n'arrive pas à la page et pose la sélection où il veut). Touche d'échauffement, pour que la
    // marche à la télécommande du premier écran ne commence pas par elle (23/09).
    if (entry.kind === 'tv') await drv.key('down', 600);
    return drv;
  })(), 3 * 60000, 'démarrage de l\'app', () => ctl.d?.stop());

  for (const screen of run.signedOut ? app.SIGNED_OUT.screens : SCREENS) {
    if (screen.platforms && !screen.platforms.includes(entry.kind)) continue;
    if (only && !run.signedOut && !only.includes(screen.id)) continue;
    if (ctl.stopped) break; // taille abandonnée (délai dépassé) : ne plus rien écrire
    try {
      // Durée maximale d'un écran et de ses états : un blocage ne fige plus tout le passage.
      const results = await withTimeout(measureScreen(d, screen, run), SCREEN_TIMEOUT_MIN * 60000, 'écran', () => d.stop());
      for (const res of results) {
        run.screens.push(res);
        L(`${res.id.padEnd(30)} ${res.skipped ? 'ignoré : ' + res.skipped : `${res.issues.length} constats${res.walkIssues ? `, ${res.walkIssues} à la télécommande` : ''}`}${res.recovered ? ` (app ramenée au premier plan, écran du système : ${res.recovered})` : ''}`);
      }
    } catch (e) {
      if (e.fatal || ctl.stopped) throw e;
      run.screens.push({ id: screen.id, label: screen.label, failed: e.message.split('\n')[0] });
      L(`${screen.id.padEnd(30)} ÉCHEC ${e.message.split('\n')[0]}`);
      // Écran bloqué, ou app qui ne répond plus : relancée, et le parcours continue à l'écran suivant.
      const responsive = !e.timeout && (await withTimeout(d.page.evaluate(() => true), 10000, 'app').catch(() => false));
      if (!responsive) {
        L('app bloquée : relance');
        d = await withTimeout(reopen(entry, ctl), 3 * 60000, 'relance de l\'app', () => ctl.d?.stop());
        run.restarts = (run.restarts || 0) + 1;
      }
    }
  }
  return run;
}

/** App de bureau : (re)lancée avec la fenêtre voulue ; l'instance précédente est arrêtée. */
async function openDesktop(entry, window) {
  await entry.browser?.close().catch(() => {});
  entry.browser = null;
  killDesktop(entry.proc);
  await sleep(1500);
  entry.window = window;
  ({ proc: entry.proc } = await launchDesktop(app.DESKTOP, window, entry.port));
  await sleep(3000); // la page se charge
}

/** Émulateur redémarré à froid (bloqué, ou horloge décalée) ; retourne l'appareil rebranché. */
async function recover(entry, why) {
  if (entry.kind === 'desktop') {
    log(`[desktop] ${why} : relance de l'app`);
    await openDesktop(entry, entry.window);
    return entry;
  }
  log(`[${entry.kind}] ${why} : redémarrage de l'émulateur ${entry.avd}`);
  await entry.device.close().catch(() => {});
  const serial = await restartEmulator(entry.serial, entry.avd, { log });
  const [fresh] = await listDevices([serial]);
  if (!fresh) throw new Error(`${entry.avd} redémarré mais introuvable`);
  devices[devices.indexOf(entry)] = fresh;
  return fresh;
}

/** Toutes les tailles d'un appareil, l'une après l'autre (les appareils, eux, tournent en parallèle). */
async function auditAllSizes(entry) {
  const fail = (key, id, label, why) => data.runs.push({ key, title: `${entry.kind} ${entry.serial}`, screens: [{ id, label, failed: why }] });
  if (entry.kind === 'desktop') return auditDesktopSizes(entry, fail);
  if (entry.kind === 'web') return auditWebSizes(entry, fail);
  let check = preflight(entry, PACKAGE);
  if (check.needsRestart) {
    entry = await recover(entry, check.problems.join(' '));
    check = preflight(entry, PACKAGE);
  }
  log(`[${entry.kind}] ${entry.serial} (${entry.avd}) : ${check.ok.join(', ')}`);
  if (check.problems.length) {
    for (const p of check.problems) log(`[${entry.kind}] ✖ ${p}`);
    fail(entry.kind, 'preflight', 'Vérifications de départ', check.problems.join(' '));
    return;
  }
  data.appVersion = data.appVersion || adb(entry.serial, 'shell', 'dumpsys', 'package', PACKAGE).match(/versionName=(\S+)/)?.[1];
  const sizes = sizesFor(entry.kind);
  for (const size of sizes) {
    const key = `${entry.kind}${size ? '-' + size : ''}`;
    if (data.runs.some((r) => r.key === key && !r.screens.some((s) => s.id === 'start' || s.id === 'preflight'))) { log(`[${key}] déjà fait, sauté (reprise)`); continue; }
    // Taille échouée : refaite. Retrait sur place : les appareils tournent en parallèle, et remplacer
    // la liste ferait ranger les résultats de l'autre appareil dans l'ancienne, perdue (vu le 22/09).
    for (let i = data.runs.length - 1; i >= 0; i--) if (data.runs[i].key === key) data.runs.splice(i, 1);
    // Deux essais : si le premier bloque ou échoue au démarrage, l'émulateur est redémarré à froid.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const ctl = { d: null, stopped: false };
      const t = Date.now();
      try {
        if (!alive(entry.serial)) entry = await recover(entry, 'l\'émulateur ne répond plus');
        applySize(entry.serial, size ? SIZES[size] : null, PACKAGE);
        await sleep(4000);
        const result = await withTimeout(auditDevice(entry, size, ctl), SIZE_TIMEOUT_MIN * 60000, `taille ${key}`, () => { ctl.stopped = true; ctl.d?.stop(); });
        result.durationMin = Math.round((Date.now() - t) / 60000);
        if (attempt > 1) result.retried = true;
        data.runs.push(result); // la liste est lue après l'attente, pas avant
        writeReport(OUT, data); // rapport partiel à jour après chaque taille : rien n'est perdu si on arrête
        break;
      } catch (e) {
        const why = e.message.split('\n')[0];
        log(`[${key}] ÉCHEC${e.fatal ? ', sans nouvel essai' : ` (essai ${attempt}/2)`}`, why);
        if (e.fatal) { fail(key, 'start', 'Démarrage', why); return; } // rien à gagner à réessayer
        if (attempt === 2) { fail(key, 'start', 'Démarrage', why); break; }
        try { entry = await recover(entry, why); } catch (e2) { fail(key, 'start', 'Démarrage', `${why} ; ${e2.message}`); return; }
      }
    }
  }
  if (sizes.some(Boolean)) applySize(entry.serial, null, null); // retour à la taille d'origine
}

/** Web : chaque taille = un navigateur neuf (moteur, fenêtre, densité, tactile), ouvert sur l'app. */
async function openWebSize(entry, size) {
  await entry.browser?.close().catch(() => {});
  entry.size = size;
  ({ browser: entry.browser, page: entry.page } = await openWeb(app.WEB, size));
}

async function auditWebSizes(entry, fail) {
  for (const size of sizesFor('web')) {
    const key = `web-${size}`;
    if (data.runs.some((r) => r.key === key && !r.screens.some((s) => s.id === 'start' || s.id === 'preflight'))) { log(`[${key}] déjà fait, sauté (reprise)`); continue; }
    for (let i = data.runs.length - 1; i >= 0; i--) if (data.runs[i].key === key) data.runs.splice(i, 1);
    for (let attempt = 1; attempt <= 2; attempt++) {
      const ctl = { d: null, stopped: false };
      const t = Date.now();
      try {
        await openWebSize(entry, SIZES[size]);
        entry.model = `${SIZES[size].browser || 'chromium'}`;
        const result = await withTimeout(auditDevice(entry, size, ctl), SIZE_TIMEOUT_MIN * 60000, `taille ${key}`, () => { ctl.stopped = true; ctl.d?.stop(); });
        result.durationMin = Math.round((Date.now() - t) / 60000);
        if (attempt > 1) result.retried = true;
        data.runs.push(result);
        writeReport(OUT, data);
        break;
      } catch (e) {
        const why = e.message.split(/\r?\n/)[0];
        log(`[${key}] ÉCHEC${e.fatal ? ', sans nouvel essai' : ` (essai ${attempt}/2)`}`, why);
        if (e.fatal || attempt === 2) { fail(key, 'start', 'Démarrage', why); if (e.fatal) break; }
      }
    }
  }
  await entry.browser?.close().catch(() => {});
}

/** App de bureau : chaque taille = un lancement de l'app avec cette fenêtre (et cette échelle). */
async function auditDesktopSizes(entry, fail) {
  for (const size of sizesFor('desktop')) {
    const key = `desktop-${size}`;
    if (data.runs.some((r) => r.key === key && !r.screens.some((s) => s.id === 'start' || s.id === 'preflight'))) { log(`[${key}] déjà fait, sauté (reprise)`); continue; }
    for (let i = data.runs.length - 1; i >= 0; i--) if (data.runs[i].key === key) data.runs.splice(i, 1);
    for (let attempt = 1; attempt <= 2; attempt++) {
      const ctl = { d: null, stopped: false };
      const t = Date.now();
      try {
        await openDesktop(entry, SIZES[size]);
        const result = await withTimeout(auditDevice(entry, size, ctl), SIZE_TIMEOUT_MIN * 60000, `taille ${key}`, () => { ctl.stopped = true; ctl.d?.stop(); });
        result.durationMin = Math.round((Date.now() - t) / 60000);
        if (attempt > 1) result.retried = true;
        data.runs.push(result);
        writeReport(OUT, data);
        break;
      } catch (e) {
        const why = e.message.split('\n')[0];
        log(`[${key}] ÉCHEC${e.fatal ? ', sans nouvel essai' : ` (essai ${attempt}/2)`}`, why);
        if (e.fatal || attempt === 2) { fail(key, 'start', 'Démarrage', why); if (e.fatal) break; }
      }
    }
  }
  await entry.browser?.close().catch(() => {});
  killDesktop(entry.proc);
}

const data = resumeDir ? JSON.parse(readFileSync(path.join(resumeDir, 'report.json'), 'utf8')) : { date: new Date().toLocaleString('fr-FR'), at: new Date().toISOString(), app: app.APP_NAME || APP.name, appId: APP.name, profile: profileName, runs: [] };
if (resumeDir) log(`Reprise de ${resumeDir} : tailles déjà faites ${data.runs.map((r) => r.key).join(', ') || 'aucune'}`);
// Code en cours : l'APK d'audit doit en être compilé (sinon on auditerait un autre code).
const CODE_ID = !APP_CODE ? null : (() => { try { return codeId(ROOT, APP_CODE.paths, APP_CODE.exclude); } catch (e) { log(`Empreinte du code impossible (${e.message}) : APK non vérifié`); return null; } })();
data.code = CODE_ID;
// Version de la mesure (core/mesure.mjs) : un passage repris avec une autre mesure ne se mélange pas.
if (resumeDir && data.mesure && data.mesure !== mesureId()) throw new Error(`Passage à reprendre mesuré avec une autre version de l'outil (${data.mesure}, actuelle ${mesureId()}) : refaire un passage complet.`);
data.mesure = mesureId();
// Émulateurs : ceux du projet, démarrés d'office s'ils ne tournent pas ; les autres sont ignorés.
// L'app de bureau (DESKTOP) s'ajoute aux émulateurs quand le profil ou --sizes lui donnent des tailles.
const kinds = allKinds().filter((k) => (!onlyDevice || k === onlyDevice) && sizesFor(k).length);
if (!kinds.length) throw new Error('Rien à auditer : aucune taille pour les appareils demandés.');
const t0 = Date.now();
const androidKinds = kinds.filter((k) => EMULATORS[k]);
const { started, serials } = androidKinds.length ? await ensureEmulators(Object.fromEntries(androidKinds.map((k) => [k, EMULATORS[k]])), { log }) : { started: [], serials: {} };
const devices = androidKinds.length ? await listDevices(Object.values(serials)) : [];
if (androidKinds.length && !devices.length) throw new Error('Émulateurs démarrés mais introuvables par Playwright (adb devices).');
// Web : le serveur de l'app est démarré s'il ne répond pas (WEB.start), arrêté à la fin.
const webServer = kinds.includes('web') ? await ensureWebServer(app.WEB, { log, cwd: ROOT }) : null;
if (kinds.includes('web')) devices.push({ kind: 'web', serial: 'web', model: 'navigateur', device: null, browser: null, page: null, size: null });
if (kinds.includes('desktop')) devices.push({ kind: 'desktop', serial: 'desktop', model: app.DESKTOP.label || 'bureau', device: null, port: app.DESKTOP.port || 9333, proc: null, browser: null, window: null });
await Promise.all([...devices].map((entry) => auditAllSizes(entry)));
// Reprise : la durée s'ajoute à celle du passage interrompu.
data.durationMin = (resumeDir ? data.durationMin || 0 : 0) + Math.round((Date.now() - t0) / 60000);
// Ordre stable dans le rapport : TV puis téléphone, chaque appareil dans l'ordre de ses tailles.
stopWebServer(webServer);
const kindRank = (k) => ['tv', 'phone', 'desktop', 'web'].indexOf(k.split('-')[0]);
data.runs.sort((a, b) => kindRank(a.key) - kindRank(b.key));
writeReport(OUT, data);
// Garde-fou : chaque taille demandée doit être dans le rapport, avec des écrans mesurés. Sinon, le
// dire au lieu d'annoncer un passage complet (22/09 : 5 tailles sur 8 perdues sans un mot).
const expected = devices.flatMap((e) => sizesFor(e.kind).map((s) => `${e.kind}${s ? '-' + s : ''}`));
const missing = expected.filter((k) => !data.runs.some((r) => r.key === k && r.screens.some((sc) => sc.shot)));
if (missing.length) {
  log(`
✖ Passage INCOMPLET : ${missing.length} taille(s) sans mesures dans le rapport : ${missing.join(', ')}.
  Pour les refaire sans refaire le reste : node audit/run.mjs ${args.filter((a, i) => a !== '--reprendre' && args[i - 1] !== '--reprendre').join(' ')} --reprendre "${OUT}"`);
}
log(`
${missing.length ? 'Arrêté' : 'Terminé'} en ${data.durationMin} min. Rapport brut : ${path.join(OUT, 'index.html')}`);
for (const e of devices) await e.device?.close().catch(() => {});
// Émulateurs démarrés par l'outil : arrêtés (sauf --garder-emulateurs). Ceux de l'utilisateur restent.
if (!keepEmulators) {
  // Démarrés par ce passage, ou par la préparation du banc (node audit banc, banc.json) juste avant.
  const bancFile = path.join(outRoot(ROOT), 'banc.json');
  const banc = existsSync(bancFile) ? JSON.parse(readFileSync(bancFile, 'utf8')).started || [] : [];
  for (const e of devices) if (EMULATORS[e.kind] && (started.includes(e.serial) || banc.includes(e.serial) || !Object.values(serials).includes(e.serial))) await stopEmulatorAndWait(e.serial);
  if (existsSync(bancFile)) rmSync(bancFile);
}
// Dernier passage : lu par les enchaînements (avant / après).
writeFileSync(path.join(outRoot(ROOT), 'dernier-passage.txt'), OUT);
// Revue enchaînée d'office (registre mis à jour) ; --no-review pour ne garder que le rapport brut.
if (withReview) {
  log('Revue…');
  const r = spawnSync(process.execPath, [path.join(TOOL, 'review', 'build.cjs'), OUT, APP.review], { stdio: 'inherit' });
  if (r.status !== 0) log(`Revue impossible : relancer « ${cmd(`refaire-revue ${path.basename(OUT)}`)} ».`);
}
// Passage incomplet : code d'erreur, pour que les enchaînements (avant / après) s'arrêtent
process.exit(missing.length ? 2 : 0);
