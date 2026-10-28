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
  parsePrice,
  normalizeDate,
  buildRecordKey,
  ingestRows,
  loadDatabase,
  listDatabaseArchives,
  getDatabaseArchive,
  ingestCSVContent
} = require('../src/ingest');

const { getBillingData, toCSV } = require('../src/export');

// Sauvegarde de database.json avant les tests pour isolation
const dbPath = path.join(__dirname, '..', 'data', 'database.json');
const archivesPath = path.join(__dirname, '..', 'data', 'archives');
const archiveFilesBeforeTests = fs.existsSync(archivesPath) ? new Set(fs.readdirSync(archivesPath)) : new Set();

let dbBackup = null;
if (fs.existsSync(dbPath)) {
  dbBackup = fs.readFileSync(dbPath, 'utf-8');
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

  await it('Devrait parser les colonnes du fichier de base avec séparateur point-virgule et BOM', () => {
    const csv = '\uFEFFCountry;Operator;Service type;Originator;MCC;MCC/MNC;Price;Currency\r\nFrance;Orange;SMS;SFR;208;01;0.025;EUR';
    const rows = parseCSV(csv);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]['MCC/MNC'], '01');
    assert.strictEqual(rows[0]['Service type'], 'SMS');
  });

  await it('Devrait rejeter un CSV qui ne contient aucun tarif reconnu', () => {
    assert.throws(() => ingestCSVContent('Pays,Nom\nFrance,Orange'), /Aucune ligne de tarif valide/);
  });

  await it('Devrait conserver les apostrophes de noms de pays et lire les décimales françaises', () => {
    const rows = parseCSV("Country;Operator;Price\nCôte d'Ivoire;Orange;0,025");
    assert.strictEqual(rows[0].Country, "Côte d'Ivoire");
    assert.strictEqual(parsePrice(rows[0].Price), 0.025);
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

  await it('Devrait importer le format de base MCC/MNC et conserver une archive avant la mise à jour', () => {
    const archivesBefore = new Set(listDatabaseArchives().map(archive => archive.filename));
    const csv = 'Country,Operator,Service type,Originator,MCC,MCC/MNC,Price,Currency\nArchiveLand,Archive Mobile,SMS,Test,777,02,0.12,EUR';
    ingestCSVContent(csv, 'base_tarifs_test.csv');

    const db = loadDatabase();
    const record = db.records['archiveland__archive_mobile__777_02'];
    assert(record, 'Le tarif avec la colonne MCC/MNC doit être ingéré');
    assert.strictEqual(record.serviceType, 'SMS');
    assert.strictEqual(record.originator, 'Test');
    assert.strictEqual(record.currency, 'EUR');
    const newArchive = listDatabaseArchives().find(archive =>
      !archivesBefore.has(archive.filename) && archive.source === 'base_tarifs_test.csv'
    );
    assert(newArchive, 'Le référentiel précédent doit être archivé');
    const archive = JSON.parse(getDatabaseArchive(newArchive.filename));
    assert(archive.database.records, 'L’archive doit contenir l’ancienne base');
    assert.strictEqual(archive.importedCsv, csv, 'L’archive doit conserver le CSV importé');
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

  console.log('\n========================================');
  console.log(`Résultats : ${testsPassed} passés, ${testsFailed} échoués`);
  console.log('========================================\n');

  // Restauration de database.json et nettoyage des archives de test
  if (dbBackup !== null) {
    fs.writeFileSync(dbPath, dbBackup, 'utf-8');
  }
  if (fs.existsSync(archivesPath)) {
    for (const filename of fs.readdirSync(archivesPath)) {
      if (!archiveFilesBeforeTests.has(filename)) fs.unlinkSync(path.join(archivesPath, filename));
    }
    if (fs.readdirSync(archivesPath).length === 0) fs.rmdirSync(archivesPath);
  }

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Erreur non rattrapée dans les tests :', err);
  process.exit(1);
});
