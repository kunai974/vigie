# Le tour complet, pas à pas

> Générique. Le process décidé avec l'utilisateur le 23/09/2026 ; outillé le 23/09 (`node audit lot`).
> Trois rôles : **la machine** (tout ce qui ne demande pas de jugement), **l'interprète** (une IA, ou
> un développeur), **le décideur** (le responsable de l'app). Le détail des fichiers : `FORMATS.md`.

```
 1. passage ──► 2. interprétation ──► 3. revue ──► 4. lots ──► 5. corrections ──► 6. vérification ──► (lot suivant)
   machine        interprète            décideur     décideur     interprète          machine
                                                    + machine                         + décideur (lit)
```

## 0. Le banc (machine)

`node audit banc` (mêmes options que le passage) : démarre les émulateurs utiles et recompile seulement
les versions d'audit dont le code a changé. Le passage suivant arrête ce que le banc a démarré.

## 1. Le passage (machine)

`node audit passage --profile complet` (ou `rapide`) : démarre les appareils, parcourt, capture, mesure,
fabrique la revue et met à jour le registre. Aucun geste manuel ; ne pas utiliser les appareils pendant
ce temps. Un passage à qui il manque une taille le dit (`INCOMPLET`) et donne la commande de reprise.

Ce passage devient le **passage de départ** : il servira d'« avant » à tous les lots du cycle.

## 2. L'interprétation (interprète)

L'interprète lit `revue/a-relire.md`, regarde les planches de relecture utiles, et écrit
`interpretation.json` : synthèse, avis et recommandation par défaut, **faux positifs** écartés avec leur
raison, **regroupements** (plusieurs défauts d'une même cause, une seule correction), constats vus à
l'œil. Puis `node audit refaire-revue <passage>` refait la revue avec. Consignes : `GUIDE-IA.md`.

## 3. La revue (décideur)

`node audit revue` ouvre la revue dans le navigateur. Pour chaque fiche : **Inclure** (à corriger),
**Plus tard** ou **Exclure**, avec une remarque si besoin. Chaque choix s'écrit aussitôt dans le passage
et dans le registre. « J'ai terminé » ferme la revue.

- « Exclure » ne revient plus parmi les défauts à trancher ; « Plus tard » est rangé à part.
- Une fiche « pour information » peut aussi être incluse : elle entre alors dans les lots comme les autres.
- La revue peut aussi être publiée pour la partager (page autonome) ; ses décisions se reportent alors
  par `node audit decisions`.

## 4. Les lots (décideur, expliqué par la machine)

`node audit lot creer` : l'outil compte les corrections décidées (fiches « Inclure » pas encore
corrigées), **explique le choix** et propose un découpage, sans rien créer :

- **1 lot = toutes ses corrections faites et intégrées, puis 1 recompilation et 1 avant / après.**
- **Plus un lot est gros, moins l'avant / après est parlant** : un changement d'image peut avoir
  plusieurs causes, une régression est plus dure à attribuer.
- **Un petit lot coûte plus de passages** (compter 15 à 30 minutes par lot, sans intervention).

Le décideur choisit : `node audit lot creer --lots <n>`. Les lots gardent les familles de défauts
ensemble autant que possible, et se font **dans l'ordre**.

Les fiches laissées sans décision ne bloquent rien : elles restent pour la prochaine revue. Refus de
l'outil : passage de départ mesuré avec une autre version de l'outil, cycle déjà en cours
(`--remplacer` pour l'abandonner).

## 5. Les corrections (interprète)

L'interprète fait **toutes** les corrections du lot, rien d'autre :

- une correction suit la recommandation validée et les règles du projet (charte, règlement CSS) ;
- **ce qui est repéré en chemin et ne fait pas partie du lot n'est pas corrigé** : il va dans
  `avant-apres-notes.json` (section « Repéré en chemin ») et attend la décision du décideur ;
- une correction qui touche un **comportement** (pas seulement l'affichage : un clavier qui doit
  s'ouvrir, une touche qui doit agir) se vérifie aussi par un vrai test de ce comportement ;
- pour chaque défaut du lot, l'interprète écrit **ce qu'il a changé**, en une ou deux phrases simples
  (fichier, quoi, pourquoi), dans `<sortie>/lots/<passage de départ>/corrections.json`
  (`{ "<identifiant>": "texte" }`) : la page avant / après l'affiche sous chaque défaut ;
- les vérifications du projet passent (tests, types, règlement CSS) avant la vérification du lot.

## 6. La vérification (machine, lue par le décideur)

`node audit lot verifier` :

1. refuse si le code de l'app n'a pas changé depuis le passage de départ (ou la dernière vérification) ;
2. **recompile toutes les plateformes que le lot touche** (Android, Windows) ;
3. refait un passage **sur les seuls écrans du lot, aux tailles du passage de départ** (les seules que
   l'avant / après peut comparer) ;
4. le compare au passage de départ (réutilisé : pas de nouveau passage « avant ») ;
5. note le résultat dans le cycle et dans la revue de départ (« Corrigé et prouvé (lot 2) »…).

**La page avant / après** (règle par défaut depuis le 23/09, demande de l'utilisateur) commence par
**une fiche par défaut du lot** : la capture « avant » avec le défaut **encadré en rouge**, la même
capture « après » avec la même zone (en **vert** si le défaut a disparu, en rouge s'il est encore là), un
**agrandissement de la zone** des deux côtés, **le souci** (interprétation de la revue), **ce qui a été
changé** (`corrections.json`), ce qui est mesuré avant et après, et le verdict. Images nettes (pleine
résolution, réduite à 1280 px de large, 540 pour un écran en hauteur), jamais des vignettes compressées.
Viennent ensuite les écrans qui changent (contrôle de non-régression) et ce qui est repéré en chemin.

| Résultat | Sens | Suite |
|---|---|---|
| **Prouvé** | Tous les défauts du lot ont disparu, aucun état perdu, aucun constat nouveau sur ses écrans | Lot suivant |
| **Incomplet** | Au moins un défaut du lot est toujours là (ou pas repassé) | Reprendre la correction, puis revérifier |
| **Régression** | Un état de l'écran n'est plus atteint, ou un constat nouveau est apparu sur un écran du lot | Voir ci-dessous |

### La règle des régressions

- **Une régression causée par le lot se traite dans le lot** : c'est une régression si elle apparaît
  sur un écran que le lot touche (constat nouveau, état perdu). On la corrige, puis on revérifie.
- **Un état perdu parce que la correction a réussi** (ex. un texte qui tient désormais en entier : plus
  rien à dérouler) n'est pas une régression, mais la machine ne peut pas le savoir : l'interprète le
  constate sur les captures « après » (`etats` dans l'interprétation de ce passage, avec la raison), puis
  `node audit lot relire`. La page avant / après le dit ; sans ce constat, l'état perdu reste une régression.
- **Ce qui apparaît ailleurs** (écran hors du lot) n'est pas une régression du lot : c'est « repéré en
  chemin », pour le décideur.
- **Pas de boucle de correction infinie** : on ne revérifie pas après chaque retouche, seulement quand
  toutes les retouches du lot sont faites. Au bout de **3 vérifications** d'un même lot, l'outil
  refuse : on s'arrête pour en parler. Le décideur peut **clore** un lot non prouvé
  (`node audit lot clore <n> --raison "…"`) pour passer au suivant ; la raison est notée.

### Un lot en partie réussi

Quand la plupart des défauts d'un lot sont corrigés et qu'un ou deux résistent, on n'est pas obligé de
tout revérifier à chaque retouche. Le verdict propose trois choix (décision de l'utilisateur, 23/09) :

- **scinder** (`node audit lot scinder`) : les défauts corrigés sont acquis (le lot est prouvé pour eux),
  ceux qui résistent partent dans un **nouveau lot**, à la fin du cycle, qu'on reprend quand on veut ;
- **reprendre** : retoucher, puis revérifier le lot entier (contrôle de non-régression complet) ;
- **clore** : s'arrêter là, avec une raison.

Un constat vu à l'œil que la machine ne peut pas prouver est « à confirmer à l'œil » : l'interprète le
confirme sur la capture « après » (`corriges` dans l'interprétation de ce passage), puis
`node audit lot relire` recalcule le verdict sans nouveau passage.

`node audit lot etat` dit à tout moment où en est le cycle et quelle est la prochaine commande.

## 7. Le suivi

- Les défauts corrigés disparaissent des revues suivantes (« Corrigés depuis le passage précédent ») ;
  un défaut qui revient est signalé « Réapparu ». Une correction prouvée par un lot sur les tailles de
  son passage de départ se constate aux autres tailles au prochain passage qui les couvre (profil
  `complet`) : la revue la rattache alors au lot (« corrigé · lot 1 du … »).
- Les faux positifs écartés sont mémorisés : ils ne sont plus signalés.
- Les passages et le registre gardent tout : on peut toujours revenir sur une décision.

## Condition de sortie de l'outil (décidée le 23/09)

Un tour complet (étapes 1 à 6), **entièrement tenu par l'outil et ce process, sans bricolage**, sur les
trois plateformes. Chaque accroc devient une correction de l'outil, puis on recommence.
