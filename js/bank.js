/**
 * Import d'un relevé bancaire au format CSV (export Société Générale ou
 * équivalent) et rapprochement avec les tickets photographiés.
 */

import { norm } from './categories.js';

const DATE = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/;
const NUM = /^-?\d{1,3}(?:[ . ]\d{3})*(?:[.,]\d{1,2})?$|^-?\d+[.,]\d{1,2}$/;

const toNum = s => {
  const t = String(s).replace(/[  ]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const v = parseFloat(t);
  return isFinite(v) ? v : null;
};

const toISO = s => {
  const m = DATE.exec(String(s).trim());
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = '20' + y;
  return `${y}-${String(+mo).padStart(2, '0')}-${String(+d).padStart(2, '0')}`;
};

/** Décode le fichier : windows-1252 par défaut, UTF-8 si le BOM ou le contenu l'indique. */
export function decodeCSV(buffer) {
  const u8 = new Uint8Array(buffer);
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(u8.subarray(3));
  }
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(u8);
  if (!utf8.includes('�')) return utf8;
  return new TextDecoder('windows-1252').decode(u8);
}

function splitLine(line, sep) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/**
 * @returns {{rows: Array<{id, date, label, amount}>, skipped: number}}
 */
export function parseStatement(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const sep = (lines.find(l => l.includes(';')) ? ';' : ',');

  // en-tête éventuel : sert à savoir quelle colonne est le débit
  let debitCol = -1, creditCol = -1;
  const head = lines.find(l => /libell|montant|d[ée]bit|cr[ée]dit/i.test(l));
  if (head) {
    splitLine(head, sep).forEach((c, i) => {
      const n = norm(c);
      if (/^DEBIT/.test(n)) debitCol = i;
      if (/^CREDIT/.test(n)) creditCol = i;
    });
  }

  const rows = [];
  let skipped = 0;

  for (const line of lines) {
    const cells = splitLine(line, sep);
    const di = cells.findIndex(c => DATE.test(c));
    if (di < 0) { skipped++; continue; }
    const date = toISO(cells[di]);
    if (!date) { skipped++; continue; }

    let amount = null;
    if (debitCol >= 0 && cells[debitCol] && NUM.test(cells[debitCol])) {
      amount = -Math.abs(toNum(cells[debitCol]));
    } else if (creditCol >= 0 && cells[creditCol] && NUM.test(cells[creditCol])) {
      amount = Math.abs(toNum(cells[creditCol]));
    } else {
      for (let i = cells.length - 1; i > di; i--) {
        if (NUM.test(cells[i])) { amount = toNum(cells[i]); break; }
      }
    }
    if (amount == null) { skipped++; continue; }

    const label = cells
      .filter((c, i) => i !== di && !NUM.test(c) && /[A-Za-zÀ-ÿ]{3}/.test(c))
      .sort((a, b) => b.length - a.length)[0] || '';

    rows.push({ id: `${date}|${amount}|${label.slice(0, 30)}|${rows.length}`, date, label, amount });
  }
  return { rows, skipped };
}

/* ---------------- rapprochement ---------------- */

const days = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);

function similarity(merchant, label) {
  const A = new Set(norm(merchant).split(/[^A-Z0-9]+/).filter(w => w.length > 2));
  const B = norm(label);
  if (!A.size) return 0;
  let hit = 0;
  A.forEach(w => { if (B.includes(w)) hit++; });
  return hit / A.size;
}

/**
 * Apparie chaque dépense avec une ligne de débit du relevé.
 * Règle : montant identique au centime, écart de date ≤ 7 jours,
 * le libellé bancaire départage les candidats.
 */
export function reconcile(expenses, bankRows) {
  const debits = bankRows.filter(r => r.amount < 0);
  const pairs = [];

  // une dépense sans date ne peut pas être rapprochée : l'écart de date,
  // qui départage les candidats de même montant, n'est pas calculable
  expenses.filter(e => e.date).forEach(e => {
    debits.forEach(t => {
      if (Math.abs(Math.abs(t.amount) - e.amount) > 0.005) return;
      const d = days(e.date, t.date);
      if (d > 7) return;
      pairs.push({ e, t, score: similarity(e.merchant, t.label) * 10 - d });
    });
  });

  pairs.sort((a, b) => b.score - a.score);
  const usedE = new Set(), usedT = new Set(), matched = [];
  pairs.forEach(p => {
    if (usedE.has(p.e.id) || usedT.has(p.t.id)) return;
    usedE.add(p.e.id); usedT.add(p.t.id);
    matched.push(p);
  });

  return {
    matched,
    expensesSansLigne: expenses.filter(e => !usedE.has(e.id)),
    lignesSansTicket: debits.filter(t => !usedT.has(t.id)),
  };
}
