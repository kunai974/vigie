// Revue locale : ouvre la revue d'un passage dans le navigateur, et chaque décision (Inclure, Plus tard,
// Exclure, remarque) s'écrit aussitôt dans le passage (decisions.json) et dans le registre du projet.
// Aucune dépendance à un service en ligne : un petit serveur sur ce PC seulement (127.0.0.1).
//
// Usage : node audit revue [<passage audit-out/...>] [--app <nom>] [--port <n>] [--sans-navigateur]
//   Sans passage : le dernier (audit-out/dernier-passage.txt). La revue est fabriquée si elle manque.
//   Le serveur s'arrête quand on clique « J'ai terminé » dans la page, ou par Ctrl+C.
//
// Fichier écrit : <passage>/decisions.json = { id: { status, note, updatedAt } } (même format que
// l'export de la page publiée) ; « libre » = remarques générales.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const registry = require('./registry.cjs');

const { ROOT, appDir, appName, outRoot } = require('./paths.cjs');
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !['--app', '--port'].includes(argv[i - 1]));
const LAST = path.join(outRoot(), 'dernier-passage.txt');

function fail(msg) { console.error(`✖ ${msg}`); process.exit(1); }

// Le passage : son chemin, ou son seul nom (dossier du même nom dans le dossier des passages), sinon le dernier.
const byName = positional[0] && !fs.existsSync(path.resolve(positional[0])) && path.join(outRoot(), positional[0]);
const DIR = path.resolve(byName && fs.existsSync(byName) ? byName : positional[0] || (fs.existsSync(LAST) ? fs.readFileSync(LAST, 'utf8').trim() : ''));
if (!fs.existsSync(path.join(DIR, 'report.json'))) fail(`passage introuvable : ${DIR || '(aucun)'} (audit-out/<date>)`);
const report = JSON.parse(fs.readFileSync(path.join(DIR, 'report.json'), 'utf8'));
// Personnalisation : --app, sinon celle qui a fait le passage (report.appId), sinon le choix par défaut.
const APP_ID = opt('--app') || report.appId || appName([]);
const REVIEW_CFG = path.join(appDir(APP_ID), 'review.cjs');
if (!fs.existsSync(REVIEW_CFG)) fail(`personnalisation introuvable : ${REVIEW_CFG}`);
const cfg = require(REVIEW_CFG);

const REVUE = path.join(DIR, 'revue');
// Revue absente, ou fabriquée avant le 23/09 (sans revue.json) : refaite.
if (!fs.existsSync(path.join(REVUE, 'revue.html')) || !fs.existsSync(path.join(DIR, 'revue.json'))) {
  console.log('Revue absente : fabrication…');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'build.cjs'), DIR, REVIEW_CFG], { stdio: 'inherit' });
  if (r.status !== 0) fail('fabrication de la revue impossible.');
}

const DECISIONS_FILE = path.join(DIR, 'decisions.json');
const readDecisions = () => (fs.existsSync(DECISIONS_FILE) ? JSON.parse(fs.readFileSync(DECISIONS_FILE, 'utf8')) : {});
// Noms lisibles, pour le journal (« Inclure : Cœur des favoris »).
const names = (() => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(DIR, 'revue.json'), 'utf8'));
    const title = Object.fromEntries(data.platforms.map((p) => [p.kind, p.title]));
    const out = {};
    for (const f of data.fiches) for (const p of f.parts) out[p.id] = `${f.name} (${title[p.kind]})`;
    return out;
  } catch { return {}; }
})();
const LABEL = { inclure: 'Inclure', 'plus-tard': 'Plus tard', exclure: 'Exclure' };

