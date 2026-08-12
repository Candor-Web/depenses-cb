/**
 * Sorties : CSV pour Excel français, archive ZIP des justificatifs,
 * sauvegarde/restauration complète.
 */

import { catLabel } from './categories.js';

/* ---------------- formats ---------------- */

export const eur = n =>
  (n == null ? 0 : n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

export const num2 = n => (n == null ? '' : n.toFixed(2).replace('.', ','));

export const dateFR = iso => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

/** Encode en Windows-1252 : c'est ce qu'Excel français attend d'un CSV. */
export function cp1252(str) {
  const SPECIAL = {
    0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86,
    0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
    0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
    0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
    0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
  };
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    out[i] = c < 256 ? c : (SPECIAL[c] != null ? SPECIAL[c] : 0x3f);
  }
  return out;
}

const cell = v => {
  const s = String(v == null ? '' : v);
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export const toCSV = rows => rows.map(r => r.map(cell).join(';')).join('\r\n') + '\r\n';

export function downloadCSV(rows, filename) {
  download(new Blob([cp1252(toCSV(rows))], { type: 'text/csv;charset=windows-1252' }), filename);
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------------- jeux de colonnes ---------------- */

/** Colonnes calées sur un relevé bancaire : à coller dans la feuille Operations. */
export const rowsReleve = list => [
  ['Date', 'Libelle', 'Debit', 'Credit', 'Categorie'],
  ...list.map(e => [dateFR(e.date), e.merchant, num2(e.amount), '', catLabel(e.category)]),
];

/** Toutes les informations saisies, pour archivage ou retraitement. */
export const rowsDetail = list => [
  ['Date', 'Commercant', 'Montant', 'Categorie', 'Paiement', 'Note', 'Justificatif', 'Source', 'Pointe', 'TVA'],
  ...list.map(e => [
    dateFR(e.date), e.merchant, num2(e.amount), catLabel(e.category),
    e.payment || 'CB', e.note || '', e.photoId ? 'oui' : 'non',
    e.source === 'ocr' ? 'photo' : 'saisie', e.matchedTxId ? 'oui' : 'non',
    num2((e.vat || []).reduce((a, v) => a + (v.tva || 0), 0)) || '',
  ]),
];

/** Une ligne par article détecté sur les tickets détaillés. */
export const rowsArticles = list => {
  const rows = [['Date', 'Commercant', 'Article', 'Prix', 'Categorie']];
  list.forEach(e => (e.items || []).forEach(it =>
    rows.push([dateFR(e.date), e.merchant, it.label, num2(it.price), catLabel(e.category)])));
  return rows;
};

/* ---------------- archive ZIP (stockage sans compression) ---------------- */

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d) {
  return {
    time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31),
    date: (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31),
  };
}

/**
 * @param {Array<{name: string, data: Uint8Array, date?: Date}>} files
 * @returns {Blob}
 */
export function makeZip(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  files.forEach(f => {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const { time, date } = dosTime(f.date || new Date());

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);           // noms de fichiers en UTF-8
    lh.setUint16(8, 0, true);                // méthode 0 : stocké
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, f.data.length, true);
    lh.setUint32(22, f.data.length, true);
    lh.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(lh.buffer), name, f.data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, f.data.length, true);
    ch.setUint32(24, f.data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);

    offset += 30 + name.length + f.data.length;
  });

  const centralSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

export const safeName = s =>
  (s || 'ticket').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 _-]/g, '').replace(/\s+/g, '-').slice(0, 40) || 'ticket';
