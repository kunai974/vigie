// Version de la mesure : ce qui décide des constats d'un passage. Deux passages mesurés avec des versions
// différentes ne se comparent pas (avant / après) : un constat pourrait apparaître ou disparaître à cause
// de l'outil, pas de l'app (« Corrigé » à tort).
//
// La version = empreinte du code des règles mesurées dans la page (core/measure.js, commentaires et
// blancs retirés) + REGLES, à augmenter à la main quand la façon de mesurer change ailleurs (run.mjs :
// marche à la télécommande, règle du clavier, éléments attendus, défilements ; pilotes : captures,
// masquages ; page.mjs : contrôle de contraste).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Historique : 1 = mesure du 23/09/2026 (premier passage complet autonome) ; 2 = 23/09 : la marche à
// la télécommande attend la fin d'un défilement avant de dire la sélection hors de l'écran, et un bouton
// posé dans un champ de saisie (œil du mot de passe) n'est plus un chevauchement ; zones sensibles
// déclarées par l'app (MASK) noircies dans les captures. 3 = 23/09 au soir (après l'épreuve) : « texte
// qui dépasse » seulement si le texte lui-même dépasse (pas une marge tactile invisible), sélecteurs
// du contrôle de contraste gardés par la fin (identité des éléments longs de la TV). 4 = 24/09 (avant le
// tour de sortie) : « raccourci par … » seulement si du texte est vraiment caché (titre limité à 2 lignes
// qui tient en entier : plus signalé).
export const REGLES = 4;

/** Code sans commentaires ni blancs : corriger un commentaire ne change pas la mesure (épreuve, point 4). */
export function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mesureId() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const code = stripComments(readFileSync(path.join(dir, 'measure.js'), 'utf8'));
  const h = createHash('sha1').update(code).update(`|${REGLES}`).digest('hex').slice(0, 8);
  return `${REGLES}-${h}`;
}
