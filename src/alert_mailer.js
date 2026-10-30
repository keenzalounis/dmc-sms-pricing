/**
 * DMC SMS Pricing - Module d'alerte email automatique
 *
 * Envoie un email d'alerte immédiat à l'administrateur (kenza.lounis@sfr.com)
 * lors de la réception d'un email Sinch non conforme :
 *  1. Format de l'email non conforme (sujet/corps inattendu)
 *  2. Pièce jointe absente ou format non CSV (.xlsx, .pdf, .zip...)
 *  3. Données CSV non conformes (colonnes manquantes ou corrompues)
 *
 * Zéro dépendance externe (TLS natif Node.js vers SMTP Gmail port 465).
 */

const tls = require('tls');
const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'mail_config.json');

/**
 * Envoie un email via SMTP TLS (port 465).
 */
async function sendSMTPMessage({ host = 'smtp.gmail.com', port = 465, user, password, to, subject, text, html }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port,
      servername: host,
      minVersion: 'TLSv1.2'
    });

    let buffer = '';
    let step = 0;

    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timeout SMTP (${host}:${port})`));
    }, 15000);

    const send = (cmd) => {
      socket.write(cmd + '\r\n');
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\r\n');

      while (lines.length > 1) {
        const line = lines.shift();
        const code = parseInt(line.slice(0, 3), 10);
        const isLastLine = line.charAt(3) === ' ';

        if (!isLastLine) continue;

        if (code >= 400) {
          clearTimeout(timeout);
          socket.destroy();
          return reject(new Error(`Erreur SMTP [${code}] : ${line}`));
        }

        switch (step) {
          case 0: // Connexion établie (220)
            if (code === 220) {
              step = 1;
              send('EHLO dmc.local');
            }
            break;
          case 1: // Réponse EHLO (250)
            if (code === 250) {
              step = 2;
              send('AUTH LOGIN');
            }
            break;
          case 2: // Demande nom utilisateur (334)
            if (code === 334) {
              step = 3;
              send(Buffer.from(user).toString('base64'));
            }
            break;
          case 3: // Demande mot de passe (334)
            if (code === 334) {
              step = 4;
              send(Buffer.from(password.replace(/\s+/g, '')).toString('base64'));
            }
            break;
          case 4: // Authentifié avec succès (235)
            if (code === 235) {
              step = 5;
              send(`MAIL FROM:<${user}>`);
            }
            break;
          case 5: // MAIL FROM accepté (250)
            if (code === 250) {
              step = 6;
              send(`RCPT TO:<${to}>`);
            }
            break;
          case 6: // RCPT TO accepté (250)
            if (code === 250) {
              step = 7;
              send('DATA');
            }
            break;
          case 7: // DATA prêt (354)
            if (code === 354) {
              step = 8;
              const boundary = '----=_Part_DMC_' + Date.now();
              const message = [
                `From: "DMC SMS Pricing Alerte" <${user}>`,
                `To: <${to}>`,
                `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
                'MIME-Version: 1.0',
                `Content-Type: multipart/alternative; boundary="${boundary}"`,
                '',
                `--${boundary}`,
                'Content-Type: text/plain; charset=utf-8',
                'Content-Transfer-Encoding: 8bit',
                '',
                text,
                '',
                `--${boundary}`,
                'Content-Type: text/html; charset=utf-8',
                'Content-Transfer-Encoding: 8bit',
                '',
                html,
                '',
                `--${boundary}--`,
                '.'
              ].join('\r\n');
              send(message);
            }
            break;
          case 8: // Message envoyé (250)
            if (code === 250) {
              clearTimeout(timeout);
              send('QUIT');
              socket.end();
              return resolve({ success: true, messageId: line });
            }
            break;
        }
      }
      buffer = lines.join('\r\n');
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Envoie une notification d'alerte spécifique pour Sinch.
 *
 * @param {Object} options
 * @param {'EMAIL_FORMAT_INVALID' | 'ATTACHMENT_NOT_CSV' | 'CSV_SCHEMA_INVALID'} options.type
 * @param {string} options.reason
 * @param {string} options.sender
 * @param {string} options.subject
 * @param {string} [options.attachmentName]
 * @param {string} [options.details]
 */
