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
  validateCSVRows,
  normalizeDate,
  buildRecordKey,
  ingestRows,
  loadDatabase,
  listDatabaseArchives,
  getDatabaseArchive,
  ingestCSVContent
} = require('../src/ingest');

const { getBillingData, toCSV } = require('../src/export');
const {
  isSenderAllowed,
  extractCSVAttachments,
  extractAttachmentsRecursive,
  validateSinchEmailFormat,
  validateCSVColumns,
  calculateMsUntilNextSchedule,
  parseMIMEHeaders,
  decodeQuotedPrintable
} = require('../src/mail_sync');

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
    const databaseBefore = fs.readFileSync(dbPath, 'utf-8');
    assert.throws(() => ingestCSVContent('Pays,Nom\nFrance,Orange'), /Aucune ligne de tarif valide/);
    assert.strictEqual(fs.readFileSync(dbPath, 'utf-8'), databaseBefore, 'Un fichier invalide ne doit pas modifier la base');
  });

  await it('Devrait rejeter les lignes invalides avant toute ingestion', () => {
    const csv = 'Country,Operator,Price\nFrance,SFR,0.025\nSpain,Movistar,prix-invalide';
    const errors = validateCSVRows(parseCSV(csv));
    assert.deepStrictEqual(errors, ['Ligne 3 : tarif invalide.']);
    assert.throws(() => ingestCSVContent(csv), /Ligne 3 : tarif invalide/);
    assert(Number.isNaN(parsePrice('0.025 EUR')), 'Un montant avec texte superflu ne doit pas être accepté');
  });

  await it('Devrait accepter les colonnes d’une mise à jour Sinch', () => {
    const rows = parseCSV('Country;Operator;Old Price;New Price;Valid From\nFrance;SFR;0,025;0,03;2026-10-01');
    assert.deepStrictEqual(validateCSVRows(rows), []);
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

  // 4. Test Connecteur Email & Synchronisation Sinch
  console.log('\n--- 4. Connecteur Mail Sinch & Planification Nocturne ---');

  await it('Devrait filtrer strictement les expéditeurs autorisés (@sinch.com)', () => {
    const allowed = ['@sinch.com'];
    assert.strictEqual(isSenderAllowed('pricing-notification@sinch.com', allowed), true);
    assert.strictEqual(isSenderAllowed('Sinch Updates <updates@sinch.com>', allowed), true);
    assert.strictEqual(isSenderAllowed('spammer@unknown.net', allowed), false);
    assert.strictEqual(isSenderAllowed('fake-sinch@sinch.com.phishing.io', allowed), false);
    assert.strictEqual(isSenderAllowed('', allowed), false);
  });

  await it('Devrait extraire et décoder une pièce jointe CSV en base64 d’un message MIME', () => {
    const csvData = 'Country,Operator,Price\nItaly,TIM,0.0350\nGermany,Telekom,0.0450';
    const base64Data = Buffer.from(csvData).toString('base64');

    const mimeMessage = [
      'From: pricing@sinch.com',
      'To: dmc.tarifs.sinch@gmail.com',
      'Subject: Sinch Price Change Notification',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="====BOUNDARY123===="',
      '',
      '--====BOUNDARY123====',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Please find attached the latest Sinch price changes.',
      '',
      '--====BOUNDARY123====',
      'Content-Type: text/csv; name="PriceChangeNotification_202611.csv"',
      'Content-Disposition: attachment; filename="PriceChangeNotification_202611.csv"',
      'Content-Transfer-Encoding: base64',
      '',
      base64Data,
      '',
      '--====BOUNDARY123====--'
    ].join('\r\n');

    const attachments = extractCSVAttachments(mimeMessage);
    assert.strictEqual(attachments.length, 1, 'Devrait trouver exactement 1 pièce jointe');
    assert.strictEqual(attachments[0].filename, 'PriceChangeNotification_202611.csv');
    assert.strictEqual(attachments[0].content.trim(), csvData.trim());
  });

  await it('Devrait traiter l\'e-mail officiel Sinch (Dear SFR Business Solutions...) avec structure multipart imbriquée', () => {
    const sinchCSV = [
      'Product,Country,Operator,Network,CC,MCC,MNC,Old Price,New Price,Valid From',
      'SFRBu_Test,San Marino,San Marino Telecom,San Marino Telecom,+378,292,01,0.04510,0.07700,Oct 27 2026'
    ].join('\n');
    const b64 = Buffer.from(sinchCSV).toString('base64');

    const rawSinchEmail = [
      'From: "Sinch Pricing Notifications" <rates@sinch.com>',
      'To: dmc.tarifs.sinch@gmail.com',
      'Subject: Sinch Price Change Notification - SFR Business Solutions',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="--outer_boundary_sinch_123"',
      '',
      '----outer_boundary_sinch_123',
      'Content-Type: multipart/alternative; boundary="--inner_boundary_sinch_456"',
      '',
      '----inner_boundary_sinch_456',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Dear SFR Business Solutions,',
      'Attached you will find price changes for particular destinations and networks. At your convenience please check the date the new prices apply.',
      'If you have any questions or any further needs please don’t hesitate to contact your Account Manager.',
      'We truly appreciate your business and look forward to being a part of your continued growth and success.',
      'Best regards,',
      'The Sinch Team',
      '',
      '----inner_boundary_sinch_456--',
      '',
      '----outer_boundary_sinch_123',
      'Content-Type: text/csv; name="PriceChangeNotification.csv"',
      'Content-Disposition: attachment; filename="PriceChangeNotification.csv"',
      'Content-Transfer-Encoding: base64',
      '',
      b64,
      '',
      '----outer_boundary_sinch_123--'
    ].join('\r\n');

    const attachments = extractCSVAttachments(rawSinchEmail);
    assert.strictEqual(attachments.length, 1, 'Devrait extraire la pièce jointe CSV');
    assert.strictEqual(attachments[0].filename, 'PriceChangeNotification.csv');
    assert(attachments[0].content.includes('SFRBu_Test'), 'Le contenu du CSV doit être fidèlement extrait');
    assert(attachments[0].content.includes('San Marino'), 'Le pays doit être présent');
  });

  await it('Devrait ignorer les pièces jointes non CSV (ex: pdf, exe, images)', () => {
    const mimeMessage = [
      'From: pricing@sinch.com',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="BOUNDARY"',
      '',
      '--BOUNDARY',
      'Content-Disposition: attachment; filename="facture.pdf"',
      'Content-Type: application/pdf',
      '',
      'FAKE_PDF_DATA',
      '--BOUNDARY--'
    ].join('\r\n');

    const attachments = extractCSVAttachments(mimeMessage);
    assert.strictEqual(attachments.length, 0, 'Les pièces non CSV doivent être ignorées');
  });

  await it('Devrait détecter et rejeter un email Sinch dont le format/sujet n\'est pas une notification tarifaire', () => {
    const invalidFormat = validateSinchEmailFormat('Invitation réunion projet', 'Bonjour, rendez-vous demain pour faire un point.');
    assert.strictEqual(invalidFormat.valid, false, 'Un e-mail sans mot-clé tarifaire doit être invalidé');
    assert(invalidFormat.reason.length > 0, 'Une raison d\'alerte doit être fournie');

    const validFormat = validateSinchEmailFormat('Sinch Price Change Notification', 'Dear SFR Business Solutions, attached price changes.');
    assert.strictEqual(validFormat.valid, true, 'Un e-mail de notification officiel Sinch doit être accepté');
  });

  await it('Devrait détecter les pièces jointes non CSV (.xlsx, .pdf) pour alerte', () => {
    const rawMimeWithExcel = [
      'From: rates@sinch.com',
      'Content-Type: multipart/mixed; boundary="EXCEL_BOUNDARY"',
      '',
      '--EXCEL_BOUNDARY',
      'Content-Type: text/plain',
      '',
      'Dear SFR Business Solutions, attached prices.',
      '',
      '--EXCEL_BOUNDARY',
      'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition: attachment; filename="PriceChangeNotification.xlsx"',
      'Content-Transfer-Encoding: base64',
      '',
      'RkFLRV9FWENFTF9EQVRB',
      '',
      '--EXCEL_BOUNDARY--'
    ].join('\r\n');

    const all = extractAttachmentsRecursive(rawMimeWithExcel, []);
    assert.strictEqual(all.length, 1, 'Devrait détecter la pièce jointe Excel');
    assert.strictEqual(all[0].filename, 'PriceChangeNotification.xlsx');
    assert.strictEqual(all[0].isCSV, false, 'Le fichier Excel doit être identifié comme non-CSV');
  });

  await it('Devrait rejeter un CSV dont les colonnes obligatoires (Country, Operator, Price) sont absentes', () => {
    const badCSV = 'Identifiant;Nom;Statut;Commentaire\n1;Test;OK;Pas de prix';
    const checkBad = validateCSVColumns(badCSV, 'test_mauvais.csv');
    assert.strictEqual(checkBad.valid, false, 'Un CSV sans colonnes tarifaires doit être rejeté');
    assert(checkBad.reason.includes('Colonnes obligatoires manquantes'), 'Le motif doit lister les colonnes manquantes');

    const goodCSV = 'Country,Operator,Old Price,New Price,Valid From\nFrance,SFR,0.02,0.03,2026-11-01';
    const checkGood = validateCSVColumns(goodCSV, 'PriceChangeNotification.csv');
    assert.strictEqual(checkGood.valid, true, 'Le CSV officiel avec Country, Operator, Price doit être accepté');
  });

  await it('Devrait calculer un délai positif et inférieur à 24h pour la planification de 02:00', () => {
    const delay = calculateMsUntilNextSchedule('02:00');
    assert(delay > 0, 'Le délai doit être strictement positif');
    assert(delay <= 24 * 3600 * 1000, 'Le délai ne doit pas dépasser 24h');
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
