/**
 * DMC SMS Pricing - Serveur HTTP & API REST
 *
 * Serveur léger autonome (zéro dépendance externe).
 * Fonctionne immédiatement sous Windows et sur la VM Ubuntu.
 */

// Modules natifs Node.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// Moteur de tarification et persistance
const {
  loadDatabase,
  listDatabaseArchives,
  getDatabaseArchive,
  deleteDatabaseArchive,
  restoreDatabaseArchive,
  resetToBaseCatalog
} = require('./ingest');

// Validation et ingestion sécurisée des téléversements manuels
const { ingestManualCSV } = require('./manual_upload');

// Moteur d'export facturation Excel avec marge
const { getBillingData, toCSV } = require('./export');

// Connecteur de relève automatique IMAP
const {
  loadMailConfig,
  syncMailbox,
  initNightlySyncScheduler,
  calculateMsUntilNextSchedule
} = require('./mail_sync');

// Module d'authentification, sessions et contrôle d'accès RBAC
const {
  verifyPassword,
  findUserByEmail,
  findUserById,
  loadUsers,
  createUser,
  deleteUser,
  updatePassword,
  createSession,
  destroySession,
  authenticateRequest
} = require('./auth');

// Configuration du serveur
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

function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body || !body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Corps de requête JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = reqUrl.pathname;

  // Normalisation du préfixe éventuel du reverse proxy Nginx (/dmc)
  if (pathname.startsWith('/dmc/')) {
    pathname = pathname.slice(4);
  } else if (pathname === '/dmc') {
    pathname = '/';
  }

  const query = Object.fromEntries(reqUrl.searchParams.entries());
  const method = req.method.toUpperCase();

  // En-têtes CORS pour intégration navigateur
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // =========================================================================
  // SECTION 1 : AUTHENTIFICATION PUBLIQUE (Sans session préalable)
  // =========================================================================

  // 1.1 POST /api/auth/login : Connexion utilisateur
  if (pathname === '/api/auth/login' && method === 'POST') {
    readJSONBody(req).then(({ email, password }) => {
      if (!email || !password) {
        sendError(res, 400, 'Veuillez renseigner votre email et votre mot de passe.');
        return;
      }
      const user = findUserByEmail(email);
      if (!user || !verifyPassword(password, user.passwordHash)) {
        sendError(res, 401, 'Adresse email ou mot de passe incorrect.');
        return;
      }
      const session = createSession(user);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': `dmc_session=${session.token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`
      });
      res.end(JSON.stringify({
        success: true,
        user: { id: user.id, email: user.email, name: user.name, role: user.role }
      }));
    }).catch(err => sendError(res, 400, err.message));
    return;
  }

  // 1.2 GET /api/auth/me : Vérification de la session active
  if (pathname === '/api/auth/me' && method === 'GET') {
    const auth = authenticateRequest(req);
    if (!auth.authenticated) {
      sendJSON(res, 200, { authenticated: false });
      return;
    }
    sendJSON(res, 200, {
      authenticated: true,
      user: {
        id: auth.user.userId,
        email: auth.user.email,
        name: auth.user.name,
        role: auth.user.role
      }
    });
    return;
  }

  // 1.3 POST /api/auth/logout : Déconnexion
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const auth = authenticateRequest(req);
    if (auth.authenticated && auth.user && auth.user.token) {
      destroySession(auth.user.token);
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'dmc_session=; HttpOnly; Path=/; Max-Age=0'
    });
    res.end(JSON.stringify({ success: true, message: 'Déconnexion réussie.' }));
    return;
  }

  // =========================================================================
  // CONTRÔLE D'ACCÈS RBAC : Toutes les autres routes /api/ sont protégées
  // =========================================================================
  if (pathname.startsWith('/api/')) {
    const auth = authenticateRequest(req);
    if (!auth.authenticated) {
      sendError(res, 401, 'Authentification requise pour accéder aux services DMC.');
      return;
    }
    req.user = auth.user;

    // Actions strictement réservées au rôle 'admin'
    const isAdminMutation = (
      pathname.startsWith('/api/upload') ||
      pathname.startsWith('/api/reset-base') ||
      pathname.startsWith('/api/mail/sync') ||
      pathname.startsWith('/api/users') ||
      (pathname.startsWith('/api/archives/') && (method === 'DELETE' || method === 'POST'))
    );

    if (isAdminMutation && req.user.role !== 'admin') {
      sendError(res, 403, 'Accès refusé : cette action est réservée à l\'administrateur.');
      return;
    }
  }

  // =========================================================================
  // SECTION 2 : GESTION DES UTILISATEURS & PROFILS
  // =========================================================================

  // 2.1 GET /api/users : Liste des collaborateurs (Admin uniquement)
  if (pathname === '/api/users' && method === 'GET') {
    const users = loadUsers().map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      createdAt: u.createdAt
    }));
    sendJSON(res, 200, { count: users.length, users });
    return;
  }

  // 2.2 POST /api/users : Création d'un collaborateur (Admin uniquement)
  if (pathname === '/api/users' && method === 'POST') {
    readJSONBody(req).then(({ email, name, password, role }) => {
      try {
        const newUser = createUser({ email, name, password, role });
        sendJSON(res, 201, { success: true, user: newUser, message: 'Utilisateur créé avec succès.' });
      } catch (err) {
        sendError(res, 400, err.message);
      }
    }).catch(err => sendError(res, 400, err.message));
    return;
  }

  // 2.3 DELETE /api/users/:id : Suppression d'un utilisateur (Admin uniquement)
  if (pathname.startsWith('/api/users/') && method === 'DELETE') {
    const userId = decodeURIComponent(pathname.slice('/api/users/'.length));
    try {
      deleteUser(userId);
      sendJSON(res, 200, { success: true, message: 'Utilisateur supprimé.' });
    } catch (err) {
      sendError(res, 400, err.message);
    }
    return;
  }

  // 2.4 POST /api/auth/change-password : Modification du mot de passe personnel
  if (pathname === '/api/auth/change-password' && method === 'POST') {
    readJSONBody(req).then(({ oldPassword, newPassword }) => {
      const user = findUserById(req.user.userId);
      if (!user || !verifyPassword(oldPassword, user.passwordHash)) {
        sendError(res, 400, 'Ancien mot de passe incorrect.');
        return;
      }
      try {
        updatePassword(user.id, newPassword);
        sendJSON(res, 200, { success: true, message: 'Mot de passe modifié avec succès.' });
      } catch (err) {
        sendError(res, 400, err.message);
      }
    }).catch(err => sendError(res, 400, err.message));
    return;
  }

  // =========================================================================
  // SECTION 3 : CONSULTATION DES TARIFS, KPI & FACTURATION
  // =========================================================================

  // 3.1 GET /api/stats : KPI globaux (Destinations, prix moyen, hausses, baisses)
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

  // 3.2 GET /api/prices : Recherche et filtrage multicritères des tarifs
  if (pathname === '/api/prices' && method === 'GET') {
    const db = loadDatabase();
    let records = Object.values(db.records);

    const q = (query.q || '').toLowerCase().trim();
    if (q) {
      records = records.filter(r =>
        r.country.toLowerCase().includes(q) ||
        r.operator.toLowerCase().includes(q) ||
        (r.cc && r.cc.includes(q)) ||
        (r.mcc && r.mcc.includes(q)) ||
        (r.mnc && r.mnc.includes(q))
      );
    }

    records.sort((a, b) => a.country.localeCompare(b.country) || a.operator.localeCompare(b.operator));
    sendJSON(res, 200, { count: records.length, data: records });
    return;
  }

  // 3.3 GET /api/history : Historique chronologique d'un opérateur
  if (pathname === '/api/history' && method === 'GET') {
    const id = query.id;
    if (!id) {
      sendError(res, 400, 'Paramètre "id" manquant.');
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

  // 3.4 GET /api/history-chart : Rendu PNG du graphique de l'opérateur sélectionné
  if (pathname === '/api/history-chart' && method === 'GET') {
    const id = query.id;
    if (!id) {
      sendError(res, 400, 'Paramètre "id" manquant.');
      return;
    }
    if (!loadDatabase().records[id]) {
      sendError(res, 404, 'Opérateur introuvable.');
      return;
    }

    const scriptPath = path.join(__dirname, '..', 'scripts', 'generate_record_chart.py');
    const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    execFile(python, [scriptPath, id], {
      timeout: 30000,
      maxBuffer: 5 * 1024 * 1024,
      encoding: 'buffer'
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr && stderr.length ? stderr.toString('utf-8').trim() : error.message;
        console.error(`[PYTHON] Échec du graphique ${id} : ${detail}`);
        sendError(res, 503, 'Graphique Python indisponible. Vérifiez Python 3 et les dépendances définies dans requirements.txt.');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store'
      });
      res.end(stdout);
    });
    return;
  }

  // 3.5 GET /api/export : Téléchargement du fichier Facturation CSV (Format Excel)
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

  // =========================================================================
  // SECTION 4 : GESTION DES ARCHIVES & RÉINITIALISATION DE LA BASE
  // =========================================================================

  // 4.1 GET /api/archives : Consultation des versions précédentes archivées
  if (pathname === '/api/archives' && method === 'GET') {
    try {
      sendJSON(res, 200, { archives: listDatabaseArchives() });
    } catch (err) {
      sendError(res, 500, `Erreur de lecture des archives : ${err.message}`);
    }
    return;
  }

  // 4.2 GET /api/archives/:filename : Téléchargement d'un instantané JSON archivé
  if (pathname.startsWith('/api/archives/') && !pathname.endsWith('/restore') && method === 'GET') {
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

  // 4.3 DELETE /api/archives/:filename : Suppression d'une archive (Admin)
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

  // 4.4 POST /api/archives/:filename/restore : Restauration d'une version antérieure (Admin)
  if (pathname.startsWith('/api/archives/') && pathname.endsWith('/restore') && method === 'POST') {
    try {
      const filename = decodeURIComponent(pathname.slice('/api/archives/'.length, -'/restore'.length));
      const result = restoreDatabaseArchive(filename);
      if (!result) {
        sendError(res, 404, 'Archive introuvable');
        return;
      }
      sendJSON(res, 200, { success: true, details: result });
    } catch (err) {
      sendError(res, 400, `Impossible de restaurer cette archive : ${err.message}`);
    }
    return;
  }

  // 4.5 POST /api/reset-base : Réinitialise la plateforme au catalogue officiel Sinch (Admin)
  if (pathname === '/api/reset-base' && method === 'POST') {
    try {
      const result = resetToBaseCatalog(true);
      sendJSON(res, 200, {
        success: true,
        details: result,
        message: 'Plateforme réinitialisée avec succès au catalogue officiel (913 destinations, 0 hausse).'
      });
    } catch (err) {
      sendError(res, 500, `Erreur lors de la réinitialisation : ${err.message}`);
    }
    return;
  }

  // =========================================================================
  // SECTION 5 : INGESTION & SYNCHRONISATION SINCH
  // =========================================================================

  // 5.1 POST /api/upload : Téléversement manuel d'un CSV (Admin)
  if (pathname === '/api/upload' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const uploadedName = req.headers['x-file-name']
          ? path.basename(decodeURIComponent(req.headers['x-file-name']))
          : 'upload_web_interface.csv';
        ingestManualCSV(body, uploadedName).then(result => {
          if (!result.success) {
            sendJSON(res, result.statusCode, result);
            return;
          }
          sendJSON(res, 200, {
            success: true,
            message: 'Fichier ingéré avec succès',
            details: result.details
          });
        }).catch(err => {
          sendError(
            res,
            err.statusCode || 500,
            `Erreur lors de l'ingestion : ${err.message}`,
            err.details
          );
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

  // 5.2 GET /api/mail/status : Consultation de l'état de la relève automatique
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

  // 5.3 POST /api/mail/sync : Déclenchement d'une relève mail immédiate (Admin)
  if (pathname === '/api/mail/sync' && method === 'POST') {
    syncMailbox().then(result => {
      sendJSON(res, result.success ? 200 : 400, result);
    }).catch(err => {
      sendError(res, 500, `Erreur inattendue : ${err.message}`);
    });
    return;
  }

  // 5.4 GET /api/charts/list : Liste des graphiques Python globaux
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

  // 5.5 POST /api/charts/generate : Déclenche la génération Python des graphes (Admin)
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

  // Route API 404 par défaut
  if (pathname.startsWith('/api/')) {
    sendError(res, 404, 'Route API introuvable');
    return;
  }

  // =========================================================================
  // SECTION 6 : DISTRIBUTION DES FICHIERS STATIQUES (UI)
  // =========================================================================
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  // Sécurité traversée de chemin (Path Traversal Protection)
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendError(res, 403, 'Accès interdit');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
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
    console.log(`👉 Export Factu  : http://localhost:${PORT}/api/export`);
    console.log(`====================================================`);
    initNightlySyncScheduler();
  });
}

module.exports = server;
