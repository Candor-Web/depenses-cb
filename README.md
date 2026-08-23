# Dépenses CB

Application web installable sur le Pixel 3 : on photographie un ticket de caisse
ou un reçu de carte bancaire, elle en extrait le montant, la date et le
commerçant, classe la dépense et tient le bilan du mois.

**Tout reste dans le téléphone.** Aucune donnée, aucune photo ne part sur
internet : la reconnaissance de texte tourne en local, et le stockage est celui
du navigateur.

---

## Installer sur le Pixel 3

1. Ouvrir l'adresse de l'application dans **Chrome** sur le téléphone.
2. Menu ⋮ → **Ajouter à l'écran d'accueil** → Installer.
3. Ouvrir l'app depuis l'icône : elle s'affiche en plein écran, sans barre
   d'adresse.
4. Onglet **Outils** → **Télécharger le moteur** (4,5 Mo, à faire en Wi-Fi).
   Après ça, la lecture des tickets fonctionne même sans réseau.

> Sans l'étape 4, l'application marche quand même, mais le moteur se télécharge
> à la première photo, donc en 4G.

---

## Utiliser

| Geste | Résultat |
|---|---|
| **Photographier un ticket** | Ouvre l'appareil photo intégré, lit le ticket, pré-remplit la fiche |
| **Galerie** | Même chose depuis des photos déjà prises (plusieurs à la fois) |
| **Sans ticket** | Saisie directe d'un montant, sans justificatif |

### Pourquoi un appareil photo intégré

À la première prise de vue, Chrome demande l'autorisation d'accéder à
l'appareil photo. Il faut l'accepter, car l'application photographie
elle-même, sans passer par l'application Appareil photo d'Android.

Ce n'est pas un caprice. Quand une application web installée cède la main à
l'appareil photo du téléphone, Android la met en arrière-plan et, sur un
appareil qui manque de mémoire comme le Pixel 3, la recharge au retour : la
photo est perdue avant d'avoir été traitée, et on retombe sur l'écran d'accueil
sans le moindre message. En capturant dans la page, on ne quitte jamais
l'application.

L'écran de prise de vue affiche un cadre en pointillés : y faire tenir le
ticket en entier. Un bouton **Lampe** apparaît si le téléphone le permet,
utile sur un ticket pâle. Si l'autorisation est refusée, l'application bascule
d'elle-même sur l'appareil photo du téléphone, avec le risque décrit ci-dessus.

### Ajouter un montant sans ticket

Pour une dépense en espèces, un achat au marché, un paiement en ligne ou un
ticket perdu : bouton **Sans ticket** sur l'écran d'accueil, ou **Ajouter un
montant sans ticket** en haut de l'onglet Dépenses. La fiche s'ouvre vide, à la
date du jour, le clavier numérique déjà actif sur le montant. Seul le montant
est obligatoire ; le commerçant se complète depuis l'historique des noms déjà
saisis, et le moyen de paiement permet de distinguer CB, espèces et autre.

Ces dépenses sont comptées comme *sans justificatif* dans le bilan, et le
rapprochement bancaire les traite comme les autres : une dépense en espèces
apparaîtra logiquement dans les tickets sans ligne bancaire.

Après la lecture, chaque champ porte une pastille :

- **lu** (vert) : l'information a été trouvée de façon fiable ;
- **à vérifier** (orange) : c'est une supposition, relire avant d'enregistrer.

Le bandeau *Texte lu sur le ticket* montre ce que le moteur a réellement
déchiffré. Si le résultat est mauvais, **Relire la photo autrement** relance la
lecture avec un autre traitement d'image (noir et blanc ↔ contraste), ce qui
rattrape souvent un ticket sombre, froissé ou pris en biais.

### Pour que la lecture marche bien

- ticket **à plat**, sur un fond uni et contrasté ;
- cadrage **serré** sur le ticket, en **portrait** ;
- lumière franche, sans ombre portée ni reflet ;
- les reçus CB (une dizaine de lignes) passent beaucoup mieux que les longs
  tickets de caisse.

C'est de la reconnaissance de caractères locale, pas de l'intelligence
artificielle : sur du papier thermique pâle ou froissé, il faut s'attendre à
corriger un champ de temps en temps. Le montant est ce qui est le mieux repéré,
parce que l'application s'appuie sur les mots-clés du ticket
(`MONTANT`, `MONTANT DU`, `TOTAL`, `NET A PAYER`…) et vérifie la cohérence avec
le récapitulatif de TVA quand il existe.

---

## Onglet Outils

### Exporter

| Bouton | Contenu |
|---|---|
| **CSV relevé** | `Date;Libelle;Debit;Credit;Categorie` — à coller dans la feuille *Operations 2026* |
| **CSV détaillé** | tous les champs : paiement, note, TVA, justificatif, pointage |
| **CSV des articles** | une ligne par article des tickets de caisse détaillés |

Format point-virgule, décimales à la virgule, encodage Windows-1252 : le fichier
s'ouvre directement dans Excel français, sans assistant d'importation.

### Rapprochement bancaire

Importer l'export CSV du relevé (par exemple
`RELEVES COMPTE ANNEE 2026.csv`). L'application apparie chaque ticket avec sa
ligne de débit — montant identique au centime, écart de date accepté jusqu'à
7 jours, le libellé bancaire départageant les candidats — puis affiche :

- les tickets sans ligne bancaire (photo prise mais débit pas encore passé, ou
  doublon) ;
- les débits sans ticket (justificatif manquant).

### Justificatifs

Export ZIP de toutes les photos, nommées `2026-08-06_Carrefour_72-30EUR.jpg`.
Pratique pour les garanties.

### Sauvegarde

**À faire régulièrement.** Les données vivent uniquement dans le navigateur du
téléphone : effacer les données de Chrome ou désinstaller l'app les détruit. Le
fichier de sauvegarde contient les dépenses **et** les photos.

---

## Ce qu'il y a dans le dossier

```
index.html                 écran unique, 4 onglets
css/styles.css             thème sombre, palette de graphiques validée
js/app.js                  orchestration de l'interface
js/db.js                   stockage IndexedDB
js/camera.js               appareil photo intégré (capture sans quitter la page)
js/ocr.js                  préparation d'image + moteur Tesseract
js/parse.js                extraction montant / date / commerçant / articles
js/categories.js           9 catégories, affectation par mots-clés
js/bank.js                 lecture du relevé CSV et rapprochement
js/export.js               CSV Windows-1252, archive ZIP
js/bilan.js                tableau de bord mensuel
sw.js                      service worker (fonctionnement hors ligne)
vendor/                    Tesseract 5.1.1 + données françaises (hors ligne)
outils/generer-icones.js   fabrique les icônes PNG
outils/test-parseur.mjs    banc d'essai du parseur sur des tickets réels
serve.cjs                  serveur statique de test sur le PC
```

### Tester sur le PC

```bash
node livrables/applications/depenses-cb/serve.cjs 4190
```

puis `http://localhost:4190`.

Contrôler le parseur après toute modification des règles :

```bash
cd livrables/applications/depenses-cb && node outils/test-parseur.mjs
```

Le banc d'essai rejoue six tickets réels (Intermarché Venelles, station
Carrefour La Pioline, Carrefour Aix Bienvenue, Hostellerie des vins de Rognes,
E.Leclerc Salon, La Rotonde) en version propre et en version bruitée : 25
contrôles, tous au vert.
