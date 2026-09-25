// Résumés en texte d'une revue, lisibles par une personne comme par n'importe quelle IA :
//   <passage>/revue.md      : la revue (fiches dans l'ordre de la grille, décisions, statuts) ;
//   <passage>/revue/a-relire.md : la liste de travail de l'interprète (identifiants, planches de relecture).
// Appelé par build.cjs. Formats : audit/FORMATS.md.
const fs = require('fs');
const path = require('path');

const PLATFORM = { tv: 'Android TV', phone: 'Téléphone', desktop: 'Bureau', web: 'Web' };
const GRAV = { bloquant: 'Bloquant', important: 'Important', mineur: 'Mineur', 'a-trancher': 'À trancher', info: 'Info' };
const PRIO = { forte: 'priorité forte', moyenne: 'priorité moyenne', faible: 'priorité faible', decider: 'à décider' };
const DEC = { inclure: 'Inclure', 'plus-tard': 'Plus tard', exclure: 'Exclure' };
const STATUS = { nouveau: 'nouveau', 'toujours-la': 'toujours là', reapparu: 'réapparu', corrige: 'corrigé', 'non-verifie': 'non vérifié' };

/** Décision d'une fiche : celle de tous ses défauts, ou « mixte » s'ils diffèrent. */
function decisionOf(f, decisions) {
  const all = f.ids.map((id) => decisions[id]?.status || null);
  const uniq = [...new Set(all)];
  const notes = [...new Set(f.ids.map((id) => decisions[id]?.note).filter(Boolean))];
  return { status: uniq.length === 1 ? uniq[0] : 'mixte', note: notes.join(' / ') };
}

/** Section de la revue où va une fiche : selon la décision déjà prise avant cette revue. */
function sectionOf(f, decisions) {
  if (f.faux) return 'ecartes';
  if (f.family.info) return 'info';
  const d = decisionOf(f, decisions).status;
  return d === 'exclure' ? 'exclus' : d === 'plus-tard' ? 'plus-tard' : 'defauts';
}

const statusText = (f) => {
  const st = [...new Set(f.parts.map((p) => p.status).filter(Boolean))];
  if (!st.length) return '';
  if (st.length === 1) return STATUS[st[0]] || st[0];
  return f.parts.map((p) => `${PLATFORM[p.kind]} ${STATUS[p.status] || '?'}`).join(', ');
};

