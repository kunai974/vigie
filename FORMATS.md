# Les fichiers de l'outil d'audit

> Générique. Le **dossier d'un passage** est la source unique : tout ce qu'une personne ou une IA
> (n'importe laquelle) doit savoir d'un passage s'y trouve, en JSON ou en Markdown. Aucune dépendance à
> un service en ligne : les pages publiées ne sont qu'une façon de partager ces fichiers.

## 1. Le dossier d'un passage (`audit-out/<date>/`)

| Fichier | Écrit par | Contenu |
|---|---|---|
| `report.json` | le passage (`node audit passage`) | Mesures brutes : chaque taille (`runs`), chaque écran et état, constats, marche à la télécommande, cadre de la WebView, zones sensibles masquées (`masked`) ; `at` (début, ISO), `appId`, `code` (empreinte du code audité), `mesure` (version de la mesure, section 4) |
| `*.png`, `index.html` | le passage | Captures d'origine, rapport brut. **Locaux seulement** (catalogue de l'utilisateur) |
| `.images/` | revue, avant / après | Banque d'images réduites du passage (chaque capture réduite une seule fois, réutilisée) |
| `revue.json` | la revue (`node audit refaire-revue`) | Toutes les données de la revue : fiches, familles, plateformes, parcours, décisions connues (section 2) |
| `revue.md` | la revue | Résumé lisible : fiches dans l'ordre de la grille, gravité, priorité, plateformes, statut, décision |
| `revue/` | la revue | La page (`revue.html`), ses planches de vignettes (`img/`) et une version nette de chaque capture pour l'agrandissement (`img/grand/`, `--sans-grand` pour s'en passer) : se publie telle quelle. `a-relire.md` et `relire/` : travail de l'interprète (jamais publiés) |
| `interpretation.json` | l'interprète (IA) | Sa lecture : avis, recommandations, regroupements, faux positifs, constats vus à l'œil (section 3) |
| `decisions.json` | la revue locale (`node audit revue`) | Décisions prises sur ce passage (section 2.3) |
| `avant-apres.json`, `avant-apres/` | la comparaison | Sur le passage « après » : données et page de l'avant / après (section 5) |
| `avant-apres-notes.json` | l'interprète | Facultatif : synthèse, « repéré en chemin », failles de l'outil, affichés dans la page avant / après |

Hors des passages : `audit-out/dernier-passage.txt` (dossier du dernier passage), `audit-out/versions.json`
(code de la dernière version d'audit compilée, par plateforme, et pour Android la date d'installation
sur chaque émulateur, `installs` : le banc ne recompile que le périmé),
`audit-out/banc.json` (émulateurs démarrés par le banc, arrêtés par le passage suivant), `audit-out/lots/`
(cycles de correction, section 6), et le **registre** du projet (`audit/<app>/registre.json`, versionné
avec le code : section 7).

## 2. `revue.json`

```jsonc
{
  "format": 2, "date": "23/09/2026 01:18:47", "at": "2026-09-22T23:18:47Z", "app": "Mon app", "appId": "mon-app",
  "profile": "complet", "durationMin": 48, "mesure": "1-f84f1999",
  "summary": "Synthèse de l'interprète",
  "families": [{ "rule": "text-tiny", "title": "Textes trop petits", "advice": "Ce qu'il faut obtenir", "info": false }],
  "fiches": [{
    "id": "f1a2b3c4d5e6",            // identifiant de la fiche (celui du défaut s'il est seul)
    "ids": ["724058bc4b7d", "dcfff58a382f"], // défauts du registre (un par plateforme) : la décision vaut pour tous
    "name": "Synopsis de la fiche", "rule": "text-faded", "family": { "rule": "…", "title": "…", "advice": "…", "info": false },
    "gravity": "important", "priority": { "level": "forte", "why": "5 écrans, 2 plateformes" }, "effort": "simple",
    "platforms": ["tv", "phone"], "sizes": ["Android TV · 1080p", "Téléphone · 360 pts"], "screens": ["Fiche film"],
    "messages": ["…"], "advice": "…", "avis": "…", "reco": "…", "faux": null, "etat": null,
    "group": null,                    // { "titre", "n" } pour un regroupement de l'interprète
    "parts": [{ "id": "724058bc4b7d", "kind": "tv", "sizes": ["1080p"], "screens": ["…"], "where": ["tv|movie-detail"],
                "example": { "img": "tv-movie-detail", "label": "…", "boxes": [[x, y, l, h]] }, "status": "toujours-la" }]
  }],
  "platforms": [{ "kind": "tv", "title": "Android TV", "sizes": ["1080p", "16:10"], "captures": 229,
                  "compare": [], "paths": [], "skipped": [{ "size": "…", "label": "…", "why": "…" }] }],
  "decisions": { "724058bc4b7d": { "status": "plus-tard", "note": "", "updatedAt": "…" } },
  "fixed": [{ "id": "…", "name": "…", "platform": "Téléphone" }]   // corrigés depuis le passage précédent
}
```

- **Gravité** : `bloquant`, `important`, `mineur`, `a-trancher`, `info`. **Priorité** : `forte`,
  `moyenne`, `faible`, `decider`. Rangement : [`GRILLE.md`](GRILLE.md).
- **Statut au registre** (`parts[].status`) : `nouveau`, `toujours-la`, `reapparu`, `corrige`,
  `non-verifie`.
- **Lieu** (`where`) : `<appareil>-<taille>|<écran>` (ex. `phone-phone-plus|live`) ; sans taille = taille
  d'origine de l'appareil.

### 2.3 `decisions.json`

