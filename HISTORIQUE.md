# Historique de Vigie

## 0.9.0 — 24/09/2026 : première version autonome, nommée Vigie (licence MIT)

Première version utilisable hors de l'app sur laquelle l'outil a été construit.

- **Plateformes** : web (Chromium, WebKit, Firefox), Android (téléphone, tablette, TV, sur émulateurs),
  bureau Windows (WebView2, Electron).
- **Passage** : parcours par déclencheurs, captures, mesures (débordements, textes, cibles tactiles,
  sélection à la télécommande, contraste, images, clavier), plateformes en parallèle, garde-fous
  (délais maximums, relance, redémarrage d'un émulateur figé), reprise d'un passage interrompu.
- **Banc** : émulateurs démarrés et arrêtés par l'outil, versions d'audit recompilées seulement si le
  code a changé ou si un émulateur ne les a pas reçues ; refus d'auditer une version compilée depuis un
  autre code.
- **Revue** : une fiche par défaut, toutes plateformes confondues ; gravité, priorité, grille fixe ;
  interprétation par une IA (avis, fausses alertes écartées, regroupements, constats vus à l'œil) ;
  décisions prises dans le navigateur, écrites dans le passage et le registre.
- **Mémoire** : registre des défauts d'un passage à l'autre ; « corrigé » seulement si le défaut a pu
  être cherché (même version de la mesure, même état de l'écran) ; « réapparu » seulement après une
  correction constatée.
- **Corrections prouvées** : tour guidé par lots, recompilation des plateformes touchées, passage ciblé,
  avant / après défaut par défaut (avant encadré en rouge, après en vert, agrandissements, ce qui a été
  changé), régressions, confirmation à l'œil, état disparu pour une bonne raison.
- **Données** : masquage dans chaque capture, écrans jamais montrés, passages locaux ; `exporter`
  refuse de copier l'outil s'il y trouve une trace d'une app, du PC ou une adresse e-mail.
- **Commande unique** : `node audit <commande>`, quel que soit le nom du dossier.

## Comment l'outil a été éprouvé

Construit du 21 au 24/09/2026 sur une vraie app (lecteur vidéo : web, Android téléphone et TV,
Windows), « l'app d'essai ». Règle suivie : l'outil d'abord ; l'app n'est corrigée que pour éprouver
l'outil, et seulement ce que son responsable a décidé.

| Étape | Résultat |
|---|---|
| Fondations (21-22/09) | Banc d'essai, parcours complet, mesures, captures, première revue |
| Mémoire et preuve (22/09) | Registre ; premier défaut corrigé et prouvé par un avant / après |
| Autonomie (22-23/09) | Passage et revue en une commande ; décisions sans recopie ; tour par lots |
| Grande épreuve (23/09) | Premier tour complet sur 3 plateformes en même temps (11 min, 217 captures) ; 21 accrocs relevés, surtout dans la mémoire et le jugement de l'outil (faux « corrigés », ciblage trop large) : tous corrigés et testés |
| Mini-tour tablette (23/09) | Tour complet sur une plateforme, sans bricolage |
| Tour de sortie (24/09) | Condition de sortie : un tour complet sur les 3 plateformes, sans geste manuel ni correction de l'outil en cours de route. Deux tours interrompus (appli d'audit absente d'un émulateur ; statuts « réapparu » faux), outil corrigé à chaque fois ; **troisième tour tenu de bout en bout**. Deux cas limites trouvés en usage réel (fiche « pour information » incluse ; état disparu parce que la correction a réussi), corrigés et testés après le tour |

Les leçons de ces épreuves sont dans [`CONCEPTION.md`](CONCEPTION.md) (sections 6 et 7) et dans les
commentaires du code, datées.

## Idées pour la suite

- **Recompiler seulement la plateforme touchée** par une retouche, au lieu de toutes celles du lot.
- **Plus d'émulateurs en parallèle** : un second appareil virtuel téléphone avec sa propre session,
  pour répartir les tailles (les copies en lecture seule d'un même appareil partagent une session, que
  les services de comptes révoquent).
- **Contenu vivant** : comparer la position des éléments plutôt que les pixels, pour ne plus compter
  une image de fond tirée au hasard comme un changement.
- **Regard ciblé sur les captures** : ne regarder que ce que la mesure signale et ce qui change d'un
  passage à l'autre.
- **Mode automatique** : sur des écrans et des tailles choisis, audit puis corrections importantes, avec
  avant / après, sur une branche dédiée.
- **iOS natif** (hors Safari), **échelle Windows réelle** (125 % simulée aujourd'hui), **état du banc**
  vérifié entre l'avant et l'après (clavier TV réveillé ou non).
- **Traduction** de l'outil et de sa documentation ; personnalisation par fichiers de configuration.
