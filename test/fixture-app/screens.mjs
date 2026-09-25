// App d'exemple des tests de l'outil (audit/test/outil.test.mjs) : juste ce que les commandes lisent.
// Aucun émulateur n'est lancé par les tests : ils travaillent sur des passages fabriqués (fabrique.mjs).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Chemin de ce dossier depuis le projet qui contient l'outil (quel que soit le nom du dossier de l'outil).
const FROM_ROOT = path.relative(path.resolve(HERE, '..', '..', '..'), HERE).split(path.sep).join('/');

export const APP_NAME = 'Exemple';
export const PACKAGE = 'com.exemple.app';
export const EMULATORS = { tv: 'Exemple_TV', phone: 'Exemple_Phone' };
export const APP_CODE = { paths: [FROM_ROOT], exclude: [] };
export const SIZES = {
  phone: { kind: 'phone', size: '1080x2340', density: 480, label: 'Téléphone (360 x 780)' },
  'tv-16-10': { kind: 'tv', size: '1728x1080', density: 320, label: 'TV 16:10' },
};
export const PROFILES = { rapide: { tv: [null], phone: ['phone'] }, complet: { tv: [null, 'tv-16-10'], phone: ['phone'] } };
export const SIZE_RULES = { phone: [], tv: [] };
export const SCREENS = [
  { id: 'accueil', label: 'Accueil', go: async () => null },
  { id: 'recherche', label: 'Recherche', go: async () => null },
];
export const passProfileScreen = async () => false;
export const enterFirstProfile = async () => {};
