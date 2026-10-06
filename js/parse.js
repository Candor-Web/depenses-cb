/**
 * Extraction des informations utiles dans le texte brut d'un ticket
 * (ticket de caisse détaillé ou reçu de carte bancaire).
 *
 * Tout est heuristique : chaque champ ressort avec un niveau de confiance
 * pour que l'écran de saisie signale ce qui doit être vérifié.
 */

const deacc = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Corrige les confusions OCR classiques à l'intérieur des nombres
 * (O→0, l→1, S→5, B→8). Ne s'applique qu'aux groupes contenant déjà
 * au moins deux vrais chiffres, pour ne pas transformer du texte en montant.
 */
function fixDigits(s, aggressif = false) {
  const minChiffres = aggressif ? 1 : 2;
  return s.replace(/[\dOoQlI|SsB]{1,6}[.,][\dOoQlI|SsB]{2}(?![\d])/g, m =>
    (m.match(/\d/g) || []).length >= minChiffres
      ? m.replace(/[OoQ]/g, '0').replace(/[lI|]/g, '1').replace(/[Ss]/g, '5').replace(/B/g, '8')
      : m);
}

const MONEY_RE = /(?:^|[^\d.,])(\d{1,5}(?:[ .]\d{3})*)[.,](\d{2})(?![\d])/g;

/**
 * Répare les mots abîmés par l'OCR avant de chercher les mots-clés : un chiffre
 * coincé entre deux lettres est forcément une lettre mal lue (M0NTANT, T0TAL).
 * Ne touche pas aux nombres, qui ne sont jamais entourés de lettres.
 */
const LETTRES = { 0: 'O', 1: 'I', 5: 'S', 8: 'B', 6: 'G' };
const keywordize = u => u.replace(/([A-Z])([01568])(?=[A-Z])/g, (_, a, d) => a + LETTRES[d]);

/** Toutes les sommes d'une ligne, avec indication de la présence d'un symbole monétaire. */
function moneyIn(line, aggressif = false) {
  const src = fixDigits(line, aggressif);
  const out = [];
  MONEY_RE.lastIndex = 0;
  let m;
  while ((m = MONEY_RE.exec(src)) !== null) {
    const value = parseFloat(m[1].replace(/[ .]/g, '') + '.' + m[2]);
    if (!isFinite(value)) continue;
    const after = src.slice(m.index + m[0].length, m.index + m[0].length + 6).toUpperCase();
    const before = src.slice(Math.max(0, m.index - 2), m.index);
    out.push({
      value,
      negative: /-\s?$/.test(before),
      cur: /^\s*(EUR|€)/.test(after) || /€/.test(before),
    });
  }
  return out;
}

/* ---------------- montant ---------------- */

const AMOUNT_KEYS = [
  [/\bMONTANT\s*(DU|REEL|TOTAL|:|=)?/, 100],
  [/\bNET\s*A\s*PAYER\b/, 98],
  [/\bTOTAL\s*(TTC|A\s*PAYER|DU)\b/, 95],
  [/\bA\s*PAYER\b/, 90],
  [/\bSOMME\s*(DUE)?\b/, 80],
  [/\bTOTAL\b/, 70],
  [/\bCB\s*EMV\b/, 66],
  [/\bDEBIT\b/, 62],
  [/\bCARTE\s*BANCAIRE\b/, 25],
];

const AMOUNT_EXCLUDE = /\bA\s*RENDRE\b|\bRENDU\b|ESPECES|MONNAIE|\bTVA\b|\bHT\b|\bMT\.|REMISE|ELIGIBLE|\bSOLDE\b|POINT|ECONOMI|CAGNOTTE|AVANTAGE|\bDONT\b|\bTAUX\b|QUANTITE|PRIX\s*UNIT|\bLITRE\b|CUMUL|FIDELIT|ANCIEN|NOUVEAU\s*SOLDE|SOUS[- ]TOTAL/;

