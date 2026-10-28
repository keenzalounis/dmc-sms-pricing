/**
 * DMC SMS Pricing - Module d'intégration API Sinch
 *
 * Permet de récupérer en direct les tarifs d'achat SMS par pays/opérateur
 * depuis l'API REST de Sinch, de calculer les variations et de mettre à jour
 * automatiquement le référentiel tarifaire (database.json).
 *
 * Conçu sans aucune dépendance npm externe (utilise le module standard 'https').
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadDatabase, saveDatabase, buildRecordKey, normalizeDate } = require('./ingest');

// Configuration par défaut (surchargée par variables d'environnement ou fichier config)
const CONFIG_FILE = path.join(__dirname, '..', 'data', 'sinch_config.json');

/**
 * Récupère la configuration Sinch active
 */
function getSinchConfig() {
  let fileConfig = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    } catch (e) {
      console.warn(`[SINCH-API] Attention, impossible de lire ${CONFIG_FILE} : ${e.message}`);
    }
  }

  return {
    servicePlanId: process.env.SINCH_SERVICE_PLAN_ID || fileConfig.servicePlanId || '',
    apiToken: process.env.SINCH_API_TOKEN || fileConfig.apiToken || '',
    baseUrl: process.env.SINCH_BASE_URL || fileConfig.baseUrl || 'https://sms.api.sinch.com',
    timeoutMs: parseInt(process.env.SINCH_TIMEOUT_MS || fileConfig.timeoutMs || '10000', 10),
    useMockFallback: (process.env.SINCH_USE_MOCK === 'true' || fileConfig.useMockFallback !== false)
  };
}

/**
 * Sauvegarde la configuration Sinch (clé API, plan ID, etc.)
 */
function saveSinchConfig(configUpdates) {
  const current = getSinchConfig();
  const updated = {
    servicePlanId: configUpdates.servicePlanId !== undefined ? configUpdates.servicePlanId.trim() : current.servicePlanId,
    apiToken: configUpdates.apiToken !== undefined ? configUpdates.apiToken.trim() : current.apiToken,
    baseUrl: configUpdates.baseUrl !== undefined ? configUpdates.baseUrl.trim() : current.baseUrl,
    timeoutMs: configUpdates.timeoutMs !== undefined ? parseInt(configUpdates.timeoutMs, 10) : current.timeoutMs,
    useMockFallback: configUpdates.useMockFallback !== undefined ? Boolean(configUpdates.useMockFallback) : current.useMockFallback
  };

  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}

/**
 * Jeu de données de simulation (Mock)
 * Représente la réponse réelle de l'API REST Sinch pour la tarification SMS internationale
 * Utilisé si les identifiants ne sont pas encore configurés ou en mode offline / démonstration.
 */
