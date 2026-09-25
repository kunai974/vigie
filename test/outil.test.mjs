// @vitest-environment node
// Tests de l'outil d'audit, sur des passages fabriqués (fabrique.mjs) et l'app d'exemple
// (fixture-app/) : registre, revue, décisions, faux positifs, avant / après, revue locale, lots.
// Garde-fou contre les régressions silencieuses de l'outil (23/09 : la page avant / après avait perdu
// ses images sans que rien ne le signale). Aucun émulateur, aucune capture réelle.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, cpSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fabrique } from './fabrique.mjs';
import { mesureId } from '../core/mesure.mjs';
import { codeId } from '../core/build-id.mjs';
import { androidStale } from '../core/rebuild.mjs';

const require = createRequire(import.meta.url);
const registry = require('../review/registry.cjs');
const summary = require('../review/summary.cjs');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.resolve(HERE, '..'); // dossier de l'outil, quel que soit son nom
const ROOT = path.resolve(TOOL, '..'); // projet qui le contient
const APP = path.join(HERE, 'fixture-app');
const CFG = path.join(APP, 'review.cjs');
const TMP = mkdtempSync(path.join(os.tmpdir(), 'audit-outil-'));
const OUT = path.join(TMP, 'out');
const REG = path.join(TMP, 'registre.json');
const env = { ...process.env, AUDIT_OUT: OUT, AUDIT_REGISTRE: REG, AUDIT_APP: APP };
const A = path.join(OUT, '2026-01-01-10-00');
const B = path.join(OUT, '2026-01-01-12-00');
const node = (script, args, opts = {}) => spawnSync(process.execPath, [path.join(TOOL, script), ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000, ...opts });
const json = (f) => JSON.parse(readFileSync(f, 'utf8'));
const build = (dir, ...more) => { const r = node('review/build.cjs', [dir, CFG, '--sans-planches', ...more]); expect(r.status, r.stderr).toBe(0); return json(path.join(dir, 'revue.json')); };
const ficheOf = (rev, name) => rev.fiches.find((f) => f.name === name);
/** Images que la page montre : toutes présentes dans ses planches, et chaque planche existe. */
function imagesOk(page, dir) {
  const html = readFileSync(page, 'utf8');
  const IMG = JSON.parse(html.match(/const IMG = (\{.*?\});\n/s)[1]);
  const DATA = JSON.parse(html.match(/const DATA = (\{.*?\});\n/s)[1]);
  return { IMG, DATA, sheetsExist: Object.values(IMG).every((m) => existsSync(path.join(dir, m.f))) };
}