function findAmount(lines, U) {
  const cands = [];
  const K = U.map(keywordize);   // lignes réparées, pour la seule reconnaissance des mots-clés

  K.forEach((u, i) => {
    if (AMOUNT_EXCLUDE.test(u)) return;
    let weight = 0;
    for (const [re, w] of AMOUNT_KEYS) if (re.test(u) && w > weight) weight = w;
    if (!weight) return;

    // somme sur la ligne du mot-clé, sinon sur les 3 lignes suivantes
    for (let k = 0; k <= 3; k++) {
      const j = i + k;
      if (j >= K.length) break;
      // ne pas déborder sur une ligne exclue ni sur un autre bloc porteur de mot-clé
      if (k > 0 && (AMOUNT_EXCLUDE.test(K[j]) || hasKey(K[j]))) break;
      const utilisable = s => s.value >= 0.05 && s.value <= 20000 && !s.negative;
      let sums = moneyIn(lines[j]).filter(utilisable);
      // sur une ligne qui annonce un montant, on insiste : « 6O,OO » pour
      // « 60,00 » est l'erreur de lecture la plus courante sur papier thermique
      if (!sums.length) sums = moneyIn(lines[j], true).filter(utilisable);
      if (!sums.length) continue;
      const best = sums.reduce((a, b) => (b.value > a.value ? b : a));
      cands.push({ value: best.value, score: weight - k * 6 + (best.cur ? 4 : 0), line: lines[j] });
      break;
    }
  });

  if (cands.length) {
    cands.sort((a, b) => b.score - a.score || b.value - a.value);
    const top = cands[0];
    return { value: top.value, confidence: top.score >= 60 ? 'high' : 'low', line: top.line };
  }

  // repli : la plus grosse somme du ticket, hors lignes exclues
  let best = null;
  K.forEach((u, i) => {
    if (AMOUNT_EXCLUDE.test(u)) return;
    moneyIn(lines[i]).forEach(s => {
      if (s.negative || s.value < 0.05 || s.value > 20000) return;
      if (!best || s.value > best.value) best = { value: s.value, line: lines[i] };
    });
  });
  return best ? { value: best.value, confidence: 'low', line: best.line } : { value: null, confidence: null, line: '' };
}

function hasKey(u) {
  return AMOUNT_KEYS.some(([re, w]) => w >= 60 && re.test(u));
}

/* ---------------- date ---------------- */

const DATE_RE = /(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{2,4})/;
const TIME_RE = /\b\d{1,2}\s*[:hH]\s*\d{2}/;
const DATE_EXCLUDE = /\bFIN\b|EXP|VALID|VALABLE|JUSQU|ECHEANCE/;

function findDate(lines, U, today = new Date()) {
  const max = new Date(today.getTime() + 36e5 * 24);
  const min = new Date(today.getFullYear() - 3, 0, 1);
  const found = [];

  U.forEach((u, i) => {
    if (DATE_EXCLUDE.test(u)) return;
    const m = DATE_RE.exec(fixDigits(u));
    if (!m) return;
    let [, d, mo, y] = m;
    d = +d; mo = +mo; y = +y;
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000) return;
    const dt = new Date(y, mo - 1, d);
    if (dt.getMonth() !== mo - 1 || dt > max || dt < min) return;
    found.push({ iso: iso(dt), hasTime: TIME_RE.test(u), index: i });
  });

  // Aucune date lisible : on ne la remplace SURTOUT PAS par celle du jour,
  // sinon un vieux ticket atterrit dans le bilan du mois en cours. La dépense
  // reste sans date tant que l'utilisateur ne l'a pas saisie.
  if (!found.length) return { value: null, confidence: null };
  const withTime = found.find(f => f.hasTime);
  const pick = withTime || found[0];
  return { value: pick.iso, confidence: withTime || found.length === 1 ? 'high' : 'low', index: pick.index };
}

export const iso = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* ---------------- commerçant ---------------- */

