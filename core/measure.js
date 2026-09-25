/**
 * Cœur de mesure générique, exécuté DANS la page (page.evaluate). Ne connaît aucune app.
 * Autonome : aucune variable extérieure, Playwright envoie le texte de la fonction.
 *
 * Retourne { metrics, issues[] }. Chaque défaut : { rule, severity, message, selector, rect }
 * avec rect en pixels CSS de la fenêtre (x, y, w, h), pour l'encadrer sur la capture.
 * Gravités : 'error' (visible et gênant), 'warning' (probable), 'info' (à regarder).
 */
export function measurePage(opts) {
  // touchMin : taille tactile minimale (0 = pas de contrôle, pour la TV et la souris).
  // checkFocus : contrôler le liseré du focus (clavier, télécommande ; pas au toucher).
  // minTextPx : taille de texte minimale à l'écran. sizeRules : [{ selector, label, minW, maxW }].
  const o = Object.assign({ touchMin: 0, expectFocus: false, checkFocus: true, minTextPx: 10, sizeRules: [], popups: [], atScrollEnd: false, maxIssuesPerRule: 25 }, opts);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const issues = [];

  // ---- Outils ----
  const shortSel = (el) => {
    if (!el || el === document.body) return 'body';
    const parts = [];
    let cur = el;
    for (let i = 0; cur && cur !== document.body && i < 4; i++) {
      let p = cur.tagName.toLowerCase();
      const cls = [...cur.classList].filter((c) => !/^(active|focused|visible|is-)/.test(c)).slice(0, 2);
      if (cls.length) p += '.' + cls.join('.');
      parts.unshift(p);
      if (cur.id) { parts[0] = '#' + cur.id; break; }
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  };
  const rectOf = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  const add = (rule, severity, message, el, rect) => {
    issues.push({ rule, severity, message, selector: shortSel(el), rect: rect || (el ? rectOf(el.getBoundingClientRect()) : null) });
  };
  const styleCache = new Map();
  const cs = (el) => { let s = styleCache.get(el); if (!s) { s = getComputedStyle(el); styleCache.set(el, s); } return s; };
  const isShown = (el) => {
    for (let cur = el; cur && cur !== document.documentElement; cur = cur.parentElement) {
      const s = cs(cur);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const inViewport = (r) => r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh;
  const scrollsX = (s) => /(auto|scroll)/.test(s.overflowX);
  const clipsX = (s) => /(hidden|clip|auto|scroll)/.test(s.overflowX);
  const clipsY = (s) => /(hidden|clip|auto|scroll)/.test(s.overflowY);
  // Barre fixe ou en-tête collant (sticky) : le contenu défile dessous par conception.
  // Seules les barres comptent : un conteneur fixe qui couvre la moitié de l'écran ou plus (l'app entière
  // sur téléphone, une fiche) n'en est pas une.
  const inFixedEl = (el) => {
    for (let cur = el; cur && cur !== document.body; cur = cur.parentElement) {
      if (!/^(fixed|sticky)$/.test(cs(cur).position)) continue;
      const r = cur.getBoundingClientRect();
      if (r.width * r.height < 0.5 * vw * vh) return true;
    }
    return false;
  };
  // Menu, liste déroulante ou fenêtre ouverts : ils recouvrent ce qui est dessous, c'est leur rôle.
  // Menus et fenêtres : rôles ARIA, et sélecteurs déclarés par l'app pour ceux qui n'en ont pas (POPUPS).
  const popupSel = ['[role="listbox"]', '[role="menu"]', '[role="dialog"]', '[aria-modal="true"]', ...o.popups].join(', ');
  const menuSel = ['[role="listbox"]', '[role="menu"]', ...o.popups].join(', ');
  const inPopup = (el) => !!el.closest(popupSel);
  // Menu ou liste déroulante seulement (une fenêtre `dialog` plein écran, elle, est un calque).
  const inMenu = (el) => !!el.closest(menuSel);
  const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';

  // Rectangle réellement visible d'un élément : coupé par les ancêtres qui rognent, puis par l'écran.
  const visibleRect = (el, extra = 0) => {
    const r = el.getBoundingClientRect();
    let box = { l: r.left - extra, t: r.top - extra, r: r.right + extra, b: r.bottom + extra };
    for (let cur = el.parentElement; cur && cur !== document.documentElement; cur = cur.parentElement) {
      const s = cs(cur);
      if (s.position === 'fixed') break;
      if (clipsX(s) || clipsY(s)) {
        const a = cur.getBoundingClientRect();
        if (clipsX(s)) { box.l = Math.max(box.l, a.left); box.r = Math.min(box.r, a.right); }
        if (clipsY(s)) { box.t = Math.max(box.t, a.top); box.b = Math.min(box.b, a.bottom); }
      }
    }
    box = { l: Math.max(box.l, 0), t: Math.max(box.t, 0), r: Math.min(box.r, vw), b: Math.min(box.b, vh) };
    return { full: { l: r.left - extra, t: r.top - extra, r: r.right + extra, b: r.bottom + extra }, box };
  };

  // Calques plein écran (fiche, fenêtre, feuille) : ce qu'ils recouvrent n'est pas « à l'écran ».
  // Un calque = élément fixe ou absolu qui couvre au moins 70 % de la fenêtre et qui est au premier
  // plan sur au moins 60 % des 16 points sondés (un fond d'écran fixe n'est jamais retenu).
  const hits = new Map();
  for (let gx = 1; gx < 5; gx++) {
    for (let gy = 1; gy < 5; gy++) {
      const seen = new Set();
      // Sous un menu ouvert (liste déroulante qui couvre une bonne part d'un petit écran) : c'est le
      // calque d'en dessous qui compte, sinon la fiche n'est plus reconnue comme calque.
      const start = document.elementsFromPoint((vw * gx) / 5, (vh * gy) / 5).find((e) => !inMenu(e));
      for (let cur = start; cur && cur !== document.body; cur = cur.parentElement) {
        const s = getComputedStyle(cur);
        if (s.position !== 'fixed' && s.position !== 'absolute') continue;
        const r = cur.getBoundingClientRect();
        if (r.width * r.height >= 0.7 * vw * vh && !seen.has(cur)) { seen.add(cur); hits.set(cur, (hits.get(cur) || 0) + 1); }
      }
    }
  }
  // Parmi les calques dominants, le plus englobant (la racine de la fiche ou de la fenêtre).
  const dominant = [...hits].filter(([, n]) => n >= 10).map(([l]) => l);
  const topLayer = dominant.find((l) => !dominant.some((o) => o !== l && o.contains(l))) || null;
  const behindLayer = (el) => topLayer && !topLayer.contains(el) && !el.contains(topLayer) && cs(el).position !== 'fixed';

  const all = [...document.body.querySelectorAll('*')].filter((el) => !['SCRIPT', 'STYLE', 'svg', 'path', 'BR'].includes(el.tagName) && !el.closest('svg') && isShown(el) && !behindLayer(el));

  // ---- 1. Débordement horizontal de la page ----
  const se = document.scrollingElement || document.documentElement;
  // Navigateur mobile : une page plus large que l'écran élargit la zone d'affichage (l'appareil dézoome
  // pour tout montrer) ; la page paraît alors tenir. On compare aussi à la largeur réelle de l'écran
  // (vu le 23/09 en mode web : bandeau de 520 px sur un téléphone de 360, non signalé). La largeur
  // attendue est celle que la page déclare (balise viewport) : « device-width » = l'écran, un nombre =
  // une toile voulue (TV : toile de 1280 mise à l'échelle), pas de balise = page de bureau, pas de contrôle.
  const metaVp = document.querySelector('meta[name="viewport"]')?.content || '';
  const declaredW = /width\s*=\s*(\d+)/.exec(metaVp)?.[1];
  const expectedW = declaredW ? Number(declaredW) : /device-width/.test(metaVp) ? window.screen?.width || 0 : 0;
  const widened = expectedW > 0 && vw > expectedW + 1;
  const limit = widened ? expectedW : vw;
  if (se.scrollWidth > vw + 1 || widened) {
    add('page-overflow-x', 'error', `La page défile en largeur : ${Math.max(se.scrollWidth, vw)} px de contenu pour ${limit} px d'écran`, document.body, { x: 0, y: 0, w: vw, h: vh });
  }
  // Éléments qui sortent de l'écran sur le côté, hors conteneurs qui défilent ou rognent exprès.
  const offenders = [];
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.right <= limit + 1 && r.left >= -1) continue;
    let tolerated = false;
    for (let cur = el.parentElement; cur && cur !== document.body; cur = cur.parentElement) {
      const s = cs(cur);
      if (scrollsX(s) || clipsX(s) || s.position === 'fixed') { tolerated = true; break; }
    }
    if (tolerated || cs(el).position === 'fixed') continue;
    if (offenders.some((p) => p.contains(el))) continue;
    offenders.push(el);
  }
  for (const el of offenders) add('offscreen-x', 'error', 'Dépasse du bord de l\'écran', el);

  // ---- 2. Textes coupés, tronqués ou qui débordent ----
  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
  for (const el of all) {
    if (!hasOwnText(el)) continue;
    const s = cs(el);
    const r = el.getBoundingClientRect();
    if (!inViewport(r)) continue;
    const overX = el.scrollWidth - el.clientWidth > 1 && el.clientWidth > 0;
    const overY = el.scrollHeight - el.clientHeight > 2 && el.clientHeight > 0 && !scrollsX(s) && !/(auto|scroll)/.test(s.overflowY);
    if (!overX && !overY) continue;
    // Ce qui déborde doit être le texte lui-même : une marge tactile invisible (pseudo-élément en
    // position absolue qui dépasse exprès du bouton) agrandit aussi la zone défilable (faux positif de
    // l'épreuve du 23/09, bouton « Lecture »). Texte entièrement dans la boîte : pas de débordement.
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((t) => t.width > 0);
    const inside = rects.every((t) => t.left >= r.left - 1 && t.right <= r.right + 1 && t.top >= r.top - 1 && t.bottom <= r.bottom + 1);
    const clamped = s.textOverflow === 'ellipsis' || (s.webkitLineClamp && s.webkitLineClamp !== 'none');
    if (inside && !clamped && !(clipsX(s) || clipsY(s))) continue;
    // Raccourci par « … » seulement si du texte est vraiment caché : la fin d'une ligne hors du cadre, ou
    // une ligne dont moins de la moitié se voit. Un texte limité en lignes qui tient en entier, avec une
    // marge sous les lettres qui agrandit la zone défilable, n'est pas raccourci (tour de sortie du
    // 24/09, point 24 : titre d'accueil de l'app d'essai).
    const hidden = rects.some((t) => t.right > r.right + 1 || t.left < r.left - 1 || Math.min(t.bottom, r.bottom) - Math.max(t.top, r.top) < t.height / 2);
    if (clamped) { if (hidden) add('text-ellipsis', 'info', 'Texte raccourci par « … »', el); }
    else if (clipsX(s) || clipsY(s)) add('text-clipped', 'warning', 'Texte coupé net par son cadre', el);
    else add('text-overflow', 'warning', 'Texte qui dépasse de son cadre', el);
  }

  // ---- 2 bis. Petits cadres de texte qui défilent (synopsis) : invisibles pour les règles ci-dessus,
  // qui écartent les conteneurs à défilement. Deux constats : texte caché sous un fondu (à trancher),
  // ligne coupée en deux par le bord du cadre (visible). ----
  const hasGradientMask = (s) => /gradient/.test(s.maskImage || '') || /gradient/.test(s.webkitMaskImage || '');
  for (const box of all) {
    const s = cs(box);
    if (!/(auto|scroll)/.test(s.overflowY) || box.scrollHeight - box.clientHeight < 3) continue;
    const r = box.getBoundingClientRect();
    if (!inViewport(r) || r.height > vh * 0.4 || r.height < 12) continue;
    const texts = [...box.querySelectorAll('*')].filter((el) => hasOwnText(el) && el.getBoundingClientRect().height > 0);
    if (!texts.length) continue;
    // Seulement un bloc de texte : une liste (menu, catégories) qui défile sous un fondu, avec un élément
    // à moitié visible au bord, invite à défiler ; c'est voulu.
    if (inPopup(box) || box.querySelector(`${INTERACTIVE}, [role="option"], li`)) continue;
    const hidden = box.scrollHeight - box.clientHeight - box.scrollTop;
    if (hasGradientMask(s) && hidden > 2) {
      add('text-faded', 'warning', `Texte masqué par un fondu : ${Math.round(hidden)} px à faire défiler dans un cadre de ${Math.round(r.height)} px`, box);
    }
    // Ligne coupée : la première ligne visible commence au-dessus du cadre sans en être sortie.
    for (const t of texts) {
      const lh = parseFloat(cs(t).lineHeight) || parseFloat(cs(t).fontSize) * 1.3;
      const tr = t.getBoundingClientRect();
      const cutTop = r.top - tr.top;
      if (cutTop > 0 && tr.bottom > r.top) {
        const partial = cutTop % lh;
        if (partial > 3 && partial < lh - 3) { add('text-line-cut', 'error', `Ligne de texte coupée par le haut du cadre (${Math.round(partial)} px sur ${Math.round(lh)})`, t, rectOf(r)); break; }
      }
      const cutBottom = tr.bottom - r.bottom;
      if (!hasGradientMask(s) && cutBottom > 0 && tr.top < r.bottom) {
        const partial = (r.bottom - tr.top) % lh;
        if (partial > 3 && partial < lh - 3) { add('text-line-cut', 'error', `Ligne de texte coupée par le bas du cadre (${Math.round(partial)} px sur ${Math.round(lh)})`, t, rectOf(r)); break; }
      }
    }
  }

  // Taille réelle du texte à l'écran : taille de police × mise à l'échelle (transform, zoom).
  for (const el of all) {
    if (!hasOwnText(el)) continue;
    const r = el.getBoundingClientRect();
    if (!inViewport(r) || !el.offsetHeight) continue;
    const scale = r.height / el.offsetHeight;
    const px = parseFloat(cs(el).fontSize) * scale;
    if (px < o.minTextPx) add('text-tiny', 'error', `Texte illisible : ${px.toFixed(1)} px à l'écran (police ${cs(el).fontSize}${scale < 0.95 ? `, réduite ×${scale.toFixed(2)}` : ''})`, el);
  }

  // Tailles encadrées (règle fournie par l'app) : ex. cartes de grille entre 92 et 150 px de large.
  for (const rule of o.sizeRules) {
    const els = [...document.querySelectorAll(rule.selector)].filter((el) => isShown(el) && !behindLayer(el));
    for (const el of els) {
      const w = el.getBoundingClientRect().width;
      if ((rule.minW && w < rule.minW - 0.5) || (rule.maxW && w > rule.maxW + 0.5)) {
        add('size-bounds', 'warning', `${rule.label} : ${Math.round(w)} px de large (attendu ${rule.minW ?? 0} à ${rule.maxW ?? '∞'})`, el);
      }
    }
  }

  // Zone qui réagit au doigt : la boîte de l'élément, agrandie par une « marge tactile invisible »
  // (pseudo-élément ::before / ::after en position absolue qui déborde de la boîte, sans changer le
  // dessin) ; pour une case à cocher, l'étiquette cliquable qui la contient ou la désigne.
  const touchArea = (el, full) => {
    let w = full.width, h = full.height;
    for (const pseudo of ['::before', '::after']) {
      const p = getComputedStyle(el, pseudo);
      if (p.content === 'none' || p.content === 'normal' || p.position !== 'absolute' || p.pointerEvents === 'none') continue;
      const px = (v) => (/px$/.test(v) ? parseFloat(v) : 0);
      const pw = parseFloat(p.width) || w - px(p.left) - px(p.right);
      const ph = parseFloat(p.height) || h - px(p.top) - px(p.bottom);
      w = Math.max(w, pw);
      h = Math.max(h, ph);
    }
    if (el.tagName === 'INPUT' && /^(checkbox|radio)$/.test(el.type)) {
      const label = el.closest('label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
      if (label) { const r = label.getBoundingClientRect(); w = Math.max(w, r.width); h = Math.max(h, r.height); }
    }
    return { w, h };
  };

  // ---- 3. Éléments cliquables : chevauchement, masquage, taille ----
  const inter = all.filter((el) => el.matches(INTERACTIVE) && !el.disabled && el.getAttribute('aria-hidden') !== 'true');
  // Bouton posé dans un champ de saisie (afficher le mot de passe, effacer, loupe) : entièrement contenu
  // dans la boîte du champ, c'est un ornement voulu, pas un chevauchement (faux positif du 23/09).
  const adornment = (field, btn) => /^(INPUT|TEXTAREA)$/.test(field.el.tagName) && btn.el.tagName !== 'INPUT'
    && btn.r.left >= field.r.left - 2 && btn.r.right <= field.r.right + 2 && btn.r.top >= field.r.top - 2 && btn.r.bottom <= field.r.bottom + 2;
  // Élément dans une barre fixe (navigation flottante) : le contenu défile dessous par conception.
  const inFixed = inFixedEl;
  // Seule la partie réellement visible compte : un élément sorti de la zone visible de sa liste (rogné
  // par un conteneur qui défile) n'est ni « recouvert » ni « chevauché ».
  const vis = inter.map((el) => {
    const { box } = visibleRect(el);
    if (box.r - box.l < 4 || box.b - box.t < 4) return null;
    const r = { left: box.l, top: box.t, right: box.r, bottom: box.b, width: box.r - box.l, height: box.b - box.t };
    return { el, r, full: el.getBoundingClientRect(), fixed: inFixed(el) };
  }).filter(Boolean);
  for (let i = 0; i < vis.length; i++) {
    for (let j = i + 1; j < vis.length; j++) {
      const a = vis[i], b = vis[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (a.fixed !== b.fixed || inPopup(a.el) !== inPopup(b.el)) continue;
      if (adornment(a, b) || adornment(b, a)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w <= 2 || h <= 2) continue;
      const small = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
      if ((w * h) / small > 0.25) add('overlap', 'warning', `Chevauche un autre élément cliquable (${shortSel(b.el)})`, a.el);
    }
  }
  // Barre fixe écrasée (fenêtre réduite par le clavier, écran moins haut) : un bouton qui chevauche le
  // logo ou une image de la même barre.
  const pics = all.filter((el) => /^(IMG|svg)$/.test(el.tagName) && !el.closest(INTERACTIVE) && inFixedEl(el) && isShown(el));
  for (const a of vis.filter((v) => v.fixed)) {
    for (const p of pics) {
      const pr = p.getBoundingClientRect();
      const w = Math.min(a.r.right, pr.right) - Math.max(a.r.left, pr.left);
      const h = Math.min(a.r.bottom, pr.bottom) - Math.max(a.r.top, pr.top);
      if (w <= 2 || h <= 2) continue;
      if ((w * h) / Math.min(a.r.width * a.r.height, pr.width * pr.height) > 0.25) add('overlap', 'warning', `Chevauche une image de la barre (${shortSel(p)})`, a.el);
    }
  }
  for (const { el, r, full, fixed } of vis) {
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx >= vw || cy >= vh) continue;
    const top = document.elementFromPoint(cx, cy);
    if (top && top !== el && !el.contains(top) && !top.contains(el) && (fixed || !inFixed(top)) && !inPopup(top)) add('covered', 'warning', `Recouvert par ${shortSel(top)}`, el);
    if (o.touchMin) {
      const hit = touchArea(el, full);
      if (hit.w < o.touchMin - 0.5 || hit.h < o.touchMin - 0.5) {
        add('touch-target', 'warning', `Zone tactile de ${Math.round(hit.w)} × ${Math.round(hit.h)} px (minimum ${o.touchMin})`, el);
      }
    }
  }

  // ---- 4. Images ----
  const dpr = window.devicePixelRatio || 1;
  let imageBytesHint = 0;
  for (const img of all.filter((el) => el.tagName === 'IMG')) {
    const r = img.getBoundingClientRect();
    if (img.complete && img.naturalWidth === 0 && img.currentSrc) add('image-broken', 'warning', 'Image qui ne s\'affiche pas', img);
    if (!img.naturalWidth || !inViewport(r)) continue;
    const need = r.width * dpr;
    imageBytesHint += img.naturalWidth * img.naturalHeight;
    if (img.naturalWidth > need * 2.5 && img.naturalWidth > 400) add('image-oversized', 'info', `Image de ${img.naturalWidth} px affichée sur ${Math.round(need)} px (poids inutile)`, img);
    if (need > img.naturalWidth * 1.6) add('image-blurry', 'info', `Image de ${img.naturalWidth} px étirée sur ${Math.round(need)} px (floue)`, img);
  }

  // ---- 4 bis. Bas de page : en fin de défilement, le dernier contenu doit rester au-dessus d'une
  // barre fixée en bas de l'écran (navigation flottante), sinon il est inatteignable. ----
  if (o.atScrollEnd) {
    const bars = [...document.querySelectorAll('body *')].filter((el) => {
      if (cs(el).position !== 'fixed' || !isShown(el)) return false;
      const r = el.getBoundingClientRect();
      return r.bottom >= vh - 4 && r.height < vh * 0.3 && r.width > vw * 0.4 && r.top > vh * 0.5;
    });
    const barTop = bars.length ? Math.min(...bars.map((b) => b.getBoundingClientRect().top)) : null;
    if (barTop !== null) {
      const content = all.filter((el) => !inFixedEl(el) && (hasOwnText(el) || el.tagName === 'IMG' || el.matches(INTERACTIVE)));
      const last = content.reduce((best, el) => (el.getBoundingClientRect().bottom > (best?.getBoundingClientRect().bottom ?? -1) ? el : best), null);
      if (last && last.getBoundingClientRect().bottom > barTop + 2) {
        add('bottom-hidden', 'warning', `Fin de page cachée sous la barre du bas (${Math.round(last.getBoundingClientRect().bottom - barTop)} px dessous)`, last);
      }
    }
  }

  // ---- 5. Focus (clavier, télécommande) ----
  const focus = o.checkFocus ? describeFocus() : { element: null };
  if (o.expectFocus && !focus.element) add('focus-missing', 'warning', 'Aucun élément sélectionné : la télécommande n\'a pas de point de départ', null, null);
  if (focus.element) {
    if (!focus.indicator) add('focus-invisible', 'error', 'Élément sélectionné sans liseré visible', focus.el);
    else if (focus.clipped) add('focus-clipped', 'error', `Liseré du focus rogné (${focus.clipped})`, focus.el);
  }

  function describeFocus() {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return { element: null };
    const s = getComputedStyle(el);
    const ow = s.outlineStyle !== 'none' ? parseFloat(s.outlineWidth) || 0 : 0;
    const shadow = s.boxShadow && s.boxShadow !== 'none';
    const indicator = ow > 0 || shadow;
    const extra = ow + Math.max(0, parseFloat(s.outlineOffset) || 0);
    const { full, box } = visibleRect(el, extra);
    let clipped = '';
    if (box.r <= box.l || box.b <= box.t) clipped = 'hors de la zone visible';
    else if (full.l < box.l - 1 || full.r > box.r + 1 || full.t < box.t - 1 || full.b > box.b + 1) clipped = 'coupé par son conteneur ou le bord de l\'écran';
    return { element: shortSel(el), el, indicator, clipped, zone: el.closest('[data-nav-zone]')?.getAttribute('data-nav-zone') || 'page' };
  }

  // ---- Limiter le bruit : constats identiques regroupés (même règle, même élément), N par règle ----
  const groups = new Map();
  for (const i of issues) {
    const k = `${i.rule}|${i.selector}`;
    const g = groups.get(k);
    if (g) { g.count++; if (i.rect && g.rects.length < 30) g.rects.push(i.rect); }
    else groups.set(k, { ...i, count: 1, rects: i.rect ? [i.rect] : [] });
  }
  const perRule = {};
  const kept = [...groups.values()].filter((i) => (perRule[i.rule] = (perRule[i.rule] || 0) + 1) <= o.maxIssuesPerRule);

  const fontsUsed = [...new Set(all.slice(0, 400).map((el) => cs(el).fontFamily.split(',')[0].replace(/["']/g, '').trim()))];
  return {
    metrics: {
      viewport: `${vw} × ${vh}`,
      dpr,
      rootFontSize: getComputedStyle(document.documentElement).fontSize,
      elements: all.length,
      interactive: inter.length,
      images: all.filter((el) => el.tagName === 'IMG').length,
      imageMegapixels: Math.round(imageBytesHint / 1e5) / 10,
      fontsUsed,
      fontsLoaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`).filter((v, i, a) => a.indexOf(v) === i),
      focus: focus.element ? { element: focus.element, zone: focus.zone, indicator: focus.indicator, clipped: focus.clipped } : null,
      truncatedRules: Object.entries(perRule).filter(([, n]) => n > o.maxIssuesPerRule).map(([r, n]) => `${r} (${n})`),
    },
    issues: kept,
  };
}

/** État du focus seul, pour la marche à la télécommande (exécuté dans la page). */
export function focusState() {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const shortSel = (e) => {
    const parts = [];
    for (let cur = e, i = 0; cur && cur !== document.body && i < 3; i++, cur = cur.parentElement) {
      const cls = [...cur.classList].filter((c) => !/^(active|focused|visible|is-)/.test(c)).slice(0, 2);
      parts.unshift(cur.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : ''));
    }
    return parts.join(' > ');
  };
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  const ow = s.outlineStyle !== 'none' ? parseFloat(s.outlineWidth) || 0 : 0;
  const visible = r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
  return {
    selector: shortSel(el),
    zone: el.closest('[data-nav-zone]')?.getAttribute('data-nav-zone') || 'page',
    rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    indicator: ow > 0 || (s.boxShadow && s.boxShadow !== 'none'),
    inViewport: visible && r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
  };
}
