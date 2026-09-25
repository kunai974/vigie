# App d'exemple : une petite boutique web

Deux pages statiques (`page/`), auditées dans les navigateurs de Playwright, pour essayer l'outil sans
rien préparer et pour servir de **modèle à un nouveau projet** (copier ce dossier en `audit/<mon-app>/`,
puis suivre [`../GUIDE-IA.md`](../GUIDE-IA.md)).

```
node audit passage --app exemple                     # profil rapide : Chrome téléphone et bureau
node audit passage --app exemple --profile complet   # + iPhone et tablette (WebKit), Firefox
node audit revue                                # la revue, dans le navigateur
```

WebKit et Firefox demandent les navigateurs de Playwright (`npx playwright install webkit
firefox`, un téléchargement) ; sans eux, ces tailles sont notées en échec et le reste du passage se fait.

## Défauts volontaires (accueil)

| Défaut | Où | Règle attendue |
|---|---|---|
| Bandeau de 520 px de large | téléphone | `page-overflow-x`, `offscreen-x` |
| En-tête qui ne passe pas à la ligne : son menu sort de l'écran | téléphone | `offscreen-x` |
| Bouton « Ajouter au panier » de 35 px de haut | écrans tactiles | `touch-target` |
| Références en 9 px | partout | `text-tiny` |
| Disponibilité en gris clair | partout | `axe-color-contrast` |
| Bouton favori de 24 px | écrans tactiles | `touch-target` |
| Titre long coupé net | partout | `text-clipped` |
| Description limitée à 2 lignes, raccourcie | partout | `text-ellipsis` (information) |

Le titre « Bienvenue… » est limité à 2 lignes et tient en entier : il ne doit pas être signalé
raccourci, même si la marge sous ses lettres agrandit sa zone défilable.

L'e-mail affiché dans l'en-tête est une donnée personnelle : il est noirci dans chaque capture
(`MASK` dans `screens.mjs`), comme les champs mot de passe.

Le formulaire (« Mon compte ») est correct : son bouton « œil », posé dans le champ mot de passe, ne
doit pas être signalé. Les tests de l'outil vérifient tout cela (`audit/test/outil.test.mjs`).