const CHAINS = [
  ['INTERMARCHE', 'Intermarché'], ['CARREFOUR', 'Carrefour'], ['LECLERC', 'E.Leclerc'],
  ['LIDL', 'Lidl'], ['ALDI', 'Aldi'], ['AUCHAN', 'Auchan'], ['MONOPRIX', 'Monoprix'],
  ['FRANPRIX', 'Franprix'], ['CASINO', 'Casino'], ['PICARD', 'Picard'],
  ['GRAND FRAIS', 'Grand Frais'], ['BIOCOOP', 'Biocoop'], ['NATURALIA', 'Naturalia'],
  ['SUPER U', 'Super U'], ['HYPER U', 'Hyper U'], ['MARCHE U', 'Marché U'], ['NETTO', 'Netto'],
  ['CORA', 'Cora'], ['DECATHLON', 'Decathlon'], ['INTERSPORT', 'Intersport'],
  ['IKEA', 'Ikea'], ['LEROY MERLIN', 'Leroy Merlin'], ['CASTORAMA', 'Castorama'],
  ['BRICORAMA', 'Bricorama'], ['BRICO DEPOT', 'Brico Dépôt'], ['DARTY', 'Darty'],
  ['FNAC', 'Fnac'], ['BOULANGER', 'Boulanger'], ['CULTURA', 'Cultura'], ['GIFI', 'Gifi'],
  ['JARDILAND', 'Jardiland'], ['TRUFFAUT', 'Truffaut'], ['GAMM VERT', 'Gamm Vert'],
  ['TOTALENERGIES', 'TotalEnergies'], ['TOTAL ACCESS', 'Total Access'], ['ESSO', 'Esso'],
  ['AVIA', 'Avia'], ['DYNEFF', 'Dyneff'], ['NORAUTO', 'Norauto'], ['FEU VERT', 'Feu Vert'],
  ['MIDAS', 'Midas'], ['ROADY', 'Roady'], ['SPEEDY', 'Speedy'], ['SNCF', 'SNCF'],
  ['MCDONALD', "McDonald's"], ['BURGER KING', 'Burger King'], ['SUBWAY', 'Subway'],
  ['DECATHL', 'Decathlon'], ['KIABI', 'Kiabi'], ['ZARA', 'Zara'], ['SEPHORA', 'Sephora'],
  ['YVES ROCHER', 'Yves Rocher'], ['MARIONNAUD', 'Marionnaud'], ['ACTION FRANCE', 'Action'],
];

const NOISE = /CARTE\s*BANCAIRE|SANS.?CONTACT|CREDIT\s*AGRICOLE|SOCIETE\s*GENERALE|BANQUE\s*POP|CAISSE\s*D.?EPARGNE|\bBNP\b|\bLCL\b|SEPA|TICKET|DUPLICATA|MERCI|AU\s*REVOIR|RECU|PAIEMENT|\bDEBIT\b|\bCREDIT\b|SIRET|\bTVA\b|^TEL|ENTREPRISE\s*INDEPENDANTE|\bEUR\b|MONTANT|\bAUTO\b|POMPE|CARBURANT|INDICATIONS|CONTROLEE|ALPES\s*PROVENCE|ILE\s*DE\s*FRANCE|GARANTIE|OUVERTURE|DIMANCHE|LUNDI|SAMEDI|A\s*CONSERVER|CLIENT|COMMERCANT|PORTEUR|ACCEPTE|^CB$|^C$|NOMBRE\s*D|ARTICLES|RECAPITULATIF|IMMEDIATE|VOTRE\s*VISITE|^VER|QUANTITE|PRIX\s*UNIT|ESPECES|RENDRE|\bDAB\b/;

