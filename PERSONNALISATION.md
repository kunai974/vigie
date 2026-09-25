# Décrire son app : la personnalisation

> Tout ce qui est propre à une app vit dans **un dossier à côté de `exemple/`**, dans le dossier de
> l'outil : `audit/<mon-app>/`. Le reste de l'outil ne connaît aucune app. Ce document liste tout ce
> que ce dossier peut déclarer ; votre IA le remplit avec vous ([`GUIDE-IA.md`](GUIDE-IA.md)).

| Fichier | Contenu |
|---|---|
| `screens.mjs` | L'app, ses plateformes, ses tailles, son parcours (module JavaScript) |
| `review.cjs` | Les réglages de la revue : noms lisibles, zones sensibles, gravités, registre |
| `registre.json` | La mémoire des défauts (créée et tenue par l'outil, à garder sous git avec le projet) |
| `PARCOURS.md` | Facultatif : les décisions prises avec vous (tailles, écrans, exclusions), datées |

Le plus simple : **copier `exemple/`** sous le nom de l'app, puis adapter. Une seule personnalisation
dans le dossier de l'outil : elle est prise d'office ; plusieurs : choisir avec `--app <nom>`.

## 1. `screens.mjs` : l'app et ses plateformes

| Réglage | Sert à | Obligatoire |
|---|---|---|
| `APP_NAME` | Nom affiché dans les pages | oui |
| `WEB` | `{ url, start }` : adresse de l'app ; `start`, commande qui démarre son serveur s'il ne répond pas (ex. `['npm', ['run', 'dev']]`) | web |
| `PACKAGE` | Nom du paquet Android (ex. `com.exemple.app`) | Android |
| `EMULATORS` | `{ tv: 'Nom_TV', phone: 'Nom_Phone' }` : appareils virtuels, démarrés par l'outil | Android |
| `DESKTOP` | `{ label, exe, port, env(fenêtre, port), args(fenêtre, port) }` : version d'audit de bureau (voir plus bas) | bureau |
| `APP_CODE` | `{ paths, exclude }` : fichiers qui font l'app (depuis la racine du projet), pour son empreinte | Android, bureau |
| `BUILD_AUDIT_APP` | `[commande, [arguments]]` : compile et installe la version d'audit Android | Android |
| `BUILD_AUDIT_DESKTOP` | `[commande, [arguments]]` : compile la version d'audit de bureau | bureau |
| `BRIDGE` | Nom de l'objet global du pont d'audit (`set`, `build`) | non |
| `MASK` | Éléments à noircir dans chaque capture (section 4) | selon l'app |
| `POPUPS` | Sélecteurs des menus et fenêtres qui n'ont pas de rôle ARIA (`listbox`, `menu`, `dialog`) | non |
| `LOADING` | Sélecteurs des indicateurs de chargement propres à l'app (en plus de `skeleton`, `shimmer`, `loading-spinner`, `aria-busy`) | non |
| `SCROLL_SCOPE` | Calque du dessus (fiche ouverte…) dont le contenu défile en priorité | non |
| `SIZES`, `PROFILES` | Tailles d'écran, et profils de passage (section 2) | oui |
| `SIZE_RULES` | Tailles encadrées : `{ phone: [{ selector, label, minW, maxW }] }` (ex. cartes entre 92 et 150 points) | non |
| `SCREENS` | Le parcours (section 3) | oui |
| `SIGNED_OUT` | `{ detect(d), signedIn, screens }` : session fermée reconnue par `detect`, session ouverte par le sélecteur `signedIn`, parcours d'avant la connexion `screens` | non |
| `passProfileScreen(d)`, `enterFirstProfile(d)` | Écran de choix d'un profil au lancement : le reconnaître (true / false), y entrer | non |

### Bureau

```js
export const DESKTOP = {
  label: 'Windows',
  exe: 'C:/chemin/vers/mon-app-audit.exe',          // version d'audit, avec ses propres données
  port: 9333,                                        // port de débogage local
  // WebView2 : le port s'ouvre sans changer l'app ; la taille de fenêtre, elle, doit être lue par l'app
  env: (win, port) => ({
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    ...(win ? { MON_APP_FENETRE: `${win.w}x${win.h}${win.scale ? `@${win.scale}` : ''}` } : {}),
  }),
  // Electron : arguments de lancement
  // args: (win, port) => [`--remote-debugging-port=${port}`],
};
```

## 2. Tailles et profils

Chaque taille a un nom (celui qu'on passe à `--sizes`) et une plateforme (`kind`) :

| Plateforme | Champs | Exemple |
|---|---|---|
| `web` | `browser` (`chromium`, `webkit`, `firefox`), `w`, `h` (pixels CSS), `dpr`, `mobile` (tactile) | `{ kind: 'web', browser: 'webkit', w: 390, h: 844, dpr: 3, mobile: true, label: 'iPhone' }` |
| `phone`, `tv` | `size` (pixels réels), `density` (densité Android) | `{ kind: 'phone', size: '1080x2340', density: 480, label: 'Téléphone (360 x 780)' }` |
| `desktop` | `w`, `h` (fenêtre, pixels de Windows), `scale` (échelle d'affichage, facultatif) | `{ kind: 'desktop', w: 1536, h: 864, label: 'Portable à 125 %' }` |

Un profil dit quelles tailles passer, par plateforme ; `null` = la taille d'origine de l'émulateur :

```js
export const PROFILES = {
  rapide: { tv: [null], phone: ['phone'], desktop: ['desktop-fhd'] },          // à chaque travail d'affichage
  complet: { tv: [null, 'tv-16-10'], phone: ['phone-small', 'phone', 'tablet'], desktop: ['desktop-laptop', 'desktop-fhd'] },
};
```

Ajouter une taille se justifie quand elle change la mise en page (un seuil de l'app) : moins de
tailles, passages plus courts.

## 3. Le parcours (`SCREENS`)

Chaque écran s'atteint **en déclenchant un élément désigné** (un attribut stable `data-*`, un id, un
texte exact), **jamais par des coordonnées**. L'outil ne fait que naviguer : jamais d'achat, de
lecture de vidéo, de réglage modifié, de déconnexion, de formulaire validé.

| Champ | Sens |
|---|---|
| `id`, `label` | Identifiant (pour `--only`) et nom lisible |
| `go(d)` | Y mener depuis n'importe quel écran ; retourne `null` si l'écran est atteint, sinon **la raison** (l'écran est alors noté « non atteint ») |
| `platforms` | Plateformes où l'écran existe (ex. `['phone']`) ; toutes par défaut |
| `scroll` | `'once'` : un pas de défilement ; `'full'` : jusqu'en bas |
| `past` | Élément de tête (bannière) : une capture en plus, calée juste après lui |
| `keyboard` | Champ de saisie : l'écran est aussi mesuré clavier ouvert |
| `type` | Texte neutre tapé dans ce champ (ex. `'the'`), puis effacé ; jamais une vraie donnée |
| `variants` | États en plus : `[{ id, label, apply(d), undo(d), noFocus }]` ; `apply` retourne `true` si l'état est atteint (ou la raison) ; `undo` le retire |
| `expect` | Éléments qui doivent être affichés : `{ phone: [{ selector, label }] }` (sinon « élément attendu absent ») |
| `walk` | TV : suite de flèches (`['down', 'right', …]`) ; à chaque touche, la sélection doit rester visible, avec son liseré |
| `expectFocus` | TV : un élément doit être sélectionné à l'arrivée |
| `after(d)` | Ce qu'il faut faire en quittant l'écran (fermer une page, revenir) |

**Le pilote `d`** (mêmes gestes sur toutes les plateformes) :

| Geste | Effet |
|---|---|
| `d.click(sélecteur)`, `d.clickText(sélecteur, 'texte exact' ou /texte/)` | Déclenche un élément (le premier dont le texte correspond, pour `clickText`) ; `true` s'il existait |
| `d.exists(sélecteur)` | L'élément existe-t-il ? |
| `d.goto(url)` | Web : ouvre une adresse |
| `d.key('up' \| 'down' \| 'left' \| 'right' \| 'ok' \| 'back')` | Touche de télécommande (TV), du clavier (bureau, web) |
| `d.scroll('next' \| 'top' \| 'bottom' \| 'past:<sélecteur>')` | Défile le contenu principal : d'un écran, en haut, en bas, juste après un élément |
| `d.wait(ms)`, `d.settle(ms max)` | Attend ; attend la stabilité (plus de chargement, images chargées) |
| `d.bridge(groupe, clé, valeur)` | Pont d'audit : force un état rare |
| `d.keyboardShown()`, `d.blur()` | Clavier système ouvert ? le fermer |
| `d.kind` | `'tv'`, `'phone'`, `'desktop'` ou `'web'` |
| `d.page` | La page Playwright, pour ce que les gestes ne couvrent pas |

**Règle de parcours à la télécommande (facultative)** : si la barre latérale porte
`data-nav-zone="sidebar"`, Haut et Bas ne doivent jamais y entrer (on y entre par la gauche) ; un
écart est un défaut « Haut / Bas qui entre dans la barre latérale ». Les autres zones se nomment
librement (`data-nav-zone="…"`), elles apparaissent dans le relevé de la marche.

## 4. Les données sensibles

À établir avec vous **avant le premier passage** ([`GUIDE-IA.md`](GUIDE-IA.md), section 1.4).

```js
// Noirci dans chaque capture, dès la prise de vue, sur toutes les plateformes.
export const MASK = [
  'input[type=password]', 'input[type=email]',          // d'office
  '.compte-email', '.solde',                            // données de l'app
  { selector: '.description', pattern: '@' },           // seulement si le texte contient « @ »
];
```

Écrans entiers à ne jamais montrer (ils restent mesurés) : `SENSITIVE` dans `review.cjs`.

## 5. `review.cjs` : les réglages de la revue

Module CommonJS (`module.exports = { … }`) :

| Réglage | Sens |
|---|---|
| `APP_NAME` | Nom affiché |
| `REGISTRY` | Chemin du registre : `require('path').join(__dirname, 'registre.json')` |
| `SENSITIVE` | Expression des écrans jamais montrés (ex. `/^(compte\|paiement)/`) |
| `SIZE_LABEL` | Nom court de chaque taille dans les pages (`{ '': 'taille d\'origine', phone: '360 pts' }`) |
| `LABELS` | Noms lisibles des éléments, par « balise.première-classe » (`{ 'button.fav': 'Bouton favori' }`) : la revue parle de ce qu'on voit, pas du code |
| `SPECIFIC` | Conseil propre à un élément (prime sur celui de la famille) |
| `GRAVITY` | Gravité ajustée : `{ 'tv\|overlap\|button.nav-item': 'important' }` ou `{ 'overlap\|button.x': 'mineur' }` |
| `toolArtifact(plateforme, écran, constat)` | Fausses alertes connues propres à l'app, écartées (retourne `true`) |
| `MANUAL` | Constats vus à l'œil déclarés à la main (rare : l'interprète les écrit plutôt dans `interpretation.json`) |
| `RENAMED` | Identités remplacées (`{ ancien: nouveau }`) : la décision et l'historique suivent |
| `FAMILIES` | Familles de défauts propres à l'app (titre, conseil), rarement utile |

## 6. Vérifier

```
node audit liste                                   écrans, profils, tailles
node audit passage --plan                          ce qu'un passage ferait
node audit passage --only <écran> --sizes <taille> un pilote sur un écran
```

Puis regarder soi-même quelques captures des écrans sensibles : une donnée visible = compléter `MASK`
ou `SENSITIVE`, puis refaire le passage.