let MESURE, CODE;
beforeAll(() => {
  MESURE = mesureId();
  CODE = codeId(ROOT, [path.relative(ROOT, APP).split(path.sep).join('/')]);
  fabrique(A, { at: '2026-01-01T09:00:00Z', extra: { mesure: MESURE, code: CODE } });
  fabrique(B, { apres: true, at: '2026-01-01T11:00:00Z', extra: { mesure: MESURE, code: CODE } });
});
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe('registre', () => {
  it('range les passages par date réelle, pas par nom, et ne réécrit pas le statut des défauts non regardés', () => {
    const reg = { passes: [], items: {}, renamed: {} };
    const item = (id, kind, where) => ({ id, kind, rule: 'r', el: 'e', name: id, gravity: 'mineur', where });
    registry.recordPass(reg, { id: '2026-01-01-08-00', at: '2026-01-01T08:00:00Z', audited: ['tv|a', 'phone|b'], items: [item('t1', 'tv', ['tv|a']), item('p1', 'phone', ['phone|b'])] });
    // « lot1-apres » : fait à 9 h, son nom le rangerait après le passage de 17 h
    registry.recordPass(reg, { id: '2026-01-01-lot1-apres', date: '01/01/2026 (lot : 09:00)', audited: ['tv|a'], items: [] });
    registry.recordPass(reg, { id: '2026-01-01-17-00', at: '2026-01-01T17:00:00Z', audited: ['desktop|c'], items: [item('d1', 'desktop', ['desktop|c'])] });
    expect(reg.passes.map((p) => p.id)).toEqual(['2026-01-01-08-00', '2026-01-01-lot1-apres', '2026-01-01-17-00']);
    expect(reg.items.t1.lastStatus).toBe('corrige'); // repassé à 9 h sans être retrouvé
    expect(reg.items.p1.lastStatus).toBe('nouveau'); // jamais repassé : son dernier vrai statut reste
    expect(reg.items.d1.lastStatus).toBe('nouveau');
  });

  it('ne déclare pas corrigé un défaut que personne n’a pu chercher (vu à l’œil, autre mesure)', () => {
    const reg = { passes: [], items: {}, renamed: {} };
    const item = (id, rule) => ({ id, kind: 'tv', rule, el: 'e', name: id, gravity: 'mineur', where: ['tv|a'] });
    registry.recordPass(reg, { id: 'p1', at: '2026-01-01T08:00:00Z', mesure: 'm1', audited: ['tv|a'], items: [item('mesure', 'text-tiny'), item('oeil', 'visual'), item('garde', 'overlap')] });
    registry.recordPass(reg, { id: 'p2', at: '2026-01-01T09:00:00Z', mesure: 'm1', audited: ['tv|a'], items: [item('garde', 'overlap')] });
    expect(reg.items.mesure.lastStatus).toBe('corrige'); // même mesure, lieu repassé : corrigé
    expect(reg.items.oeil.lastStatus).toBe('nouveau'); // vu à l'œil, passage non interprété : pas corrigé
    registry.recordPass(reg, { id: 'p3', at: '2026-01-01T10:00:00Z', mesure: 'm2', audited: ['tv|a'], items: [] });
    const status = registry.recordPass(reg, { id: 'p3', at: '2026-01-01T10:00:00Z', mesure: 'm2', audited: ['tv|a'], items: [] });
    expect(status.garde).toBe('non-verifie'); // absent, mais mesuré avec une autre version
    expect(reg.items.garde.lastStatus).toBe('toujours-la');
  });

  it('ne dit « réapparu » que pour un défaut constaté corrigé entre-temps', () => {
    const reg = { passes: [], items: {}, renamed: {} };
    const item = (id, rule) => ({ id, kind: 'tv', rule, el: 'e', name: id, gravity: 'mineur', where: ['tv|a'] });
    registry.recordPass(reg, { id: 'p1', at: '2026-01-01T08:00:00Z', mesure: 'm1', audited: ['tv|a'], items: [item('oeil', 'visual'), item('mesure', 'text-tiny')] });
    // Passage de vérification d'un lot : lieu regardé, constat non repris, autre version de la mesure
    registry.recordPass(reg, { id: 'p2', at: '2026-01-01T09:00:00Z', mesure: 'm2', audited: ['tv|a'], items: [] });
    const status = registry.recordPass(reg, { id: 'p3', at: '2026-01-01T10:00:00Z', mesure: 'm2', audited: ['tv|a'], items: [item('oeil', 'visual'), item('mesure', 'text-tiny')] });
    expect(status.oeil).toBe('toujours-la'); // jamais constaté corrigé (épreuve du 24/09, point 26)
    expect(status.mesure).toBe('toujours-la');
    // Vraiment corrigé (même mesure, absent), puis revenu : réapparu
    registry.recordPass(reg, { id: 'p4', at: '2026-01-01T11:00:00Z', mesure: 'm2', audited: ['tv|a'], items: [] });
    const again = registry.recordPass(reg, { id: 'p5', at: '2026-01-01T12:00:00Z', mesure: 'm2', audited: ['tv|a'], items: [item('mesure', 'text-tiny')] });
    expect(again.mesure).toBe('reapparu');
  });
});

