// Emplacements communs à tout l'outil (générique) :
// - le dossier de l'outil (peu importe son nom) et le projet audité (le dossier qui le contient) ;
// - la personnalisation d'une app : un nom (sous-dossier de l'outil) ou un chemin vers son dossier ;
// - le dossier des passages : audit-out/ à la racine du projet, ou la variable AUDIT_OUT (tests, autre disque) ;
// - la commande à taper pour lancer l'outil, écrite dans ses messages (« node audit lot verifier »).
const fs = require('fs');
const path = require('path');

const AUDIT_DIR = path.resolve(__dirname, '..');
const ROOT = path.resolve(AUDIT_DIR, '..');
const isPath = (name) => /[\\/]/.test(name) || path.isAbsolute(name);
// Sous-dossiers de l'outil qui ne sont pas la personnalisation d'une app.
const NOT_APPS = new Set(['core', 'review', 'test', 'exemple', 'node_modules']);

/** Personnalisations présentes dans le dossier de l'outil (sous-dossiers avec un screens.mjs), hors exemple. */
function apps() {
  return fs.readdirSync(AUDIT_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !NOT_APPS.has(d.name) && !d.name.startsWith('.') && fs.existsSync(path.join(AUDIT_DIR, d.name, 'screens.mjs')))
    .map((d) => d.name);
}

/**
 * Personnalisation choisie : --app <nom|chemin>, sinon la variable AUDIT_APP, sinon la seule présente dans
 * le dossier de l'outil, sinon l'exemple. Plusieurs présentes sans choix : erreur claire.
 */
function appName(args = process.argv.slice(2)) {
  const i = args.indexOf('--app');
  const asked = (i >= 0 && args[i + 1]) || process.env.AUDIT_APP;
  if (asked) return asked;
  const found = apps();
  if (found.length > 1) throw new Error(`plusieurs personnalisations (${found.join(', ')}) : choisir avec --app <nom>`);
  return found[0] || 'exemple';
}

/** Dossier de la personnalisation (nom : sous-dossier de l'outil ; ou chemin). */
function appDir(name = appName()) {
  return isPath(name) ? path.resolve(name) : path.join(AUDIT_DIR, name);
}
const reviewConfig = (name) => path.join(appDir(name), 'review.cjs');
const outRoot = () => (process.env.AUDIT_OUT ? path.resolve(process.env.AUDIT_OUT) : path.join(ROOT, 'audit-out'));

/** Commande de l'outil telle qu'elle se tape depuis le dossier courant : cmd('lot verifier') → « node audit lot verifier ». */
function cmd(sub = '') {
  let rel = path.relative(process.cwd(), AUDIT_DIR).split(path.sep).join('/') || '.';
  if (/\s/.test(rel)) rel = `"${rel}"`;
  return `node ${rel}${sub ? ` ${sub}` : ''}`;
}

module.exports = { AUDIT_DIR, ROOT, apps, appName, appDir, reviewConfig, outRoot, cmd };
