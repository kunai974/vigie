// Personnalisation de l'app auditée : un sous-dossier de l'outil (parcours `screens.mjs`, réglages de
// revue `review.cjs`, registre). Choisie par --app <nom|chemin>, sinon la variable AUDIT_APP, sinon la
// seule présente, sinon l'exemple (review/paths.cjs). Le reste de l'outil ne connaît aucune app.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const paths = createRequire(import.meta.url)('../review/paths.cjs');

export const { AUDIT_DIR, cmd } = paths;
export const appName = (args) => paths.appName(args);

/** Dossier et fichiers de la personnalisation ; échoue clairement s'il manque. */
export function appFiles(root, name = appName()) {
  const dir = paths.appDir(name);
  const screens = path.join(dir, 'screens.mjs');
  if (!existsSync(screens)) throw new Error(`Personnalisation introuvable : ${screens} (--app <nom>)`);
  return { name, dir, screens, review: path.join(dir, 'review.cjs') };
}

/** Dossier des passages : audit-out/ à la racine du projet, ou la variable AUDIT_OUT. */
export function outRoot() {
  return paths.outRoot();
}

/** Parcours de l'app (screens.mjs). */
export async function loadApp(root, name = appName()) {
  const files = appFiles(root, name);
  return { files, config: await import(pathToFileURL(files.screens).href) };
}
