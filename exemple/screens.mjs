// Personnalisation d'exemple de l'outil d'audit : une petite page web (page/), auditée dans les
// navigateurs de Playwright. Modèle pour un nouveau projet : copier ce dossier à côté, sous le nom de
// l'app (<outil>/<mon-app>/), puis suivre GUIDE-IA.md.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const APP_NAME = 'Exemple web';

// Mode web : adresse de l'app. Pour une app servie en local : url 'http://localhost:5173' et, si le
// serveur n'est pas lancé, la commande qui le démarre : start: ['npm', ['run', 'dev']].
const HOME = pathToFileURL(path.join(HERE, 'page', 'index.html')).href;
export const WEB = { url: HOME };

// Données personnelles affichées (e-mail, nom, solde…) : noircies dans chaque capture, dès la prise
// de vue (core/masque.mjs). Pour un écran entier à ne jamais montrer : SENSITIVE dans review.cjs.
export const MASK = ['.utilisateur', 'input[type=password]'];

// Tailles : moteur (chromium, webkit ≈ Safari et iPhone, firefox), fenêtre en pixels CSS, densité,
// appareil mobile (tactile : zones tactiles contrôlées à 44 px).
export const SIZES = {
  iphone: { kind: 'web', browser: 'webkit', w: 390, h: 844, dpr: 3, mobile: true, label: 'iPhone (Safari, 390 x 844)' },
  android: { kind: 'web', browser: 'chromium', w: 360, h: 780, dpr: 3, mobile: true, label: 'Téléphone Android (Chrome, 360 x 780)' },
  tablette: { kind: 'web', browser: 'webkit', w: 820, h: 1180, dpr: 2, mobile: true, label: 'Tablette (Safari, 820 x 1180)' },
  bureau: { kind: 'web', browser: 'chromium', w: 1440, h: 900, label: 'Bureau (Chrome, 1440 x 900)' },
  firefox: { kind: 'web', browser: 'firefox', w: 1280, h: 800, label: 'Bureau (Firefox, 1280 x 800)' },
};
export const PROFILES = {
  rapide: { web: ['android', 'bureau'] },
  complet: { web: ['iphone', 'android', 'tablette', 'bureau', 'firefox'] },
};

// Le parcours : chaque écran s'atteint par une action sur un élément désigné (jamais par des
// coordonnées). `go` retourne null si l'écran est atteint, sinon la raison. Options : scroll ('once' :
// un pas de défilement, 'full' : jusqu'en bas), keyboard (champ à mesurer clavier ouvert), type (texte
// à taper), variants (états forcés), expect (éléments qui doivent être affichés).
export const SCREENS = [
  { id: 'accueil', label: 'Accueil', scroll: 'once', go: async (d) => { await d.goto(HOME); await d.settle(); return null; } },
  {
    id: 'compte', label: 'Mon compte', keyboard: '#email',
    expect: { web: [{ selector: 'button[type=submit]', label: 'Bouton « Se connecter »' }] },
    go: async (d) => {
      await d.goto(HOME);
      if (!(await d.click('#lien-compte'))) return 'lien « Mon compte » introuvable';
      await d.settle();
      return null;
    },
  },
];
