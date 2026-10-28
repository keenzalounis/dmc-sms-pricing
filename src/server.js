/**
 * DMC SMS Pricing - Serveur HTTP & API REST
 *
 * Serveur léger autonome (zéro dépendance externe).
 * Fonctionne immédiatement sous Windows et sur la VM Ubuntu.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const { loadDatabase, ingestCSVContent } = require('./ingest');
const { getBillingData, toCSV } = require('./export');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

function sendError(res, statusCode, message) {
  sendJSON(res, statusCode, { error: true, message });
}

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;
  const query = Object.fromEntries(reqUrl.searchParams.entries());
  const method = req.method.toUpperCase();

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- ROUTES API ---

  // 1. GET /api/stats : KPI globaux
  if (pathname === '/api/stats' && method === 'GET') {
    const db = loadDatabase();
    const records = Object.values(db.records);

    let totalIncreases = 0;
    let totalDecreases = 0;
    let sumPrices = 0;

    records.forEach(r => {
      sumPrices += r.currentPrice;
      if (r.priceChange > 0) totalIncreases++;
      if (r.priceChange < 0) totalDecreases++;
    });

    const avgPrice = records.length > 0 ? (sumPrices / records.length).toFixed(5) : 0;

    sendJSON(res, 200, {
      totalDestinations: records.length,
      averagePriceEUR: parseFloat(avgPrice),
      totalIncreases,
      totalDecreases,
      lastUpdated: db.meta.lastUpdated,
      currency: db.meta.currency
    });
    return;
  }

  // 2. GET /api/prices : Liste des tarifs avec recherche et filtres
  if (pathname === '/api/prices' && method === 'GET') {
    const db = loadDatabase();
    let records = Object.values(db.records);

    const q = (query.q || '').toLowerCase().trim();
    if (q) {
      records = records.filter(r =>
        r.country.toLowerCase().includes(q) ||
        r.operator.toLowerCase().includes(q) ||
        r.cc.includes(q) ||
        r.mcc.includes(q) ||
        r.mnc.includes(q)
      );
    }

    // Tri par pays puis opérateur
    records.sort((a, b) => a.country.localeCompare(b.country) || a.operator.localeCompare(b.operator));

    sendJSON(res, 200, { count: records.length, data: records });
    return;
  }

  // 3. GET /api/history : Historique de prix d'un opérateur
  if (pathname === '/api/history' && method === 'GET') {
    const id = query.id;
    if (!id) {
      sendError(res, 400, 'Paramètre "id" manquant (ex: ?id=san_marino__san_marino_telecom__292_01)');
      return;
    }
    const db = loadDatabase();
    const record = db.records[id];
    if (!record) {
      sendError(res, 404, `Opérateur introuvable avec l'id : ${id}`);
      return;
    }
    sendJSON(res, 200, {
      id: record.id,
      country: record.country,
      operator: record.operator,
      cc: record.cc,
      currentPrice: record.currentPrice,
      history: record.history
    });
    return;
  }

  // 4. GET /api/export : Téléchargement du fichier Facturation CSV
  if (pathname === '/api/export' && method === 'GET') {
    const margin = parseFloat(query.margin || 0);
    const country = query.country || null;
    const rows = getBillingData({ marginPct: margin, countryFilter: country });
    const csv = toCSV(rows, ';');

    const filename = `export_facturation_dmc_${new Date().toISOString().slice(0, 10)}.csv`;
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`
    });
    res.end(csv);
    return;
  }

  // 5. POST /api/upload : Ingestion d'un nouveau CSV (fichier complet ou différentiel)
  if (pathname === '/api/upload' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        if (!body || body.trim().length === 0) {
          sendError(res, 400, 'Corps de requête vide');
          return;
        }

        // Si c'est du multipart (upload de formulaire standard), on extrait le contenu CSV
        let csvContent = body;
        if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
          const match = body.match(/\r?\n\r?\n([\s\S]*?)\r?\n--/);
          if (match && match[1]) {
            csvContent = match[1];
          }
        }

        const result = ingestCSVContent(csvContent, 'upload_web_interface.csv');
        sendJSON(res, 200, {
          success: true,
          message: 'Fichier ingéré avec succès',
          details: result
        });
      } catch (err) {
        sendError(res, 500, `Erreur lors de l'ingestion : ${err.message}`);
      }
    });
    return;
  }

  // --- SERVEUR DE FICHIERS STATIQUES (UI) ---
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  // Sécurité traversée de chemin
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendError(res, 403, 'Accès interdit');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback vers index.html pour les URLs simples
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        sendError(res, 404, 'Fichier non trouvé');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 DMC SMS Pricing - Serveur démarré avec succès !`);
    console.log(`👉 Interface Web : http://localhost:${PORT}`);
    console.log(`👉 API Tarifs    : http://localhost:${PORT}/api/prices`);
    console.log(`👉 Export Factu  : http://localhost:${PORT}/api/export`);
    console.log(`====================================================`);
  });
}

module.exports = server;