describe('revue', () => {
  let rev;
  it('fabrique une fiche par défaut, fusionnée entre plateformes', () => {
    rev = build(A);
    const badges = ficheOf(rev, 'Badges');
    expect(badges.platforms).toEqual(['tv', 'phone']);
    expect(badges.ids).toHaveLength(2);
    expect(badges.priority.why).toMatch(/2 plateformes/);
    expect(ficheOf(rev, 'Icônes de navigation').platforms).toEqual(['tv']);
    // Grille : le plus grave d'abord (Badges, important, avant Cœur, mineur)
    const names = rev.fiches.filter((f) => !f.family.info).map((f) => f.name);
    expect(names.indexOf('Badges')).toBeLessThan(names.indexOf('Cœur des favoris'));
  });

  it('écrit les fichiers lisibles et une page dont toutes les images existent', () => {
    expect(readFileSync(path.join(A, 'revue.md'), 'utf8')).toMatch(/## Défauts à trancher[\s\S]*\*\*Badges\*\*/);
    expect(existsSync(path.join(A, 'revue', 'a-relire.md'))).toBe(true);
    const { IMG, DATA, sheetsExist } = imagesOk(path.join(A, 'revue', 'revue.html'), path.join(A, 'revue'));
    expect(sheetsExist).toBe(true);
    for (const f of DATA.fiches) for (const p of f.parts) if (p.example?.img) expect(IMG[p.example.img], p.example.img).toBeTruthy();
    // Zone sensible (compte) : jamais d'image
    expect(Object.keys(IMG).some((k) => k.includes('compte'))).toBe(false);
  });

  it('mémorise un faux positif dans le registre, et l\'écarte encore au passage suivant', () => {
    const contraste = ficheOf(rev, 'Texte d\'aide');
    writeFileSync(path.join(A, 'interpretation.json'), JSON.stringify({ items: { [contraste.ids[0]]: { faux: 'Texte sur fond flou mal mesuré' } } }));
    rev = build(A);
    expect(ficheOf(rev, 'Texte d\'aide').faux).toMatch(/fond flou/);
    expect(json(REG).items[contraste.ids[0]].faux.raison).toMatch(/fond flou/);
  });

  it('range à part ce qui a été exclu ou reporté, et marque les corrigés', () => {
    const d = (status) => ({ status, note: '', updatedAt: '2026-01-01T10:30:00Z' });
    const reg = registry.load(REG);
    const ids = (name) => ficheOf(rev, name).ids;
    registry.importDecisions(reg, Object.fromEntries([
      ...ids('Badges').map((id) => [id, d('inclure')]), ...ids('Icônes de navigation').map((id) => [id, d('exclure')]),
      ...ids('Cœur des favoris').map((id) => [id, d('plus-tard')]),
    ]));
    registry.save(REG, reg);
    const revB = build(B);
    const sec = (name) => summary.sectionOf(ficheOf(revB, name), revB.decisions);
    expect(sec('Icônes de navigation')).toBe('exclus');
    expect(sec('Cœur des favoris')).toBe('plus-tard');
    expect(sec('Texte d\'aide')).toBe('ecartes'); // faux positif mémorisé, sans nouvelle interprétation
    expect(revB.fixed.map((x) => x.name)).toEqual(['Badges', 'Badges']);
    expect(ficheOf(revB, 'Titres').parts[0].status).toBe('nouveau');
  });
});

describe('avant / après', () => {
  it('compare, signale la régression, et ne montre qu\'une fois un même changement', () => {
    const ids = ficheOf(json(path.join(A, 'revue.json')), 'Badges').ids;
    const r = node('review/compare.cjs', [A, B, CFG, '--ids', ids.join(','), '--titre', 'Lot 1']);
    expect(r.status, r.stderr).toBe(0);
    const aa = json(path.join(B, 'avant-apres.json'));
    // Badges corrigés sur les deux plateformes ; l'état perdu (clavier de la Recherche) est sur un autre écran
    expect(aa.targets.map((t) => t.status)).toEqual(['corrige', 'corrige']);
    expect(aa.totals.lost).toBe(1);
    expect(aa.pairs.find((p) => p.id === 'accueil' && p.kind === 'phone').new.map((n) => n.el)).toEqual(['Titres']);
    // Accueil et Accueil vide (même écran) perdent le même constat : une seule carte
    expect(aa.pairs.find((p) => p.id === 'accueil-vide').twinOf).toMatch(/Accueil/);
    const { IMG, DATA, sheetsExist } = imagesOk(path.join(B, 'avant-apres', 'avant-apres.html'), path.join(B, 'avant-apres'));
    expect(sheetsExist).toBe(true);
    for (const p of DATA.pairs) for (const s of [p.before.img, p.after.img]) if (s) expect(IMG[s], s).toBeTruthy();
    expect(DATA.pairs.filter((p) => p.changed && !p.twinOf).every((p) => p.before.img || p.after.img || p.before.skipped || p.after.skipped)).toBe(true);
  });

  it('ne compte pas comme régression un faux positif écarté par l’interprète', () => {
    const titres = ficheOf(json(path.join(B, 'revue.json')), 'Titres').ids[0];
    const reg = registry.load(REG);
    // Écarté avec une autre version de la mesure : pas caché (à revérifier)
    reg.items[titres].faux = { raison: 'Marge tactile invisible prise pour du texte qui déborde', pass: path.basename(B), mesure: 'ancienne' };
    registry.save(REG, reg);
    expect(node('review/compare.cjs', [A, B, CFG]).status).toBe(0);
    expect(json(path.join(B, 'avant-apres.json')).pairs.find((p) => p.id === 'accueil' && p.kind === 'phone').new.length).toBe(1);
    // Écarté avec la même version : ignoré
    reg.items[titres].faux.mesure = MESURE;
    registry.save(REG, reg);
    const r = node('review/compare.cjs', [A, B, CFG]);
    expect(r.status, r.stderr).toBe(0);
    const aa = json(path.join(B, 'avant-apres.json'));
    expect(aa.pairs.find((p) => p.id === 'accueil' && p.kind === 'phone').new).toEqual([]);
    delete reg.items[titres].faux;
    registry.save(REG, reg);
  });

  it('refuse de comparer deux passages mesurés différemment', () => {
    const C = path.join(OUT, '2026-01-01-13-00');
    cpSync(B, C, { recursive: true });
    writeFileSync(path.join(C, 'report.json'), JSON.stringify({ ...json(path.join(B, 'report.json')), mesure: 'autre' }));
    const r = node('review/compare.cjs', [A, C, CFG]);
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/même version/);
    rmSync(C, { recursive: true, force: true });
  });
});