function getMockSinchRates() {
  return [
    {
      country: 'France',
      country_code: 'FR',
      cc: '+33',
      mcc: '208',
      mnc: '10',
      operator: 'SFR',
      network: 'SFR',
      price: 0.02500,
      currency: 'EUR',
      product: 'SFRBu_API_REST_2026'
    },
    {
      country: 'France',
      country_code: 'FR',
      cc: '+33',
      mcc: '208',
      mnc: '01',
      operator: 'Orange',
      network: 'Orange',
      price: 0.02500,
      currency: 'EUR',
      product: 'SFRBu_API_REST_2026'
    },
    {
      country: 'France',
      country_code: 'FR',
      cc: '+33',
      mcc: '208',
      mnc: '20',
      operator: 'Bouygues',
      network: 'Bouygues Telecom',
      price: 0.02500,
      currency: 'EUR',
      product: 'SFRBu_API_REST_2026'
    },
    {
      country: 'France',
      country_code: 'FR',
      cc: '+33',
      mcc: '208',
      mnc: '15',
      operator: 'Free Mobile',
      network: 'Free Mobile',
      price: 0.02500,
      currency: 'EUR',
      product: 'SFRBu_API_REST_2026'
    },
    {
      country: 'San Marino',
      country_code: 'SM',
      cc: '+378',
      mcc: '292',
      mnc: '01',
      operator: 'San Marino Telecom',
      network: 'San Marino Telecom',
      price: 0.07700, // Mis à jour suite à la notification d'octobre
      currency: 'EUR',
      product: 'SFRBu_20261008053302366_ra'
    },
    {
      country: 'Spain',
      country_code: 'ES',
      cc: '+34',
      mcc: '214',
      mnc: '07',
      operator: 'Telefonica Movistar',
      network: 'Telefonica',
      price: 0.04350, // Légère variation par API
      currency: 'EUR',
      product: 'SFRBu_API_REST_2026'
    },
    {
      country: 'Spain',
      country_code: 'ES',
      cc: '+34',
      mcc: '214',
      mnc: '01',
      operator: 'Vodafone Spain',
      network: 'Vodafone',
      price: 0.04200,
      currency: 'EUR',
      product: 'SFRBu_API_REST_2026'
    },
    {
      country: 'Italy',
      country_code: 'IT',
      cc: '+39',
      mcc: '222',
      mnc: '01',
      operator: 'TIM',
      network: 'Telecom Italia Mobile',
      price: 0.04800,
      currency: 'EUR',
      product: 'SFRBu_API_REST_2026'
    },
    {
      country: 'Italy',
      country_code: 'IT',
      cc: '+39',
      mcc: '222',
      mnc: '10',
      operator: 'Vodafone Italy',
      network: 'Vodafone Omnitel',
      price: 0.04900,
      currency: 'EUR',
      product: 'SFRBu_API_REST_2026'
    },
    {
      country: 'Germany',
      country_code: 'DE',
      cc: '+49',
      mcc: '262',
      mnc: '01',
      operator: 'Telekom Deutschland',
      network: 'Deutsche Telekom',
      price: 0.05100,
      currency: 'EUR',
      product: 'SFRBu_API_REST_2026'
    },
    {
      country: 'Germany',
      country_code: 'DE',
      cc: '+49',
      mcc: '262',
      mnc: '02',
      operator: 'Vodafone Germany',
      network: 'Vodafone D2',
      price: 0.05200,
      currency: 'EUR',
      product: 'SFRBu_API_REST_2026'
    },
    {
      country: 'Belgium',
      country_code: 'BE',
      cc: '+32',
      mcc: '206',
      mnc: '01',
      operator: 'Proximus',
      network: 'Belgacom Mobile',
      price: 0.04600,
      currency: 'EUR',
      product: 'SFRBu_API_REST_2026'
    },
    {
      country: 'United Kingdom',
      country_code: 'GB',
      cc: '+44',
      mcc: '234',
      mnc: '30',
      operator: 'EE',
      network: 'Everything Everywhere',
      price: 0.04300,
      currency: 'EUR',
      product: 'SFRBu_API_REST_2026'
    },
    {
      country: 'United States',
      country_code: 'US',
      cc: '+1',
      mcc: '310',
      mnc: '410',
      operator: 'AT&T Mobility',
      network: 'AT&T',
      price: 0.01900,
      currency: 'EUR',
      product: 'SFRBu_API_REST_2026'
    },
    {
      country: 'United States',
      country_code: 'US',
      cc: '+1',
      mcc: '310',
      mnc: '260',
      operator: 'T-Mobile USA',
      network: 'T-Mobile',
      price: 0.01950,
      currency: 'EUR',
      product: 'SFRBu_API_REST_2026'
    },
    {
      country: 'Morocco',
      country_code: 'MA',
      cc: '+212',
      mcc: '604',
      mnc: '01',
      operator: 'Maroc Telecom',
      network: 'Itissalat Al-Maghrib',
      price: 0.08200,
      currency: 'EUR',
      product: 'SFRBu_API_REST_2026'
    },
    {
      country: 'Portugal',
      country_code: 'PT',
      cc: '+351',
      mcc: '268',
      mnc: '01',
      operator: 'Vodafone Portugal',
      network: 'Vodafone',
      price: 0.03900,
      currency: 'EUR',
      product: 'SFRBu_API_REST_2026'
    },
    {
      country: 'Switzerland',
      country_code: 'CH',
      cc: '+41',
      mcc: '228',
      mnc: '01',
      operator: 'Swisscom',
      network: 'Swisscom Mobile',
      price: 0.05400,
      currency: 'EUR',
      product: 'SFRBu_API_REST_2026'
    },
    {
      country: 'Canada',
      country_code: 'CA',
      cc: '+1',
      mcc: '302',
      mnc: '720',
      operator: 'Rogers Wireless',
      network: 'Rogers Communications',
      price: 0.02100,
      currency: 'EUR',
      product: 'SFRBu_API_REST_2026'
    },
    {
      country: 'Senegal',
      country_code: 'SN',
      cc: '+221',
      mcc: '608',
      mnc: '01',
      operator: 'Orange Senegal',
      network: 'Sonatel',
      price: 0.08900,
      currency: 'EUR',
      product: 'SFRBu_API_REST_2026'
    },
    {
      country: 'Ivory Coast',
      country_code: 'CI',
      cc: '+225',
      mcc: '612',
      mnc: '03',
      operator: 'Orange CI',
      network: 'Orange Cote d\'Ivoire',
      price: 0.09100,
      currency: 'EUR',
      product: 'SFRBu_API_REST_2026'
    }
  ];
}

