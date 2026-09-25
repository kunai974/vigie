// Réglages de revue de l'app d'exemple : noms lisibles des éléments, tailles, zones sensibles, faux
// positifs connus, registre. Modèle pour un nouveau projet (audit/GUIDE-IA.md).
const path = require('path');

module.exports = {
  APP_NAME: 'Exemple web',
  // Écrans dont les captures ne doivent jamais être montrées (données personnelles) : identifiants.
  SENSITIVE: /^$/,
  // Nom affiché de chaque taille (clé de SIZES dans screens.mjs).
  SIZE_LABEL: { iphone: 'iPhone', android: 'Android 360', tablette: 'Tablette', bureau: 'Bureau 1440', firefox: 'Firefox 1280' },
  // Conseil propre à un élément (prime sur celui de la famille).
  SPECIFIC: {},
  // Gravité ajustée : `${plateforme}|${règle}|${élément}` ou `${règle}|${élément}`.
  GRAVITY: {},
  // Faux positifs connus de l'outil sur cette app, écartés avant la revue.
  toolArtifact: () => false,
  // Constats vus à l'œil, par plateforme (rarement utile : l'interprète les écrit dans interpretation.json).
  MANUAL: {},
  // Noms lisibles (balise + première classe, ou #id).
  LABELS: {
    'div.promo': 'Bandeau promotionnel', 'span.ref': 'Références produit', 'span.dispo': 'Disponibilité', '.dispo': 'Disponibilité',
    'button.fav': 'Bouton favori', 'button.acheter': 'Bouton « Ajouter au panier »', h2: 'Titres des produits', nav: 'Menu de l\'en-tête',
    'p.desc': 'Description du produit',
  },
  // Registre (mémoire des défauts et des décisions) : versionné avec le code du projet.
  REGISTRY: process.env.AUDIT_REGISTRE || path.join(__dirname, 'registre.json'),
  RENAMED: {},
};
