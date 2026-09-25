# Vigie

**L'audit d'affichage qui prouve ses corrections.**

Vigie est un outil qui **vérifie l'affichage et le responsive d'une app** sur plusieurs plateformes et tailles
d'écran. Il ouvre l'app, parcourt ses écrans, prend des captures, **mesure les défauts** (texte coupé
ou trop petit, élément qui sort de l'écran, bouton trop petit pour le doigt, sélection invisible à la
télécommande, contraste insuffisant…) et fabrique une **revue** où vous décidez quoi corriger. Chaque
correction est ensuite **prouvée par un avant / après**, défaut par défaut.

Il ne corrige rien de lui-même et ne décide de rien : il constate, classe et prouve.

| Qui | Quoi |
|---|---|
| **La machine** (l'outil) | Tout ce qui ne demande pas de jugement : lancer, parcourir, capturer, mesurer, fabriquer la revue, comparer avant / après |
| **L'interprète** (votre IA, ou un développeur) | Lire la revue, écarter les fausses alertes, expliquer, recommander, corriger ce qui a été décidé |
| **Le décideur** (vous) | Inclure, reporter ou exclure chaque défaut ; valider les corrections |

Pas besoin d'être développeur pour s'en servir : l'outil est fait pour être piloté avec une IA
(Claude ou une autre), à qui il donne un guide ([`GUIDE-IA.md`](GUIDE-IA.md)). Tout est en fichiers
lisibles, sur votre PC : aucun service en ligne, aucun compte.

## Plateformes

| Plateforme | Comment | Ce qu'il faut |
|---|---|---|
| **Web** | Navigateurs de Playwright : Chrome, Safari (WebKit, comme sur iPhone), Firefox ; tailles de téléphone, tablette, bureau | L'adresse de l'app (et la commande qui démarre son serveur, s'il y en a un) |
| **Android** (téléphone, tablette, TV) | Émulateurs, app pilotée par sa WebView, captures de l'écran Android | Une app à WebView (Tauri, Capacitor, Cordova…) en « version d'audit », une session ouverte par vous |
| **Bureau** (Windows, WebView2) | L'app lancée à chaque taille, pilotée par son port de débogage | Une « version d'audit » de l'app (port de débogage, taille de fenêtre au lancement) |

## Essayer en cinq minutes

Il faut [Node.js](https://nodejs.org) 20 ou plus récent. Placez le dossier de l'outil dans un projet
(ou dans un dossier vide), sous le nom `audit` par exemple, puis :

```
cd audit
npm install
npx playwright install chromium
cd ..
node audit passage --app exemple
node audit revue
```

La première commande installe l'outil, la deuxième le navigateur d'essai (un téléchargement). Le
passage audite une petite boutique d'exemple, livrée avec l'outil ([`exemple/`](exemple/)), qui
contient des défauts volontaires ; la revue s'ouvre ensuite dans votre navigateur.

Détails, et préparation d'Android et de Windows : [`INSTALLATION.md`](INSTALLATION.md).

## Auditer votre app

Demandez à votre IA de lire [`GUIDE-IA.md`](GUIDE-IA.md). Elle vous pose quelques questions
(plateformes, tailles, écrans à parcourir, données sensibles à cacher), puis crée la
**personnalisation** de votre app : un dossier à côté de `exemple/`, qui décrit l'app, son parcours et
ses réglages ([`PERSONNALISATION.md`](PERSONNALISATION.md)). Le reste de l'outil ne connaît aucune app.

## Le tour complet

```
node audit banc              0. prépare les appareils (émulateurs, versions d'audit à jour)
node audit passage           1. parcours, captures, mesures, revue
(l'IA interprète)            2. elle écrit interpretation.json, puis node audit refaire-revue <passage>
node audit revue             3. vous tranchez chaque défaut dans le navigateur
node audit lot creer         4. découpage des corrections en lots, expliqué
(l'IA corrige le lot)        5. les corrections du lot, et rien d'autre
node audit lot verifier      6. recompilation, passage ciblé, avant / après, verdict
```

Pas à pas, avec la règle des lots et des régressions : [`PROCESS.md`](PROCESS.md).

## Les commandes

Toutes se tapent depuis le projet : `node audit <commande>` (remplacez `audit` par le nom du dossier
de l'outil si vous l'avez appelé autrement). `node audit` seul les liste.

| Commande | Ce qu'elle fait |
|---|---|
| `node audit liste` | Écrans, profils et tailles de l'app |
| `node audit banc [options]` | Démarre les émulateurs utiles, recompile seulement les versions d'audit périmées ou absentes d'un émulateur |
| `node audit passage [options]` | Un passage, puis sa revue (registre mis à jour) |
| `node audit revue [<passage>]` | Ouvre la revue dans le navigateur ; chaque décision s'enregistre aussitôt. « J'ai terminé » la ferme |
| `node audit refaire-revue <passage>` | Refait la revue d'un passage (après l'interprétation) |
| `node audit lot creer \| verifier \| relire \| scinder \| clore \| etat` | Le tour guidé des corrections par lots ([`PROCESS.md`](PROCESS.md)) |
| `node audit avant-apres avant \| apres` | Avant / après d'une correction isolée, hors cycle de lots |
| `node audit comparer <avant> <après>` | Refait une comparaison (`--ids`, `--titre`) |
| `node audit decisions <fichier.json>` | Importe les décisions d'une revue partagée |
| `node audit recalculer` | Recalcule le statut de chaque défaut du registre |
| `node audit exporter <dossier>` | Copie de l'outil **sans** vos personnalisations ni vos données, contrôlée, prête à partager |

Un passage se désigne par son nom (`2026-09-24-07-04`) ou son chemin.

### Options d'un passage

| Option | Effet |
|---|---|
| `--app <nom ou chemin>` | La personnalisation ; par défaut, la seule présente dans le dossier de l'outil (sinon l'exemple). Aussi la variable `AUDIT_APP` |
| `--profile rapide` (défaut) / `complet` | Jeu de tailles de l'app (par exemple une par plateforme ; ou petit et grand de chacune) |
| `--device <plateforme>`, `--only <écrans>`, `--sizes <tailles>` | Restreindre le passage |
| `--cible` | Écrans et tailles des défauts « Inclure » encore à corriger |
| `--plan` | Ce que le passage ferait, sans rien lancer |
| `--reprendre <passage>` | Complète un passage interrompu (seulement les tailles qui manquent) |
| `--no-axe`, `--no-review` | Sans contrôle de contraste ; sans revue à la fin |
| `--delai-ecran <min>`, `--delai-taille <min>` | Délais maximums avant les garde-fous (6 et 30 min) |
| `--garder-emulateurs`, `--accepter-apk` | Laisse tourner les émulateurs ; audite une version compilée depuis un autre code (déconseillé) |

Les passages s'écrivent dans `audit-out/`, à la racine du projet (ou dans le dossier de la variable
`AUDIT_OUT`). Ce dossier reste **local** : les captures montrent vos données.

