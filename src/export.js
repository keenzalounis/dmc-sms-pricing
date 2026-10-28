/**
 * DMC SMS Pricing - Module d'export Facturation
 *
 * Génère des exports prêts à l'emploi pour le pôle Facturation SFR Business :
 * - Format CSV compatible Excel FR (séparateur point-virgule et BOM UTF-8)
 * - Possibilité d'appliquer une marge commerciale personnalisée (%)
 * - Filtre par pays ou export global
 */

const fs = require('fs');
const path = require('path');
const { loadDatabase } = require('./ingest');

const DEFAULT_EXPORT_PATH = path.join(__dirname, '..', 'data', 'export_facturation.csv');

/**
 * Génère les lignes de données pour la facturation
 * @param {Object} options
 * @param {number} options.marginPct Marge commerciale en % (ex: 20 pour +20%)
 * @param {string} options.countryFilter Filtrer sur un pays spécifique (optionnel)
 */
function getBillingData({ marginPct = 0, countryFilter = null } = {}) {
  const db = loadDatabase();
  const records = Object.values(db.records);

  const filtered = countryFilter
    ? records.filter(r => r.country.toLowerCase().includes(countryFilter.toLowerCase()))
    : records;

  // Tri alphabétique par Pays puis Opérateur
  filtered.sort((a, b) => {
    if (a.country.localeCompare(b.country) !== 0) {
      return a.country.localeCompare(b.country);
    }
    return a.operator.localeCompare(b.operator);
  });

  return filtered.map(r => {
    const buyPrice = r.currentPrice;
    const marginMultiplier = 1 + (marginPct / 100);
    const sellPrice = parseFloat((buyPrice * marginMultiplier).toFixed(5));

    return {
      country: r.country,
      operator: r.operator,
      network: r.network,
      cc: r.cc,
      mcc: r.mcc,
      mnc: r.mnc,
      buyPriceEUR: buyPrice.toFixed(5),
      marginPct: marginPct,
      sellPriceEUR: sellPrice.toFixed(5),
      priceChangeEUR: r.priceChange !== undefined ? r.priceChange.toFixed(5) : '0.00000',
      percentChange: r.percentChange !== undefined ? `${r.percentChange}%` : '0%',
      validFrom: r.validFrom,
      productRef: r.product,
      lastUpdated: db.meta.lastUpdated ? db.meta.lastUpdated.slice(0, 10) : ''
    };
  });
}

/**
 * Génère le contenu CSV
 * @param {Array} rows Lignes issues de getBillingData
 * @param {string} delimiter Séparateur (défaut ';' pour Excel FR)
 */
function toCSV(rows, delimiter = ';') {
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

  const lines = [headers.join(delimiter)];

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

  // Ajout du BOM UTF-8 (﻿) pour qu'Excel ouvre le fichier en UTF-8 sans souci d'accents
  return '﻿' + lines.join('\r\n');
}

function escapeCSV(val, delimiter) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(delimiter) || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Exporte vers un fichier physique sur disque
 */
function exportToFile({ outputPath = DEFAULT_EXPORT_PATH, marginPct = 0, countryFilter = null, delimiter = ';' } = {}) {
  const rows = getBillingData({ marginPct, countryFilter });
  const csvContent = toCSV(rows, delimiter);

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, csvContent, 'utf-8');
  return { outputPath, count: rows.length };
}

// Mode CLI autonome
if (require.main === module) {
  const args = process.argv.slice(2);
  let margin = 0;
  let country = null;
  let dest = DEFAULT_EXPORT_PATH;

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
