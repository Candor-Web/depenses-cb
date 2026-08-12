/**
 * Tableau de bord mensuel.
 * Chaque barre porte son libellé : la couleur ne fait que rappeler la
 * catégorie, elle ne porte jamais seule l'information.
 */

import { CATEGORIES, catLabel, catColor } from './categories.js';
import { eur } from './export.js';

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MOIS_COURT = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'aoû', 'sep', 'oct', 'nov', 'déc'];

export const monthKey = iso => (iso || '').slice(0, 7);
export const monthLabel = key => {
  const [y, m] = key.split('-');
  return `${MOIS[+m - 1]} ${y}`;
};
const prevMonth = key => {
  const [y, m] = key.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const sum = list => list.reduce((a, e) => a + (e.amount || 0), 0);

export function renderBilan(el, expenses, key) {
  const inMonth = expenses.filter(e => monthKey(e.date) === key);
  const prev = expenses.filter(e => monthKey(e.date) === prevMonth(key));

  if (!inMonth.length) {
    el.innerHTML = `<p class="empty">Aucune dépense enregistrée en ${esc(monthLabel(key))}.</p>`;
    return;
  }

  const total = sum(inMonth);
  const totalPrev = sum(prev);
  const delta = totalPrev ? ((total - totalPrev) / totalPrev) * 100 : null;
  const jours = new Set(inMonth.map(e => e.date)).size;

  /* ---- tuiles ---- */
  let html = `
  <div class="tiles">
    <div class="tile">
      <div class="tile-label">Total du mois</div>
      <div class="tile-value">${eur(total)}</div>
      <div class="tile-sub">${
        delta == null
          ? 'Pas de mois précédent'
          : `<span class="${delta >= 0 ? 'delta-up' : 'delta-down'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(0)} %</span> vs ${esc(monthLabel(prevMonth(key)))}`
      }</div>
    </div>
    <div class="tile">
      <div class="tile-label">Tickets</div>
      <div class="tile-value">${inMonth.length}</div>
      <div class="tile-sub">sur ${jours} jour${jours > 1 ? 's' : ''}, ${eur(total / inMonth.length)} en moyenne</div>
    </div>
  </div>`;

  /* ---- répartition par catégorie : barres classées ---- */
  const byCat = {};
  inMonth.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
  const cats = CATEGORIES
    .filter(c => byCat[c.id])
    .map(c => ({ ...c, value: byCat[c.id] }))
    .sort((a, b) => b.value - a.value);
  const maxCat = cats[0].value;

  html += `
  <div class="chart">
    <h3 class="chart-title">Répartition par catégorie</h3>
    <p class="chart-sub">${esc(monthLabel(key))} · ${cats.length} catégorie${cats.length > 1 ? 's' : ''}</p>
    <div class="bars">
      ${cats.map(c => `
        <div class="bar-row">
          <div class="bar-head">
            <span class="bar-name"><i style="background:${c.color}"></i><span>${esc(c.label)}</span></span>
            <span class="bar-val">${eur(c.value)} <span style="color:var(--muted)">· ${Math.round((c.value / total) * 100)} %</span></span>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, (c.value / maxCat) * 100)}%;background:${c.color}"></div></div>
        </div>`).join('')}
    </div>
  </div>`;

  /* ---- tendance sur 12 mois : série unique ---- */
  const months = [];
  const [Y, M] = key.split('-').map(Number);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Y, M - 1 - i, 1);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({ k, label: MOIS_COURT[d.getMonth()], value: sum(expenses.filter(e => monthKey(e.date) === k)) });
  }
  const maxM = Math.max(...months.map(m => m.value), 1);

  html += `
  <div class="chart">
    <h3 class="chart-title">Douze derniers mois</h3>
    <p class="chart-sub">Total dépensé par mois · maximum ${eur(maxM)}</p>
    <div class="trend">
      ${months.map(m => `
        <div class="trend-col ${m.k === key ? 'is-current' : ''} ${m.value ? '' : 'is-empty'}" title="${esc(monthLabel(m.k))} : ${eur(m.value)}">
          <div class="trend-bar" style="height:${m.value ? Math.max(3, (m.value / maxM) * 100) : 1}%"></div>
          <div class="trend-label">${esc(m.label)}</div>
        </div>`).join('')}
    </div>
  </div>`;

  /* ---- commerçants ---- */
  const byMerchant = {};
  inMonth.forEach(e => {
    const k = e.merchant || '(sans nom)';
    byMerchant[k] = byMerchant[k] || { total: 0, n: 0, cat: e.category };
    byMerchant[k].total += e.amount;
    byMerchant[k].n++;
  });
  const top = Object.entries(byMerchant).sort((a, b) => b[1].total - a[1].total).slice(0, 8);

  html += `
  <div class="chart">
    <h3 class="chart-title">Où part l'argent</h3>
    <p class="chart-sub">Commerçants les plus dépensiers du mois</p>
    <table class="table">
      <thead><tr><th>Commerçant</th><th>Visites</th><th>Total</th></tr></thead>
      <tbody>
        ${top.map(([m, v]) => `<tr>
          <td><span class="bar-name"><i style="background:${catColor(v.cat)}"></i><span>${esc(m)}</span></span></td>
          <td>${v.n}</td>
          <td>${eur(v.total)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;

  /* ---- justificatifs ---- */
  const sansPhoto = inMonth.filter(e => !e.photoId).length;
  const pointes = inMonth.filter(e => e.matchedTxId).length;
  html += `
  <div class="chart">
    <h3 class="chart-title">Qualité du suivi</h3>
    <p class="chart-sub">${inMonth.length - sansPhoto} ticket${inMonth.length - sansPhoto > 1 ? 's' : ''} avec photo · ${pointes} pointé${pointes > 1 ? 's' : ''} avec le relevé</p>
    <table class="table">
      <tbody>
        <tr><td>Dépenses sans justificatif</td><td>${sansPhoto}</td></tr>
        <tr><td>Dépenses non pointées</td><td>${inMonth.length - pointes}</td></tr>
        <tr><td>Catégorie « Divers » à classer</td><td>${inMonth.filter(e => e.category === 'divers').length}</td></tr>
      </tbody>
    </table>
  </div>`;

  el.innerHTML = html;
}

export { catLabel };