describe('revue locale', () => {
  it('écrit chaque décision dans le passage et le registre, et refuse ce qui ne vient pas de la page', async () => {
    const port = 48000 + Math.floor(Math.random() * 1000);
    const srv = spawn(process.execPath, [path.join(TOOL, 'review', 'serve.cjs'), A, '--app', APP, '--port', String(port), '--sans-navigateur'], { cwd: ROOT, env });
    let log = '';
    srv.stdout.on('data', (c) => { log += c; });
    for (let i = 0; i < 100 && !log.includes('Revue locale'); i++) await new Promise((r) => setTimeout(r, 100));
    const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
    const H = { 'X-Audit-Revue': '1', 'Content-Type': 'application/json' };
    expect((await fetch(`${url}/api/etat`)).status).toBe(403);
    expect((await fetch(`${url}/../report.json`)).status).toBe(404);
    expect((await fetch(`${url}/revue.html`)).status).toBe(200);
    const coeur = ficheOf(json(path.join(A, 'revue.json')), 'Cœur des favoris').ids[0];
    const res = await fetch(`${url}/api/decisions`, { method: 'POST', headers: H, body: JSON.stringify({ decisions: { [coeur]: { status: 'inclure', note: 'essai' }, undefined: { status: 'exclure' } } }) });
    expect((await res.json()).n).toBe(1);
    expect(json(path.join(A, 'decisions.json'))[coeur]).toMatchObject({ status: 'inclure', note: 'essai' });
    expect(json(REG).items[coeur].decision.status).toBe('inclure');
    const closed = new Promise((r) => srv.on('exit', r));
    await fetch(`${url}/api/fin`, { method: 'POST', headers: H });
    expect(await closed).toBe(0);
  });
});

