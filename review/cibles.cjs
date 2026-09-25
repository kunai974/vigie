// Fiches des défauts visés par un avant / après (un lot) : pour chaque défaut, la capture « avant » avec
// le défaut encadré, la même capture « après » avec la même zone, un agrandissement de la zone des deux
// côtés, le souci d'origine, ce qui a été changé, et le verdict. Images nettes (pleine résolution
// réduite au besoin, JPEG de bonne qualité), un fichier par image : c'est ce que la personne doit juger
// (demande de l'utilisateur, 23/09 : planches trop compressées, défaut initial introuvable).
const fs = require('fs');
const path = require('path');
const { load, scale, crop, frame, save } = require('./relire.cjs');

const RED = [255, 70, 90];
const GREEN = [70, 220, 120];
const walkRule = (w) => (/sort de l'écran/.test(w.note) ? 'walk-offscreen' : /perdu/.test(w.note) ? 'walk-lost' : /barre latérale/.test(w.note) ? 'walk-sidebar' : 'focus-invisible');
const elOf = (sel) => {
  const last = (sel || '').split(' > ').slice(-1)[0];
  if (last.startsWith('#') || !last.includes('.')) return last;
  const [tag, first] = last.split('.');
  return `${tag}.${first}`;
};

/** Cadres (pixels de la capture) d'un défaut sur une capture : constats mesurés de même règle et élément. */
function rectsOn(s, it) {
  if (!s || s.skipped || s.failed || !s.metrics) return null;
  const issues = [...(s.issues || []), ...(s.walk || []).filter((w) => w.severity).map((w) => ({ rule: walkRule(w), selector: w.to, message: `Touche ${w.key} : ${w.note}`, rects: [] }))]
    .filter((i) => i.rule === it.rule && elOf(i.selector) === it.el);
  if (!issues.length) return null;
  const [vw, vh] = s.metrics.viewport.split(' × ').map(Number);
  const f = s.frame || { x: 0, y: 0, w: s.image.w, h: s.image.h };
  const px = (rc) => [f.x + (rc.x * f.w) / vw, f.y + (rc.y * f.h) / vh, (rc.w * f.w) / vw, (rc.h * f.h) / vh];
  return { issues, boxes: issues.flatMap((i) => (i.rects || (i.rect ? [i.rect] : [])).filter((r) => r.w > 0).slice(0, 6).map(px)) };
}

/** Écran où montrer le défaut : dans le passage avant, présent aussi dans le passage après. */
function findShot(ra, rb, it, interpA) {
  if (it.rule === 'visual') {
    const m = (interpA.constats || []).find((c) => c.kind === it.kind && c.el === it.el);
    if (!m) return null;
    const run = ra.runs.find((r) => r.key === m.shot.run);
    const s = run?.screens.find((x) => x.id === m.shot.id);
    if (!s?.image) return null;
    return { run: run.key, id: s.id, label: s.label, boxes: (m.boxes || []).map(([x, y, w, h]) => [(x / 100) * s.image.w, (y / 100) * s.image.h, (w / 100) * s.image.w, (h / 100) * s.image.h]), messages: [m.message] };
  }
  // État « après » non atteint (ex. plus rien à dérouler) : la capture « avant » reste la bonne, et l'après
  // montre l'écran d'origine du même groupe (tour de sortie du 24/09, point 29 : la fiche disait « aucune
  // capture du défaut dans le passage de départ », ce qui était faux).
  let fallback = null;
  for (const run of ra.runs.filter((r) => r.key.split('-')[0] === it.kind)) {
    const runB = rb.runs.find((r) => r.key === run.key);
    for (const s of run.screens) {
      const found = rectsOn(s, it);
      if (!found) continue;
      const shot = { run: run.key, id: s.id, label: s.label, boxes: found.boxes, messages: [...new Set(found.issues.map((i) => i.message))] };
      const sb = runB?.screens.find((x) => x.id === s.id);
      if (runB && sb && !sb.skipped && !sb.failed) return shot;
      const group = s.group || s.id;
      const alt = runB?.screens.filter((x) => (x.group || x.id) === group && !x.skipped && !x.failed && x.shot).sort((a, b) => Number(b.id === group) - Number(a.id === group))[0];
      if (!fallback && alt) fallback = { ...shot, afterId: alt.id, afterLabel: alt.label };
    }
  }
  return fallback;
}

/** Zone agrandie : les cadres et une marge, dans les limites de l'image. */
function zoneOf(boxes, W, H) {
  if (!boxes.length) return null;
  const pad = Math.round(W * 0.05);
  const x0 = Math.max(0, Math.floor(Math.min(...boxes.map((b) => b[0])) - pad)), y0 = Math.max(0, Math.floor(Math.min(...boxes.map((b) => b[1])) - pad));
  const x1 = Math.min(W, Math.ceil(Math.max(...boxes.map((b) => b[0] + b[2])) + pad)), y1 = Math.min(H, Math.ceil(Math.max(...boxes.map((b) => b[1] + b[3])) + pad));
  return x1 - x0 > 8 && y1 - y0 > 8 ? [x0, y0, x1 - x0, y1 - y0] : null;
}

/** Image de la capture, cadres dessinés, réduite à `maxW` ; agrandissement de la zone à côté. */
function render(file, boxes, color, zone, outBase) {
  const shot = load(file);
  const maxW = shot.height > shot.width ? 540 : 1280;
  const full = shot.width > maxW ? scale(shot, maxW) : { width: shot.width, height: shot.height, data: Buffer.from(shot.data) };
  const k = full.width / shot.width;
  const t = Math.max(3, Math.round(full.width / 320));
  for (const [x, y, w, h] of boxes) frame(full, Math.round(x * k), Math.round(y * k), Math.max(8, Math.round(w * k)), Math.max(8, Math.round(h * k)), t, color);
  save(`${outBase}.jpg`, full);
  if (!zone) return { full: `${path.basename(outBase)}.jpg` };
  const [x0, y0, w0, h0] = zone;
  const z = crop(shot, x0, y0, w0, h0);
  for (const [x, y, w, h] of boxes) frame(z, Math.round(x - x0), Math.round(y - y0), Math.round(w), Math.round(h), 4, color);
  const zw = Math.min(900, Math.max(z.width, 420));
  save(`${outBase}-zoom.jpg`, z.width === zw ? z : scale(z, zw));
  return { full: `${path.basename(outBase)}.jpg`, zoom: `${path.basename(outBase)}-zoom.jpg` };
}

/**
 * Fiches des défauts visés. `targets` : sortie de compare (id, name, kind, status, oeil) ; `reg` : registre ;
 * `dirs` : { A, B, out } ; `texts` : { avis: id → texte, corrections: id → texte }. Écrit les images
 * dans out/cibles/ et retourne les fiches (chemins d'images relatifs à la page).
 */
function targetCards({ targets, reg, ra, rb, dirs, interpA, texts, cfg, sizeLabel }) {
  const dir = path.join(dirs.out, 'cibles');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return targets.map((t) => {
    const it = reg.items[t.id];
    const card = { ...t, avis: texts.avis[t.id] || null, reco: texts.reco[t.id] || null, correction: texts.corrections[t.id] || null };
    const shot = it && findShot(ra, rb, it, interpA);
    if (!shot) return { ...card, why: 'aucune capture du défaut dans le passage de départ' };
    Object.assign(card, { screen: shot.label, size: sizeLabel(shot.run), before: shot.messages });
    if (cfg.SENSITIVE.test(shot.id)) return { ...card, why: 'zone sensible : pas d\'image' };
    const sa = ra.runs.find((r) => r.key === shot.run).screens.find((x) => x.id === shot.id);
    const sb = rb.runs.find((r) => r.key === shot.run).screens.find((x) => x.id === (shot.afterId || shot.id));
    if (shot.afterId) card.afterScreen = shot.afterLabel;
    const fa = path.join(dirs.A, sa.shot), fb = path.join(dirs.B, sb.shot);
    if (!fs.existsSync(fa) || !fs.existsSync(fb)) return { ...card, why: 'capture introuvable' };
    // Après : le défaut encore relevé (cadres rouges), sinon la même zone qu'avant (cadres verts).
    const still = it.rule !== 'visual' && rectsOn(sb, it);
    card.after = still ? [...new Set(still.issues.map((i) => i.message))] : [];
    // Écran d'origine montré à la place d'un état perdu : pas de cadre vert tant que rien n'est constaté.
    const boxesB = still ? still.boxes : shot.afterId && t.status !== 'corrige' ? [] : shot.boxes;
    const zone = zoneOf([...shot.boxes, ...(still ? still.boxes : [])], sa.image.w, sa.image.h);
    card.img = {
      avant: render(fa, shot.boxes, RED, zone, path.join(dir, `${t.id}-avant`)),
      apres: render(fb, boxesB, still ? RED : GREEN, zone, path.join(dir, `${t.id}-apres`)),
    };
    for (const side of Object.values(card.img)) for (const k of Object.keys(side)) side[k] = `cibles/${side[k]}`;
    return card;
  });
}

module.exports = { targetCards };