/** Décisions reçues de la page : { id: { status, note } }. Écrites dans le passage puis le registre. */
function record(incoming) {
  const now = new Date().toISOString();
  const file = readDecisions();
  const clean = {};
  for (const [id, d] of Object.entries(incoming || {})) {
    // Identifiant d'un défaut (12 caractères hexadécimaux) ou « libre » (remarques générales).
    if (!/^(?:[0-9a-f]{12}|libre)$/.test(id) || !d || typeof d !== 'object') continue;
    const status = registry.DECISIONS.includes(d.status) ? d.status : null;
    const note = typeof d.note === 'string' ? d.note.slice(0, 4000) : (file[id]?.note || '');
    clean[id] = { status: id === 'libre' ? null : status, note, updatedAt: now };
  }
  if (!Object.keys(clean).length) return 0;
  Object.assign(file, clean);
  fs.writeFileSync(DECISIONS_FILE, JSON.stringify(file, null, 1) + '\n');
  if (cfg.REGISTRY) {
    const reg = registry.load(cfg.REGISTRY);
    registry.importDecisions(reg, clean);
    registry.save(cfg.REGISTRY, reg);
  }
  for (const [id, d] of Object.entries(clean)) {
    if (id === 'libre') console.log(`Remarque générale : ${d.note ? 'enregistrée' : 'effacée'}`);
    else console.log(`${LABEL[d.status] || 'Sans décision'} : ${names[id] || id}${d.note ? ` · « ${d.note.slice(0, 80)} »` : ''}`);
  }
  return Object.keys(clean).length;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

let server;
function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  // Écritures : seulement depuis la page elle-même (en-tête propre à l'outil : un autre site ouvert dans
  // le navigateur ne peut pas l'envoyer sans autorisation, que ce serveur ne donne jamais).
  if (url.pathname.startsWith('/api/')) {
    if (req.headers['x-audit-revue'] !== '1') return send(res, 403, { error: 'refusé' });
    if (req.method === 'GET' && url.pathname === '/api/etat') {
      return send(res, 200, { passage: path.basename(DIR), app: APP_ID, decisions: readDecisions() });
    }
    if (req.method === 'POST' && (url.pathname === '/api/decisions' || url.pathname === '/api/fin')) {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        if (url.pathname === '/api/fin') {
          send(res, 200, { ok: true });
          finish('revue terminée depuis la page');
          return;
        }
        try { send(res, 200, { ok: true, n: record(JSON.parse(body || '{}').decisions) }); }
        catch (e) { send(res, 400, { error: e.message }); }
      });
      return;
    }
    return send(res, 404, { error: 'inconnu' });
  }
  if (req.method !== 'GET') return send(res, 405, 'méthode refusée', 'text/plain; charset=utf-8');
  if (url.pathname === '/') { res.writeHead(302, { Location: '/revue.html' }); return res.end(); }
  // Fichiers de la revue seulement (jamais au-dessus du dossier revue/).
  const file = path.resolve(REVUE, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(REVUE + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'introuvable', 'text/plain; charset=utf-8');
  send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
}

function summary() {
  const d = readDecisions();
  const c = { inclure: 0, 'plus-tard': 0, exclure: 0 };
  for (const [id, x] of Object.entries(d)) if (id !== 'libre' && c[x.status] != null) c[x.status]++;
  return `${c.inclure} à corriger, ${c['plus-tard']} plus tard, ${c.exclure} exclus`;
}

function finish(why) {
  console.log(`\nRevue fermée (${why}). Décisions : ${summary()}.\n  Passage : ${DECISIONS_FILE}${cfg.REGISTRY ? `\n  Registre : ${cfg.REGISTRY}` : ''}`);
  server.close();
  setTimeout(() => process.exit(0), 200);
}

function open(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore', windowsVerbatimArguments: process.platform === 'win32' }).unref(); } catch { /* adresse affichée de toute façon */ }
}

function listen(port, tries = 10) {
  server = http.createServer(handle);
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && tries > 1) return listen(port + 1, tries - 1);
    fail(`serveur impossible : ${e.message}`);
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/revue.html`;
    console.log(`Revue locale : ${url}\n  Passage ${path.basename(DIR)} · décisions dans ${path.relative(ROOT, DECISIONS_FILE)} et le registre.\n  « J'ai terminé » dans la page (ou Ctrl+C) pour fermer.`);
    if (!argv.includes('--sans-navigateur')) open(url);
  });
}

process.on('SIGINT', () => finish('Ctrl+C'));
listen(Number(opt('--port')) || 4870);
