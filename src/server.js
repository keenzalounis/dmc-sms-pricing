/**
 * DMC SMS Pricing - Serveur HTTP & API REST
 *
 * Serveur léger autonome (zéro dépendance externe).
 * Fonctionne immédiatement sous Windows et sur la VM Ubuntu.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const { loadDatabase, ingestCSVContent } = require('./ingest');
const { getBillingData, toCSV } = require('./export');
const {
  getSinchConfig,
  saveSinchConfig,
  fetchSinchRates,
  syncSinchPricing,
  getSinchApiStatus
} = require('./sinch-api');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const CHARTS_DIR = path.join(PUBLIC_DIR, 'charts');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
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

function formatChartTitle(filename) {
  const base = filename.replace(/\.(png|svg)$/, '');
  const titles = {
    'top_variations': 'Variations Récentes des Tarifs (%)',
    'price_by_country': 'Comparatif Tarifs d\'Achat par Destination',
    'price_evolution_history': 'Évolution Chronologique dans le Temps',
    'executive_report': 'Synthèse Exécutive Facturation (Dashboard Global)'
  };
  return titles[base] || base.replace(/_/g, ' ');
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

  // 5. GET /api/charts/list : Liste des graphiques Python disponibles
  if (pathname === '/api/charts/list' && method === 'GET') {
    if (!fs.existsSync(CHARTS_DIR)) {
      sendJSON(res, 200, { charts: [] });
      return;
    }
    const files = fs.readdirSync(CHARTS_DIR).filter(f => f.endsWith('.png') || f.endsWith('.svg'));
    const charts = files.map(f => ({
      name: f,
      url: `/charts/${f}`,
      title: formatChartTitle(f)
    }));
    sendJSON(res, 200, { count: charts.length, charts });
    return;
  }

  // 6. POST /api/charts/generate : Déclenche la génération Python des graphes
  if (pathname === '/api/charts/generate' && method === 'POST') {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'generate_charts.py');
    const cmd = process.platform === 'win32'
      ? `python "${scriptPath}"`
      : `python3 "${scriptPath}"`;

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.warn(`[PYTHON] Exécution échouée : ${stderr || error.message}`);
        sendJSON(res, 500, {
          success: false,
          message: 'Échec de la génération Python (vérifier si python3 et pandas/matplotlib sont installés)',
          details: stderr || error.message
        });
        return;
      }
      sendJSON(res, 200, {
        success: true,
        message: 'Graphiques Python générés avec succès !',
        output: stdout
      });
    });
    return;
  }

  // 7. POST /api/upload : Ingestion d'un nouveau CSV (fichier complet ou différentiel)
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

  // 8. GET /api/sinch/status : État de la connexion API Sinch
  if (pathname === '/api/sinch/status' && method === 'GET') {
    const status = getSinchApiStatus();
    sendJSON(res, 200, status);
    return;
  }

  // 9. GET /api/sinch/rates : Consultation des prix en direct depuis Sinch API
  if (pathname === '/api/sinch/rates' && method === 'GET') {
    const country = query.country || null;
    const forceMock = query.mock === 'true';

    fetchSinchRates({ country, forceMock })
      .then(result => {
        sendJSON(res, 200, result);
      })
      .catch(err => {
        sendError(res, err.statusCode || 502, `Erreur Sinch API : ${err.message}`);
      });
    return;
  }

  // 10. POST /api/sinch/sync : Synchronisation des prix Sinch vers database.json
  if (pathname === '/api/sinch/sync' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let options = {};
      if (body) {
        try {
          options = JSON.parse(body);
        } catch (e) {
          // Si le corps n'est pas du JSON strict, on utilise les query params
        }
      }
      const forceMock = options.forceMock !== undefined ? options.forceMock : (query.mock === 'true');
      const country = options.country || query.country || null;

      syncSinchPricing({ forceMock, country })
        .then(result => {
          sendJSON(res, 200, {
            success: true,
            message: 'Synchronisation avec Sinch API effectuée avec succès',
            details: result
          });
        })
        .catch(err => {
          sendError(res, err.statusCode || 500, `Erreur lors de la synchronisation Sinch : ${err.message}`);
        });
    });
    return;
  }

  // 11. POST /api/sinch/config : Mise à jour de la configuration API Sinch
  if (pathname === '/api/sinch/config' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const updated = saveSinchConfig(payload);
        sendJSON(res, 200, {
          success: true,
          message: 'Configuration Sinch sauvegardée avec succès',
          config: {
            configured: Boolean(updated.servicePlanId && updated.apiToken),
            baseUrl: updated.baseUrl,
            timeoutMs: updated.timeoutMs,
            useMockFallback: updated.useMockFallback
          }
        });
      } catch (err) {
        sendError(res, 400, `Payload invalide : ${err.message}`);
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
    console.log(`👉 API Sinch     : http://localhost:${PORT}/api/sinch/status`);
    console.log(`👉 Export Factu  : http://localhost:${PORT}/api/export`);
    console.log(`====================================================`);
  });
}

module.exports = server;