/**
 * Exécute une requête HTTPS GET vers l'API Sinch
 */
function makeSinchApiRequest({ endpoint, config }) {
  return new Promise((resolve, reject) => {
    const fullUrl = new URL(endpoint, config.baseUrl);
    const transport = fullUrl.protocol === 'http:' ? http : https;

    const options = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'SFR-Business-DMC-Pricing/1.1'
      },
      timeout: config.timeoutMs
    };

    const req = transport.request(fullUrl, options, (res) => {
      let body = '';
      res.setEncoding('utf8');

      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(body);
            resolve({ statusCode: res.statusCode, data: parsed });
          } catch (e) {
            reject(new Error(`Réponse API Sinch non-JSON (${res.statusCode}) : ${body.slice(0, 150)}`));
          }
        } else {
          let errMsg = `Erreur HTTP ${res.statusCode} reçue de Sinch`;
          try {
            const errObj = JSON.parse(body);
            if (errObj.text || errObj.message) errMsg += ` : ${errObj.text || errObj.message}`;
          } catch (e) {
            errMsg += ` : ${body.slice(0, 100)}`;
          }
          const err = new Error(errMsg);
          err.statusCode = res.statusCode;
          reject(err);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Délai d'attente dépassé (${config.timeoutMs}ms) lors de l'appel Sinch API`));
    });

    req.on('error', (err) => {
      reject(new Error(`Échec de connexion vers Sinch API (${fullUrl.hostname}) : ${err.message}`));
    });

    req.end();
  });
}

/**
 * Récupère les tarifs SMS depuis l'API Sinch (ou via le fallback Mock si non configuré)
 * @param {Object} options
 * @param {string} [options.country] Filtrer sur un pays spécifique (code ISO ou nom)
 * @param {boolean} [options.forceMock=false] Forcer l'utilisation des données mock
 */
async function fetchSinchRates(options = {}) {
  const config = getSinchConfig();
  const forceMock = options.forceMock === true;

  // Si aucun identifiant configuré ou mode simulation demandé
  if (forceMock || !config.servicePlanId || !config.apiToken) {
    let mockData = getMockSinchRates();
    if (options.country) {
      const q = options.country.toLowerCase();
      mockData = mockData.filter(r =>
        r.country.toLowerCase().includes(q) ||
        (r.country_code && r.country_code.toLowerCase() === q)
      );
    }
    return {
      source: 'sinch_mock_sandbox',
      authenticated: false,
      isMock: true,
      rates: mockData,
      total: mockData.length,
      note: 'Données fournies par le bac à sable Sinch (credentials non renseignés ou mode mock)'
    };
  }

  // Appel réel à l'API Sinch REST : /xms/v1/{service_plan_id}/rates
  let endpoint = `/xms/v1/${encodeURIComponent(config.servicePlanId)}/rates`;
  if (options.country) {
    endpoint += `?country=${encodeURIComponent(options.country)}`;
  }

  try {
    const response = await makeSinchApiRequest({ endpoint, config });
    const rawRates = response.data.rates || response.data || [];

    // Normalisation au format standard
    const normalized = rawRates.map(item => ({
      country: item.country || item.country_name || 'Inconnu',
      country_code: item.country_code || item.iso || '',
      cc: item.cc || (item.calling_code ? `+${item.calling_code}` : ''),
      mcc: String(item.mcc || ''),
      mnc: String(item.mnc || ''),
      operator: item.operator || item.network_name || 'Opérateur général',
      network: item.network || item.operator || 'Opérateur général',
      price: parseFloat(item.rate || item.price || 0),
      currency: item.currency || 'EUR',
      product: `Sinch_API_${config.servicePlanId.slice(0, 8)}`
    }));

    return {
      source: 'sinch_rest_api_live',
      authenticated: true,
      isMock: false,
      rates: normalized,
      total: normalized.length
    };
  } catch (error) {
    // Si fallback autorisé lors d'une coupure réseau ou identifiants de test invalides
    if (config.useMockFallback) {
      console.warn(`[SINCH-API] Erreur d'appel API réelle (${error.message}), bascule vers les données de simulation.`);
      const fallbackData = getMockSinchRates();
      return {
        source: 'sinch_mock_fallback_on_error',
        authenticated: false,
        isMock: true,
        rates: fallbackData,
        total: fallbackData.length,
        error: error.message
      };
    }
    throw error;
  }
}

