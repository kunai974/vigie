// Pilote de l'app de bureau (Windows, WebView2) : lance la version d'audit de l'app avec une taille de
// fenêtre et une échelle d'affichage, s'y branche par le protocole de débogage (port local) et capture
// par Playwright. Sur un Chromium de bureau, les captures de Playwright sont le vrai rendu (sur Android,
// elles ne le sont pas : d'où la capture par Android). Générique : l'exécutable et la façon de lui
// passer taille, échelle et port sont fournis par l'app (DESKTOP dans sa personnalisation).
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { pageActions, guard } from './page.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Touches de télécommande → touches du clavier du PC (le mode TV de l'app les comprend aussi)
const KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', ok: 'Enter', back: 'Escape' };

/** Arrête une instance lancée par l'outil (processus et ses enfants WebView2). */
export function killDesktop(proc) {
  if (!proc?.pid) return;
  spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { encoding: 'utf8', timeout: 20000 });
}

/** Le port de débogage répond-il ? */
async function portUp(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Lance l'app. `cfg` : { exe, env(fenêtre, port) → variables d'environnement, args(fenêtre, port) → arguments }. `window` :
 * { w, h, scale } en pixels logiques de Windows, ou null pour sa taille par défaut.
 * Retourne { proc, port }.
 */
export async function launchDesktop(cfg, window, port) {
  if (!existsSync(cfg.exe)) throw new Error(`Version d'audit de l'app introuvable : ${cfg.exe} (voir INSTALLATION.md de l'outil)`);
  if (await portUp(port)) throw new Error(`Le port ${port} est déjà pris : une autre instance de l'app d'audit tourne-t-elle ?`);
  // Taille, échelle et port passés à l'app par variables d'environnement (`env`) et / ou par arguments
  // de lancement (`args`, ex. --remote-debugging-port pour Electron).
  const env = { ...process.env, ...(cfg.env ? cfg.env(window, port) : {}) };
  const args = cfg.args ? cfg.args(window, port) : [];
  const proc = spawn(cfg.exe, args, { env, stdio: 'ignore', cwd: path.dirname(cfg.exe) });
  proc.on('error', () => {});
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    if (proc.exitCode !== null) throw new Error(`L'app s'est fermée au lancement (code ${proc.exitCode})`);
    if (await portUp(port)) return { proc, port };
  }
  killDesktop(proc);
  throw new Error(`L'app n'ouvre pas son port de débogage (${port}) en 60 s : est-ce bien la version d'audit ?`);
}

/** Branche Playwright sur la page de l'app ; retourne { browser, page }. */
export async function attachDesktop(port, timeout = 30000) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout });
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools://'));
    if (page) return { browser, page };
    await sleep(500);
  }
  await browser.close().catch(() => {});
  throw new Error('Branché sur l\'app, mais aucune page trouvée');
}

/**
 * Pilote de l'app de bureau : gestes communs de la page (page.mjs), touches du clavier du PC, pas de
 * clavier système (un champ sélectionné suffit pour taper), captures par Playwright.
 */
export function makeDesktopDriver(entry, page, { bridge = null, scope = null, loading = [] } = {}) {
  const d = {
    ...pageActions(page, bridge, { scope, loading }),
    serial: entry.serial,
    kind: entry.kind,
    key: async (name, settleMs = 450) => {
      await page.keyboard.press(KEYS[name] || name);
      await page.waitForTimeout(settleMs);
    },
    keyboardShown: async () => false,
    /** Pas de clavier système sur le bureau : « clavier ouvert » = champ sélectionné, prêt à taper. */
    openKeyboard: async (selector) => {
      await page.click(selector, { timeout: 5000 }).catch(() => page.focus(selector));
      d.memo.keyboardVia = 'champ sélectionné (pas de clavier système sur le bureau)';
      return page.evaluate((s) => document.activeElement === document.querySelector(s), selector);
    },
    tap: async (selector) => { await page.click(selector, { timeout: 5000 }); return true; },
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
