// Réglages de revue de l'app d'exemple des tests. Registre : fichier temporaire donné par le test.
const path = require('path');
const os = require('os');

module.exports = {
  APP_NAME: 'Exemple',
  SENSITIVE: /^compte/,
  SIZE_LABEL: { '': 'origine', phone: '360 pts', 'tv-16-10': '16:10' },
  SPECIFIC: {},
  GRAVITY: {},
  toolArtifact: () => false,
  MANUAL: {},
  LABELS: { 'span.badge': 'Badges', 'button.nav-item': 'Icônes de navigation', 'button.coeur': 'Cœur des favoris', 'p.aide': 'Texte d\'aide', 'h2.titre': 'Titres' },
  REGISTRY: process.env.AUDIT_REGISTRE || path.join(os.tmpdir(), 'audit-exemple-registre.json'),
  RENAMED: {},
};