/**
 * Synchronise les tarifs provenant de l'API Sinch directement dans la base de données locale
 * Calcule les écarts de prix (€ et %) et met à jour l'historique chronologique.
 */
async function syncSinchPricing(options = {}) {
  const fetchResult = await fetchSinchRates(options);
  const rates = fetchResult.rates || [];
  const db = loadDatabase();

  const syncTimestamp = new Date().toISOString();
  const todayDate = syncTimestamp.slice(0, 10);

  let countCreated = 0;
  let countUpdated = 0;
  let countUnchanged = 0;
  const changes = [];

  for (const item of rates) {
    const country = item.country;
    const operator = item.operator;
    const mcc = item.mcc;
    const mnc = item.mnc;
    const newPrice = parseFloat(item.price);

    if (isNaN(newPrice) || newPrice <= 0) continue;

    const key = buildRecordKey(country, operator, mcc, mnc);
    const existing = db.records[key];

    if (!existing) {
      // Nouvelle destination découverte via l'API Sinch
      db.records[key] = {
        id: key,
        country,
        operator,
        network: item.network || operator,
        cc: item.cc || '',
        mcc: item.mcc || '',
        mnc: item.mnc || '',
        product: item.product || 'Sinch_API_Sync',
        currentPrice: newPrice,
        previousPrice: newPrice,
        priceChange: 0,
        percentChange: 0,
        validFrom: todayDate,
        lastSyncSource: fetchResult.source,
        history: [
          {
            date: todayDate,
            price: newPrice,
            oldPrice: newPrice,
            product: item.product || 'Sinch_API_Sync',
            source: 'sinch_api'
          }
        ]
      };
      countCreated++;
      changes.push({
        id: key,
        country,
        operator,
        type: 'CREATED',
        price: newPrice
      });
    } else {
      // Mise à jour d'une destination existante
      const oldPrice = existing.currentPrice;
      const priceDiff = parseFloat((newPrice - oldPrice).toFixed(5));

      if (priceDiff !== 0) {
        const pctDiff = oldPrice > 0 ? parseFloat(((priceDiff / oldPrice) * 100).toFixed(2)) : 0;
        existing.previousPrice = oldPrice;
        existing.currentPrice = newPrice;
        existing.priceChange = priceDiff;
        existing.percentChange = pctDiff;
        existing.validFrom = todayDate;
        existing.product = item.product || existing.product;
        existing.lastSyncSource = fetchResult.source;

        // Ajouter à l'historique
        const alreadyLogged = existing.history.some(h => h.date === todayDate && h.price === newPrice);
        if (!alreadyLogged) {
          existing.history.push({
            date: todayDate,
            price: newPrice,
            oldPrice: oldPrice,
            product: item.product || existing.product,
            source: 'sinch_api'
          });
          existing.history.sort((a, b) => (a.date > b.date ? 1 : -1));
        }

        countUpdated++;
        changes.push({
          id: key,
          country,
          operator,
          type: priceDiff > 0 ? 'INCREASE' : 'DECREASE',
          oldPrice,
          newPrice,
          priceChange: priceDiff,
          percentChange: pctDiff
        });
      } else {
        countUnchanged++;
      }
    }
  }

  // Mise à jour des métadonnées globales
  db.meta.lastSinchApiSync = syncTimestamp;
  db.meta.lastSyncSource = fetchResult.source;
  db.meta.lastUpdated = syncTimestamp;

  saveDatabase(db);

  return {
    success: true,
    source: fetchResult.source,
    isMock: fetchResult.isMock,
    syncedAt: syncTimestamp,
    totalFetched: rates.length,
    countCreated,
    countUpdated,
    countUnchanged,
    changes
  };
}

