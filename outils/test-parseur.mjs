/**
 * Banc d'essai du parseur, sur la transcription des tickets réels de Jérôme.
 * Usage : node outils/test-parseur.mjs
 */
import { parseReceipt } from '../js/parse.js';
import { guessCategory, catLabel } from '../js/categories.js';

const TODAY = new Date(2026, 7, 12); // 12/08/2026

const TICKETS = [
  {
    nom: 'Intermarché Venelles (ticket détaillé)',
    // 17 lignes = 16 articles + la ligne de remise « 2EME A -60% », dont la somme fait bien 37,01
    attendu: { montant: 37.01, date: '2026-07-13', enseigne: 'Intermarché', cat: 'alimentation', articles: 17 },
    texte: `Intermarche
SA.DELVIL
ENTREPRISE INDEPENDANTE
R.N 96,LES LOGISSONS
13770 VENELLES
SIRET 33218497700020
TEL : 04-42-54-99-00
DUPLICATA
ALPRO BOISS.AVOINE S      2,78 EUR A
ALVALLE GAZP. SALMOJ      3,93 EUR A
ALVALLE GAZP. SALMOJ      3,93 EUR A
6 OEUFS PLEIN AIR CA      2,33 EUR A
ALPRO BOISS.AVOINE S      2,78 EUR A
PSDT BEURRE GASTR DX      1,77 EUR A
BARILLA SPAGHETTI N       0,95 EUR A
TIPIAK MELIMELO CER/      2,27 EUR A
FIORINI FUSILLI 500G      0,64 EUR A
FIOR DBL CONC.TOMAT       1,01 EUR A
TWININGS EARL GREY 5      4,10 EUR A
SIGGI'S SKYR NATURE       5,02 EUR A
TIC TAC MENTHE ETUI       2,01 EUR B
QUAKER OATS 800G          2,58 EUR A
TIPIAK CEREALE GOURM      1,78 EUR A
LABELL BAD WHITE&PRO      1,49 EUR B
2EME A -60% ALVALLE      -2,36
MONTANT DU               37,01 EUR
CB EMV                   37,01 EUR
Nombre d'articles vendus= 16
TOTAL ELIGIBLE TRD       33,51 EUR
A RENDRE                  0,00 EUR
ESPECES                   0,00 EUR
RECAPITULATIF TVA
CODE TVA   MT. HT   MT. TVA   MT. TTC
A  5,50%    31,76     1,75      33,51
B 20,00%     2,92     0,58       3,50
TOTAL TVA   34,68     2,33      37,01
Remises immediates
REMISES IMMEDIATES    1    2,36 EUR
9:45:23    13/07/2026
M12106  C009   00210   T0004
Ver:8.6.8.2-981 - 1.1.12.1
CE TICKET SERT DE GARANTIE
*MERCI DE VOTRE VISITE*`,
  },
  {
    nom: 'Station Carrefour La Pioline (carburant)',
    attendu: { montant: 72.30, date: '2026-08-06', enseigne: 'Carrefour', cat: 'carburant' },
    texte: `Station Carrefour
ZI LA PIOLINE
13545 AIX EN PROVENCE
SIRET 45132137600
CREDIT AGRICOLE
ILE DE FRANCE
A000000421010
CB
le : 06/08/26 a: 17:01:11
CARREFOUR DAC VL
AIX-EN-PROVENCE
13290
2368542 18206
4513213500304
************4887
5C216F845DE67A3C
509 292204 1518
C      @
No AUTO : 216915
MONTANT REEL :
  72.30  EUR
        DEBIT
   TICKET A CONSERVER
MERCI AU REVOIR
Ticket No :
000501 00006 00 09 03189298
No pompe   = 9
Carburant  = E10
Quantite   = 37,50 L
Prix unit. = 1,928 EUR
TVA 20,00% = 12,05 EUR
indications non
controlees par l'etat
TVA FR 19451321376
Tel : 08 26 25 32 35`,
  },
  {
    nom: 'Carrefour Aix Bienvenue (reçu CB)',
    attendu: { montant: 21.03, date: '2026-08-06', enseigne: 'Carrefour', cat: 'alimentation' },
    texte: `Carrefour
AIX BIENVENUE
TEL 04.42.16.91.79
SEPA-FAST
SANS-CONTACT
AIX EN PROVENCE
198702587612002
00000002
A0000000421010
CB
XXXXXXXXXXXX4887 00
06/08/2026        16:54:03
438268            501108
MONTANT      21,03 EUR
PAIEMENT ACCEPTE
RECU PORTEUR`,
  },
  {
    nom: 'Hostellerie des Vins de Rognes (reçu CB)',
    attendu: { montant: 39.00, date: '2026-08-06', enseigne: 'Hostellerie Vins Rognes', cat: 'restaurant' },
    texte: `CARTE BANCAIRE
SANS CONTACT
CREDIT AGRICOLE ALPES
PROVENCE
A0000000421010
CB
LE 06/08/2026 A 09:29:07
HOSTELLERIE VINS   ROGNES
13840
1381352
11306
79485460400012
***********4887
4576953F40595A4F
001 000002 95 C@
N° AUTO: 187566
MONTANT
                39,00 €
DEBIT
TICKET CLIENT A CONSERVER
MERCI AU REVOIR 1854234077`,
  },
  {
    nom: 'E.Leclerc Salon-de-Provence (reçu CB)',
    attendu: { montant: 22.72, date: '2026-08-04', enseigne: 'E.Leclerc', cat: 'alimentation' },
    texte: `E.Leclerc
*************************
S.A.S SALONDIS
ROUTE DE PELISSANNE
13300 SALON DE
PROVENCE
*************************
CARTE BANCAIRE
SANS CONTACT
A0000000421010
CB
le 04/08/26 a 17:45:59
E.LECLERC
13 SALON DE PROVENCE
8515116  44257023000015
13149
XXXXXXXXXXXX4887
BB3E72F8B829CA76
018  001   001690
C      @
No AUTO : 619600
MONTANT = 22,72 EUR
DEBIT
TICKET CLIENT
A CONSERVER`,
  },
  {
    nom: 'Retrait au distributeur',
    attendu: { montant: 60.00, date: '2026-08-02', cat: 'retrait' },
    texte: `CREDIT AGRICOLE ALPES PROVENCE
RETRAIT D'ESPECES
LE 02/08/2026 A 14:22:08
DAB 00123 ROGNES
A0000000421010
CB
***********4887
MONTANT
       60,00 EUR
DEBIT
TICKET CLIENT A CONSERVER`,
  },
  {
    nom: 'Ticket sans aucune date lisible',
    attendu: { montant: 14.90, date: null },
    texte: `BOULANGERIE DU COURS
AIX EN PROVENCE
BAGUETTE TRADITION        1,30
CROISSANTS X4             4,60
TARTE AUX POMMES          9,00
MONTANT DU               14,90 EUR
CB
MERCI DE VOTRE VISITE`,
  },
  {
    nom: 'La Rotonde Aix (reçu CB, avec date de fin de validité)',
    attendu: { montant: 78.00, date: '2026-08-04', enseigne: 'La Rotonde', cat: 'restaurant' },
    texte: `CARTE BANCAIRE
A0000000421010
CB
Le 04/08/2026 a 13:58:50
LA ROTONDE
AIX EN PROVENCE
13100
3063320
10278
43033271800021
2010
4561889798474887
8FF03F56122BC57F
FIN  30/09/28
022 001 000551 C
No AUTO :
MONTANT :
       78,00 EUR
DEBIT
TICKET COMMERCANT
A CONSERVER`,
  },
];

