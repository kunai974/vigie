// Pilote web : audite une page ou une app web dans les navigateurs de Playwright (Chromium, WebKit ≈
// Safari et iPhone, Firefox), sans émulateur ni version d'audit. Chaque taille = un contexte de
// navigateur neuf (largeur, hauteur, densité, tactile). Les captures de Playwright sont le vrai rendu du
// navigateur. Générique : l'adresse et, au besoin, la commande qui démarre le serveur de l'app sont
// fournies par l'app (WEB dans sa personnalisation).
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { pageActions, guard } from './page.mjs';

const require = createRequire(import.meta.url);
const playwright = require('@playwright/test');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', ok: 'Enter', back: 'Escape' };

async function answers(url) {
  if (!/^https?:/.test(url)) return true; // fichier local
  try { return (await fetch(url, { signal: AbortSignal.timeout(3000) })).status < 500; } catch { return false; }
}

/**
 * Serveur de l'app : déjà en marche, ou démarré par la commande `web.start` ([commande, [arguments]]),
 * attendu jusqu'à 90 s. Retourne le processus démarré (à arrêter à la fin), ou null.
 */
export async function ensureWebServer(web, { log = console.log, cwd } = {}) {
  if (await answers(web.url)) return null;
  if (!web.start) throw new Error(`${web.url} ne répond pas, et l'app ne donne pas de commande pour démarrer son serveur (WEB.start)`);
  log(`[web] démarrage du serveur : ${web.start[0]} ${web.start[1].join(' ')}`);
  const proc = spawn(web.start[0], web.start[1], { cwd, stdio: 'ignore', shell: process.platform === 'win32' });
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    if (await answers(web.url)) return proc;
  }
  stopWebServer(proc);
  throw new Error(`${web.url} ne répond toujours pas 90 s après le démarrage du serveur`);
}

export function stopWebServer(proc) {
  if (!proc?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { timeout: 20000 });
  else proc.kill();
}

/**
 * Lance un navigateur de Playwright. Chromium absent (navigateurs de Playwright pas installés pour sa
 * version) : le Chrome ou l'Edge du PC font l'affaire. WebKit et Firefox n'ont pas d'équivalent sur le
 * PC : erreur claire, avec la commande d'installation (un téléchargement, à faire soi-même).
 */
async function launch(type, name) {
  try {
    return await type.launch();
  } catch (e) {
    if (!/Executable doesn't exist/.test(e.message)) throw e;
    if (name === 'chromium') {
      for (const channel of ['chrome', 'msedge']) {
        try { return await type.launch({ channel }); } catch { /* suivant */ }
      }
    }
    const err = new Error(`navigateur ${name} de Playwright non installé : « npx playwright install ${name} » (téléchargement)`);
    err.fatal = true;
    throw err;
  }
}

/**
 * Ouvre l'app à une taille : `size` = { browser: 'chromium'|'webkit'|'firefox', w, h, dpr, mobile, touch }.
 * Retourne { browser, context, page }.
 */
export async function openWeb(web, size) {
  const name = size.browser || 'chromium';
  const type = playwright[name];
  if (!type) throw new Error(`Navigateur inconnu : ${name} (chromium, webkit, firefox)`);
  const browser = await launch(type, name);
  const context = await browser.newContext({
    viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr || 1, hasTouch: !!(size.touch ?? size.mobile),
    // Firefox ne sait pas simuler un appareil mobile : largeur et tactile seulement
    ...(size.mobile && size.browser !== 'firefox' && { isMobile: true }), locale: web.locale || 'fr-FR',
  });
  const page = await context.newPage();
  await page.goto(web.url, { waitUntil: 'load', timeout: 60000 });
  return { browser, context, page };
}

/** Pilote web : gestes communs de la page, touches du clavier, pas de clavier système, captures Playwright. */
export function makeWebDriver(entry, page, { bridge = null, scope = null, loading = [], touch = false } = {}) {
  const d = {
    ...pageActions(page, bridge, { scope, loading }),
    serial: 'web',
    kind: 'web',
    touch,
    key: async (name, settleMs = 450) => {
      await page.keyboard.press(KEYS[name] || name);
      await page.waitForTimeout(settleMs);
    },
    keyboardShown: async () => false,
    openKeyboard: async (selector) => {
      await page.click(selector, { timeout: 5000 }).catch(() => page.focus(selector));
      d.memo.keyboardVia = 'champ sélectionné (pas de clavier système dans le navigateur)';
      return page.evaluate((s) => document.activeElement === document.querySelector(s), selector);
    },
    tap: async (selector) => { await page.click(selector, { timeout: 5000 }); return true; },
    goto: (url) => page.goto(url, { waitUntil: 'load', timeout: 60000 }),
    foreground: async () => null,
    frame: async () => null,
    typeText: async (text) => {
      await page.keyboard.type(text, { delay: 40 });
      await page.waitForTimeout(900);
    },
    screenshot: (file) => page.screenshot({ path: file }),
  };
  return guard(d);
}