describe('lots', () => {
  it('laisse des fiches sans décision pour plus tard, sans refuser', () => {
    const r = node('lots.mjs', ['creer', '--depuis', A, '--app', APP]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/sans décision : elles? rest\S* dans la prochaine revue/);
  });

  it('explique le découpage, puis crée le cycle et refuse de vérifier sans correction', () => {
    const r = node('lots.mjs', ['creer', '--depuis', A, '--app', APP, '--malgre-indecis']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/En combien de lots/);
    expect(existsSync(path.join(OUT, 'lots'))).toBe(false); // rien de créé sans --lots
    // Badges : « Inclure » mais déjà corrigés au passage suivant, donc hors des lots ; Cœur : « Inclure »
    // depuis la revue locale. Une seule correction : au plus un lot.
    expect(r.stdout).toMatch(/1 correction à faire/);
    expect(node('lots.mjs', ['creer', '--depuis', A, '--app', APP, '--malgre-indecis', '--lots', '2']).stderr).toMatch(/entre 1 et 1/);
    const c = node('lots.mjs', ['creer', '--depuis', A, '--app', APP, '--malgre-indecis', '--lots', '1']);
    expect(c.status, c.stderr).toBe(0);
    const cycle = json(path.join(OUT, 'lots', path.basename(A), 'cycle.json'));
    expect(cycle.lots).toHaveLength(1);
    expect(cycle.lots[0].units.map((u) => u.name)).toEqual(['Cœur des favoris']);
    const v = node('lots.mjs', ['verifier', '--app', APP]);
    expect(v.status).toBe(1);
    expect(v.stderr).toMatch(/pas changé/);
    const again = node('lots.mjs', ['creer', '--depuis', A, '--app', APP, '--malgre-indecis', '--lots', '1']);
    expect(again.stderr).toMatch(/cycle est en cours/);
    // La revue de départ porte l'état du lot
    const rev = build(A);
    expect(ficheOf(rev, 'Cœur des favoris').etat).toBe('Dans le lot 1 : à corriger');
  });

  it('scinde un lot en partie réussi : les corrigés sont acquis, le reste part dans un nouveau lot', () => {
    const f = path.join(OUT, 'lots', path.basename(A), 'cycle.json');
    const cycle = json(f);
    const lot = cycle.lots[0];
    const coeur = lot.ids[0];
    lot.units.push({ fiche: 'x', name: 'Autre défaut', ids: ['aaaaaaaaaaaa'], platforms: ['tv'], gravity: 'mineur', priority: 'faible', family: 'Autre' });
    lot.ids.push('aaaaaaaaaaaa');
    lot.etat = 'incomplet';
    lot.verifications.push({ date: 'x', apres: B, code: 'c', etat: 'incomplet', targets: [{ id: coeur, status: 'corrige' }, { id: 'aaaaaaaaaaaa', status: 'toujours-la' }], regressions: [] });
    writeFileSync(f, JSON.stringify(cycle));
    expect(node('lots.mjs', ['etat', '--app', APP]).stdout).toMatch(/ lot scinder/);
    const r = node('lots.mjs', ['scinder', '--app', APP]);
    expect(r.status, r.stderr).toBe(0);
    const after = json(f);
    expect(after.lots.map((l) => [l.n, l.etat, l.ids])).toEqual([[1, 'prouve', [coeur]], [2, 'a-corriger', ['aaaaaaaaaaaa']]]);
    expect(node('lots.mjs', ['etat', '--app', APP]).stdout).toMatch(/Lot 2 : faire ses corrections \(Autre défaut\)/);
  });

  it('calcule les plateformes d\'un lot sans rien lancer', () => {
    const ids = ficheOf(json(path.join(A, 'revue.json')), 'Badges').ids;
    const r = node('run.mjs', ['--app', APP, '--cible-ids', ids.join(','), '--plan']);
    expect(r.status, r.stderr).toBe(0);
    const plan = JSON.parse(r.stdout.trim().split('\n').pop());
    expect(plan.kinds).toEqual(['tv', 'phone']);
    expect(plan.screens).toEqual(['accueil']);
    // --dans : seulement les lieux regardés par ce passage (celui de départ d'un lot)
    const dans = node('run.mjs', ['--app', APP, '--cible-ids', ids.join(','), '--dans', path.basename(B), '--plan']);
    expect(JSON.parse(dans.stdout.trim().split(/\r?\n/).pop()).sizes).toEqual({ tv: [null], phone: ['phone'] });
  });
});

