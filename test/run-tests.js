/**
 * DMC SMS Pricing - Suite de tests unitaires et d'intégration
 *
 * Exécutable via : npm test ou node test/run-tests.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  parseCSV,
  normalizeDate,
  buildRecordKey,
  ingestRows,
  loadDatabase
} = require('../src/ingest');

const { getBillingData, toCSV } = require('../src/export');

const {
  getSinchConfig,
  saveSinchConfig,
  getMockSinchRates,
  fetchSinchRates,
  syncSinchPricing,
  getSinchApiStatus
} = require('../src/sinch-api');

// Sauvegarde de database.json avant les tests pour isolation
const dbPath = path.join(__dirname, '..', 'data', 'database.json');
const sinchConfigPath = path.join(__dirname, '..', 'data', 'sinch_config.json');

let dbBackup = null;
if (fs.existsSync(dbPath)) {
  dbBackup = fs.readFileSync(dbPath, 'utf-8');
}

let sinchConfigBackup = null;
if (fs.existsSync(sinchConfigPath)) {
  sinchConfigBackup = fs.readFileSync(sinchConfigPath, 'utf-8');
}

let testsPassed = 0;
let testsFailed = 0;

async function it(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    testsFailed++;
  }
}

async function runTests() {
  console.log('\n========================================');
  console.log('🧪 Lancement des tests DMC SMS Pricing');
  console.log('========================================\n');

  // 1. Test CSV Parser
  console.log('--- 1. Module Ingestion & Parsing CSV ---');

  await it('Devrait parser correctement un CSV simple', () => {
    const csv = "Country,Operator,Price\nFrance,SFR,0.025\nSpain,Movistar,0.042";
    const rows = parseCSV(csv);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].Country, 'France');
    assert.strictEqual(rows[0].Price, '0.025');
  });

  await it('Devrait gérer les guillemets et virgules internes', () => {
    const csv = 'Product,Operator,Price\n"SFR, Business",Orange,0.030';
    const rows = parseCSV(csv);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].Product, 'SFR, Business');
    assert.strictEqual(rows[0].Operator, 'Orange');
  });

  await it('Devrait normaliser les formats de dates divers', () => {
    assert.strictEqual(normalizeDate('Oct 27 2026'), '2026-10-27');
    assert.strictEqual(normalizeDate('2026-10-27'), '2026-10-27');
  });

  await it('Devrait générer une clé unique cohérente', () => {
    const key = buildRecordKey('San Marino', 'San Marino Telecom', '292', '01');
    assert.strictEqual(key, 'san_marino__san_marino_telecom__292_01');
  });

  // 2. Test Ingestion et Historisation
  console.log('\n--- 2. Ingestion et Calcul des Variations ---');

  await it('Devrait ingérer des lignes et calculer les hausses correctement', () => {
    const baseRows = [{
      Country: 'TestLand',
      Operator: 'TestTel',
      Network: 'TestTel',
      CC: '+999',
      MCC: '999',
      MNC: '01',
      Price: '0.05000',
      EffectiveDate: '2026-01-01'
    }];
    ingestRows(baseRows, 'test_base.csv');

    const updateRows = [{
      Country: 'TestLand',
      Operator: 'TestTel',
      Network: 'TestTel',
      CC: '+999',
      MCC: '999',
      MNC: '01',
      'Old Price': '0.05000',
      'New Price': '0.07000',
      'Valid From': '2026-11-01',
      Product: 'SFRBu_TEST'
    }];
    ingestRows(updateRows, 'test_update.csv');

    const db = loadDatabase();
    const record = db.records['testland__testtel__999_01'];
    assert(record, 'L\'enregistrement doit exister');
    assert.strictEqual(record.currentPrice, 0.07);
    assert.strictEqual(record.previousPrice, 0.05);
    assert.strictEqual(record.priceChange, 0.02);
    assert.strictEqual(record.percentChange, 40);
    assert(record.history.length >= 2, 'L\'historique doit contenir au moins 2 dates');
  });

  // 3. Test Export Facturation
  console.log('\n--- 3. Module Export Facturation ---');

  await it('Devrait appliquer la marge commerciale demandée', () => {
    const rows = getBillingData({ marginPct: 20, countryFilter: 'TestLand' });
    assert.strictEqual(rows.length, 1);
    const row = rows[0];
    assert.strictEqual(parseFloat(row.buyPriceEUR), 0.07);
    assert.strictEqual(parseFloat(row.sellPriceEUR), 0.084);
  });

  await it('Devrait générer un CSV compatible Excel FR avec BOM', () => {
    const rows = getBillingData({ marginPct: 10 });
    const csv = toCSV(rows, ';');
    assert(csv.startsWith('﻿'), 'Le CSV doit inclure le BOM UTF-8');
    assert(csv.includes('Tarif_Facture_Client_EUR'), 'Le CSV doit contenir le header facturation');
    assert(csv.includes(';'), 'Le séparateur doit être le point-virgule');
  });

  // 4. Test Intégration API Sinch
  console.log('\n--- 4. Module Intégration API Sinch (Priorité 1bis DMC) ---');

  await it('Devrait fournir des tarifs Sinch de simulation avec structure complète', () => {
    const mockRates = getMockSinchRates();
    assert(Array.isArray(mockRates));
    assert(mockRates.length >= 10, 'Le catalogue mock doit contenir au moins 10 destinations');

    const first = mockRates[0];
    assert(first.country, 'Pays obligatoire');
    assert(first.operator, 'Opérateur obligatoire');
    assert(first.mcc, 'MCC obligatoire');
    assert(first.mnc, 'MNC obligatoire');
    assert(typeof first.price === 'number' && first.price > 0, 'Prix positif requis');
  });

  await it('Devrait filtrer les tarifs Sinch par nom de pays', async () => {
    const res = await fetchSinchRates({ country: 'France', forceMock: true });
    assert.strictEqual(res.isMock, true);
    assert(res.rates.length >= 3, 'Au moins 3 opérateurs français attendus');
    res.rates.forEach(r => {
      assert.strictEqual(r.country, 'France');
    });
  });

  await it('Devrait rapporter le statut de connexion API Sinch', () => {
    const status = getSinchApiStatus();
    assert('configured' in status);
    assert('baseUrl' in status);
    assert('timeoutMs' in status);
    assert(typeof status.totalDestinations === 'number');
  });

  await it('Devrait synchroniser les tarifs Sinch API et alimenter la base de données', async () => {
    const syncRes = await syncSinchPricing({ forceMock: true });
    assert.strictEqual(syncRes.success, true);
    assert(syncRes.totalFetched > 0);
    assert(typeof syncRes.countCreated === 'number');
    assert(typeof syncRes.countUpdated === 'number');

    const db = loadDatabase();
    assert(db.meta.lastSinchApiSync !== null, 'Date de synchro API enregistrée');
    assert(db.meta.lastSyncSource.includes('sinch'), 'Source Sinch enregistrée');

    // Vérifier l'existence d'une destination spécifique provenant du mock
    const key = buildRecordKey('France', 'SFR', '208', '10');
    assert(db.records[key], 'Destination France SFR présente');
    assert.strictEqual(db.records[key].currentPrice, 0.025);
  });

  await it('Devrait sauvegarder et recharger la configuration Sinch', () => {
    const testConfig = {
      servicePlanId: 'test_plan_12345',
      apiToken: 'secret_token_abcde',
      baseUrl: 'https://sms.api.sinch.com',
      timeoutMs: 8000,
      useMockFallback: true
    };
    saveSinchConfig(testConfig);
    const loaded = getSinchConfig();
    assert.strictEqual(loaded.servicePlanId, 'test_plan_12345');
    assert.strictEqual(loaded.apiToken, 'secret_token_abcde');
    assert.strictEqual(loaded.timeoutMs, 8000);
  });

  console.log('\n========================================');
  console.log(`Résultats : ${testsPassed} passés, ${testsFailed} échoués`);
  console.log('========================================\n');

  // Restauration de database.json et config
  if (dbBackup !== null) {
    fs.writeFileSync(dbPath, dbBackup, 'utf-8');
  }
  if (sinchConfigBackup !== null) {
    fs.writeFileSync(sinchConfigPath, sinchConfigBackup, 'utf-8');
  } else if (fs.existsSync(sinchConfigPath)) {
    fs.unlinkSync(sinchConfigPath);
  }

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Erreur non rattrapée dans les tests :', err);
  process.exit(1);
});
