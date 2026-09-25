// Planches de relecture pour l'interprète (pas pour la page publiée) : les vignettes de la revue sont
// trop petites pour lire un texte ou juger un détail, et les captures d'origine trop grandes pour être
// regardées une à une. Deux sortes d'images JPEG, dans <passage>/revue/relire/ :
// - une par défaut : la capture qui le montre, zones encadrées, et à côté un agrandissement de ces zones ;
// - une par écran : son état de base à toutes les tailles, côte à côte (défauts que la mesure ne voit pas).
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

const BG = [24, 26, 36];
const RED = [255, 70, 90];

const load = (file) => PNG.sync.read(fs.readFileSync(file));

/** Image RVBA { width, height, data } mise à l'échelle (moyenne des pixels couverts, ou plus proche voisin en agrandissement). */
function scale(src, w) {
  const k = src.width / w;
  const h = Math.max(1, Math.round(src.height / k));
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

function crop(src, x, y, w, h) {
  const data = Buffer.alloc(w * h * 4);
  for (let r = 0; r < h; r++) src.data.copy(data, r * w * 4, ((y + r) * src.width + x) * 4, ((y + r) * src.width + x + w) * 4);
  return { width: w, height: h, data };
}

/** Cadre de `t` pixels (rectangle en pixels de l'image). */
function frame(img, x, y, w, h, t = 3, c = RED) {
  const put = (px, py) => {
    if (px < 0 || py < 0 || px >= img.width || py >= img.height) return;
    const o = (py * img.width + px) * 4;
    img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2];
  };
  for (let i = 0; i < t; i++) {
    for (let px = x; px < x + w; px++) { put(px, y + i); put(px, y + h - 1 - i); }
    for (let py = y; py < y + h; py++) { put(x + i, py); put(x + w - 1 - i, py); }
  }
}

/** Images côte à côte, alignées en haut, sur fond sombre. */
function row(imgs, gap = 12) {
  const W = imgs.reduce((n, i) => n + i.width, 0) + gap * (imgs.length - 1);
  const H = Math.max(...imgs.map((i) => i.height));
  const data = Buffer.alloc(W * H * 4);
  for (let p = 0; p < W * H; p++) { data[p * 4] = BG[0]; data[p * 4 + 1] = BG[1]; data[p * 4 + 2] = BG[2]; data[p * 4 + 3] = 255; }
  let x0 = 0;
  for (const im of imgs) {
    for (let y = 0; y < im.height; y++) im.data.copy(data, (y * W + x0) * 4, y * im.width * 4, (y + 1) * im.width * 4);
    x0 += im.width + gap;
  }
  return { width: W, height: H, data };
}

const save = (file, img) => fs.writeFileSync(file, jpeg.encode(img, 84).data);

/**
 * `data` : données de la revue (plateformes, défauts, comparaison des tailles). Retourne
 * { items: { id: fichier }, screens: [{ kind, label, file }] }, chemins relatifs à `out`.
 */
function buildReadingSheets(src, out, data) {
  const dir = path.join(out, 'relire');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const res = { items: {}, screens: [] };
  for (const p of data.platforms) {
    const overviewW = p.kind === 'phone' ? 420 : 760;
    for (const f of [...p.families, ...p.info]) {
      for (const it of f.items) {
        const ex = it.example;
        if (!ex?.img || !fs.existsSync(path.join(src, `${ex.img}.png`))) continue;
        const shot = load(path.join(src, `${ex.img}.png`));
        const overview = scale(shot, overviewW);
        const k = overview.width / shot.width;
        const boxes = (ex.boxes || []).map(([x, y, w, h]) => [x, y, w, h].map((v, i) => (v / 100) * (i % 2 ? shot.height : shot.width)));
        for (const [x, y, w, h] of boxes) frame(overview, Math.round(x * k), Math.round(y * k), Math.max(6, Math.round(w * k)), Math.max(6, Math.round(h * k)));
        const parts = [overview];
        if (boxes.length) {
          // Zone agrandie : toutes les zones encadrées, avec une marge pour le contexte ; si elles sont
          // éparpillées sur l'écran (agrandir ne servirait à rien), seulement la première.
          const pad = Math.round(shot.width * 0.06);
          const around = (bs) => [
            Math.max(0, Math.floor(Math.min(...bs.map((b) => b[0])) - pad)), Math.max(0, Math.floor(Math.min(...bs.map((b) => b[1])) - pad)),
            Math.min(shot.width, Math.ceil(Math.max(...bs.map((b) => b[0] + b[2])) + pad)), Math.min(shot.height, Math.ceil(Math.max(...bs.map((b) => b[1] + b[3])) + pad)),
          ];
          let [x0, y0, x1, y1] = around(boxes);
          if ((x1 - x0) * (y1 - y0) > 0.4 * shot.width * shot.height) [x0, y0, x1, y1] = around(boxes.slice(0, 1));
          if (x1 - x0 > 8 && y1 - y0 > 8) {
            const zone = crop(shot, x0, y0, x1 - x0, y1 - y0);
            for (const [x, y, w, h] of boxes) frame(zone, Math.round(x - x0), Math.round(y - y0), Math.round(w), Math.round(h), 4);
            // Largeur de lecture : 900 px au plus, et pas plus haute que l'écran réduit à côté.
            const w = Math.min(900, zone.width, Math.round((zone.width * Math.max(overview.height, 600)) / zone.height));
            parts.push(w < zone.width ? scale(zone, w) : zone);
          }
        }
        const file = `relire/${it.id}.jpg`;
        save(path.join(out, file), row(parts));
        res.items[it.id] = file;
      }
    }
    // Chaque écran à toutes les tailles : état de base côte à côte, lisible.
    const cellW = p.kind === 'phone' ? 330 : 560;
    p.compare.forEach((c, i) => {
      const sizes = p.sizes.filter((s) => c.cells[s]?.img && fs.existsSync(path.join(src, `${c.cells[s].img}.png`)));
      if (!sizes.length) return;
      const file = `relire/ecran-${p.kind}-${String(i + 1).padStart(2, '0')}.jpg`;
      const tiles = sizes.map((s) => scale(load(path.join(src, `${c.cells[s].img}.png`)), cellW));
      save(path.join(out, file), row(tiles));
      res.screens.push({ kind: p.kind, label: c.label, sizes, file });
    });
  }
  return res;
}

module.exports = { buildReadingSheets, load, scale, crop, frame, row, save };
