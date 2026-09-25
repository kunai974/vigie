// Identité du code d'une app : empreinte du contenu de ses fichiers (modifications non commitées
// comprises, fins de ligne ignorées). Même code = même identité, qu'il soit commité ou non.
// La version d'audit de l'app l'embarque à la compilation ; l'outil la compare au code en cours et
// refuse d'auditer un APK compilé depuis un autre code (22/09 : APK d'une branche abandonnée).
//
// Ligne de commande (pour le script de compilation) : node <outil>/core/build-id.mjs [--app <nom>]
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * `paths` : fichiers et dossiers qui font l'app (pas l'outil d'audit, pas la documentation).
 * `exclude` : chemins à ignorer (fichiers régénérés par la compilation).
 */
export function codeId(root, paths, exclude = []) {
  // Index temporaire : l'index de travail de l'utilisateur n'est jamais touché.
  const index = path.join(os.tmpdir(), `audit-build-id-${process.pid}-${Date.now()}`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: root, env, encoding: 'utf8', timeout: 60000 });
    if (r.status !== 0) throw new Error(`git ${args[0]} : ${(r.stderr || '').trim()}`);
    return r.stdout.trim();
  };
  try {
    git(['read-tree', 'HEAD']);
    git(['add', '-A', '--', ...paths, ...exclude.map((p) => `:(exclude)${p}`)]);
    const tree = git(['write-tree']);
    return createHash('sha1').update(git(['ls-tree', tree, '--', ...paths])).digest('hex').slice(0, 12);
  } finally {
    rmSync(index, { force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { loadApp } = await import('./app.mjs');
  const { config } = await loadApp(ROOT);
  console.log(codeId(ROOT, config.APP_CODE.paths, config.APP_CODE.exclude));
}
