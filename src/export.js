/**
 * DMC SMS Pricing - Module d'exportation pour le Pôle Facturation SFR Business
 *
 * Ce module transforme le référentiel des prix Sinch en un fichier CSV prêt pour
 * l'intégration directe ou l'ouverture dans Microsoft Excel :
 * 1. Applique une marge commerciale paramétrable en % (ex: +15%) sur le tarif brut Sinch
 * 2. Formate le fichier selon les standards Excel français (séparateur point-virgule ';')
 * 3. Intègre le caractère d'en-tête UTF-8 BOM (﻿) pour préserver tous les accents français
 * 4. Permet un filtrage ciblé par pays ou un export mondial complet des 913 destinations
 */

// Module natif Node.js pour écrire les fichiers sur le disque dur
const fs = require('fs');

// Module natif Node.js pour construire des chemins de fichiers compatibles Windows et Linux
const path = require('path');

// Chargement de la base de données active (database.json)
const { loadDatabase } = require('./ingest');

// Chemin de destination par défaut pour les exports en ligne de commande
const DEFAULT_EXPORT_PATH = path.join(__dirname, '..', 'data', 'export_facturation.csv');

/**
 * Calcule et extrait les données de facturation prêtes à l'emploi.
 *
 * @param {Object} options - Options de génération
 * @param {number} [options.marginPct=0] - Marge commerciale en pourcentage (ex: 15 pour 15%)
 * @param {string|null} [options.countryFilter=null] - Filtrer sur un pays précis (ex: 'France')
 * @returns {Array<Object>} Tableau d'objets contenant les tarifs calculés pour chaque destination
 */
function getBillingData({ marginPct = 0, countryFilter = null } = {}) {
  // 1. Chargement de la base de données active en temps réel
  const db = loadDatabase();
  const records = Object.values(db.records);

  // 2. Application du filtre par pays si renseigné par l'utilisateur
  const filtered = countryFilter
    ? records.filter(r => (r.country || '').toLowerCase().includes(countryFilter.toLowerCase().trim()))
    : records;

  // 3. Tri alphabétique propre par Pays puis par Opérateur (prise en compte des accents français : Émirats, Algérie...)
  filtered.sort((a, b) => {
    const countryCompare = (a.country || '').localeCompare(b.country || '', 'fr');
    if (countryCompare !== 0) {
      return countryCompare;
    }
    return (a.operator || '').localeCompare(b.operator || '', 'fr');
  });

  // 4. Calcul de la marge et mise en forme de chaque ligne de tarif
  return filtered.map(r => {
    // Tarif d'achat brut négocié auprès de Sinch (€ HT / SMS)
    const buyPrice = Number.isFinite(r.currentPrice) ? r.currentPrice : (parseFloat(r.currentPrice) || 0);

    // Multiplicateur de marge commerciale : ex. 15% donne 1 + 0.15 = 1.15
    const marginMultiplier = 1 + (marginPct / 100);

    // Formule : Tarif Vente Client = Tarif Achat Sinch * (1 + Marge / 100)
    // Arrondi bancaire précis à 5 décimales pour les télécoms
    const sellPrice = parseFloat((buyPrice * marginMultiplier).toFixed(5));

    return {
      country: r.country || '',                                              // Nom du pays de destination
      operator: r.operator || '',                                            // Nom de l'opérateur mobile
      network: r.network || r.operator || '',                                // Nom du réseau télécom
      cc: r.cc || '',                                                        // Indicatif téléphonique international (+33, +34...)
      mcc: r.mcc || '',                                                      // Code pays mobile ITU (ex: 208 pour la France)
      mnc: r.mnc || '',                                                      // Code réseau opérateur ITU (ex: 10 pour SFR)
      buyPriceEUR: buyPrice.toFixed(5),                                      // Coût brut d'achat Sinch en euros
      marginPct: marginPct,                                                  // Pourcentage de marge appliqué (%)
      sellPriceEUR: sellPrice.toFixed(5),                                    // Prix final facturé au client SFR en euros
      priceChangeEUR: Number.isFinite(r.priceChange) ? r.priceChange.toFixed(5) : '0.00000', // Écart en euros
      percentChange: r.percentChange !== undefined ? `${r.percentChange}%` : '0%',           // Écart en pourcentage
      validFrom: r.validFrom || '',                                          // Date d'entrée en vigueur du tarif
      productRef: r.product || '',                                           // Référence produit Sinch d'origine
      lastUpdated: db.meta.lastUpdated ? db.meta.lastUpdated.slice(0, 10) : '' // Date de synchronisation
    };
  });
}