async function sendSinchAlert(options) {
  let config = null;
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch (e) {}
  }

  const recipient = (config && config.alertRecipient) || 'kenza.lounis@sfr.com';
  const user = (config && config.user) || 'dmc.tarifs.sinch@gmail.com';
  const password = config ? config.password : '';

  if (!password || password.includes('METTRE_ICI')) {
    console.warn('[ALERTE] Impossible d\'envoyer l\'email : mot de passe mail_config.json absent.');
    return { success: false, reason: 'Mot de passe absent' };
  }

  const typeLabels = {
    'EMAIL_FORMAT_INVALID': 'Format d\'email Sinch non conforme',
    'ATTACHMENT_NOT_CSV': 'Pièce jointe absente ou non CSV',
    'CSV_SCHEMA_INVALID': 'Données CSV non conformes aux tarifs attendus'
  };

  const title = typeLabels[options.type] || 'Notification Sinch rejetée';
  const emailSubject = `🚨 [ALERTE DMC] ${title}`;
  const now = new Date().toLocaleString('fr-FR');

  const textBody = [
    `ALERTE DMC - TARIFICATION SMS SINCH`,
    `=====================================`,
    `Une notification reçue par la boîte de relève automatique a été rejetée.`,
    ``,
    `Motif du rejet : ${options.reason}`,
    `Type d'anomalie : ${title}`,
    `Date de détection : ${now}`,
    `Expéditeur : ${options.sender}`,
    `Sujet du mail : ${options.subject}`,
    options.attachmentName ? `Fichier concerné : ${options.attachmentName}` : '',
    options.details ? `Détails techniques : ${options.details}` : '',
    ``,
    `Action requise :`,
    `- Vérifiez le courriel reçu dans la boîte dmc.tarifs.sinch@gmail.com.`,
    `- Contactez l'Account Manager Sinch si les colonnes ou le format ont été modifiés.`,
    `=====================================`
  ].filter(Boolean).join('\n');

  const htmlBody = `
  <!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"></head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F4F6F9; padding: 20px; color: #1C2024;">
    <div style="max-width: 600px; margin: 0 auto; background: #FFFFFF; border-radius: 8px; border: 1px solid #E2E6EC; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06);">
      <div style="background: #E2001A; color: #FFFFFF; padding: 18px 24px;">
        <h2 style="margin: 0; font-size: 18px; display: flex; align-items: center; gap: 8px;">
          🚨 ALERTE DMC SMS — Notification Rejetée
        </h2>
        <p style="margin: 4px 0 0; font-size: 12px; opacity: 0.9;">Plateforme Tarification SMS Internationaux Sinch | SFR Business</p>
      </div>

      <div style="padding: 24px;">
        <div style="background: #FEE2E2; border-left: 4px solid #E2001A; padding: 12px 16px; border-radius: 4px; margin-bottom: 20px;">
          <strong style="color: #991B1B; font-size: 14px;">Motif de l'anomalie :</strong>
          <p style="margin: 4px 0 0; color: #7F1D1D; font-size: 13px;">${escapeHtml(options.reason)}</p>
        </div>

        <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px;">
          <tr style="border-bottom: 1px solid #F1F3F5;">
            <td style="padding: 8px 0; color: #6C757D; width: 140px;">Type d'anomalie</td>
            <td style="padding: 8px 0; font-weight: 600;">${escapeHtml(title)}</td>
          </tr>
          <tr style="border-bottom: 1px solid #F1F3F5;">
            <td style="padding: 8px 0; color: #6C757D;">Expéditeur</td>
            <td style="padding: 8px 0; font-family: monospace;">${escapeHtml(options.sender)}</td>
          </tr>
          <tr style="border-bottom: 1px solid #F1F3F5;">
            <td style="padding: 8px 0; color: #6C757D;">Sujet du courriel</td>
            <td style="padding: 8px 0;">${escapeHtml(options.subject)}</td>
          </tr>
          ${options.attachmentName ? `
          <tr style="border-bottom: 1px solid #F1F3F5;">
            <td style="padding: 8px 0; color: #6C757D;">Pièce jointe</td>
            <td style="padding: 8px 0; font-family: monospace; color: #DC2626;">${escapeHtml(options.attachmentName)}</td>
          </tr>` : ''}
          <tr style="border-bottom: 1px solid #F1F3F5;">
            <td style="padding: 8px 0; color: #6C757D;">Date de détection</td>
            <td style="padding: 8px 0;">${now}</td>
          </tr>
          ${options.details ? `
          <tr>
            <td style="padding: 8px 0; color: #6C757D;">Détails techniques</td>
            <td style="padding: 8px 0; color: #495057; font-size: 12px;">${escapeHtml(options.details)}</td>
          </tr>` : ''}
        </table>

        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; padding: 14px; border-radius: 6px; font-size: 12px; color: #334155;">
          <strong>Action recommandée :</strong>
          <ul style="margin: 6px 0 0; padding-left: 18px;">
            <li>Consulter le courriel original sur la boîte <code>dmc.tarifs.sinch@gmail.com</code>.</li>
            <li>Si le format a changé côté Sinch, contactez votre Account Manager Sinch ou adaptez le schéma d'ingestion.</li>
            <li>La base active n'a pas été modifiée pour préserver l'intégrité de vos tarifs.</li>
          </ul>
        </div>
      </div>

      <div style="background: #F8FAFC; border-top: 1px solid #E2E6EC; padding: 12px 24px; text-align: center; font-size: 11px; color: #6C757D;">
        Ce message est généré automatiquement par l'application DMC SMS Pricing (SFR Business).
      </div>
    </div>
  </body>
  </html>
  `;

  try {
    const res = await sendSMTPMessage({
      host: (config && config.smtpHost) || 'smtp.gmail.com',
      port: (config && config.smtpPort) || 465,
      user,
      password,
      to: recipient,
      subject: emailSubject,
      text: textBody,
      html: htmlBody
    });
    console.log(`[ALERTE] ✓ Email d'alerte envoyé avec succès à ${recipient} (Type: ${options.type})`);
    return { success: true, recipient, type: options.type };
  } catch (err) {
    console.error(`[ALERTE] ✗ Échec de l'envoi de l'alerte à ${recipient} :`, err.message);
    return { success: false, error: err.message };
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  sendSMTPMessage,
  sendSinchAlert
};
