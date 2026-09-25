# Installer l'outil

> Ce qu'il faut sur le PC, puis ce que chaque plateforme demande. Le web ne demande presque rien ;
> Android et Windows demandent une « version d'audit » de l'app, préparée une fois. Votre IA peut
> faire chaque étape avec vous ([`GUIDE-IA.md`](GUIDE-IA.md)).

## 1. L'outil lui-même

| Il faut | Pourquoi |
|---|---|
| [Node.js](https://nodejs.org) **20 ou plus récent** | L'outil est écrit en JavaScript |
| **git**, et un projet sous git | Pour Android et Windows seulement : l'outil calcule l'empreinte du code de l'app pour refuser d'auditer une version compilée depuis un autre code |

1. Copiez le dossier de l'outil **dans le projet de votre app** (à la racine), sous le nom que vous
   voulez ; ici, `audit`. Le dossier qui le contient est « le projet » : c'est là que les passages
   s'écrivent (`audit-out/`, à ajouter au `.gitignore` du projet : les captures montrent vos données).
2. Installez ses dépendances, dans son dossier :

   ```
   cd audit
   npm install
   ```

3. Vérifiez, depuis le projet : `node audit` liste les commandes ; `npm test`, dans le dossier de
   l'outil, lance ses tests (une vingtaine, sur des passages fabriqués).

Pour **mettre à jour** l'outil plus tard : remplacez ses fichiers par ceux de la nouvelle version, en
gardant le dossier de votre personnalisation (`audit/<votre-app>/`, avec son registre), puis
`npm install` de nouveau.

## 2. Web

Les navigateurs de Playwright (un téléchargement, une fois) :

```
npx playwright install chromium webkit firefox
```

- **Chromium** (Chrome) suffit pour commencer ; s'il manque, l'outil prend le Chrome ou l'Edge du PC.
- **WebKit** donne le rendu de Safari (iPhone, iPad) ; **Firefox**, celui de Firefox.

La personnalisation donne l'adresse de l'app (`WEB.url`) et, si son serveur n'est pas déjà lancé, la
commande qui le démarre (`WEB.start`) : l'outil le démarre au besoin et l'arrête à la fin. Essai sans
rien d'autre : `node audit passage --app exemple`.

## 3. Android (téléphone, tablette, TV)

Pour une app dont l'interface est une **WebView** (Tauri, Capacitor, Cordova, Ionic, une app hybride…).

### 3.1 Le SDK et les émulateurs

1. Le **SDK Android** (le plus simple : installer Android Studio). L'outil le trouve par la variable
   `ANDROID_HOME`, sinon à l'emplacement par défaut de Windows (`%LOCALAPPDATA%\Android\Sdk`) :
   sur macOS ou Linux, définissez `ANDROID_HOME`.
2. Un **appareil virtuel par type d'appareil** (Device Manager d'Android Studio) : par exemple un
   téléphone et une TV. Leurs noms vont dans la personnalisation (`EMULATORS`). L'outil les démarre
   lui-même, **à froid et sans instantané** (l'horloge d'un instantané repris est fausse et fait
   refuser les sessions), et arrête à la fin ceux qu'il a démarrés.
3. Réglages de l'appareil virtuel **téléphone** : `hw.keyboard=no` dans sa configuration (sinon pas de
   clavier à l'écran). L'outil vérifie ce réglage au départ et désactive de lui-même l'écriture au
   stylet de Gboard. Pièges connus du banc : [`CONCEPTION.md`](CONCEPTION.md), section 6.

L'outil change lui-même la taille et la densité de l'écran à chaque taille du passage (`SIZES`), puis
remet la taille d'origine.

### 3.2 La version d'audit de l'app

Une compilation de l'app **réservée aux émulateurs**, jamais publiée, avec :

| Quoi | Pourquoi | Comment (exemples) |
|---|---|---|
| **Débogage de la WebView activé** (obligatoire) | L'outil pilote et mesure la page par ce biais | `WebView.setWebContentsDebuggingEnabled(true)` ; Capacitor : `webContentsDebuggingEnabled: true` ; Tauri : compilation de débogage, ou l'option équivalente |
| **L'empreinte du code** (recommandé) | L'outil refuse d'auditer une version compilée depuis un autre code | Au moment de compiler : `node audit/core/build-id.mjs` donne l'empreinte ; la version d'audit l'expose par son pont d'audit (`build`) |
| **Un pont d'audit** (facultatif, précieux) | Forcer les états rares : vide, erreur, chargement, fenêtre ouverte | Un objet global (nom déclaré par `BRIDGE`) : `set(groupe, clé, valeur)`, retiré aussitôt ; `build` |

Un script de votre projet compile cette version et l'**installe sur les émulateurs qui tournent**
(`adb install -r`) ; sa commande va dans la personnalisation (`BUILD_AUDIT_APP`). L'outil le lance
quand il faut : `node audit banc` (version périmée, ou absente d'un émulateur) et chaque vérification
d'un lot. Il retient, émulateur par émulateur, l'installation qu'il a faite.

### 3.3 La session

Si l'app demande un compte, **connectez-vous vous-même**, une fois, dans la version d'audit, sur
chaque émulateur. L'outil reprend la session ; il ne manipule jamais d'identifiant. Les écrans d'avant
la connexion demandent un émulateur jamais connecté (`SIGNED_OUT` dans la personnalisation).

Pendant un passage, ne touchez pas aux émulateurs : les captures seraient faussées.

## 4. Bureau (Windows)

Pour une app de bureau dont l'interface est une **WebView2** (Tauri, WinUI, WPF…) ou **Electron**.

La version d'audit de l'app doit :

| Quoi | Comment |
|---|---|
| **Ouvrir un port de débogage** local, choisi par l'outil | WebView2 : sans changer l'app, par la variable `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>` ; Electron : l'argument `--remote-debugging-port=<port>` |
| **Prendre la taille de fenêtre** (et l'échelle d'affichage) **au lancement** | L'app lit une variable ou un argument au démarrage et dimensionne sa fenêtre. Sans cela, une seule taille : celle de l'app |
| **Garder ses propres données** | Jamais celles de l'app installée : un dossier de données à part, et une session ouverte par vous |

La personnalisation décrit comment lancer cette version (`DESKTOP` : chemin de l'exécutable, port,
variables `env(fenêtre, port)` et / ou arguments `args(fenêtre, port)`) et, si elle se recompile, la
commande (`BUILD_AUDIT_DESKTOP`). L'outil la lance à chaque taille, s'y branche, capture, puis la
ferme. Pendant un passage, l'app passe au premier plan : laissez le PC tranquille.

## 5. Vérifier son installation

```
node audit liste                        les écrans, profils et tailles de votre app
node audit passage --plan               ce qu'un passage ferait, sans rien lancer
node audit passage --only <écran> --sizes <taille>   un pilote sur un écran, à une taille
```

Petite échelle d'abord : un écran, une taille ; puis le parcours entier.