const CITY_RE = /^\d{5}\b|^[A-Z][A-Z\s\-']{2,30}$/;

function looksLikeName(u) {
  if (u.length < 3 || u.length > 34) return false;
  if (NOISE.test(u)) return false;
  const letters = (u.match(/[A-Z]/g) || []).length;
  const digits = (u.match(/\d/g) || []).length;
  if (letters < 3 || digits > letters) return false;
  if (/^\d/.test(u)) return false;
  return true;
}

function findMerchant(lines, U, dateIndex) {
  // 1. enseigne connue
  let bestChain = null;
  for (const [key, label] of CHAINS) {
    const re = new RegExp('\\b' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
    for (let i = 0; i < U.length; i++) {
      if (re.test(U[i])) {
        if (!bestChain || i < bestChain.index) bestChain = { label, index: i };
        break;
      }
    }
  }
  if (bestChain && bestChain.index <= 12) return { value: bestChain.label, confidence: 'high' };

  // 2. sur un reçu CB, le nom suit la ligne date + heure
  if (dateIndex != null) {
    for (let j = dateIndex + 1; j < Math.min(dateIndex + 4, U.length); j++) {
      if (looksLikeName(U[j])) return { value: titleCase(lines[j]), confidence: 'high' };
    }
  }

  // 3. première ligne exploitable en tête de ticket
  for (let i = 0; i < Math.min(8, U.length); i++) {
    if (looksLikeName(U[i])) return { value: titleCase(lines[i]), confidence: 'low' };
  }
  if (bestChain) return { value: bestChain.label, confidence: 'low' };
  return { value: '', confidence: null };
}

export function titleCase(s) {
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
    .replace(/(^|[\s\-'])([a-zà-ÿ])/g, (_, p, c) => p + c.toUpperCase());
}

/* ---------------- articles et TVA ---------------- */

const ITEM_RE = /^(.{3,32}?)\s{1,}(-?\d{1,3}[.,]\d{2})\s*(EUR|€)?\s*([AB])?$/i;
const VAT_RE = /^([AB])\s+(\d{1,2}[.,]\d{2})\s*%?\s+(\d{1,5}[.,]\d{2})\s+(\d{1,5}[.,]\d{2})\s+(\d{1,5}[.,]\d{2})/;

function findItems(lines, U) {
  const items = [];
  lines.forEach((l, i) => {
    if (AMOUNT_EXCLUDE.test(U[i]) || hasKey(U[i])) return;
    const m = ITEM_RE.exec(fixDigits(l.trim()));
    if (!m) return;
    const label = m[1].trim().replace(/\s{2,}/g, ' ');
    if (!/[A-Za-z]{3}/.test(label)) return;
    items.push({ label, price: parseFloat(m[2].replace(',', '.')) });
  });
  return items.length >= 3 ? items : [];
}

function findVat(lines) {
  const out = [];
  lines.forEach(l => {
    const m = VAT_RE.exec(fixDigits(l.trim().toUpperCase()));
    if (m) out.push({
      code: m[1],
      rate: parseFloat(m[2].replace(',', '.')),
      ht: parseFloat(m[3].replace(',', '.')),
      tva: parseFloat(m[4].replace(',', '.')),
      ttc: parseFloat(m[5].replace(',', '.')),
    });
  });
  return out;
}

/* ---------------- point d'entrée ---------------- */

export function parseReceipt(raw, today = new Date()) {
  const lines = String(raw || '').split(/\r?\n/).map(l => l.replace(/\s+$/, '')).filter(l => l.trim());
  const U = lines.map(l => deacc(l).toUpperCase().replace(/\s+/g, ' ').trim());

  const amount = findAmount(lines, U);
  const date = findDate(lines, U, today);
  const merchant = findMerchant(lines, U, date.index);
  const items = findItems(lines, U);
  const vat = findVat(lines);

  // cohérence : si la somme des articles colle au montant, on gagne en confiance
  if (items.length && amount.value) {
    const sum = items.reduce((a, b) => a + b.price, 0);
    if (Math.abs(sum - amount.value) < 0.02) amount.confidence = 'high';
  }
  // cohérence : le TTC du récapitulatif TVA doit égaler le montant
  const ttc = vat.reduce((a, b) => a + b.ttc, 0);
  if (vat.length && amount.value && Math.abs(ttc - amount.value) < 0.02) amount.confidence = 'high';

  const postal = (U.join('\n').match(/\b(\d{5})\b/) || [])[1] || '';

  return { amount, date, merchant, items, vat, postal, lines };
}
