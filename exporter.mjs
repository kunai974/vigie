// Exporter l'outil, prêt à partager ou à publier : une copie du dossier de l'outil SANS les
// personnalisations des apps (parcours, réglages, registre), sans passages ni dépendances installées,
// puis un contrôle de toute la copie : aucune trace des apps retirées (dossier, nom de l'app, paquet),
// de ce PC (nom d'utilisateur, chemins) ni d'adresse e-mail. Une trace trouvée : refus, la liste des
// lignes en cause est affichée, la copie reste là pour être examinée.
//
// Usage : node audit exporter <dossier de destination, vide ou absent> [--interdits mot1,mot2]
//   --interdits : mots en plus à ne jamais publier (ex. le nom d'un client).
// La personnalisation d'exemple (exemple/) et les tests de l'outil partent avec la copie.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const TOOL = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TOOL, '..');
const { apps } = createRequire(import.meta.url)('./review/paths.cjs');
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const dest = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--interdits');
const fail = (msg) => { console.error(`✖ ${msg}`); process.exit(1); };
if (!dest) fail('Usage : node audit exporter <dossier de destination> [--interdits mot1,mot2]');
const DEST = path.resolve(dest);
if (DEST === TOOL || DEST.startsWith(TOOL + path.sep)) fail('la destination ne peut pas être dans le dossier de l\'outil.');
if (existsSync(DEST) && readdirSync(DEST).length) fail(`la destination n'est pas vide : ${DEST}`);

// 1. Copie : tout le dossier de l'outil, sauf les personnalisations des apps et ce qui est local.
const removed = apps();
const SKIP_DIRS = new Set(['node_modules', '.git', 'audit-out', '.images', ...removed]);
const SKIP_FILES = [/^exemple[\\/]registre\.json$/, /\.log$/];
mkdirSync(DEST, { recursive: true });
cpSync(TOOL, DEST, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(TOOL, src);
    if (!rel) return true;
    if (rel.split(path.sep).some((part) => SKIP_DIRS.has(part))) return false;
    return !SKIP_FILES.some((re) => re.test(rel));
  },
});

// 2. Mots interdits : les apps retirées (nom du dossier, nom affiché, paquet, émulateurs), ce PC, et ceux
// donnés par --interdits. Recherche sans tenir compte des majuscules.
const words = new Set((opt('--interdits') || '').split(',').map((w) => w.trim()).filter(Boolean));
for (const name of removed) {
  words.add(name);
  try {
    const cfg = await import(pathToFileURL(path.join(TOOL, name, 'screens.mjs')).href);
    for (const v of [cfg.APP_NAME, cfg.PACKAGE, ...Object.values(cfg.EMULATORS || {})]) if (typeof v === 'string' && v.length > 2) words.add(v);
  } catch { /* personnalisation illisible : son nom de dossier suffit */ }
}
const user = os.userInfo().username;
if (user && user.length > 2) words.add(user);
const places = [os.homedir(), ROOT].filter(Boolean);
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/g;
// Adresses d'exemple, permises (documentation, page d'exemple) : exemple.fr, example.com…
const allowedEmail = (m) => /@(exemple|example)\.(fr|com|org)$/i.test(m) || /@anthropic\.com$/i.test(m);

const TEXT = /\.(mjs|cjs|js|json|md|html|css|txt|ya?ml)$/i;
const findings = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    const rel = path.relative(DEST, f);
    for (const w of words) if (e.name.toLowerCase().includes(w.toLowerCase())) findings.push(`${rel} : nom de fichier contenant « ${w} »`);
    if (e.isDirectory()) { walk(f); continue; }
    if (!TEXT.test(e.name) || statSync(f).size > 5e6) continue;
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const low = line.toLowerCase();
      for (const w of words) if (low.includes(w.toLowerCase())) findings.push(`${rel}:${i + 1} : « ${w} » — ${line.trim().slice(0, 120)}`);
      for (const p of places) if (line.includes(p) || line.includes(p.split(path.sep).join('/'))) findings.push(`${rel}:${i + 1} : chemin de ce PC — ${line.trim().slice(0, 120)}`);
      for (const m of line.match(EMAIL) || []) if (!allowedEmail(m)) findings.push(`${rel}:${i + 1} : adresse e-mail « ${m} »`);
    });
  }
};
walk(DEST);

if (findings.length) {
  console.error(`✖ Export refusé : ${findings.length} trace${findings.length > 1 ? 's' : ''} à retirer d'abord (dans l'outil, pas dans la copie) :`);
  for (const f of findings.slice(0, 60)) console.error(`  ${f}`);
  if (findings.length > 60) console.error(`  … et ${findings.length - 60} autres`);
  console.error(`La copie est restée dans ${DEST} pour examen : la supprimer avant de réessayer.`);
  process.exit(1);
}
console.log(`Outil exporté dans ${DEST}${removed.length ? ` (personnalisation${removed.length > 1 ? 's' : ''} retirée${removed.length > 1 ? 's' : ''} : ${removed.join(', ')})` : ''}.
Contrôle : aucune trace ${[...words].length ? `de ${[...words].map((w) => `« ${w} »`).join(', ')}, ` : ''}ni de chemin de ce PC, ni d'adresse e-mail.
Pour l'essayer : placer ce dossier dans un projet, « npm install » dans le dossier, puis « node <dossier> passage --app exemple ».`);
