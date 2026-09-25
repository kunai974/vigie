// Zones sensibles : éléments que l'app déclare (MASK dans sa personnalisation : e-mail affiché, nom,
// solde, identifiant de source…), noircis dans chaque capture juste après la prise de vue, sur toutes
// les plateformes. La capture n'est jamais gardée en clair : rapport brut, revue, avant / après et
// planches de relecture partent tous du fichier masqué. Pour un écran entier à ne jamais montrer :
// SENSITIVE dans les réglages de revue (review.cjs).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
export const MASK_COLOR = [24, 26, 36];

/**
 * Exécuté dans la page : cadres (pixels CSS, zone visible) des éléments affichés qui correspondent aux
 * entrées de MASK, avec les dimensions de la page. Une entrée : un sélecteur, ou { selector, pattern }
 * pour ne masquer que les éléments dont le texte (ou la valeur d'un champ) correspond au motif (ex.
 * « @ » : une description qui affiche un e-mail, pas les autres). Un champ masqué l'est en entier.
 */
export function sensitiveRects(entries) {
  const out = [];
  for (const entry of entries) {
    const sel = typeof entry === 'string' ? entry : entry.selector;
    const re = typeof entry === 'string' || !entry.pattern ? null : new RegExp(entry.pattern, 'i');
    let list = [];
    try { list = [...document.querySelectorAll(sel)]; } catch { continue; } // sélecteur invalide : ignoré
    for (const el of list) {
      if (re && !re.test(el.value ?? el.textContent ?? '')) continue;
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (r.width < 1 || r.height < 1 || st.visibility === 'hidden' || st.display === 'none') continue;
      if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) continue;
      out.push({ x: r.left, y: r.top, w: r.width, h: r.height, sel });
    }
  }
  return { rects: out, vw: innerWidth, vh: innerHeight };
}

/**
 * Noircit les cadres dans la capture `file`. `frame` : place de la page dans la capture (Android : la
 * WebView n'occupe pas tout l'écran), sinon la capture est la page entière. Marge de 3 pixels CSS.
 * Retourne le nombre de zones masquées.
 */
export function maskRects(file, { rects, vw, vh }, frame = null) {
  if (!rects.length) return 0;
  const png = PNG.sync.read(readFileSync(file));
  const f = frame || { x: 0, y: 0, w: png.width, h: png.height };
  const kx = f.w / vw, ky = f.h / vh;
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(f.x + (r.x - 3) * kx)), y0 = Math.max(0, Math.floor(f.y + (r.y - 3) * ky));
    const x1 = Math.min(png.width, Math.ceil(f.x + (r.x + r.w + 3) * kx)), y1 = Math.min(png.height, Math.ceil(f.y + (r.y + r.h + 3) * ky));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * png.width + x) * 4;
        png.data[i] = MASK_COLOR[0]; png.data[i + 1] = MASK_COLOR[1]; png.data[i + 2] = MASK_COLOR[2]; png.data[i + 3] = 255;
      }
    }
  }
  writeFileSync(file, PNG.sync.write(png));
  return rects.length;
}