```json
{ "724058bc4b7d": { "status": "inclure", "note": "remarque", "updatedAt": "2026-09-24T08:00:00Z" },
  "libre": { "status": null, "note": "remarques générales sur la revue", "updatedAt": "…" } }
```

`status` : `inclure` (à corriger), `plus-tard`, `exclure`, ou `null`. Même format que l'export de la page
publiée ; `node audit decisions <fichier>` l'importe dans le registre. La décision la plus récente
l'emporte.

## 3. `interpretation.json` (écrit par l'interprète)

```jsonc
{
  "resume": "Synthèse en quelques lignes, affichée en tête de la revue.",
  "items": {
    "<id d'un défaut>": { "gravity": "important", "avis": "Le souci.", "reco": "La correction recommandée.", "effort": "simple" },
    "<id d'un faux positif>": { "faux": "Pourquoi la mesure s'est trompée." }
  },
  "corriges": { "<id d'un constat vu à l'œil>": "ce qui a été constaté sur la capture de ce passage" },
  "etats": { "<taille>|<état>": "pourquoi cet état n'est plus atteint, constaté sur les captures (passage « après » d'un lot)" },
  "groupes": [
    { "titre": "Métadonnées des fiches trop petites", "ids": ["<id>", "<id>"], "avis": "…", "reco": "Une seule correction : …", "effort": "simple" }
  ],
  "constats": [
    { "kind": "tv", "name": "Nom lisible", "el": "identifiant stable", "shot": { "run": "tv-tv-16-10", "id": "home-films" },
      "message": "Ce qui se voit", "gravity": "important", "avis": "…", "reco": "…", "boxes": [[x, y, l, h]] }
  ]
}
```

Un faux positif est gardé dans la revue (section « Écartés », avec sa raison) et **mémorisé dans le
registre** : il ne sera plus signalé aux passages suivants. Un état listé dans `etats` (ex.
`"tv|movie-detail-synopsis": "le synopsis tient en entier, plus rien à dérouler"`) n'est plus compté comme
régression, et les défauts vus seulement dans cet état sont dits corrigés, « constaté à l'œil ». Consignes
de l'interprète :
[`GUIDE-IA.md`](GUIDE-IA.md).

## 4. Version de la mesure

`report.json` porte `mesure` (ex. `1-f84f1999`) : le numéro `REGLES` de `core/mesure.mjs`, et
l'empreinte des règles mesurées dans la page (`core/measure.js`). **L'avant / après refuse de comparer
deux passages mesurés différemment** (un « Corrigé » pourrait venir de l'outil, pas de l'app) ;
`--forcer` passe outre, avec un avertissement dans la page. Toute modification de la façon de mesurer
ailleurs que dans `measure.js` (marche à la télécommande, règle du clavier, défilements, captures)
augmente `REGLES` à la main.

## 5. `avant-apres.json`

```jsonc
{
  "format": 2, "titre": "Lot 1", "mesure": { "avant": "…", "apres": "…" }, "mesureNote": null,
  "before": { "id": "<passage avant>", "date": "…" }, "after": { "id": "<passage après>", "date": "…" },
  "targets": [{ "id": "…", "name": "…", "kind": "phone", "note": "…", "status": "corrige", "lost": [] }],
  "pairs": [{ "run": "phone-phone", "size": "360 pts", "kind": "phone", "id": "movie-detail", "group": "movie-detail",
              "label": "…", "gone": [{ "rule", "el", "message" }], "new": [], "diff": 12.4, "reached": null,
              "changed": true, "also": ["mêmes changements ailleurs"], "twinOf": null }],
  "totals": { "pairs": 197, "changed": 96, "shown": 14, "gone": 236, "new": 0, "lost": 0 }
}
```

`targets[].status` : `corrige`, `toujours-la`, `non-verifie` (aucun lieu du défaut repassé),
`a-verifier` (un état de l'écran atteint avant ne l'est plus : régression possible).
`reached: "perdu"` : état atteint avant et plus après, signalé en tête de page.

## 6. Cycles de correction (`audit-out/lots/<cycle>/`)

Voir [`PROCESS.md`](PROCESS.md) : `cycle.json` (passage de départ, lots, état de chaque lot), `lots.md`
(le découpage expliqué), `corrections.json` (écrit par l'interprète : `{ "<identifiant>": "ce qui a été
changé" }`, affiché sous chaque défaut dans la page avant / après).

Dans `avant-apres.json`, `cibles` : une fiche par défaut visé (`status`, `avis`, `correction`, `before`,
`after` : constats mesurés avant et après, `img` : `avant` et `apres`, chacun `full` et `zoom`, images
nettes dans `avant-apres/cibles/`).

## 7. Le registre (`audit/<app>/registre.json`)

```jsonc
{
  "passes": [{ "id": "<passage>", "date": "…", "at": "…", "audited": ["<lieu>"] }],   // dans l'ordre où ils ont été faits
  "items": { "<id>": { "kind", "rule", "el", "name", "gravity",
                      "history": [{ "pass": "<passage>", "where": ["<lieu>"] }],
                      "decision": { "status", "note", "updatedAt" },
                      "faux": { "raison", "pass", "mesure" },             // faux positif mémorisé (caché seulement avec la même mesure)
                      "interp": { "avis", "reco", "effort", "gravity", "pass" }, // dernière interprétation, reproposée « à revérifier »
                      "constat": { "name", "message", "shot", "pass" },  // définition d'un constat vu à l'œil, listé à revérifier
                      "lastStatus": "corrige", "lastPass": "<passage>" } },  // dernier passage qui l'a vraiment regardé
  "renamed": { "<ancienne identité>": "<nouvelle>" }
}
```
