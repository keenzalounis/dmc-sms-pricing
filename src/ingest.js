/**
 * DMC SMS Pricing - Module d'ingestion Sinch
 *
 * Permet d'ingérer :
 * 1. Le catalogue de base (ex: base_tarifs.csv)
 * 2. Les fichiers de mise à jour (ex: PriceChangeNotification.csv)
 *
 * Maintient l'historique complet pour tracer l'évolution des prix dans le temps.
 */

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'database.json');
const BASE_CSV_PATH = path.join(__dirname, '..', 'data', 'base_tarifs.csv');

/**
 * Parseur CSV universel léger et robuste (sans dépendance externe).
 */
function parseCSV(content) {
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return [];

  const rawHeaders = splitCSVLine(lines[0]);
  const headers = rawHeaders.map(h => h.trim().replace(/^["']|["']$/g, ''));

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitCSVLine(lines[i]);
    if (values.length === 0 || (values.length === 1 && values[0].trim() === '')) continue;

    const row = {};
    headers.forEach((h, idx) => {
      if (h) {
        row[h] = values[idx] !== undefined ? values[idx].trim().replace(/^["']|["']$/g, '') : '';
      }
    });
    rows.push(row);
  }
  return rows;
}

function splitCSVLine(line) {
  const result = [];
  let current = '';
  let insideQuote = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' || char === "'") {
      insideQuote = !insideQuote;
    } else if (char === ',' && !insideQuote) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/**
 * Normalise les dates (supporte "Oct 27 2026", "2026-10-27", "27/10/2026", etc.)
 */
function normalizeDate(dateStr) {
  if (!dateStr) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  const trimmed = dateStr.trim();
  // Format direct ISO AAAA-MM-JJ
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  // Cas spécifique JJ/MM/AAAA
  const parts = trimmed.split(/[/.-]/);
  if (parts.length === 3) {
    if (parts[2].length === 4) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
  }
  return trimmed;
}

/**
 * Charge ou initialise la base locale JSON
 */
function loadDatabase() {
  if (fs.existsSync(DB_PATH)) {
    try {
      const data = fs.readFileSync(DB_PATH, 'utf-8');
      return JSON.parse(data);
    } catch (e) {
      console.warn(`[WARN] Fichier database.json corrompu, réinitialisation : ${e.message}`);
    }
  }
  return {
    meta: {
      lastUpdated: null,
      currency: 'EUR',
      totalDestinations: 0
    },
    records: {}
  };
}

/**
 * Sauvegarde atomique de la base
 */
function saveDatabase(db) {
  db.meta.lastUpdated = new Date().toISOString();
  db.meta.totalDestinations = Object.keys(db.records).length;

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), 'utf-8');
  fs.renameSync(tmpPath, DB_PATH);
}

/**
 * Génère la clé unique télécom pour un opérateur
 */
function buildRecordKey(country, operator, mcc, mnc) {
  const normCountry = (country || 'unknown').toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
  const normOp = (operator || 'generic').toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
  const normMcc = (mcc || '000').trim();
  const normMnc = (mnc || '00').trim();
  return `${normCountry}__${normOp}__${normMcc}_${normMnc}`;
}

/**
 * Ingestion d'un flux de lignes (Base ou Notification)
 */
function ingestRows(rows, sourceName = 'inconnu') {
  const db = loadDatabase();
  let countUpdated = 0;
  let countCreated = 0;

  for (const row of rows) {
    // Détecte le type de format (Base ou PriceChangeNotification)
    const isPriceChange = ('New Price' in row || 'Old Price' in row);

    const country = row['Country'] || row['country'] || 'Inconnu';
    const operator = row['Operator'] || row['operator'] || 'Tous opérateurs';
    const network = row['Network'] || row['network'] || operator;
    const cc = row['CC'] || row['cc'] || '';
    const mcc = row['MCC'] || row['mcc'] || '';
    const mnc = row['MNC'] || row['mnc'] || '';
    const product = row['Product'] || row['product'] || 'SFRBu_STANDARD';

    const key = buildRecordKey(country, operator, mcc, mnc);

    let newPrice, oldPrice, validFrom;

    if (isPriceChange) {
      newPrice = parseFloat(row['New Price'] || row['new_price'] || 0);
      oldPrice = parseFloat(row['Old Price'] || row['old_price'] || newPrice);
      validFrom = normalizeDate(row['Valid From'] || row['valid_from']);
    } else {
      newPrice = parseFloat(row['Price'] || row['price'] || 0);
      oldPrice = newPrice;
      validFrom = normalizeDate(row['EffectiveDate'] || row['date']);
    }

    if (isNaN(newPrice)) continue;

    if (!db.records[key]) {
      // Nouvelle entrée
      db.records[key] = {
        id: key,
        country,
        operator,
        network,
        cc,
        mcc,
        mnc,
        product,
        currentPrice: newPrice,
        previousPrice: oldPrice,
        priceChange: parseFloat((newPrice - oldPrice).toFixed(5)),
        percentChange: oldPrice > 0 ? parseFloat((((newPrice - oldPrice) / oldPrice) * 100).toFixed(2)) : 0,
        validFrom,
        history: []
      };

      if (oldPrice !== newPrice && oldPrice > 0) {
        // Enregistrer l'ancien tarif à une date estimée antérieure
        db.records[key].history.push({
          date: '2026-01-01',
          price: oldPrice,
          source: 'historique_prealable'
        });
      }

      db.records[key].history.push({
        date: validFrom,
        price: newPrice,
        oldPrice,
        product,
        source: sourceName
      });

      countCreated++;
    } else {
      // Entrée existante : mise à jour
      const record = db.records[key];
      const previousPrice = isPriceChange && oldPrice > 0 ? oldPrice : record.currentPrice;

      if (newPrice !== record.currentPrice || isPriceChange) {
        record.previousPrice = previousPrice;
        record.currentPrice = newPrice;
        record.priceChange = parseFloat((newPrice - previousPrice).toFixed(5));
        record.percentChange = previousPrice > 0 ? parseFloat((((newPrice - previousPrice) / previousPrice) * 100).toFixed(2)) : 0;
      }
      record.validFrom = validFrom;
      record.product = product;
      if (network) record.network = network;
      if (cc) record.cc = cc;

      // Ajouter à l'historique si ce point n'existe pas déjà
      const alreadyLogged = record.history.some(h => h.date === validFrom && h.price === newPrice);
      if (!alreadyLogged) {
        record.history.push({
          date: validFrom,
          price: newPrice,
          oldPrice: previousPrice,
          product,
          source: sourceName
        });
        // Trier l'historique chronologiquement
        record.history.sort((a, b) => (a.date > b.date ? 1 : -1));
      }

      countUpdated++;
    }
  }

  saveDatabase(db);
  return { countCreated, countUpdated, total: Object.keys(db.records).length };
}

/**
 * Ingestion directe depuis un fichier sur le disque
 */
function ingestFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Fichier introuvable : ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const filename = path.basename(filePath);
  const rows = parseCSV(content);
  return ingestRows(rows, filename);
}

/**
 * Ingestion depuis une chaîne CSV reçue via upload ou API
 */
function ingestCSVContent(csvString, sourceName = 'upload_manuel.csv') {
  const rows = parseCSV(csvString);
  return ingestRows(rows, sourceName);
}

// Mode CLI autonome : node src/ingest.js [fichier.csv]
if (require.main === module) {
  const targetFile = process.argv[2] || BASE_CSV_PATH;
  console.log(`[INGEST] Démarrage de l'ingestion depuis : ${targetFile}`);
  try {
    const res = ingestFile(targetFile);
    console.log(`[INGEST] Succès : ${res.countCreated} créés, ${res.countUpdated} mis à jour. Total actif : ${res.total}`);
  } catch (err) {
    console.error(`[ERREUR] ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  parseCSV,
  normalizeDate,
  buildRecordKey,
  loadDatabase,
  saveDatabase,
  ingestRows,
  ingestFile,
  ingestCSVContent
};
