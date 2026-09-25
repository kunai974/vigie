// Passages d'audit fabriqués pour les tests de l'outil : un « avant » et un « après » sur une TV et un
// téléphone, avec des images synthétiques (aucune capture réelle) et des constats choisis :
// - « Badges » trop petits sur les deux plateformes (une fiche, deux défauts), corrigés dans l'après ;
// - « Icônes de navigation » qui se chevauchent (TV), toujours là ;
// - « Cœur des favoris » trop petit (téléphone), toujours là ;
// - « Texte d'aide » en contraste insuffisant (téléphone) : faux positif écarté à la relecture ;
// - Haut / Bas qui entre dans la barre latérale (TV, marche à la télécommande) ;
// - après : « Titres » coupés apparaissent sur l'accueil du téléphone, et l'état « clavier » de la
//   Recherche n'est plus atteint (régression).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

function png(file, w, h, color, box) {
  const img = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const inBox = box && x >= box[0] && y >= box[1] && x < box[0] + box[2] && y < box[1] + box[3];
    const c = inBox ? box[4] : color;
    img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
  }
  writeFileSync(file, PNG.sync.write(img));
}

const issue = (rule, selector, message, severity = 'warning', rect = { x: 10, y: 10, w: 40, h: 20 }) => ({ rule, severity, message, selector, rects: [rect] });

/** Un écran mesuré : capture fabriquée dans `dir`. */
function screen(dir, key, id, label, { group, issues = [], walk, w, h, color, box, skipped }) {
  if (skipped) return { id, label, group: group || id, skipped };
  const shot = `${key}-${id}.png`;
  png(path.join(dir, shot), w, h, color, box);
  return { id, label, group: group || id, shot, image: { w, h }, frame: null, metrics: { viewport: `${w} × ${h}` }, issues, ...(walk && { walk, walkIssues: walk.filter((x) => x.severity).length }) };
}

/**
 * Fabrique un passage dans `dir`. `apres` : version corrigée (badges), avec une régression.
 * `extra` : champs ajoutés au rapport (mesure, code).
 */
export function fabrique(dir, { apres = false, at, extra = {} } = {}) {
  mkdirSync(dir, { recursive: true });
  const TV = { w: 640, h: 360 }, PH = { w: 180, h: 390 };
  const badges = (msg) => (apres ? [] : [issue('text-tiny', 'div.meta > span.badge', msg)]);
  const tv = { key: 'tv', title: 'Android TV · Émulateur', screens: [
    screen(dir, 'tv', 'accueil', 'Accueil', { ...TV, color: [20, 20, 30], box: [40, 40, 200, 100, apres ? [90, 90, 160] : [200, 60, 60]],
      issues: [...badges('Texte de 9 px'), issue('overlap', 'nav > button.nav-item', 'Chevauche le logo')] }),
    screen(dir, 'tv', 'recherche', 'Recherche', { ...TV, color: [30, 20, 20], box: [100, 100, 80, 40, [240, 240, 240]],
      walk: [{ key: 'arrivée', to: 'input.champ', zone: 'main', note: '', severity: '' }, { key: 'up', to: 'button.nav-item', zone: 'sidebar', note: 'Haut/Bas entre dans la barre latérale (règle TV)', severity: 'error' }] }),
  ] };
  const phone = { key: 'phone-phone', title: 'Téléphone · Émulateur', screens: [
    screen(dir, 'phone-phone', 'accueil', 'Accueil', { ...PH, color: [10, 30, 10], box: [20, 20, 100, 60, apres ? [60, 60, 200] : [220, 200, 40]],
      issues: [...badges('Texte de 9,5 px'), issue('touch-target', 'div.carte > button.coeur', 'Zone tactile de 25 × 25'),
        ...(apres ? [issue('text-clipped', 'section > h2.titre', 'Titre coupé net')] : [])] }),
    screen(dir, 'phone-phone', 'accueil-vide', 'Accueil · vide', { ...PH, group: 'accueil', color: [10, 30, 10], box: [20, 200, 100, 60, apres ? [60, 60, 200] : [220, 200, 40]],
      issues: [...badges('Texte de 9,5 px'), ...(apres ? [issue('text-clipped', 'section > h2.titre', 'Titre coupé net')] : [])] }),
    screen(dir, 'phone-phone', 'recherche', 'Recherche', { ...PH, color: [40, 10, 40], issues: [issue('axe-color-contrast', 'form > p.aide', 'Contraste 3,9:1')] }),
    screen(dir, 'phone-phone', 'recherche-clavier', 'Recherche · clavier ouvert', apres
      ? { group: 'recherche', skipped: 'le clavier système ne s\'est pas ouvert' }
      : { ...PH, group: 'recherche', color: [40, 10, 40], box: [0, 250, 180, 140, [200, 200, 200]] }),
    screen(dir, 'phone-phone', 'compte', 'Compte', { ...PH, color: [0, 0, 0] }),
  ] };
  const report = { date: at ? new Date(at).toLocaleString('fr-FR') : 'x', at, app: 'Exemple', profile: 'rapide', durationMin: 1, runs: [tv, phone], ...extra };
  writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 1));
  return dir;
}
