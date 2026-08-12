/**
 * Catégories de dépenses : couleurs (palette catégorielle validée, mode sombre)
 * et affectation automatique par mots-clés, dans l'esprit des feuilles Categories
 * du classeur budget.
 */

export const CATEGORIES = [
  { id: 'alimentation', label: 'Alimentation',  color: 'var(--series-1)' },
  { id: 'carburant',    label: 'Carburant',     color: 'var(--series-2)' },
  { id: 'restaurant',   label: 'Restaurant',    color: 'var(--series-3)' },
  { id: 'sante',        label: 'Santé',         color: 'var(--series-4)' },
  { id: 'maison',       label: 'Maison',        color: 'var(--series-5)' },
  { id: 'loisirs',      label: 'Loisirs',       color: 'var(--series-6)' },
  { id: 'transport',    label: 'Transport',     color: 'var(--series-7)' },
  { id: 'habillement',  label: 'Habillement',   color: 'var(--series-8)' },
  { id: 'divers',       label: 'Divers',        color: 'var(--series-other)' },
];

export const catById = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
export const catLabel = id => catById(id).label;
export const catColor = id => catById(id).color;

/** Mots-clés cherchés dans le nom du commerçant PUIS dans le texte complet du ticket. */
const RULES = [
  ['carburant', ['STATION', 'CARBURANT', 'GAZOLE', 'GASOIL', 'SP95', 'SP98', 'E10', 'E85',
                 'TOTAL ENERGIES', 'TOTALENERGIES', 'ESSO', 'AVIA', 'DYNEFF', 'AGIP', 'DAC VL',
                 'SHELL', 'BP FRANCE', 'ELAN']],
  ['restaurant', ['RESTAURANT', 'BRASSERIE', 'PIZZ', 'BURGER', 'MCDONALD', 'MC DONALD', 'KFC',
                  'SUBWAY', 'CAFE', 'CAFÉ', 'BISTRO', 'TAVERNE', 'CREPERIE', 'SNACK', 'TRAITEUR',
                  'HOSTELLERIE', 'AUBERGE', 'ROTONDE', 'GLACIER', 'SUSHI', 'KEBAB', 'BAR ']],
  ['alimentation', ['INTERMARCHE', 'INTERMARCHÉ', 'CARREFOUR', 'LECLERC', 'LIDL', 'ALDI', 'AUCHAN',
                    'CASINO', 'MONOPRIX', 'FRANPRIX', 'SUPER U', 'HYPER U', 'MARKET', 'PICARD',
                    'GRAND FRAIS', 'BIOCOOP', 'NATURALIA', 'NETTO', 'CORA', 'SPAR', 'VIVAL',
                    'BOULANGERIE', 'BOUCHERIE', 'PRIMEUR', 'FROMAGERIE', 'POISSONNERIE',
                    'EPICERIE', 'SUPERMARCHE', 'MARCHE U', 'PROXI', 'UTILE', 'DELVIL']],
  ['sante', ['PHARMACIE', 'PARAPHARM', 'LABORATOIRE', 'MEDECIN', 'MÉDECIN', 'DENTAIRE', 'DENTISTE',
             'OPTIQUE', 'OPTICIEN', 'KINE', 'KINÉ', 'INFIRMIER', 'CLINIQUE', 'HOPITAL', 'HÔPITAL',
             'RADIOLOGIE', 'AUDITION', 'MUTUELLE']],
  ['maison', ['LEROY MERLIN', 'CASTORAMA', 'BRICO', 'BRICORAMA', 'WELDOM', 'MR BRICOLAGE', 'IKEA',
              'CONFORAMA', 'BUT ', 'MAISONS DU MONDE', 'JARDILAND', 'TRUFFAUT', 'GAMM VERT',
              'DARTY', 'BOULANGER', 'ACTION', 'GIFI', 'CENTRAKOR', 'QUINCAILLERIE']],
  ['transport', ['SNCF', 'RATP', 'PEAGE', 'PÉAGE', 'VINCI', 'ESCOTA', 'ASF ', 'PARKING', 'PARC AUTO',
                 'NORAUTO', 'FEU VERT', 'MIDAS', 'ROADY', 'SPEEDY', 'CONTROLE TECHNIQUE', 'GARAGE',
                 'TAXI', 'UBER', 'AEROPORT', 'AÉROPORT', 'PEUGEOT', 'RENAULT', 'CITROEN', 'LAVAGE']],
  ['loisirs', ['FNAC', 'CULTURA', 'CINEMA', 'CINÉMA', 'PATHE', 'PATHÉ', 'UGC', 'THEATRE', 'THÉÂTRE',
               'MUSEE', 'MUSÉE', 'LIBRAIRIE', 'PRESSE', 'TABAC', 'MICROMANIA', 'SPOTIFY', 'NETFLIX',
               'PISCINE', 'GOLF', 'CAVE', 'VINS', 'OENOLOG']],
  ['habillement', ['DECATHLON', 'ZARA', 'KIABI', 'H&M', 'C&A', 'CELIO', 'JULES', 'GEMO', 'GÉMO',
                   'CHAUSSURE', 'ANDRE', 'ERAM', 'INTERSPORT', 'GO SPORT', 'PRETMANIA', 'VETEMENT',
                   'BIJOUTERIE', 'SEPHORA', 'YVES ROCHER', 'MARIONNAUD', 'NOCIBE']],
];

/** Indices très caractéristiques : ils l'emportent sur le nom de l'enseigne. */
const STRONG = [
  ['carburant', /\bCARBURANT\b|\bGAZOLE\b|\bGASOIL\b|\bSP9[58]\b|\bE10\b|\bE85\b|PRIX UNIT|\bLITRE|\bPOMPE\b/],
  ['sante', /\bORDONNANCE\b|\bPHARMACIE\b|\bMUTUELLE\b/],
  ['transport', /\bPEAGE\b|\bCONTROLE TECHNIQUE\b|\bPARKING\b/],
];

const wordRe = w => new RegExp('\\b' + norm(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');

/**
 * Devine la catégorie par score : un mot-clé trouvé dans le nom du commerçant
 * pèse trois fois plus que le même mot trouvé ailleurs sur le ticket.
 * @param {string} merchant nom du commerçant
 * @param {string} fullText texte OCR complet (facultatif)
 * @param {Object} learned  mémoire commerçant -> catégorie
 */
export function guessCategory(merchant = '', fullText = '', learned = {}) {
  const m = norm(merchant);
  if (m && learned[m]) return learned[m];

  const f = norm(fullText);
  const scores = {};
  const add = (cat, n) => { scores[cat] = (scores[cat] || 0) + n; };

  for (const [cat, words] of RULES) {
    for (const w of words) {
      const re = wordRe(w);
      if (m && re.test(m)) add(cat, 3);
      else if (f && re.test(f)) add(cat, 1);
    }
  }
  for (const [cat, re] of STRONG) if (re.test(f) || re.test(m)) add(cat, 5);

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : 'divers';
}

export const norm = s => (s || '')
  .toUpperCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

/** Mémorise le choix manuel de l'utilisateur pour ce commerçant. */
export function learn(learned, merchant, category) {
  const m = norm(merchant);
  if (m.length >= 3) learned[m] = category;
  return learned;
}
