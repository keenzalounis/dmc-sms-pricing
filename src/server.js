/**
 * DMC SMS Pricing - Serveur HTTP & API REST
 *
 * Serveur léger autonome (zéro dépendance externe).
 * Fonctionne immédiatement sous Windows et sur la VM Ubuntu.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const {
  loadDatabase,
  ingestCSVContent,
  listDatabaseArchives,
  getDatabaseArchive,
  deleteDatabaseArchive
} = require('./ingest');
const { getBillingData, toCSV } = require('./export');
const {
  loadMailConfig,
  syncMailbox,
  initNightlySyncScheduler,
  calculateMsUntilNextSchedule
} = require('./mail_sync');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
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
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function sendError(res, statusCode, message, details) {
  const response = { error: true, message };
  if (details && details.length) response.details = details;
  sendJSON(res, statusCode, response);
}

function formatChartTitle(filename) {
  const base = filename.replace(/\.(png|svg)$/, '');
  const titles = {
    'average_price_by_country': 'Comparaison des tarifs moyens par pays',
    'annual_price_evolution': 'Évolution temporelle des tarifs historisés'
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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

  // 5. GET /api/archives : Versions précédentes du référentiel
  if (pathname === '/api/archives' && method === 'GET') {
    try {
      sendJSON(res, 200, { archives: listDatabaseArchives() });
    } catch (err) {
      sendError(res, 500, `Erreur de lecture des archives : ${err.message}`);
    }
    return;
  }

  // 6. GET /api/archives/:filename : Téléchargement d'une version archivée
  if (pathname.startsWith('/api/archives/') && method === 'GET') {
    try {
      const filename = decodeURIComponent(pathname.slice('/api/archives/'.length));
      const archive = getDatabaseArchive(filename);
      if (!archive) {
        sendError(res, 404, 'Archive introuvable');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`
      });
      res.end(archive);
    } catch (err) {
      sendError(res, 400, `Impossible de télécharger cette archive : ${err.message}`);
    }
    return;
  }

  // 6b. DELETE /api/archives/:filename : Suppression d'une version archivée
  if (pathname.startsWith('/api/archives/') && method === 'DELETE') {
    try {
      const filename = decodeURIComponent(pathname.slice('/api/archives/'.length));
      const deleted = deleteDatabaseArchive(filename);
      if (!deleted) {
        sendError(res, 404, 'Archive introuvable');
        return;
      }
      sendJSON(res, 200, { success: true, message: 'Archive supprimée avec succès' });
    } catch (err) {
      sendError(res, 400, `Impossible de supprimer cette archive : ${err.message}`);
    }
    return;
  }

  // 7. GET /api/charts/list : Liste des graphiques Python disponibles
  if (pathname === '/api/charts/list' && method === 'GET') {
    if (!fs.existsSync(CHARTS_DIR)) {
      sendJSON(res, 200, { charts: [] });
      return;
    }
    const files = fs.readdirSync(CHARTS_DIR)
      .filter(f => f.endsWith('.png') || f.endsWith('.svg'))
      .sort((a, b) => a.localeCompare(b));
    const charts = files.map(f => ({
      name: f,
      url: `/charts/${f}`,
      title: formatChartTitle(f)
    }));
    sendJSON(res, 200, { count: charts.length, charts });
    return;
  }

  // 8. POST /api/charts/generate : Déclenche la génération Python des graphes
  if (pathname === '/api/charts/generate' && method === 'POST') {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'generate_charts.py');
    const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    execFile(python, [scriptPath], { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) {
        console.warn(`[PYTHON] Exécution échouée : ${stderr || error.message}`);
        sendJSON(res, 500, {
          success: false,
          message: 'Échec de la génération Python. Vérifiez Python 3 et les dépendances définies dans requirements.txt.',
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

  // 9. POST /api/upload : Ingestion d'un nouveau CSV (fichier complet ou différentiel)
  if (pathname === '/api/upload' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        if (!body || body.trim().length === 0) {
          sendError(res, 400, 'Corps de requête vide');
          return;
        }

        const uploadedName = req.headers['x-file-name']
          ? path.basename(decodeURIComponent(req.headers['x-file-name']))
          : 'upload_web_interface.csv';
        const result = ingestCSVContent(body, uploadedName);
        sendJSON(res, 200, {
          success: true,
          message: 'Fichier ingéré avec succès',
          details: result
        });
      } catch (err) {
        sendError(
          res,
          err.statusCode || 500,
          `Erreur lors de l'ingestion : ${err.message}`,
          err.details
        );
      }
    });
    return;
  }

  // 10. GET /api/mail/status : État de la configuration et de la planification email
  if (pathname === '/api/mail/status' && method === 'GET') {
    const config = loadMailConfig();
    if (!config) {
      sendJSON(res, 200, { configured: false, enabled: false });
      return;
    }
    const hasPassword = Boolean(config.password && !config.password.includes('METTRE_ICI'));
    const msUntilNext = calculateMsUntilNextSchedule(config.scheduleTime || '02:00');
    const nextRun = new Date(Date.now() + msUntilNext).toISOString();
    sendJSON(res, 200, {
      configured: hasPassword,
      enabled: Boolean(config.enabled),
      user: config.user,
      host: config.host || 'imap.gmail.com',
      port: config.port || 993,
      allowedSenders: config.allowedSenders || ['@sinch.com'],
      scheduleTime: config.scheduleTime || '02:00',
      nextRun
    });
    return;
  }

  // 11. POST /api/mail/sync : Déclenchement d'une synchronisation manuelle immédiate
  if (pathname === '/api/mail/sync' && method === 'POST') {
    syncMailbox().then(result => {
      sendJSON(res, result.success ? 200 : 400, result);
    }).catch(err => {
      sendError(res, 500, `Erreur inattendue : ${err.message}`);
    });
    return;
  }

  if (pathname.startsWith('/api/')) {
    sendError(res, 404, 'Route API introuvable');
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
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store'
      });
      res.end(content);
    });
  });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`====================================================`);
    console.log(`🚀 DMC SMS Pricing - Serveur démarré avec succès !`);
    console.log(`👉 Interface Web : http://localhost:${PORT}`);
    console.log(`👉 Écoute        : ${HOST}:${PORT}`);
    console.log(`👉 Tarifs        : http://localhost:${PORT}/api/prices`);
    console.log(`👉 Archives      : http://localhost:${PORT}/api/archives`);
    console.log(`👉 Export Factu  : http://localhost:${PORT}/api/export`);
    console.log(`====================================================`);
    initNightlySyncScheduler();
  });
}

module.exports = server;