// Variante dégradée : ce que l'OCR rend réellement sur du papier thermique froissé
const BRUIT = s => s
  .replace(/MONTANT/g, 'M0NTANT')
  .replace(/0,00/g, 'O,OO')
  .replace(/1/g, m => (Math.random() < 0.15 ? 'l' : m));

let ok = 0, ko = 0;
const fail = [];

for (const t of TICKETS) {
  const r = parseReceipt(t.texte, TODAY);
  const cat = guessCategory(r.merchant.value, t.texte);
  const got = {
    montant: r.amount.value,
    date: r.date.value,
    enseigne: r.merchant.value,
    cat,
    articles: r.items.length,
  };
  const checks = [];
  for (const [k, v] of Object.entries(t.attendu)) {
    const good = k === 'enseigne'
      ? String(got[k]).toLowerCase().replace(/\s+/g, ' ') === String(v).toLowerCase()
      : got[k] === v;
    checks.push([k, good, got[k], v]);
    good ? ok++ : (ko++, fail.push(`${t.nom} → ${k} : obtenu ${JSON.stringify(got[k])}, attendu ${JSON.stringify(v)}`));
  }
  console.log(`\n${checks.every(c => c[1]) ? '✓' : '✗'} ${t.nom}`);
  console.log(`   ${got.montant} € · ${got.date} · ${got.enseigne} · ${catLabel(cat)}` +
    (got.articles ? ` · ${got.articles} articles` : '') +
    `  [confiance montant ${r.amount.confidence}, date ${r.date.confidence}, enseigne ${r.merchant.confidence}]`);
  checks.filter(c => !c[1]).forEach(c => console.log(`   ! ${c[0]} : ${JSON.stringify(c[2])} au lieu de ${JSON.stringify(c[3])}`));
}

console.log('\n--- affectation des catégories ---');
const CAS = [
  ['Amazon', '', 'internet'],
  ['PayPal', '', 'internet'],
  ['Vinted', '', 'internet'],
  // « market » figure aussi dans les supermarchés : le mot-clé le plus précis gagne
  ['Back Market', '', 'internet'],
  ['Carrefour Market', '', 'alimentation'],
  // les abonnements ne sont pas des achats en ligne : ils sont suivis ailleurs
  ['Free Mobile', '', 'divers'],
  ['Freebox', '', 'divers'],
  ['Retrait', 'RETRAIT D\'ESPECES DAB 00123', 'retrait'],
  ['Crédit Agricole', 'RETRAIT DAB ROGNES', 'retrait'],
  ['Intermarché', 'DRIVE RETRAIT EN MAGASIN', 'alimentation'],
  ['Carrefour', 'Carburant = E10', 'carburant'],
  ['Pharmacie Mirabeau', '', 'sante'],
];
for (const [m, t, attendu] of CAS) {
  const obtenu = guessCategory(m, t);
  const bon = obtenu === attendu;
  bon ? ok++ : (ko++, fail.push(`catégorie « ${m} » : obtenu ${obtenu}, attendu ${attendu}`));
  console.log(`${bon ? '✓' : '✗'} ${m.padEnd(22)} ${catLabel(obtenu)}`);
}

console.log('\n--- texte dégradé (simulation OCR bruité) ---');
for (const t of TICKETS) {
  const r = parseReceipt(BRUIT(t.texte), TODAY);
  const bon = r.amount.value === t.attendu.montant;
  console.log(`${bon ? '✓' : '✗'} ${t.nom.padEnd(48)} montant ${r.amount.value}`);
}

console.log(`\n${ok} contrôles OK, ${ko} en échec`);
if (fail.length) { fail.forEach(f => console.log('  · ' + f)); process.exitCode = 1; }
