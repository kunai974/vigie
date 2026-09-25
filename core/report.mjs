// Rapport HTML autonome (fichier local : les captures montrent le catalogue de l'utilisateur).
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const SEV = { error: { label: 'Erreur', rank: 0 }, warning: { label: 'Alerte', rank: 1 }, info: { label: 'Info', rank: 2 } };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function countBySeverity(issues) {
  const c = { error: 0, warning: 0, info: 0 };
  for (const i of issues) c[i.severity]++;
  return c;
}

function pills(c) {
  return ['error', 'warning', 'info'].map((s) => `<span class="pill ${s}${c[s] ? '' : ' zero'}">${c[s]} ${SEV[s].label.toLowerCase()}${c[s] > 1 ? 's' : ''}</span>`).join('');
}

function screenCard(run, s) {
  const id = `${run.key}-${s.id}`;
  if (s.skipped || s.failed) {
    return `<section class="screen muted" id="${id}"><h3>${esc(s.label)}</h3><p>${s.failed ? '⚠ Échec : ' : 'Ignoré : '}${esc(s.skipped || s.failed)}</p></section>`;
  }
  const issues = [...s.issues].sort((a, b) => SEV[a.severity].rank - SEV[b.severity].rank);
  // Pixels CSS de la page → pourcentage de la capture (écran entier, WebView placée à s.frame).
  const [vw, vh] = s.metrics.viewport.split(' × ').map(Number);
  const f = s.frame && s.image ? s.frame : null;
  const toPct = (rc) => (f
    ? { l: (f.x + (rc.x * f.w) / vw) / s.image.w, t: (f.y + (rc.y * f.h) / vh) / s.image.h, w: (rc.w * f.w) / vw / s.image.w, h: (rc.h * f.h) / vh / s.image.h }
    : { l: rc.x / vw, t: rc.y / vh, w: rc.w / vw, h: rc.h / vh });
  const boxes = issues.flatMap((i, n) => (i.rects || (i.rect ? [i.rect] : [])).filter((rc) => rc.w > 0).map((rc) => {
    const p = toPct(rc);
    const st = `left:${p.l * 100}%;top:${p.t * 100}%;width:${p.w * 100}%;height:${p.h * 100}%`;
    return `<div class="box ${i.severity}" style="${st}" data-n="${n + 1}" title="${esc(i.message)}"></div>`;
  })).join('');
  const rows = issues.map((i, n) => `<tr class="${i.severity}"><td>${n + 1}</td><td><span class="sev ${i.severity}">${SEV[i.severity].label}</span></td><td>${esc(i.message)}${i.count > 1 ? ` <b>× ${i.count}</b>` : ''}</td><td><code>${esc(i.selector)}</code></td><td class="rule">${esc(i.rule)}</td></tr>`).join('');
  const walk = s.walk?.length ? `<details class="walk"><summary>Marche du focus à la télécommande (${s.walk.length} touches${s.walkIssues ? `, ${s.walkIssues} défaut(s)` : ''})</summary><table><tr><th>Touche</th><th>Focus sur</th><th>Zone</th><th>Constat</th></tr>${s.walk.map((w) => `<tr class="${w.severity || ''}"><td>${esc(w.key)}</td><td><code>${esc(w.to)}</code></td><td>${esc(w.zone)}</td><td>${esc(w.note || 'ok')}</td></tr>`).join('')}</table>${(s.walkShots || []).map((f) => `<img class="walkshot" src="${esc(f)}" loading="lazy">`).join('')}</details>` : '';
  const m = s.metrics;
  return `<section class="screen" id="${id}">
  <h3>${esc(s.label)} ${pills(countBySeverity(s.issues))}</h3>
  <div class="grid">
    <div class="shot"><img src="${esc(s.shot)}" loading="lazy">${boxes}</div>
    <div class="side">
      <dl>
        <dt>Fenêtre</dt><dd>${esc(m.viewport)} (densité ${m.dpr})</dd>
        <dt>Texte de base</dt><dd>${esc(m.rootFontSize)}</dd>
        <dt>Éléments</dt><dd>${m.elements} dont ${m.interactive} cliquables, ${m.images} images (${m.imageMegapixels} Mpx visibles)</dd>
        <dt>Polices</dt><dd>${esc(m.fontsUsed.join(', '))}</dd>
        <dt>Focus</dt><dd>${m.focus ? `<code>${esc(m.focus.element)}</code> (${esc(m.focus.zone)})${m.focus.indicator ? '' : ' — sans liseré'}` : 'aucun'}</dd>
        <dt>Stabilité</dt><dd>${s.settleMs} ms</dd>
        ${m.truncatedRules.length ? `<dt>Limité</dt><dd>${esc(m.truncatedRules.join(', '))}</dd>` : ''}
      </dl>
    </div>
  </div>
  ${rows ? `<table class="issues"><tr><th>#</th><th>Gravité</th><th>Constat</th><th>Élément</th><th>Règle</th></tr>${rows}</table>` : '<p class="ok">Aucun défaut mesuré.</p>'}
  ${walk}
</section>`;
}

export function writeReport(outDir, data) {
  const all = data.runs.flatMap((r) => r.screens.flatMap((s) => s.issues || []));
  const total = countBySeverity(all);
  const byRule = {};
  for (const i of all) {
    const k = `${i.severity}|${i.rule}`;
    byRule[k] = (byRule[k] || 0) + 1;
  }
  const ruleRows = Object.entries(byRule).sort((a, b) => SEV[a[0].split('|')[0]].rank - SEV[b[0].split('|')[0]].rank || b[1] - a[1])
    .map(([k, n]) => { const [sev, rule] = k.split('|'); return `<tr><td><span class="sev ${sev}">${SEV[sev].label}</span></td><td>${esc(rule)}</td><td>${n}</td></tr>`; }).join('');
  const nav = data.runs.map((r) => `<li><a href="#run-${r.key}">${esc(r.title)}</a> ${pills(countBySeverity(r.screens.flatMap((s) => s.issues || [])))}</li>`).join('');
  const runs = data.runs.map((r) => `<h2 id="run-${r.key}">${esc(r.title)}</h2>
<table class="summary"><tr><th>Écran</th><th>Défauts</th></tr>${r.screens.map((s) => `<tr><td><a href="#${r.key}-${s.id}">${esc(s.label)}</a></td><td>${s.issues ? pills(countBySeverity(s.issues)) + (s.walkIssues ? ` <span class="pill error">${s.walkIssues} télécommande</span>` : '') : esc(s.skipped ? 'ignoré' : 'échec')}</td></tr>`).join('')}</table>
${r.screens.map((s) => screenCard(r, s)).join('\n')}`).join('\n');

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Audit d'affichage ${esc(data.app || '')}</title>
<style>
:root{--bg:#0d1117;--panel:#161b22;--line:#30363d;--text:#e6edf3;--muted:#8b949e;--err:#f85149;--warn:#d29922;--info:#58a6ff;--ok:#3fb950}
@media (prefers-color-scheme: light){:root{--bg:#f6f8fa;--panel:#fff;--line:#d0d7de;--text:#1f2328;--muted:#656d76;--err:#cf222e;--warn:#9a6700;--info:#0969da;--ok:#1a7f37}}
*{box-sizing:border-box}body{margin:0;padding:24px 16px 64px;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1280px;margin:0 auto}h1{margin:0 0 4px;font-size:24px}h2{margin:48px 0 12px;font-size:20px;border-bottom:1px solid var(--line);padding-bottom:6px}
h3{margin:0 0 12px;font-size:16px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}.sub{color:var(--muted);margin:0 0 24px}
.pill{font-size:12px;padding:1px 8px;border-radius:999px;border:1px solid currentColor}.pill.zero{opacity:.35}.pill.error,.sev.error{color:var(--err)}.pill.warning,.sev.warning{color:var(--warn)}.pill.info,.sev.info{color:var(--info)}
.sev{font-weight:600}table{border-collapse:collapse;width:100%;margin:8px 0}th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:500}
code{font-size:12px;word-break:break-all}.rule{color:var(--muted);font-size:12px}.screen{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0}
.screen.muted{opacity:.7}.grid{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:16px}@media (max-width:800px){.grid{grid-template-columns:minmax(0,1fr)}}
.shot{position:relative;align-self:start;border:1px solid var(--line);border-radius:6px;overflow:hidden}.shot img{display:block;width:100%;height:auto}
.box{position:absolute;border:2px solid;pointer-events:auto}.box.error{border-color:var(--err);background:color-mix(in srgb,var(--err) 12%,transparent)}.box.warning{border-color:var(--warn)}.box.info{border-color:var(--info);border-style:dashed;opacity:.7}
.box::after{content:attr(data-n);position:absolute;top:-2px;left:-2px;font:600 10px/1 system-ui;padding:2px 3px;background:#000;color:#fff}
dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;margin:0}dt{color:var(--muted)}dd{margin:0}.ok{color:var(--ok)}
.walk{margin-top:12px}.walk summary{cursor:pointer;font-weight:600}tr.error td{color:var(--err)}.walkshot{max-width:48%;margin:8px 8px 0 0;border:1px solid var(--line);border-radius:6px}
.toc li{margin:4px 0}
</style></head><body><main>
<h1>Audit d'affichage ${esc(data.app || '')}</h1>
<p class="sub">${esc(data.date)} · ${esc(data.appVersion || '')} · lecteur exclu · fichier local, ne pas diffuser (catalogue de l'utilisateur)</p>
<p>${pills(total)}</p>
<ul class="toc">${nav}</ul>
<h2>Défauts par règle</h2><table><tr><th>Gravité</th><th>Règle</th><th>Nombre</th></tr>${ruleRows}</table>
${runs}
</main></body></html>`;
  writeFileSync(path.join(outDir, 'index.html'), html);
  writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(data, null, 2));
}
