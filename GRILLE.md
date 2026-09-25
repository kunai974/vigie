# Grille de rangement des revues

> Générique : vaut pour toute app auditée. Mise en œuvre : `review/build.cjs` (ordre, fiches),
> `review/template.html` (page), `review/summary.cjs` (`revue.md`). Décidée le 23/09/2026.

Une revue range toujours les défauts de la même façon, pour qu'on s'y retrouve d'un passage à l'autre
et d'une app à l'autre.

## 1. Une fiche par défaut

Un défaut, c'est **une règle mesurée sur un élément** (ex. « zone tactile trop petite » sur « le cœur
des favoris »), quel que soit le nombre d'écrans, de tailles et de **plateformes** où il se voit.

- Vu sur la TV et sur le téléphone : **une seule fiche**, avec ses pastilles de plateforme. Le
  registre garde une identité par plateforme (un défaut peut être corrigé sur l'une et pas sur
  l'autre) : la décision prise sur la fiche s'applique à toutes.
- **Regroupements de l'interprète** : plusieurs défauts d'une même cause, qu'une seule correction
  règle, peuvent être réunis en une fiche (`groupes` dans `interpretation.json`, voir `GUIDE-IA.md`).

## 2. L'ordre

1. **Famille** (débordements, textes, sélection à la télécommande, zones tactiles…), avec pour chacune
   ce qu'il faut obtenir. Les familles viennent dans l'ordre de leur défaut le plus grave ; les
   questions de conception (« À trancher ») après les défauts.
2. Dans une famille : **gravité**, puis **priorité**, puis nombre de **plateformes**, puis nombre
   d'**écrans**, puis le nom.

| Gravité | Sens |
|---|---|
| Bloquant | Empêche d'utiliser l'écran |
| Important | Se voit et gêne |
| Mineur | Gêne peu, ou rarement |
| À trancher | Question de conception plus que défaut |
| Info | Pas un défaut en soi (repliés à part) |

**Priorité de correction** (recommandée) : la gravité, plus un cran si le défaut est étendu (4 écrans,
2 tailles ou 2 plateformes et plus), plus un cran si la correction est simple, moins un si elle est
lourde. Forte, moyenne ou faible ; « à décider » pour ce qui est à trancher.

## 3. Les filtres

Plateforme, gravité, priorité, écran, taille, décision (dont « sans décision »). Ils ne changent pas
l'ordre, seulement ce qui est affiché. Les boutons « toute la famille » ne visent que les fiches
affichées.

## 4. Les sections

| Section | Contenu |
|---|---|
| Défauts à trancher | Tout ce qui n'a pas été mis de côté avant cette revue |
| Corrigés depuis le passage précédent | Défauts dont un lieu a été repassé sans les retrouver |
| Plus tard | Décidé « Plus tard » **avant** cette revue : rangé à part, repliable |
| Exclus | Décidé « Exclure » avant cette revue : ne revient plus parmi les défauts |
| Écartés à la relecture | Faux positifs de la mesure, avec leur raison ; mémorisés dans le registre, ils ne sont plus signalés |
| Pour information | Constats qui ne sont pas des défauts (textes raccourcis, images lourdes) |
| Captures | Par plateforme : chaque écran à toutes les tailles, puis le parcours complet |

Une fiche qu'on met de côté pendant la revue reste à sa place jusqu'à la revue suivante : elle ne
saute pas sous les yeux.

## 5. Présentation

Couleurs neutres propres à l'outil (`review/theme.css`), claires ou sombres selon le réglage du
système : la revue ne reprend pas la charte de l'app auditée. Les pages sont autonomes (une page et
ses planches d'images) : elles s'ouvrent en local ou se publient telles quelles.