## Vos données

L'outil ne manipule **aucun identifiant** : vous vous connectez vous-même à l'app, il reprend la
session. Chaque app déclare ce qui est sensible chez elle (votre IA vous le demande avant le premier
passage) :

- `MASK` : éléments noircis dans **chaque capture**, dès la prise de vue (e-mail, nom, solde,
  adresse d'un serveur…) ;
- `SENSITIVE` : écrans entiers dont aucune image n'apparaît dans une revue ou un avant / après ;
- le bandeau du clavier Android (qui peut montrer le presse-papiers du PC) est toujours masqué ;
- une revue ne se partage qu'avec votre accord ; `node audit exporter` refuse de copier l'outil s'il y
  trouve une trace de vos apps, de votre PC ou une adresse e-mail.

## Ce qui est mesuré

| Règle | Ce qui est relevé |
|---|---|
| `page-overflow-x`, `offscreen-x` | La page défile en largeur (y compris quand un navigateur mobile dézoome pour tout montrer), un élément sort de l'écran |
| `text-clipped`, `text-overflow`, `text-line-cut`, `text-faded`, `text-tiny` | Texte coupé, qui déborde, ligne coupée en deux, caché sous un fondu, trop petit à l'écran |
| `overlap`, `covered` | Éléments cliquables qui se chevauchent, ou recouverts |
| `touch-target` | Écran tactile : zone qui réagit au doigt de moins de 44 points (marge tactile invisible comprise) |
| `focus-invisible`, `focus-clipped`, marche à la télécommande | Sélection invisible, rognée, perdue, hors de l'écran ; règles de parcours de l'app |
| `axe-color-contrast` | Contraste insuffisant (axe-core, WCAG AA) |
| `expected-missing`, `size-bounds` | Élément que le parcours exige ; tailles encadrées par l'app |
| `keyboard-auto` | Clavier système ouvert tout seul à l'arrivée sur un écran |
| `image-broken`, `image-blurry`, `image-oversized` | Images cassées, étirées, trop lourdes |
| `text-ellipsis` | Texte raccourci par « … » (pour information) |

Volontairement écarté : ce qui est sous une fenêtre plein écran, le contenu qui défile sous une barre
fixe, ce que recouvre un menu ouvert, le focus au toucher.

## Limites

- **Le jugement reste humain** : la mesure ne voit pas une mise en page cassée sans débordement, ni
  l'esthétique. D'où l'interprétation, et les constats vus à l'œil sur les captures.
- **Émulateur ≠ appareil réel** : pas de décodage vidéo matériel, pas de mesure de fluidité.
- **Contenu vivant** (images tirées au hasard, programmes TV) : il fait changer les captures d'un
  passage à l'autre ; les constats, eux, restent fiables.
- Le pilotage d'une WebView Android par Playwright est une fonction expérimentale de Playwright.
- Les messages de l'outil et sa documentation sont en français.

## Les documents

| Document | Pour |
|---|---|
| [`INSTALLATION.md`](INSTALLATION.md) | Installer l'outil ; préparer le web, Android, Windows |
| [`PERSONNALISATION.md`](PERSONNALISATION.md) | Décrire son app : parcours, tailles, données sensibles, réglages de revue |
| [`PROCESS.md`](PROCESS.md) | Le tour complet pas à pas, les lots, la règle des régressions |
| [`GUIDE-IA.md`](GUIDE-IA.md) | L'IA : démarrer sur un projet, interpréter, corriger |
| [`GRILLE.md`](GRILLE.md) | Le rangement des revues (fiches, ordre, filtres, sections) |
| [`FORMATS.md`](FORMATS.md) | Les fichiers d'un passage, lisibles par n'importe quelle IA |
| [`CONCEPTION.md`](CONCEPTION.md) | Principes, déroulement, pièges du banc d'essai, zones d'ombre |
| [`HISTORIQUE.md`](HISTORIQUE.md) | Versions, et comment l'outil a été éprouvé |
| [`exemple/`](exemple/) | L'app d'exemple (web), modèle d'une nouvelle personnalisation |

## Organisation du code

| Fichier | Rôle |
|---|---|
| `cli.mjs` | La commande `node audit <commande>` |
| `run.mjs` | Un passage |
| `banc.mjs` | La préparation des appareils |
| `lots.mjs`, `avant-apres.mjs` | Le tour guidé des corrections ; l'avant / après isolé |
| `exporter.mjs` | La copie contrôlée de l'outil |
| `core/measure.js` | Les mesures, exécutées dans la page (n'importe quelle page) |
| `core/page.mjs` | Gestes communs (cliquer, défiler, attendre la stabilité, contraste) |
| `core/android.mjs`, `core/emulators.mjs` | Pilote Android, émulateurs |
| `core/desktop.mjs`, `core/web.mjs` | Pilotes bureau et web |
| `core/app.mjs`, `core/build-id.mjs`, `core/mesure.mjs`, `core/rebuild.mjs`, `core/masque.mjs` | Personnalisation, empreinte du code, version de la mesure, recompilation, masquage |
| `review/` | Revue, registre, avant / après, revue locale, thème |
| `test/` | Tests de l'outil sur des passages fabriqués (`npm test` dans le dossier de l'outil) |

## Licence

[MIT](LICENSE) © 2026 kunai974. Vigie s'appuie sur [Playwright](https://playwright.dev) (Apache 2.0),
[axe-core](https://github.com/dequelabs/axe-core) (MPL 2.0), pngjs (MIT) et jpeg-js (BSD).
