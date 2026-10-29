#!/usr/bin/env node
/**
 * DMC SMS Pricing - Script de synchronisation manuelle ou planifiée de la boîte mail Sinch
 *
 * Utilisation :
 *   npm run sync-mail
 *   ou node scripts/sync_mail.js
 */

const { syncMailbox, loadMailConfig } = require('../src/mail_sync');

async function main() {
  console.log('\n======================================================');
  console.log('📬 DMC SMS Pricing - Synchronisation Boîte Mail Sinch');
  console.log('======================================================\n');

  const config = loadMailConfig();
  if (!config) {
    console.error('❌ Configuration manquante !');
    console.error('Veuillez créer le fichier "data/mail_config.json" à partir de "data/mail_config.example.json".\n');
    process.exit(1);
  }

  console.log(`- Serveur IMAP : ${config.host || 'imap.gmail.com'}:${config.port || 993}`);
  console.log(`- Compte mail  : ${config.user}`);
  console.log(`- Filtre expéditeurs autorisés : ${JSON.stringify(config.allowedSenders || ['@sinch.com'])}`);
  console.log(`- Planification nocturne       : ${config.scheduleTime || '02:00'}\n`);
  console.log('Connexion en cours et analyse des e-mails non lus...\n');

  const startTime = Date.now();
  const result = await syncMailbox();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  if (result.success) {
    console.log(`✅ ${result.message} (durée : ${elapsed}s)`);
    if (result.stats) {
      console.log(`   - Messages non lus examinés : ${result.stats.emailsScanned}`);
      console.log(`   - E-mails Sinch détectés   : ${result.stats.sinchEmailsFound}`);
      console.log(`   - Fichiers CSV ingérés     : ${result.stats.csvProcessed}`);

      if (result.stats.details && result.stats.details.length > 0) {
        console.log('\nDétail des traitements :');
        result.stats.details.forEach((d, idx) => {
          console.log(`   [${idx + 1}] Fichier : ${d.filename || 'N/A'}`);
          console.log(`       De      : ${d.from}`);
          console.log(`       Sujet   : ${d.subject}`);
          if (d.recordsUpdated !== undefined) {
            console.log(`       Tarifs mis à jour : ${d.recordsUpdated} (hausses: ${d.increases}, baisses: ${d.decreases})`);
            console.log(`       Archive créée     : ${d.archiveFile}`);
          }
          console.log(`       Statut  : ${d.status}`);
        });
      }
    }
  } else {
    console.error(`❌ Échec de la synchronisation : ${result.message}`);
    if (result.error) {
      console.error(`   Détails : ${result.error}`);
    }
    process.exit(1);
  }

  console.log('\n======================================================\n');
}

main().catch(err => {
  console.error('Erreur inattendue :', err);
  process.exit(1);
});
