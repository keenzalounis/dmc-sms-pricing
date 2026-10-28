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
const ARCHIVES_DIR = path.join(__dirname, '..', 'data', 'archives');

/**
 * Parseur CSV universel léger et robuste (sans dépendance externe).
 */
function parseCSV(content) {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(lines[0]);
  const rawHeaders = splitCSVLine(lines[0], delimiter);
  const headers = rawHeaders.map(h => h.trim().replace(/^["']|["']$/g, ''));

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitCSVLine(lines[i], delimiter);
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

function detectDelimiter(headerLine) {
  const candidates = [',', ';', '\t'];
  return candidates.reduce((selected, delimiter) =>
    splitCSVLine(headerLine, delimiter).length > splitCSVLine(headerLine, selected).length
      ? delimiter
      : selected
  , candidates[0]);
}

function splitCSVLine(line, delimiter = ',') {
  const result = [];
  let current = '';
  let quote = null;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && (!quote || quote === char)) {
      if (quote && line[i + 1] === char) {
        current += char;
        i++;
      } else {
        quote = quote ? null : char;
      }
    } else if (char === delimiter && !quote) {
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

function parsePrice(value) {
  const normalized = String(value || '').trim().replace(/\s/g, '');
  if (!normalized) return NaN;
  const decimalComma = normalized.lastIndexOf(',') > normalized.lastIndexOf('.');
  const standard = decimalComma
    ? normalized.replace(/\./g, '').replace(',', '.')
    : normalized.replace(/,/g, '');
  return Number.parseFloat(standard);
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

function archiveDatabaseSnapshot(db, sourceName, sourceContent) {
  if (!fs.existsSync(DB_PATH) || Object.keys(db.records).length === 0) return null;

  fs.mkdirSync(ARCHIVES_DIR, { recursive: true });
  const archivedAt = new Date().toISOString();
  const timestamp = archivedAt.replace(/[-:.]/g, '');
  const safeSource = path.basename(sourceName || 'import')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80);
  const baseFilename = `${timestamp}__${safeSource || 'import'}`;
  let filename = `${baseFilename}.json`;
  let suffix = 1;
  while (fs.existsSync(path.join(ARCHIVES_DIR, filename))) {
    filename = `${baseFilename}_${suffix++}.json`;
  }
  const archive = {
    archivedAt,
    source: sourceName || 'import',
    database: db,
    importedCsv: sourceContent || null
  };
  fs.writeFileSync(path.join(ARCHIVES_DIR, filename), JSON.stringify(archive, null, 2), 'utf-8');
  return filename;
}

function listDatabaseArchives() {
  if (!fs.existsSync(ARCHIVES_DIR)) return [];

  return fs.readdirSync(ARCHIVES_DIR)
    .filter(filename => filename.endsWith('.json'))
    .map(filename => {
      const archive = JSON.parse(fs.readFileSync(path.join(ARCHIVES_DIR, filename), 'utf-8'));
      return {
        filename,
        archivedAt: archive.archivedAt,
        source: archive.source,
        totalDestinations: Object.keys(archive.database.records || {}).length
      };
    })
    .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
}

function getDatabaseArchive(filename) {
  if (path.basename(filename) !== filename || !filename.endsWith('.json')) {
    throw new Error('Nom d’archive invalide');
  }
  const archivePath = path.join(ARCHIVES_DIR, filename);
  if (!fs.existsSync(archivePath)) return null;
  return fs.readFileSync(archivePath, 'utf-8');
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
function ingestRows(rows, sourceName = 'inconnu', sourceContent = null) {
  const db = loadDatabase();
  let countUpdated = 0;
  let countCreated = 0;
  let archived = false;

  for (const row of rows) {
    // Détecte le type de format (Base ou PriceChangeNotification)
    const isPriceChange = ('New Price' in row || 'Old Price' in row);

    const country = row['Country'] || row['country'] || 'Inconnu';
    const operator = row['Operator'] || row['operator'] || 'Tous opérateurs';
    if (country === 'Inconnu' || operator === 'Tous opérateurs') continue;
    const network = row['Network'] || row['network'] || operator;
    const cc = row['CC'] || row['cc'] || '';
    let mcc = row['MCC'] || row['mcc'] || '';
    let mnc = row['MNC'] || row['mnc'] || '';
    const mccMnc = row['MCC/MNC'] || row['MCC / MNC'] || row['mcc_mnc'] || '';
    if (mccMnc) {
      const combined = mccMnc.trim().match(/^(\d{3})\s*[/.-]\s*(\d{1,3})$/);
      if (combined) {
        mcc = mcc || combined[1];
        mnc = mnc || combined[2];
      } else if (!mnc) {
        mnc = mccMnc.trim();
      }
    }
    const product = row['Product'] || row['product'] || 'SFRBu_STANDARD';
    const serviceType = row['Service type'] || row['Service Type'] || row['service_type'] || '';
    const originator = row['Originator'] || row['originator'] || '';

    const key = buildRecordKey(country, operator, mcc, mnc);

    let newPrice, oldPrice, validFrom;

    if (isPriceChange) {
      newPrice = parsePrice(row['New Price'] || row['new_price']);
      oldPrice = parsePrice(row['Old Price'] || row['old_price'] || newPrice);
      validFrom = normalizeDate(row['Valid From'] || row['valid_from']);
      if (!Number.isFinite(oldPrice) || oldPrice < 0) oldPrice = newPrice;
    } else {
      newPrice = parsePrice(row['Price'] || row['price']);
      oldPrice = newPrice;
      validFrom = normalizeDate(row['EffectiveDate'] || row['date']);
    }

    if (!Number.isFinite(newPrice) || newPrice <= 0) continue;
    if (!archived) {
      archiveDatabaseSnapshot(db, sourceName, sourceContent);
      archived = true;
    }

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
        serviceType,
        originator,
        currency: row['Currency'] || row['currency'] || 'EUR',
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
      if (serviceType) record.serviceType = serviceType;
      if (originator) record.originator = originator;
      if (row['Currency'] || row['currency']) record.currency = row['Currency'] || row['currency'];
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
  if (!archived) {
    const error = new Error('Aucune ligne de tarif valide trouvée. Vérifiez le format et les colonnes du CSV.');
    error.statusCode = 400;
    throw error;
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
  return ingestRows(rows, filename, content);
}

/**
 * Ingestion depuis une chaîne CSV reçue via upload ou API
 */
function ingestCSVContent(csvString, sourceName = 'upload_manuel.csv') {
  const rows = parseCSV(csvString);
  if (rows.length === 0) {
    const error = new Error('Le fichier CSV est vide ou ne contient aucune ligne de données.');
    error.statusCode = 400;
    throw error;
  }
  return ingestRows(rows, sourceName, csvString);
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
  parsePrice,
  normalizeDate,
  buildRecordKey,
  loadDatabase,
  saveDatabase,
  listDatabaseArchives,
  getDatabaseArchive,
  ingestRows,
  ingestFile,
  ingestCSVContent
};
