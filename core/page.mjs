// Gestes communs à toutes les plateformes, joués dans la page (Playwright) : cliquer par sélecteur,
// défiler, attendre la stabilité, forçages du pont d'audit, accessibilité. Les pilotes d'appareil
// (android.mjs, desktop.mjs) y ajoutent ce qui leur est propre : touches, clavier, captures.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

/**
 * `bridge` : nom de l'objet global du pont d'audit de l'app ({ set(groupe, clé, valeur), build }), ou null.
 * `scope` : sélecteur du calque du dessus (fiche ouverte…) dont le contenu défile en priorité (app).
 * `loading` : sélecteurs des indicateurs de chargement propres à l'app (LOADING), en plus des noms courants.
 */
export function pageActions(page, bridge = null, { scope = null, loading = [] } = {}) {
  const LOADING_SEL = ['[class*="skeleton"]', '[class*="shimmer"]', '.loading-spinner', '[aria-busy="true"]', ...loading].join(', ');
  return {
    page,
    wait: (ms) => page.waitForTimeout(ms),
    /** Active un élément par son sélecteur, sans viser de coordonnées (ni passer en mode souris). */
    click: (selector) => page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return false;
      el.click();
      return true;
    }, selector),
    exists: (selector) => page.evaluate((s) => !!document.querySelector(s), selector),
    /** Mémoire du passage (ex. catégorie active à restaurer). */
    memo: {},
    /** Active le premier élément du sélecteur dont le texte correspond (chaîne exacte ou RegExp). */
    clickText: (selector, text) => page.evaluate(({ s, t, re }) => {
      const match = (v) => (re ? new RegExp(re, 'i').test(v) : v === t);
      const el = [...document.querySelectorAll(s)].find((e) => match((e.textContent || '').replace(/\s+/g, ' ').trim()));
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      el.click();
      return true;
    }, { s: selector, t: typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : null, re: text instanceof RegExp ? text.source : null }),
    /** Quitte le champ sélectionné (et ferme le clavier système), sans touche. */
    blur: async () => {
      await page.evaluate(() => document.activeElement?.blur?.());
      await page.waitForTimeout(700);
    },
    /** Forçage d'état par le pont d'audit de l'app. Retourne false si le pont est absent. */
    bridge: (group, key, value) => page.evaluate(({ b, g, k, v }) => (b && window[b] ? window[b].set(g, k, v) : false), { b: bridge, g: group, k: key, v: value }),
    hasBridge: () => page.evaluate((b) => !!(b && window[b]), bridge),
    /** Empreinte du code embarquée dans la version d'audit (core/build-id.mjs), ou null. */
    build: () => page.evaluate((b) => (b && window[b]?.build) || null, bridge),
    /** Vide le champ focalisé (valeur React comprise), sans touche. */
    clearField: (selector) => page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      setter?.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, selector),
    /**
     * Défilement du contenu principal (ou de `selector`) : 'top', 'next' (une hauteur d'écran),
     * 'bottom' ou 'past:<sélecteur>' (juste après cet élément). Retourne { pos, max, moved } ; `max` = 0 si rien ne défile.
     */
    scroll: (where, selector) => page.evaluate(({ where, selector, scope }) => {
      const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
      let el = selector ? [...document.querySelectorAll(selector)].find((e) => visible(e) && e.scrollHeight > e.clientHeight + 20) : null;
      if (!el) {
        // Le plus grand conteneur qui défile, pris dans le calque du dessus (fiche ouverte) s'il y en a un.
        const root = (scope && document.querySelector(scope)) || document.body;
        const cands = [...root.querySelectorAll('*')].filter((e) => {
          const s = getComputedStyle(e);
          return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 20 && visible(e);
        });
        el = cands.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth)[0] || document.scrollingElement;
      }
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      const before = el.scrollTop;
      if (where === 'top') el.scrollTop = 0;
      else if (where === 'bottom') el.scrollTop = max;
      else if (where.startsWith('past:')) {
        // Juste après un élément (la bannière d'accueil) : ne montrer que ce qui le suit.
        const t = document.querySelector(where.slice(5));
        if (!t) return { pos: before, max, moved: false };
        const top = el === document.scrollingElement ? 0 : el.getBoundingClientRect().top;
        el.scrollTop = Math.min(max, before + t.getBoundingClientRect().bottom - top);
      } else el.scrollTop = Math.min(max, before + el.clientHeight * 0.85);
      return { pos: el.scrollTop, max, moved: Math.abs(el.scrollTop - before) > 2 };
    }, { where, selector: selector || null, scope }),
    /** Attend que l'écran soit stable : plus de squelette de chargement, images visibles chargées. */
    settle: async (maxMs = 8000) => {
      const t0 = Date.now();
      await page.waitForTimeout(400);
      while (Date.now() - t0 < maxMs) {
        const busy = await page.evaluate((sel) => {
          const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
          const skeleton = [...document.querySelectorAll(sel)].some(shown);
          const images = [...document.images].filter(shown).some((img) => !img.complete);
          return skeleton || images;
        }, LOADING_SEL).catch(() => true);
        if (!busy) break;
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(350); // fin des transitions
      return Date.now() - t0;
    },
    /** Contraste et accessibilité (axe-core), limités aux règles utiles à l'affichage. */
    axe: async () => {
      // Injecté par le protocole de débogage (pas par eval) : la politique de sécurité de la page ne s'applique pas.
      if (!(await page.evaluate(() => !!window.axe))) await page.evaluate(`${AXE_SOURCE}\n;void 0`);
      return page.evaluate(async () => {
        const res = await window.axe.run(document, {
          runOnly: { type: 'rule', values: ['color-contrast', 'button-name', 'image-alt', 'label', 'link-name'] },
          resultTypes: ['violations'],
        });
        return res.violations.flatMap((v) => v.nodes.slice(0, 12).map((n) => {
          const el = document.querySelector(n.target[0]);
          const r = el ? el.getBoundingClientRect() : null;
          return {
            rule: 'axe-' + v.id,
            severity: v.id === 'color-contrast' ? 'warning' : 'info',
            message: v.id === 'color-contrast'
              ? `Contraste insuffisant : ${(n.any[0]?.data?.contrastRatio ?? '?')}:1 (attendu ${n.any[0]?.data?.expectedContrastRatio ?? '4.5:1'})`
              : v.help,
            // Fin du sélecteur gardée (l'élément lui-même) : tronqué par le début, un long sélecteur de la TV
            // devenait « .episo » et passait pour un autre élément (épreuve du 23/09, point 13).
            selector: String(n.target[0]).slice(-200),
            rect: r ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null,
          };
        }));
      });
    },
  };
}

/**
 * Arrêt d'un pilote : après un blocage, le parcours abandonné continue en arrière-plan. Chaque action
 * du pilote échoue alors aussitôt, pour qu'il ne touche plus à l'appareil ni aux captures du parcours repris.
 */
export function guard(d) {
  d.stopped = false;
  for (const [k, fn] of Object.entries(d)) {
    if (typeof fn !== 'function') continue;
    d[k] = (...a) => { if (d.stopped) throw new Error('parcours arrêté'); return fn(...a); };
  }
  d.stop = () => { d.stopped = true; };
  return d;
}
