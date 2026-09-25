#!/usr/bin/env node
// Point d'entrée de l'outil : « node audit <commande> » depuis le projet audité (le dossier de l'outil
// porte le nom qu'on veut : node <dossier> <commande>). Chaque commande lance le script correspondant,
// avec les mêmes options. Mode d'emploi : README.md ; le tour complet : PROCESS.md.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const TOOL = path.dirname(fileURLToPath(import.meta.url));
const { cmd } = createRequire(import.meta.url)('./review/paths.cjs');

// commande → [script, arguments ajoutés devant, résumé]
const COMMANDS = {
  liste: ['run.mjs', ['--list'], 'écrans, profils et tailles de l\'app'],
  banc: ['banc.mjs', [], 'prépare les appareils (émulateurs, versions d\'audit à jour)'],
  passage: ['run.mjs', [], 'un passage : parcours, captures, mesures, revue'],
  revue: ['review/serve.cjs', [], 'ouvre la revue dans le navigateur (vos décisions s\'y enregistrent)'],
  'refaire-revue': ['review/build.cjs', [], 'refait la revue d\'un passage (après l\'interprétation)'],
  lot: ['lots.mjs', [], 'le tour guidé des corrections : creer, verifier, relire, scinder, clore, etat'],
  'avant-apres': ['avant-apres.mjs', [], 'avant / après d\'une correction isolée : avant, puis apres'],
  comparer: ['review/compare.cjs', [], 'refait la comparaison de deux passages'],
  decisions: ['review/registry.cjs', ['import'], 'importe les décisions d\'une revue partagée'],
  recalculer: ['review/registry.cjs', ['recalculer'], 'recalcule le statut de chaque défaut du registre'],
  exporter: ['exporter.mjs', [], 'copie l\'outil, sans vos données ni vos personnalisations, prêt à partager'],
};

const [name, ...rest] = process.argv.slice(2);
const entry = COMMANDS[name];
if (!entry) {
  const width = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  console.log(`Vigie, l'audit d'affichage qui prouve ses corrections. Usage : ${cmd('<commande> [options]')}\n`);
  for (const [k, [, , about]] of Object.entries(COMMANDS)) console.log(`  ${k.padEnd(width)}  ${about}`);
  console.log(`\nExemple, sans rien installer d'autre : ${cmd('passage --app exemple')}, puis ${cmd('revue')}.`);
  process.exit(name && name !== 'aide' && name !== '--help' ? 1 : 0);
}
const [script, pre] = entry;
const r = spawnSync(process.execPath, [path.join(TOOL, script), ...pre, ...rest], { stdio: 'inherit' });
process.exit(r.status ?? 1);