/**
 * Retourne le statut de l'intégration API Sinch
 */
function getSinchApiStatus() {
  const config = getSinchConfig();
  const db = loadDatabase();

  const isConfigured = Boolean(config.servicePlanId && config.apiToken);

  return {
    configured: isConfigured,
    servicePlanId: config.servicePlanId ? `${config.servicePlanId.slice(0, 4)}...${config.servicePlanId.slice(-4)}` : 'Non configuré',
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    useMockFallback: config.useMockFallback,
    lastSyncDate: db.meta.lastSinchApiSync || null,
    lastSyncSource: db.meta.lastSyncSource || null,
    totalDestinations: Object.keys(db.records).length
  };
}

// Mode CLI autonome : node src/sinch-api.js [--mock] [--sync] [--country=France]
if (require.main === module) {
  const args = process.argv.slice(2);
  const isSync = args.includes('--sync') || args.includes('-s');
  const forceMock = args.includes('--mock') || args.includes('-m');
  const countryArg = args.find(a => a.startsWith('--country='));
  const country = countryArg ? countryArg.split('=')[1] : null;

  console.log('====================================================');
  console.log('🌐 DMC SMS Pricing - Module API Sinch');
  console.log('====================================================');

  if (isSync) {
    console.log(`[SYNC] Démarrage de la synchronisation des tarifs... (Mock: ${forceMock})`);
    syncSinchPricing({ forceMock, country })
      .then(res => {
        console.log(`[SYNC] Terminé avec succès !`);
        console.log(`- Source : ${res.source}`);
        console.log(`- Tarifs récupérés : ${res.totalFetched}`);
        console.log(`- Créés : ${res.countCreated}`);
        console.log(`- Modifiés : ${res.countUpdated}`);
        console.log(`- Inchangés : ${res.countUnchanged}`);
        if (res.changes.length > 0) {
          console.log('\nChangements notables :');
          res.changes.forEach(c => {
            console.log(`  • ${c.country} (${c.operator}) : ${c.oldPrice || 'Nouveau'} € -> ${c.newPrice || c.price} € (${c.percentChange ? c.percentChange + '%' : c.type})`);
          });
        }
      })
      .catch(err => {
        console.error(`[ERREUR] Échec de la synchronisation : ${err.message}`);
        process.exit(1);
      });
  } else {
    // Mode consultation simple
    console.log('[INFO] Statut de configuration :');
    console.log(JSON.stringify(getSinchApiStatus(), null, 2));
    console.log('\n[FETCH] Récupération des tarifs (échantillon)...');
    fetchSinchRates({ forceMock, country })
      .then(res => {
        console.log(`- Source : ${res.source} (isMock: ${res.isMock})`);
        console.log(`- Total tarifs trouvés : ${res.total}`);
        console.log('- 3 premiers tarifs :');
        console.log(res.rates.slice(0, 3));
      })
      .catch(err => {
        console.error(`[ERREUR] ${err.message}`);
      });
  }
}

module.exports = {
  getSinchConfig,
  saveSinchConfig,
  getMockSinchRates,
  fetchSinchRates,
  syncSinchPricing,
  getSinchApiStatus
};
