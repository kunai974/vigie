# Conception de l'outil d'audit d'affichage

> Document **générique** : ce que fait l'outil, comment, et ce qu'il faut savoir pour s'en servir sur
> n'importe quelle app. Il a été construit et éprouvé en septembre 2026 sur une vraie app (web, Android
> téléphone et TV, Windows), appelée ici « l'app d'essai » : les leçons datées viennent de là.
> Document vivant, à compléter à chaque leçon apprise. Mode d'emploi : `README.md` ; versions et
> épreuves : `HISTORIQUE.md`.

## 1. Ce que fait l'outil

Il parcourt une app **web** (navigateurs de Playwright : Chromium, WebKit, Firefox), **Android**
(WebView, sur émulateurs : téléphone, tablette, TV) ou **de bureau** (WebView2), **écran par écran, à
plusieurs tailles**, capture chaque état, mesure les défauts d'affichage, puis produit une **revue** où
une personne tranche chaque défaut. Il garde la mémoire des défauts d'un passage à l'autre et prouve
chaque correction par un **avant / après**.

Il ne corrige rien : il constate, classe et prouve. Les décisions restent humaines.

### Trois rôles

| Qui | Quoi |
|---|---|
| **La machine** | Tout ce qui ne demande pas de jugement : lancer, parcourir, capturer, mesurer, fabriquer la revue, comparer avant / après |
| **L'interprète** (développeur ou assistant) | Lire la revue, écarter les faux positifs, expliquer les causes, conseiller, regarder les captures quand c'est utile |
| **Le décideur** (responsable de l'app) | Inclure, reporter ou exclure chaque défaut, avec une remarque ; valider les corrections |

## 2. Principes de conception

1. **Android pour les yeux, Playwright pour le cerveau.** Les captures viennent de l'écran Android
   (`screencap`) : c'est le rendu réel. Playwright, branché sur la WebView, sert à mesurer, naviguer
   et lire le focus. Les captures Playwright ne sont pas fidèles sur Android (mosaïque quand la page
   est mise à l'échelle, textes réduits).
2. **Naviguer par déclencheurs, jamais par coordonnées.** Chaque écran s'atteint en déclenchant un
   élément désigné par une étiquette stable (`data-tab`, `data-section`…). Un parcours par appuis à
   l'écran casse au moindre changement de mise en page. Seule exception : ouvrir le clavier sur
   téléphone exige un vrai toucher Android.
3. **Le banc d'essai d'abord.** Un émulateur mal réglé fabrique de faux défauts. L'outil vérifie son
   banc au départ et refuse d'auditer un appareil douteux (section 6).
4. **L'outil ne fait que naviguer.** Jamais de lecture vidéo, d'achat, de modification de compte ou
   de réglage. Les états rares se forcent par un pont d'audit, en mémoire, retirés aussitôt.
5. **Petite échelle, puis plus grande.** Un pilote sur un écran, puis le parcours entier ; un passage
   rapide (une taille par plateforme) au quotidien, un complet (petit et grand de chaque plateforme)
   avant une version.
6. **Plusieurs sources valent mieux qu'une.** Les meilleurs constats croisent mesure, capture et code.
   Une source seule reste « à confirmer ».
7. **Séparer l'outil de sa personnalisation.** Le cœur (`core/`, `review/`, `run.mjs`) ne connaît
   aucune app. Tout ce qui est propre à une app vit dans son dossier (`exemple/`, `<votre-app>/`).
8. **Des fichiers, pas un service.** Le dossier d'un passage est la source unique, en JSON et en
   Markdown lisibles par n'importe quelle IA (`FORMATS.md`) ; aucune dépendance à une IA ou à un
   service en ligne. Une page publiée n'est qu'une façon de partager.
9. **L'outil refuse de mentir.** Il refuse d'auditer une version compilée depuis un autre code, de
   comparer deux passages mesurés différemment, de sauter une étape du tour de corrections.

## 3. Le déroulement

```
 passage (node audit passage)          revue (node audit refaire-revue)        décision          avant / après
 ─────────────────────────        ─────────────────────────        ────────          ─────────────
 pour chaque taille d'écran  ──►  défauts dédoublonnés,       ──►  Inclure      ──►  passage ciblé « avant »
   pour chaque écran              gravité, priorité, conseil,      Plus tard         correction
     y aller                      galerie des captures             Exclure           passage « après »
     attendre la stabilité        registre mis à jour              + remarque        comparaison
     capturer (Android)           (nouveau, corrigé…)                                statut dans le registre
     mesurer (dans la page)
     marche à la télécommande (TV)
     défiler, clavier, variantes
```

### 3.1 Un passage

**Avant tout** : les émulateurs de l'app sont démarrés s'ils ne tournent pas (à froid et sans
instantané : horloge juste, instantané de l'utilisateur intact), le banc est vérifié (section 6), et
l'APK d'audit doit être compilé depuis le code en cours (empreinte du contenu des fichiers de l'app,
`core/build-id.mjs`, embarquée dans l'APK et relue par l'outil). À la fin, les tailles d'origine sont
remises et les émulateurs démarrés par l'outil arrêtés.

Pour chaque appareil (TV et téléphone **en parallèle**), pour chaque taille demandée, pour chaque
écran du parcours :

1. **Y aller** : la fonction `go` de l'écran déclenche les éléments qui y mènent.
2. **Attendre la stabilité** : plus de squelette de chargement, images visibles chargées.
3. **Capturer** l'écran Android ; masquer le bandeau du clavier (presse-papiers du PC).
4. **Mesurer** dans la page (section 4).
5. **Marcher à la télécommande** (TV) : une suite de flèches ; à chaque touche, la sélection doit
   rester visible, avec son liseré, et respecter les règles de parcours de l'app.
6. **Décliner** : défilements (un pas, ou jusqu'en bas), capture calée sous une bannière, clavier
   ouvert, texte tapé, variantes forcées (vide, erreur, chargement, menu ouvert, fenêtre).

Le rapport brut (`audit-out/<date>/report.json`, captures, `index.html`) est écrit après chaque
taille : rien n'est perdu si le passage s'arrête.

**Garde-fous : ne jamais attendre ce qui n'arrive pas.** Un émulateur peut se figer (vu sur Google TV)
sans rien signaler. Donc : délai maximum sur chaque commande `adb` et sur la liste des appareils ; un
écran qui dépasse 6 minutes est abandonné, le pilote de ce parcours est arrêté (toute action qu'il
tenterait encore échoue aussitôt, pour qu'il n'écrive plus rien), l'app est relancée et le parcours
reprend à l'écran suivant ; une app qui ne répond plus après un échec est relancée de même ; une taille
qui dépasse 30 minutes, ou qui échoue au démarrage, fait redémarrer l'émulateur à froid, puis elle est
refaite une fois ; au-delà, elle est notée en échec et le passage continue. Un passage à qui il manque
une taille se dit `INCOMPLET` et donne la commande de reprise.

### 3.2 La revue

Construite à partir du rapport brut (`review/build.cjs`) :

- **dédoublonnage** : un défaut = plateforme + règle + élément (balise et première classe), quel que
  soit le nombre d'écrans et de tailles où il se voit ;
- **familles** avec un conseil « à obtenir » (quoi, pas comment) ;
- **gravité** : Bloquant, Important, Mineur, À trancher ; **priorité de correction** recommandée
  (forte, moyenne, faible) selon la gravité, l'étendue et l'effort estimé ;
- constats « information » repliés à part, comparaison des tailles (état de base de chaque écran) ;
- **parcours complet** par appareil et par taille : toutes les captures dans l'ordre du passage, pour
  une relecture rapide ; une capture identique à une autre est estompée (« identique en 1080p »), et
  n'est gardée qu'une fois dans les images ;
- **planches d'images** : les captures d'une taille sont réunies en une ou deux images JPEG que la page
  découpe à l'affichage ; le dossier de revue (une vingtaine de fichiers pour 600 captures) se publie
  en une fois ;
- décisions Inclure / Plus tard / Exclure + remarque, préremplies depuis le registre ; tranchées dans
  la **revue locale** (`node audit revue` : un petit serveur sur le PC écrit chaque choix dans le passage
  et le registre) ;
- **une fiche par défaut, toutes plateformes confondues** (23/09) : un défaut vu sur la TV et le
  téléphone est une seule fiche à pastilles, la décision vaut pour ses deux identités du registre ;
  grille de rangement fixe et filtres (`GRILLE.md`) ; ce qui a été exclu ou reporté avant est rangé à
  part ; les faux positifs écartés sont mémorisés dans le registre.

**Interprétation.** Après le passage automatique, l'interprète lit `revue/a-relire.md` (chaque défaut,
son identifiant, sa planche de relecture), regarde les planches utiles et écrit
`audit-out/<date>/interpretation.json`, que la revue intègre à sa fabrication suivante :

```json
{
  "resume": "Synthèse en quelques lignes, affichée en tête de la revue.",
  "items": {
    "<identifiant du défaut>": { "gravity": "important", "avis": "Le souci, expliqué.", "reco": "La correction recommandée.", "effort": "simple" },
    "<identifiant d'un faux positif>": { "faux": "Pourquoi la mesure s'est trompée." }
  },
  "constats": [
    { "kind": "tv", "name": "Nom lisible", "el": "identifiant stable", "shot": { "run": "tv-tv-720p", "id": "home-films" },
      "message": "Ce qui se voit", "gravity": "important", "avis": "…", "reco": "…", "boxes": [[x, y, l, h]] }
  ]
}
```

Les faux positifs ne disparaissent pas : ils sont rangés à part (« Écartés à la relecture ») avec leur
raison, et mémorisés dans le registre pour ne plus être signalés. `groupes` réunit plusieurs défauts
d'une même cause en une fiche (une correction). Consignes de l'interprète : `GUIDE-IA.md`. Un constat vu à l'œil devrait, à terme, devenir une règle ou un élément attendu (`expect`).

### 3.3 Le registre (mémoire)

Un fichier par projet, versionné avec le code. Les passages y sont rangés **par leur date réelle**
(pas par leur nom : un passage nommé « lot1-apres » se rangeait après un passage du soir, 23/09), et le
dernier statut d'un défaut est celui du dernier passage qui l'a **vraiment regardé** (un passage
Windows seul ne rend pas « non vérifiés » les défauts de la TV). Chaque défaut y a son identité stable, ses **lieux**
(taille | écran), son historique et la décision. À chaque passage il est **nouveau**, **toujours
là**, **réapparu**, **corrigé** (un de ses lieux repassé sans le retrouver) ou **non vérifié** (aucun
de ses lieux repassé : l'absence ne prouve rien). Quand un défaut vu à l'œil devient mesurable, son
ancienne identité est renommée vers la nouvelle et la décision suit.

### 3.4 L'avant / après

Le tour guidé par lots (`PROCESS.md`, `node audit lot`) : le passage de la revue sert d'« avant » à
tous les lots ; chaque lot recompile **toutes** les plateformes qu'il touche (Windows compris), refait un
passage sur ses seuls écrans et tailles, compare, et note « prouvé », « incomplet » ou « régression ».
Un même changement vu à plusieurs tailles ou états n'est montré qu'une fois. Deux passages mesurés avec
des versions différentes de l'outil (`core/mesure.mjs`) ne se comparent pas.

En détail : un passage ciblé avant la correction, le même après (version recompilée), puis la comparaison
(`review/compare.cjs`) : captures côte à côte, constats disparus et apparus, part des pixels qui
changent, écrans de nouveau atteints, statut des défauts visés. Élargir le passage à quelques écrans
voisins et à une autre taille sert de **contrôle de non-régression** : ce qui ne devait pas bouger
doit rester identique (au plus 1 à 2 % de pixels, le contenu en direct).

## 4. Ce qui est mesuré

| Famille | Exemples |
|---|---|
| Débordements | page plus large que l'écran, élément hors écran |
| Textes | coupés, qui débordent, trop petits (taille réelle à l'écran, échelle comprise), cachés sous un fondu, ligne coupée en deux par le bord d'un cadre |
| Éléments cliquables | chevauchements, masqués par un autre, zones tactiles trop petites (téléphone) |
| Sélection (TV) | liseré absent ou rogné, sélection perdue ou hors écran à la télécommande, règles de parcours |
| Tailles encadrées | règles fournies par l'app (ex. cartes entre deux largeurs) |
| Éléments attendus | élément que le parcours exige à l'écran (`expect`) |
| Accessibilité | contraste (axe-core) |
| Images | cassées, étirées, trop lourdes (information) |
| Clavier | ouvert tout seul à l'arrivée sur l'écran |

Ce qui est volontairement écarté : ce qui est sous un calque plein écran (y compris sous un menu
ouvert qui cache une bonne part d'un petit écran), le contenu qui défile sous une barre fixe (c'est le
design), ce que recouvre un menu ouvert (c'est la variante testée), le focus au toucher, et le focus
des variantes ouvertes par script (menus, synopsis) : la sélection n'y a pas bougé comme elle le
ferait à la télécommande.

Zone tactile : c'est la zone qui réagit au doigt qui compte, pas la boîte dessinée. Une « marge
tactile invisible » (pseudo-élément `::before` / `::after` en position absolue qui déborde de la
boîte) et l'étiquette cliquable d'une case à cocher sont prises en compte. Limite : le rognage par un
parent (`overflow: hidden`) n'est pas mesuré.

## 5. Ce qu'une app doit fournir

0. **Web** : seulement son adresse (et la commande qui démarre son serveur). Le reste de cette liste
   concerne Android et le bureau.
1. **Une version d'audit** où la WebView se laisse piloter (Android : débogage WebView activé), à
   réserver aux émulateurs et absente de toute version publiée.
2. **Des étiquettes stables** sur les éléments de navigation (`data-*`), plutôt que des positions.
3. **Facultatif mais précieux : un pont d'audit** (objet global en version d'audit, nom déclaré par
   l'app) : `set(groupe, clé, valeur)` force les états rares (vide, erreur, chargement, fenêtres), et
   `build` donne l'empreinte du code compilé (`core/build-id.mjs`), que l'outil compare au code en cours.
4. **Une session ouverte** sur l'émulateur, ouverte par une personne : l'outil ne manipule aucun
   identifiant.
5. **La personnalisation** (dans son dossier `audit/<nom>/`, choisi par `--app <nom>` s'il y en a plusieurs ; détail : `PERSONNALISATION.md`) : nom de l'app,
   paquet, émulateurs, tailles, fichiers qui font l'app (empreinte), nom du pont d'audit, commande de
   recompilation de la version d'audit ; le parcours (`screens.mjs` : écrans, chemin, défilement,
   clavier, variantes, éléments attendus, marche à la télécommande, profils de tailles), les réglages de
   revue (`review.cjs` : noms lisibles, conseils, gravités ajustées, zones sensibles, faux positifs
   connus, constats vus à l'œil), le registre (`registre.json`).

## 6. Le banc d'essai et ses pièges

Chaque piège ci-dessous a produit de faux défauts avant d'être compris. L'outil contrôle ceux qu'il
peut au départ (`preflight`).

| Piège | Symptôme | Parade |
|---|---|---|
| **Horloge figée** après la reprise d'un instantané d'émulateur | session refusée (jeton « expiré »), l'app reste sur une erreur | redémarrage à froid (`-no-snapshot-load`) ; contrôle au départ |
| **Écran tactile déclaré « stylet »** (émulateurs Android 15 et plus) | le clavier à l'écran est remplacé par la pilule d'écriture au stylet de Gboard | `settings put secure stylus_handwriting_enabled 0`, appliqué d'office |
| **Clavier physique déclaré** (`hw.keyboard=yes`) | pas de clavier à l'écran ; un champ focalisé passe pour « clavier ouvert » | `hw.keyboard=no` dans la configuration de l'émulateur téléphone ; contrôle au départ. La TV garde son clavier (il sert de télécommande) |
| **Presse-papiers du PC** partagé avec l'émulateur | Gboard l'affiche dans son bandeau (e-mail, mot de passe copiés) | bandeau masqué sur chaque capture clavier ouvert |
| **Plusieurs écrans déclarés** (émulateur à taille variable) | capture vide ou du mauvais écran | capture avec l'identifiant de l'écran principal |
| **App fermée après installation** d'un APK | WebView non pilotable, passage refusé | relancée d'office par son lanceur au départ du passage |
| **Clavier impossible à ouvrir par programme** (téléphone) | la mise au point d'un champ n'ouvre pas le clavier | un vrai toucher Android, seule exception à la règle « pas d'appui » |
| **Clavier TV endormi** après un démarrage à froid (vu le 22/09) | OK sur un champ n'ouvre pas le clavier, tant qu'un premier toucher ne l'a pas réveillé ; le constat « clavier ouvert tout seul » devient alors invisible | l'outil tente un toucher quand OK échoue ; un passage « avant » et un « après » doivent être mesurés dans le même état du banc |
| **Branchement Playwright expérimental** sur WebView Android | peut casser à une mise à jour | version de Playwright figée ; vérifier à chaque mise à jour |
| **Taille d'écran changée** en cours de route | mise en page d'une autre taille ; ou mise en page choisie trop tôt par l'app (vu sur l'app d'essai : barre de catégories choisie avant la détection de la TV) | l'outil change la taille et la densité, relance l'app, attend ; l'app doit décider de sa mise en page au rendu |
| **Toucher l'émulateur pendant un passage** | captures faussées | ne pas utiliser les émulateurs pendant un passage |
| **APK d'une autre version du code** (vu le 23/09 : APK compilé sur une branche abandonnée, resté sur les émulateurs) | le passage mesure un autre code que celui en cours | empreinte du code embarquée dans l'APK d'audit, comparée au départ ; passage refusé si elle diffère |
| **Émulateur figé** (vu le 22/09 : TV bloquée une heure sans rien signaler) | passage qui n'avance plus | délais maximums partout, relance de l'app, redémarrage à froid de l'émulateur, taille refaite (section 3.1) |
| **Première touche avalée** (vu le 23/09, TV) | juste après le lancement de l'app, la première touche de télécommande n'arrive pas à la page (Android donne alors la main à la WebView) : un test qui commence par OK conclut à tort que OK ne fait rien | une première flèche « d'échauffement » avant tout test d'une touche |
| **Toucher sur une page mise à l'échelle** (vu le 23/09, TV) | le toucher tombe à côté de l'élément (toile 1280 de large affichée sur un écran de densité 2) | position calculée avec l'échelle réelle de la page à l'écran (largeur de la WebView / largeur de la page), pas avec la densité |
| **Navigateur mobile qui dézoome** (vu le 23/09, mode web) | une page plus large que l'écran élargit la zone d'affichage : elle paraît tenir, aucun débordement relevé | la largeur de la page est comparée à celle qu'elle déclare (balise `viewport` : `device-width` = l'écran ; un nombre = une toile voulue, comme une TV mise à l'échelle) |
| **Défilement animé** (vu le 23/09, TV) | juste après une flèche, la sélection paraît hors de l'écran alors que la liste la ramène | la marche à la télécommande attend la fin du défilement (1,5 s au plus) avant de conclure |
| **Fenêtre du système par-dessus l'app** (vu le 22/09 : Google TV refuse une résolution non 16:9 et affiche un avertissement, puis ses Paramètres) | mesures d'une page cachée, passage bloqué | l'app est ramenée au premier plan avant chaque capture (noté au journal), durée maximale par écran, reprise d'un passage interrompu (`--reprendre`) |

## 7. Zones d'ombre (générales, pas propres à une app)

- **Un état perdu est une régression** (leçon du premier avant / après, 23/09) : une correction du
  clavier TV empêchait l'ouverture automatique, mais aussi l'ouverture demandée. Les constats avaient
  disparu, la page annonçait « Corrigé ». Désormais, un état atteint avant et plus après est signalé
  en tête de la page, et les défauts de son écran passent « À vérifier ». Et une correction qui touche
  un comportement (pas seulement l'affichage) se vérifie aussi par un test de ce comportement.
- **Pixels et contenu vivant** : une fiche qui tire son image de fond au hasard change à 40 % sans que
  la mise en page bouge. Piste : comparer la position des éléments plutôt que les pixels.

- **Ce que la mesure ne voit pas** : une mise en page cassée sans débordement (colonne disparue,
  grand vide), l'esthétique, la cohérence avec la charte, les animations. D'où le regard sur les
  captures, coûteux : il doit rester ciblé (captures signalées par la mesure, captures qui changent
  d'un passage à l'autre). Chaque défaut vu à l'œil devrait devenir un contrôle (`expect`, règle).
- **Émulateur ≠ appareil réel** : pas de décodage vidéo matériel, pas de mesure de fluidité, densités
  et polices système à vérifier sur un vrai appareil.
- **Faux positifs** : chaque nouvelle règle en produit ; ils se découvrent à l'usage et s'écartent dans
  la mesure (générique) ou dans les réglages de l'app (propre à l'app). Les passages anciens mesurés
  avec une règle fautive restent dans le rapport brut : les réglages de revue les écartent.
- **Identité d'un défaut** : liée à la classe CSS de l'élément. Si une correction renomme la classe, le
  défaut paraît « corrigé » et un autre « nouveau » : l'avant / après le montre, le renommage dans le
  registre le rattache.
- **Contenu vivant** : catalogues, guides TV, images qui changent d'un passage à l'autre bruitent la
  comparaison de pixels.
- **Avant / après honnête** : les deux passages doivent être mesurés avec la même version de l'outil
  (vérifié depuis le 23/09 : `mesure` dans chaque passage) et dans le même état du banc (clavier TV
  réveillé ou non : pas encore vérifié par l'outil).
- **Temps** : un passage complet de 8 tailles (2 appareils en parallèle) prenait environ 50 minutes, le
  téléphone (5 tailles) fixant la durée. **Plus d'émulateurs en parallèle** (23/09) : des copies en
  lecture seule du même appareil virtuel (`-read-only`) partageraient la même session de l'app ; or
  un service de comptes qui fait tourner ses jetons de session (Supabase le fait par défaut) révoque
  la session quand deux copies la renouvellent, et l'utilisateur serait déconnecté. Solution propre :
  un second appareil virtuel téléphone, avec **sa propre session** ouverte une fois par l'utilisateur ;
  les tailles se répartiraient alors sur trois émulateurs (≈ 35 minutes).
- **Écrans d'avant la connexion** : demandent un émulateur dédié, jamais connecté, et un compte de test.
- **Préréglages de taille** : déclarés par l'app (`SIZES`), appliqués par des commandes `adb` directes
  (23/09).
- **Relecture des captures** (23/09) : les vignettes de la revue sont trop petites pour lire un texte,
  les captures d'origine trop grandes pour être regardées une à une. L'outil prépare donc des planches
  de relecture (`review/relire.cjs`) : chaque défaut encadré et agrandi, chaque écran à toutes les
  tailles côte à côte. C'est ce que l'interprète fabriquait à la main pendant la première relecture.
- **Doublons de captures** : repérés par une empreinte de l'image, plus fine sur grand écran (23/09 :
  « Live TV vide » et « en erreur » confondus en 1920 × 1080) ; une seule zone nettement différente
  suffit à garder les deux. Chaque capture n'est réduite qu'une fois (banque d'images du passage,
  `.images/`), réutilisée par la revue et chaque avant / après.

## 8. Choisir ce qu'on audite

Options d'un passage (profils, plateformes, écrans, tailles, ciblage) : `README.md`. Enchaînements
automatiques : un passage se termine par sa revue ; le tour des corrections se fait en quelques
commandes (`node audit lot`, `PROCESS.md`) qui recompilent, repassent et comparent ; les décisions
s'écrivent directement depuis la revue locale. Seul le jugement reste humain : interpréter, décider,
valider les corrections.

## 9. Organisation du code

Voir `README.md` (section « Organisation du code »). Tout est générique, sauf les dossiers de
personnalisation (`exemple/`, `<votre-app>/`) ; `test/` vérifie l'outil sur des passages fabriqués.

## 10. Questions ouvertes

- Regard ciblé sur les captures : quelles captures, à quelle résolution, avec quelle grille (charte).
- iOS natif (hors Safari) : pilotage à écrire. Échelle 125 % de Windows : simulée, à comparer à un
  vrai Windows.
- Forme de la personnalisation : du code aujourd'hui (souple), des fichiers de configuration plus tard ?
- Traduction de l'outil et de sa documentation (aujourd'hui en français).