function ficheLines(f, decisions) {
  const d = decisionOf(f, decisions);
  const head = [GRAV[f.gravity], f.gravity === 'info' ? '' : PRIO[f.priority.level], f.platforms.map((k) => PLATFORM[k]).join(' + '), statusText(f),
    d.status ? `décision : ${d.status === 'mixte' ? 'différente selon la plateforme' : DEC[d.status]}` : 'sans décision'].filter(Boolean).join(' · ');
  const out = [`- **${f.name}** — ${head}`];
  out.push(`  - Identifiant${f.ids.length > 1 ? 's' : ''} : ${f.ids.map((i) => `\`${i}\``).join(', ')}${f.group ? ` (regroupés : ${f.group.n} défauts, même cause)` : ''}`);
  out.push(`  - Où : ${f.sizes.join(', ')} ; ${f.screens.length} écran${f.screens.length > 1 ? 's' : ''} : ${f.screens.slice(0, 8).join(', ')}${f.screens.length > 8 ? '…' : ''}`);
  if (f.messages.length) out.push(`  - Mesuré : ${f.messages.join(' | ')}`);
  if (f.avis) out.push(`  - Le souci : ${f.avis.replace(/\n/g, ' ; ')}`);
  if (f.reco) out.push(`  - Recommandation${f.effort ? ` (effort ${f.effort})` : ''} : ${f.reco.replace(/\n/g, ' ; ')}`);
  if (f.faux) out.push(`  - Écarté : ${f.faux.replace(/\n/g, ' ; ')}`);
  if (d.note) out.push(`  - Remarque : « ${d.note} »`);
  return out;
}

function write(src, out, data, { reading, interpFile }) {
  const decisions = data.decisions || {};
  const by = { defauts: [], 'plus-tard': [], exclus: [], ecartes: [], info: [] };
  for (const f of data.fiches) by[sectionOf(f, decisions)].push(f);
  const count = (list, k) => list.filter((f) => f.gravity === k).length;
  const dec = { inclure: 0, 'plus-tard': 0, exclure: 0, none: 0 };
  for (const f of by.defauts) { const s = decisionOf(f, decisions).status; dec[DEC[s] ? s : 'none']++; }

  const L = [`# Revue ${data.app ? `${data.app} ` : ''}— passage ${path.basename(src)}`, '',
    `${data.date} · profil ${data.profile || '?'} · ${data.durationMin ?? '?'} min${data.mesure ? ` · mesure ${data.mesure}` : ''}`, ''];
  for (const p of data.platforms) L.push(`- ${p.title}${p.model ? ` (${p.model})` : ''} : ${p.sizes.join(', ')} · ${p.captures} captures${p.skipped.length ? ` · ${p.skipped.length} non atteints` : ''}`);
  L.push('', '## En bref', '',
    `- ${by.defauts.length} défauts à trancher : ${['bloquant', 'important', 'mineur', 'a-trancher'].map((g) => `${count(by.defauts, g)} ${GRAV[g].toLowerCase()}`).join(', ')} ; ${by.defauts.filter((f) => f.platforms.length > 1).length} vus sur plusieurs plateformes.`,
    `- Décisions : ${dec.inclure} à corriger, ${dec['plus-tard']} plus tard, ${dec.exclure} exclus, ${dec.none} sans décision.`,
    `- Déjà décidés avant : ${by['plus-tard'].length} « Plus tard », ${by.exclus.length} « Exclure » ; ${by.ecartes.length} faux positifs écartés ; ${by.info.length} constats pour information.`);
  if (data.fixed?.length) L.push(`- Corrigés depuis le passage précédent : ${data.fixed.map((x) => `${x.name} (${x.platform}${x.lot ? `, ${x.lot}` : ''})`).join(', ')}.`);
  if (data.summary) L.push('', '## Synthèse de la relecture', '', data.summary);
  L.push('', '## Défauts à trancher', '', 'Ordre de la grille (audit/GRILLE.md) : famille, puis gravité, priorité, plateformes, écrans.', '');
  for (const fam of data.families.filter((x) => !x.info)) {
    const list = by.defauts.filter((f) => f.family.rule === fam.rule);
    if (!list.length) continue;
    L.push(`### ${fam.title}`, '', `À obtenir : ${fam.advice}`, '');
    for (const f of list) L.push(...ficheLines(f, decisions));
    L.push('');
  }
  const section = (title, list, hint) => { if (list.length) L.push(`## ${title}`, '', ...(hint ? [hint, ''] : []), ...list.flatMap((f) => ficheLines(f, decisions)), ''); };
  section('Plus tard (décidé avant cette revue)', by['plus-tard']);
  section('Exclus (décidé avant cette revue)', by.exclus, 'Ne reviennent plus dans la revue ; rien n\'empêche de changer d\'avis.');
  section('Écartés à la relecture (faux positifs)', by.ecartes, 'Erreurs de la mesure, avec leur raison ; mémorisés dans le registre pour ne plus être signalés.');
  if (by.info.length) L.push('## Pour information', '', ...by.info.map((f) => `- ${f.name} (${f.platforms.map((k) => PLATFORM[k]).join(' + ')}) : ${f.messages[0] || ''}`), '');
  const skipped = data.platforms.flatMap((p) => p.skipped.map((s) => `- ${p.title} ${s.size} · ${s.label} : ${s.why}`));
  if (skipped.length) L.push('## Non atteints', '', ...skipped, '');
  L.push('## Fichiers de ce passage', '', '- `report.json` : mesures brutes ; `index.html` : rapport brut (local)', `- \`revue.json\` : ces données en entier ; \`revue/revue.html\` : la page (${require('./paths.cjs').cmd('revue')})`,
    '- `decisions.json` : décisions prises dans ce passage ; `interpretation.json` : lecture de l\'interprète', '- `revue/a-relire.md` et `revue/relire/` : travail de l\'interprète', '');
  fs.writeFileSync(path.join(src, 'revue.md'), L.join('\n'));

  // Liste de travail de l'interprète : chaque fiche, ses identifiants (clés de interpretation.json), la
  // planche de relecture de chacun de ses défauts.
  const R = [`# À relire — passage ${path.basename(src)} (${data.date})`, '',
    `Interprétation à écrire : ${interpFile} (format et consignes : audit/GUIDE-IA.md, section « Interpréter »).`,
    `Planches de relecture : ${path.join(out, 'relire')} (un défaut encadré et agrandi par fichier ; « ecran-* » : un écran à toutes les tailles).`, ''];
  for (const fam of data.families) {
    const list = data.fiches.filter((f) => f.family.rule === fam.rule && !f.faux);
    if (!list.length) continue;
    R.push(`## ${fam.title}${fam.info ? ' (information)' : ''}`);
    for (const f of list) {
      R.push(`- **${f.name}** [${f.gravity}] ${f.platforms.map((k) => PLATFORM[k]).join(' + ')} · ${f.sizes.join(', ')} · ${f.screens.length} écran(s) : ${f.screens.slice(0, 4).join(', ')}${f.avis ? '  · déjà interprété' : ''}`,
        `  ${f.messages.join(' | ')}`);
      for (const p of f.parts) R.push(`  - \`${p.id}\` ${PLATFORM[p.kind]} : ${reading.items[p.id] ? path.join(out, reading.items[p.id]) : p.example?.img ? path.join(src, `${p.example.img}.png`) : '(zone sensible, pas de capture)'}`);
    }
    R.push('');
  }
  if (data.aRevoir?.length) {
    R.push('## Constats vus à l\'œil des passages précédents, à revérifier', '',
      'La mesure ne les voit pas : regarder la capture du même écran dans ce passage. Toujours là : les reprendre dans « constats » (même `el`) ; corrigés : les confirmer dans « corriges » ; sinon, ils restent « non vérifiés ».', '');
    for (const x of data.aRevoir) R.push(`- \`${x.id}\` **${x.name}** (${PLATFORM[x.kind]}, \`el\` : ${x.el}) — ${x.message}${x.decision ? ` · décision : ${x.decision}` : ''} · vu au passage ${x.pass} sur ${x.shot.run}/${x.shot.id}`);
    R.push('');
  }
  for (const p of data.platforms) {
    const screens = reading.screens.filter((x) => x.kind === p.kind);
    if (screens.length) R.push(`## ${p.title} : chaque écran à toutes les tailles (ce que la mesure ne voit pas)`, ...screens.map((x) => `- ${x.label} (${x.sizes.join(', ')}) : ${path.join(out, x.file)}`), '');
  }
  fs.writeFileSync(path.join(out, 'a-relire.md'), R.join('\n'));
}

module.exports = { write, decisionOf, sectionOf };
