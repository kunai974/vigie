// Images des pages de revue et d'avant / après : réduction des captures et planches d'images.
// Une planche réunit en grille les captures d'une même taille d'écran (8 millions de pixels au plus) ;
// la page les découpe à l'affichage. Quelques fichiers au lieu de centaines : la page se publie en une fois.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

/**
 * Réduction d'une capture à `targetW` de large (moyenne des pixels d'origine couverts par chaque
 * pixel réduit). Retourne { width, height, data } (RVBA).
 */
function shrink(file, targetW) {
  const src = PNG.sync.read(fs.readFileSync(file));
  const f = src.width / targetW;
  const w = Math.min(src.width, targetW), h = Math.max(1, Math.round(src.height / Math.max(1, f)));
  const k = Math.max(1, f);
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * k), y1 = Math.min(src.height, Math.max(y0 + 1, Math.floor((y + 1) * k)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * k), x1 = Math.min(src.width, Math.max(x0 + 1, Math.floor((x + 1) * k)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * src.width + xx) * 4;
        r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; n++;
      }
      const o = (y * w + x) * 4;
      data[o] = r / n; data[o + 1] = g / n; data[o + 2] = b / n; data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Part des pixels nettement différents entre deux images réduites, en % (100 si tailles différentes). */
function pixelDiff(a, b) {
  if (a.width !== b.width || a.height !== b.height) return 100;
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 48) n++;
  }
  return +((n / (a.width * a.height)) * 100).toFixed(1);
}

/**
 * Banque d'images d'un passage : chaque capture n'est réduite qu'une fois, puis gardée dans
 * <passage>/.images/ (hors du dossier publié). La revue et chaque avant / après qui s'en sert (le même
 * « avant » peut servir à plusieurs lots) relisent la même image réduite au lieu de la refaire.
 */
function shrinkCached(passDir, shot, targetW) {
  const dir = path.join(passDir, '.images');
  const file = path.join(dir, `${path.basename(shot, '.png')}-${targetW}.png`);
  const src = path.join(passDir, shot);
  if (fs.existsSync(file) && fs.statSync(file).mtimeMs >= fs.statSync(src).mtimeMs) {
    const png = PNG.sync.read(fs.readFileSync(file));
    return { width: png.width, height: png.height, data: png.data };
  }
  const img = shrink(src, targetW);
  fs.mkdirSync(dir, { recursive: true });
  const png = new PNG({ width: img.width, height: img.height });
  img.data.copy(png.data);
  fs.writeFileSync(file, PNG.sync.write(png));
  return img;
}

/** Largeur des images réduites : 300 px pour un écran en hauteur (téléphone, web mobile), 640 sinon. */
const thumbWidth = (kind, s) => (kind === 'phone' || (s?.image && s.image.h > s.image.w) ? 300 : 640);

const SHEET_MAX_PX = 8e6;

/**
 * Planches d'images. `entries` : [nom, image, clé de planche]. Écrit <dir>/<clé>(-n).jpg et retourne
 * { IMG: { nom: { f: 'img/<fichier>', x, y, w, h, W, H } }, sheets: [{ key, file }] } ; `prefix` : dossier
 * des planches tel que la page l'appelle.
 */
function packSheets(entries, dir, prefix = 'img/') {
  const IMG = {};
  const sheets = [];
  const byKey = {};
  for (const [name, img, key] of entries) (byKey[key] || (byKey[key] = [])).push([name, img]);
  for (const [key, list] of Object.entries(byKey)) {
    const cellW = Math.max(...list.map(([, im]) => im.width));
    const cols = Math.max(1, Math.min(6, Math.floor(2400 / cellW)));
    let part = [];
    const flush = () => {
      if (!part.length) return;
      const rows = [];
      for (let i = 0; i < part.length; i += cols) rows.push(part.slice(i, i + cols));
      const heights = rows.map((r) => Math.max(...r.map(([, im]) => im.height)));
      const W = cellW * Math.min(cols, part.length), H = heights.reduce((a, b) => a + b, 0);
      const buf = Buffer.alloc(W * H * 4, 255);
      const n = sheets.filter((s) => s.key === key).length;
      const file = `${key}${n ? `-${n + 1}` : ''}.jpg`;
      let y0 = 0;
      rows.forEach((r, ri) => {
        r.forEach(([name, im], ci) => {
          const x0 = ci * cellW;
          for (let y = 0; y < im.height; y++) im.data.copy(buf, ((y0 + y) * W + x0) * 4, y * im.width * 4, (y + 1) * im.width * 4);
          IMG[name] = { f: `${prefix}${file}`, x: x0, y: y0, w: im.width, h: im.height, W, H };
        });
        y0 += heights[ri];
      });
      fs.writeFileSync(path.join(dir, file), jpeg.encode({ width: W, height: H, data: buf }, 78).data);
      sheets.push({ key, file });
      part = [];
    };
    let px = 0;
    for (const entry of list) {
      const size = cellW * entry[1].height;
      if (px + size > SHEET_MAX_PX) { flush(); px = 0; }
      part.push(entry);
      px += size;
    }
    flush();
  }
  return { IMG, sheets };
}

/**
 * Empreinte d'une image réduite (niveaux de gris) pour repérer les doublons. Grille plus fine sur les
 * grandes images (96 colonnes au lieu de 48) : en 1920 × 1080, « Live TV vide » et « Live TV en
 * erreur » (petit message au centre d'un grand écran sombre) tombaient dans les mêmes cases (23/09).
 */
function signature(img) {
  const cols = img.width >= 600 ? 96 : 48, rows = Math.max(1, Math.round((img.height / img.width) * cols));
  const out = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let s = 0, n = 0;
    for (let y = Math.floor((r * img.height) / rows); y < Math.floor(((r + 1) * img.height) / rows); y++) {
      for (let x = Math.floor((c * img.width) / cols); x < Math.floor(((c + 1) * img.width) / cols); x++) {
        const i = (y * img.width + x) * 4;
        s += img.data[i] * 0.3 + img.data[i + 1] * 0.59 + img.data[i + 2] * 0.11; n++;
      }
    }
    out[r * cols + c] = n ? s / n : 0;
  }
  return { w: img.width, h: img.height, v: out };
}

/**
 * Même image, au contenu vivant près : même taille réduite, écart moyen infime, et presque aucune zone
 * vraiment différente (un message d'erreur à la place d'un message « vide » suffit à les distinguer).
 * Tolérance : quelques zones, pour l'heure ou une vignette qui change.
 */
function sameImage(a, b) {
  if (a.w !== b.w || Math.abs(a.h - b.h) > 2 || a.v.length !== b.v.length) return false;
  let d = 0, strong = 0;
  for (let i = 0; i < a.v.length; i++) {
    const x = Math.abs(a.v[i] - b.v[i]);
    d += x;
    if (x > 10) strong++;
  }
  return d / a.v.length < 1.5 && strong <= 3;
}

module.exports = { thumbWidth, shrink, shrinkCached, pixelDiff, packSheets, signature, sameImage };