// Tour de sortie du 24/09 : un état qui disparaît parce que la correction a réussi (point 29), et une fiche
// « pour information » incluse (point 28). Passages et registre à part, pour ne pas toucher aux autres tests.
describe('états perdus et fiches d\'information', () => {
  const OUT2 = path.join(TMP, 'out2');
  const env2 = { ...env, AUDIT_OUT: OUT2, AUDIT_REGISTRE: path.join(TMP, 'registre2.json') };
  const A2 = path.join(OUT2, '2026-01-02-10-00'), B2 = path.join(OUT2, '2026-01-02-12-00');
  const run2 = (script, args) => { const r = node(script, args, { env: env2 }); expect(r.status, r.stdout + r.stderr).toBe(0); return r; };
  const build2 = (dir) => { run2('review/build.cjs', [dir, CFG, '--sans-planches']); return json(path.join(dir, 'revue.json')); };
  const reg2 = () => json(env2.AUDIT_REGISTRE);
  const clavier = registry.defectId('phone', 'text-tiny', 'span.touche');
  const desc = registry.defectId('phone', 'text-ellipsis', 'p.desc');
  beforeAll(() => {
    fabrique(A2, { at: '2026-01-02T09:00:00Z', extra: { mesure: MESURE, code: CODE } });
    fabrique(B2, { apres: true, at: '2026-01-02T11:00:00Z', extra: { mesure: MESURE, code: CODE } });
    // Avant : un défaut vu seulement dans l'état « clavier ouvert » (plus atteint après), et un texte
    // raccourci « pour information » sur l'accueil.
    const rep = json(path.join(A2, 'report.json'));
    const phone = rep.runs.find((r) => r.key === 'phone-phone');
    phone.screens.find((s) => s.id === 'recherche-clavier').issues = [{ rule: 'text-tiny', severity: 'warning', message: 'Touche de 8 px', selector: 'div.clavier > span.touche', rects: [{ x: 10, y: 300, w: 40, h: 20 }] }];
    phone.screens.find((s) => s.id === 'accueil').issues.push({ rule: 'text-ellipsis', severity: 'info', message: 'Texte raccourci par « … »', selector: 'div.carte > p.desc', rects: [{ x: 10, y: 120, w: 100, h: 20 }] });
    writeFileSync(path.join(A2, 'report.json'), JSON.stringify(rep));
    // Après : le texte raccourci est toujours là (sinon il serait « corrigé », donc hors des lots)
    const repB = json(path.join(B2, 'report.json'));
    repB.runs.find((r) => r.key === 'phone-phone').screens.find((s) => s.id === 'accueil').issues.push({ rule: 'text-ellipsis', severity: 'info', message: 'Texte raccourci par « … »', selector: 'div.carte > p.desc', rects: [{ x: 10, y: 120, w: 100, h: 20 }] });
    writeFileSync(path.join(B2, 'report.json'), JSON.stringify(repB));
    build2(A2);
    build2(B2);
  });

  it('ne dit pas « corrigé » un défaut dont l\'état n\'est plus atteint, sauf constat de l\'interprète', () => {
    const pass = reg2().passes.find((p) => p.id === path.basename(B2));
    expect(pass.missed).toContain('phone-phone|recherche-clavier');
    expect(reg2().items[clavier].lastStatus).not.toBe('corrige');
    run2('review/compare.cjs', [A2, B2, CFG, '--ids', clavier]);
    let aa = json(path.join(B2, 'avant-apres.json'));
    expect(aa.targets[0].status).toBe('a-verifier');
    // La fiche montre l'avant, et l'écran d'origine après (plus « aucune capture du défaut »)
    expect(aa.cibles[0].why).toBeUndefined();
    expect(aa.cibles[0].afterScreen).toBe('Recherche');
    expect(aa.cibles[0].img.apres.full).toBeTruthy();
    // L'interprète constate que l'état a disparu pour une bonne raison : plus de régression, défaut corrigé
    writeFileSync(path.join(B2, 'interpretation.json'), JSON.stringify({ etats: { 'phone-phone|recherche-clavier': 'le clavier ne s\'ouvre plus tout seul, comme demandé' } }));
    build2(B2);
    expect(reg2().passes.find((p) => p.id === path.basename(B2)).missed).toBeUndefined();
    expect(reg2().items[clavier].lastStatus).toBe('corrige');
    run2('review/compare.cjs', [A2, B2, CFG, '--ids', clavier]);
    aa = json(path.join(B2, 'avant-apres.json'));
    expect(aa.targets[0].status).toBe('corrige');
    expect(aa.targets[0].oeil).toMatch(/n'est plus atteint : le clavier/);
    expect(aa.totals.lost).toBe(0);
    expect(aa.pairs.find((p) => p.id === 'recherche-clavier').reached).toBe('perdu-constate');
  });

  it('met dans les lots une fiche « pour information » que l\'utilisateur a incluse', () => {
    const file = path.join(TMP, 'decisions2.json');
    writeFileSync(file, JSON.stringify({ [desc]: { status: 'inclure', note: '', updatedAt: '2026-01-02T13:00:00Z' } }));
    run2('review/registry.cjs', ['import', file]);
    const rev = build2(B2);
    const fiche = rev.fiches.find((f) => f.ids.includes(desc));
    expect(fiche.family.info).toBe(true);
    const r = run2('lots.mjs', ['creer', '--depuis', B2, '--app', APP]);
    expect(r.stdout).toContain(fiche.name);
  });
});

describe('banc', () => {
  it('recompile Android quand un émulateur du passage n\'a pas reçu la dernière installation', () => {
    const v = { android: 'c1', installs: { Phone_AVD: '2026-09-23 23:38:01' } };
    // Épreuve du 24/09 : APK installé sur le téléphone seul, la TV gardait l'ancien
    expect(androidStale(v, 'c1', { Phone_AVD: '2026-09-23 23:38:01', TV_AVD: '2026-09-23 21:10:00' })).toMatch(/TV_AVD/);
    expect(androidStale(v, 'c1', { Phone_AVD: '2026-09-23 23:38:01' })).toBeNull();
    expect(androidStale(v, 'c1', { Phone_AVD: '2026-09-24 06:00:00' })).toMatch(/Phone_AVD/); // réinstallé depuis
    expect(androidStale(v, 'c1', { Phone_AVD: null })).toMatch(/Phone_AVD/); // paquet absent
    expect(androidStale(v, 'c2', {})).toBe('code changé');
    expect(androidStale({ android: 'c1' }, 'c1', { TV_AVD: 'x' })).toMatch(/TV_AVD/); // ancien fichier, sans trace
  });
});

// Mesure dans un vrai navigateur, sur la page d'exemple (audit/exemple) : sautée si aucun Chromium
// n'est disponible (navigateurs de Playwright, ou Chrome / Edge du PC).
const browserOk = await (async () => {
  const { chromium } = require('@playwright/test');
  for (const o of [{}, { channel: 'chrome' }, { channel: 'msedge' }]) {
    try { await (await chromium.launch(o)).close(); return true; } catch { /* suivant */ }
  }
  return false;
})();

describe.skipIf(!browserOk)('mesure (mode web, page d\'exemple)', () => {
  it('relève les défauts voulus, et pas le bouton « œil » du mot de passe', () => {
    const out = path.join(TMP, 'web');
    const r = node('run.mjs', ['--app', 'exemple', '--sizes', 'android,bureau', '--no-review'], { env: { ...env, AUDIT_OUT: out, AUDIT_APP: 'exemple' }, timeout: 180000 });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const report = json(path.join(readFileSync(path.join(out, 'dernier-passage.txt'), 'utf8').trim(), 'report.json'));
    const rules = (key, id) => report.runs.find((x) => x.key === key).screens.find((s) => s.id === id).issues.map((i) => `${i.rule} ${i.selector.split(' > ').pop()}`);
    const phone = rules('web-android', 'accueil'), desk = rules('web-bureau', 'accueil');
    // Bandeau de 520 px sur un téléphone de 360 : le navigateur mobile dézoome, la page déborde quand même
    expect(phone).toEqual(expect.arrayContaining(['page-overflow-x body', 'offscreen-x div.promo', 'touch-target button.fav', 'text-tiny span.ref', 'text-clipped h2']));
    expect(desk.some((x) => x.startsWith('page-overflow-x') || x.startsWith('touch-target'))).toBe(false);
    expect(desk).toEqual(expect.arrayContaining(['text-tiny span.ref']));
    // Raccourci par « … » : la description limitée à 2 lignes, oui ; le titre qui tient en 2 lignes, non (point 24)
    for (const x of [phone, desk]) {
      expect(x).toContain('text-ellipsis p.desc');
      expect(x.filter((i) => /h1.bienvenue/.test(i))).toEqual([]);
    }
    // Formulaire : l'œil posé dans le champ mot de passe n'est pas un chevauchement
    for (const key of ['web-android', 'web-bureau']) expect(rules(key, 'compte').filter((x) => /overlap|covered/.test(x))).toEqual([]);
    // Lien avec une zone tactile invisible : ni zone trop petite, ni « texte qui dépasse » (règle corrigée, mesure 3)
    expect(rules('web-android', 'compte').filter((x) => /a.oubli/.test(x))).toEqual([]);
    expect(report.mesure).toBe(MESURE);
    // Donnée personnelle (e-mail dans l'en-tête) noircie dans la capture elle-même
    const shot = report.runs.find((x) => x.key === 'web-bureau').screens.find((s) => s.id === 'accueil');
    expect(shot.masked).toBe(1);
    const { PNG } = require('pngjs');
    const png = PNG.sync.read(readFileSync(path.join(readFileSync(path.join(out, 'dernier-passage.txt'), 'utf8').trim(), shot.shot)));
    // Une bande de pixels à la couleur du masque dans l'en-tête (60 premiers pixels)
    let masked = 0;
    for (let y = 0; y < 60; y++) for (let x = 0; x < png.width; x++) { const i = (y * png.width + x) * 4; if (png.data[i] === 24 && png.data[i + 1] === 26 && png.data[i + 2] === 36) masked++; }
    expect(masked).toBeGreaterThan(500);
  }, 200000);
});