/**
 * Convertit le tableau de données en texte brut CSV compatible Excel.
 *
 * @param {Array<Object>} rows - Lignes générées par getBillingData
 * @param {string} [delimiter=';'] - Séparateur de colonnes (point-virgule pour Excel FR)
 * @returns {string} Chaîne CSV complète encodée avec BOM UTF-8
 */
function toCSV(rows, delimiter = ';') {
  // En-têtes officiels des colonnes pour le pôle Facturation
  const headers = [
    'Pays',
    'Operateur',
    'Reseau',
    'Indicatif_Tel',
    'MCC',
    'MNC',
    'Tarif_Achat_Sinch_EUR',
    'Marge_Appliquee_Pct',
    'Tarif_Facture_Client_EUR',
    'Variation_Recente_EUR',
    'Variation_Recente_Pct',
    'Date_Entree_Vigueur',
    'Ref_Produit_Sinch'
  ];

  // Première ligne : la ligne d'en-tête
  const lines = [headers.join(delimiter)];

  // Construction de chaque ligne de données
  for (const r of rows) {
    const line = [
      escapeCSV(r.country, delimiter),
      escapeCSV(r.operator, delimiter),
      escapeCSV(r.network, delimiter),
      escapeCSV(r.cc, delimiter),
      escapeCSV(r.mcc, delimiter),
      escapeCSV(r.mnc, delimiter),
      r.buyPriceEUR,
      r.marginPct,
      r.sellPriceEUR,
      r.priceChangeEUR,
      r.percentChange,
      r.validFrom,
      escapeCSV(r.productRef, delimiter)
    ];
    lines.push(line.join(delimiter));
  }

  // Ajout du caractère magique UTF-8 BOM (﻿) en tout début de fichier.
  // Ce caractère informe Microsoft Excel que le fichier est en UTF-8 et permet
  // l'affichage parfait et automatique de tous les accents français (é, è, ê, ô, etc.).
  return '﻿' + lines.join('\r\n');
}

/**
 * Sécurise une cellule CSV pour éviter toute cassure de tableau.
 * Si une valeur contient un point-virgule, un guillemet ou un retour à la ligne,
 * elle est automatiquement protégée par des guillemets doubles.
 */
function escapeCSV(val, delimiter) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(delimiter) || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Génère et enregistre physiquement le fichier CSV sur le disque du serveur.
 */
function exportToFile({ outputPath = DEFAULT_EXPORT_PATH, marginPct = 0, countryFilter = null, delimiter = ';' } = {}) {
  // Calcul des données avec la marge demandée
  const rows = getBillingData({ marginPct, countryFilter });
  const csvContent = toCSV(rows, delimiter);

  // Création du dossier cible s'il n'existe pas encore
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Écriture du fichier sur le disque
  fs.writeFileSync(outputPath, csvContent, 'utf-8');
  return { outputPath, count: rows.length };
}

// Mode console autonome : exécutable directement via "node src/export.js --margin=15"
if (require.main === module) {
  const args = process.argv.slice(2);
  let margin = 0;
  let country = null;
  let dest = DEFAULT_EXPORT_PATH;

  // Lecture des arguments en ligne de commande
  args.forEach(arg => {
    if (arg.startsWith('--margin=')) margin = parseFloat(arg.split('=')[1]) || 0;
    if (arg.startsWith('--country=')) country = arg.split('=')[1];
    if (arg.startsWith('--out=')) dest = arg.split('=')[1];
  });

  console.log(`[EXPORT] Génération du fichier facturation (Marge: ${margin}%, Filtre pays: ${country || 'TOUS'})...`);
  const res = exportToFile({ outputPath: dest, marginPct: margin, countryFilter: country });
  console.log(`[EXPORT] Fichier généré avec succès (${res.count} lignes) : ${res.outputPath}`);
}

module.exports = {
  getBillingData,
  toCSV,
  exportToFile
};
