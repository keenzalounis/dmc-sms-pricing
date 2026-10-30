/**
 * DMC SMS Pricing - Module de synchronisation de boîte mail Sinch
 *
 * Se connecte à la boîte dédiée en IMAP sécurisé (port 993 / TLS),
 * filtre rigoureusement les messages provenant de Sinch,
 * extrait le fichier CSV de mise à jour tarifaire,
 * et l'ingère directement dans le référentiel des prix.
 *
 * Zéro dépendance externe (utilise le module standard tls de Node.js).
 */

const tls = require('tls');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { ingestCSVContent } = require('./ingest');

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'mail_config.json');

/**
 * Charge la configuration de la boîte mail.
 */
function loadMailConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[MAIL] Erreur de lecture de mail_config.json : ${err.message}`);
    return null;
  }
}

/**
 * Décode le quoted-printable en chaîne UTF-8.
 */
function decodeQuotedPrintable(str) {
  if (!str) return '';
  return str
    .replace(/=\r?\n/g, '') // Lignes coupées (soft line breaks)
    .replace(/=([0-9A-Fa-f]{2})/g, (match, hex) => {
      try {
        return String.fromCharCode(parseInt(hex, 16));
      } catch (e) {
        return match;
      }
    });
}

/**
 * Décode les en-têtes RFC 2047 (=?UTF-8?B?...?= ou =?ISO-8859-1?Q?...?=)
 */
function decodeRFC2047(str) {
  if (!str) return '';
  return str.replace(/=\?([^?]+)\?([BQbq])\?([^?]+)\?=/g, (match, charset, encoding, text) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        return Buffer.from(text, 'base64').toString(charset.toLowerCase() === 'iso-8859-1' ? 'latin1' : 'utf-8');
      } else if (encoding.toUpperCase() === 'Q') {
        const decoded = text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
          String.fromCharCode(parseInt(hex, 16))
        );
        return decoded;
      }
    } catch (e) {
      return text;
    }
    return match;
  });
}

/**
 * Parse sommairement les en-têtes d'un message MIME / RFC822.
 */
function parseMIMEHeaders(rawHeaders) {
  const headers = {};
  // Déplier les en-têtes multi-lignes (commençant par espace ou tabulation)
  const unfolded = rawHeaders.replace(/\r?\n[ \t]+/g, ' ');
  const lines = unfolded.split(/\r?\n/);

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim().toLowerCase();
      const value = line.slice(colonIdx + 1).trim();
      headers[key] = decodeRFC2047(value);
    }
  }
  return headers;
}

/**
 * Extrait le nom de fichier d'un en-tête Content-Disposition ou Content-Type.
 */
function extractFilename(headerValue) {
  if (!headerValue) return null;
  const patterns = [
    /(?:filename\*?|name\*?)\s*=\s*(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i,
    /filename\*0\*?\s*=\s*["']?([^"';\r\n]+)["']?/i
  ];
  for (const regex of patterns) {
    const match = headerValue.match(regex);
    if (match && match[1]) {
      let raw = match[1].trim().replace(/^["']|["']$/g, '');
      try {
        return decodeURIComponent(raw);
      } catch (e) {
        return raw;
      }
    }
  }
  return null;
}

/**
 * Extrait récursivement les pièces jointes CSV d'un bloc MIME (gère les multiparts imbriqués Outlook/Exchange).
 */
function extractAttachmentsRecursive(mimeBlock, attachments = []) {
  const headerEnd = mimeBlock.search(/\r?\n\r?\n/);
  if (headerEnd === -1) return attachments;

  const rawHeaders = mimeBlock.slice(0, headerEnd);
  const body = mimeBlock.slice(headerEnd).trim();
  const headers = parseMIMEHeaders(rawHeaders);

  const contentType = (headers['content-type'] || '').toLowerCase();
  const disposition = headers['content-disposition'] || '';

  // Chercher un nom de fichier dans Content-Disposition ou Content-Type
  const filename = extractFilename(headers['content-disposition']) || extractFilename(headers['content-type']);

  // Vérifier si cette partie est un conteneur multipart
  const boundaryMatch = (headers['content-type'] || '').match(/boundary\s*=\s*["']?([^"';\r\n]+)["']?/i);

  if (boundaryMatch) {
    const boundary = boundaryMatch[1].trim();
    const boundaryRegex = new RegExp(`--${escapeRegExp(boundary)}(?:--)?`);
    const subParts = body.split(boundaryRegex);
    for (const subPart of subParts) {
      const trimmed = subPart.trim();
      if (trimmed && trimmed !== '--') {
        extractAttachmentsRecursive(trimmed, attachments);
      }
    }
  } else {
    // Partie feuille : vérifier si c'est un CSV
    const isCSVByFilename = filename && /\.csv$/i.test(filename.trim());
    const isCSVByMime = contentType.includes('text/csv') || contentType.includes('text/comma-separated-values');

    if (isCSVByFilename || (isCSVByMime && !filename)) {
      const finalFilename = filename ? path.basename(filename) : 'sinch_rates.csv';
      const encoding = (headers['content-transfer-encoding'] || '').toLowerCase().trim();

      let decodedContent = '';
      if (encoding.includes('base64')) {
        decodedContent = Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf-8');
      } else if (encoding.includes('quoted-printable')) {
        decodedContent = decodeQuotedPrintable(body);
      } else {
        decodedContent = body;
      }

      attachments.push({
        filename: finalFilename,
        content: decodedContent
      });
    }
  }

  return attachments;
}

/**
 * Point d'entrée pour extraire les pièces jointes CSV d'un message brut.
 */
function extractCSVAttachments(rawMessage) {
  return extractAttachmentsRecursive(rawMessage, []);
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extrait l'adresse e-mail brute (sans nom d'affichage).
 */
function extractEmailAddress(fromHeader) {
  if (!fromHeader) return '';
  const angleMatch = fromHeader.match(/<([^>]+)>/);
  if (angleMatch) return angleMatch[1].trim().toLowerCase();
  const emailMatch = fromHeader.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return emailMatch ? emailMatch[0].trim().toLowerCase() : fromHeader.trim().toLowerCase();
}

/**
 * Vérifie si l'expéditeur est autorisé (domaine @sinch.com, sous-domaine légitime ou adresse exacte).
 */
function isSenderAllowed(fromHeader, allowedSenders) {
  if (!allowedSenders || allowedSenders.length === 0) return true;
  if (!fromHeader) return false;

  const email = extractEmailAddress(fromHeader);
  if (!email || !email.includes('@')) return false;

  const domain = email.slice(email.indexOf('@')); // ex: "@sinch.com" ou "@sub.sinch.com"

  return allowedSenders.some(allowed => {
    const normAllowed = allowed.toLowerCase().trim();
    if (normAllowed.startsWith('@')) {
      // Correspondance exacte du domaine (@sinch.com) ou sous-domaine (@notifications.sinch.com)
      return domain === normAllowed || domain.endsWith('.' + normAllowed.slice(1));
    }
    // Correspondance d'adresse e-mail exacte
    return email === normAllowed;
  });
}

/**
 * Client IMAP minimaliste sécurisé en TLS natif (port 993).
 */
class MinimalIMAPClient {
  constructor(host, port, timeoutMs = 15000) {
    this.host = host;
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.tagCounter = 1;
    this.buffer = '';
  }

  async connect(proxyUrl = null) {
    if (proxyUrl) {
      return this.connectViaProxy(proxyUrl);
    }
    return this.connectDirect();
  }

  async connectDirect() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.socket) this.socket.destroy();
        reject(new Error(`Timeout de connexion au serveur IMAP ${this.host}:${this.port}`));
      }, this.timeoutMs);

      this.socket = tls.connect({
        host: this.host,
        port: this.port,
        servername: this.host,
        minVersion: 'TLSv1.2'
      }, () => {
        clearTimeout(timer);
        resolve();
      });

      this.socket.setEncoding('binary');

      this.socket.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async connectViaProxy(proxyUrl) {
    const parsed = new URL(proxyUrl.includes('://') ? proxyUrl : `http://${proxyUrl}`);
    const proxyHost = parsed.hostname;
    const proxyPort = parseInt(parsed.port, 10) || 8080;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.socket) this.socket.destroy();
        reject(new Error(`Timeout de connexion au proxy ${proxyHost}:${proxyPort}`));
      }, this.timeoutMs);

      const plainSocket = net.connect({ host: proxyHost, port: proxyPort }, () => {
        plainSocket.write(`CONNECT ${this.host}:${this.port} HTTP/1.1\r\nHost: ${this.host}:${this.port}\r\n\r\n`);
      });

      let responseBuffer = '';
      const onData = (chunk) => {
        responseBuffer += chunk.toString('utf-8');
        if (responseBuffer.includes('\r\n\r\n')) {
          plainSocket.removeListener('data', onData);
          if (responseBuffer.startsWith('HTTP/1.1 200') || responseBuffer.startsWith('HTTP/1.0 200')) {
            // Tunnel proxy établi avec succès -> passage en TLS
            this.socket = tls.connect({
              socket: plainSocket,
              servername: this.host,
              minVersion: 'TLSv1.2'
            }, () => {
              clearTimeout(timer);
              resolve();
            });
            this.socket.setEncoding('binary');
            this.socket.on('error', (err) => {
              clearTimeout(timer);
              reject(err);
            });
          } else {
            clearTimeout(timer);
            plainSocket.destroy();
            const firstLine = responseBuffer.split('\r\n')[0];
            reject(new Error(`Le proxy a refusé la connexion CONNECT vers ${this.host}:${this.port} : ${firstLine}`));
          }
        }
      };

      plainSocket.on('data', onData);
      plainSocket.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Impossible de joindre le proxy ${proxyHost}:${proxyPort} : ${err.message}`));
      });
    });
  }

  nextTag() {
    return `A${String(this.tagCounter++).padStart(4, '0')}`;
  }

  async sendCommand(command, onLiteral = null) {
    const tag = this.nextTag();
    const fullCmd = `${tag} ${command}\r\n`;

    return new Promise((resolve, reject) => {
      let accumulated = '';
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Délai d'attente dépassé pour la commande IMAP : ${command}`));
      }, this.timeoutMs);

      const onData = (chunk) => {
        accumulated += chunk;
        // Recherche de la ligne de fin tagged (ex: A0001 OK ...)
        const endRegex = new RegExp(`^${tag}\\s+(OK|NO|BAD)[^\\r\\n]*\\r\\n`, 'm');
        const match = accumulated.match(endRegex);

        if (match) {
          clearTimeout(timer);
          cleanup();
          const status = match[1];
          if (status === 'OK') {
            resolve({ raw: accumulated, tag, status });
          } else {
            reject(new Error(`Erreur IMAP [${status}] : ${match[0].trim()}`));
          }
        }
      };

      const onError = (err) => {
        clearTimeout(timer);
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        if (this.socket) {
          this.socket.removeListener('data', onData);
          this.socket.removeListener('error', onError);
        }
      };

      this.socket.on('data', onData);
      this.socket.on('error', onError);

      this.socket.write(fullCmd);
    });
  }

  async close() {
    if (this.socket && !this.socket.destroyed) {
      try {
        await this.sendCommand('LOGOUT');
      } catch (e) {
        // Ignorer l'erreur de déconnexion
      }
      this.socket.end();
      this.socket.destroy();
    }
  }
}

/**
 * Exécute la synchronisation complète de la boîte mail.
 */
async function syncMailbox() {
  const config = loadMailConfig();

  if (!config) {
    return {
      success: false,
      message: 'Fichier data/mail_config.json introuvable. Veuillez le créer à partir de data/mail_config.example.json.'
    };
  }

  if (!config.enabled) {
    return {
      success: false,
      message: 'Synchronisation désactivée dans data/mail_config.json (enabled = false).'
    };
  }

  if (!config.password || config.password.includes('METTRE_ICI')) {
    return {
      success: false,
      message: 'Le mot de passe d\'application Gmail n\'est pas encore renseigné dans data/mail_config.json.'
    };
  }

  const cleanPassword = config.password.replace(/\s+/g, '');
  const client = new MinimalIMAPClient(config.host || 'imap.gmail.com', config.port || 993);

  const results = {
    checkedAt: new Date().toISOString(),
    emailsScanned: 0,
    sinchEmailsFound: 0,
    csvProcessed: 0,
    details: [],
    errors: []
  };

  try {
    // 1. Connexion TLS (directe ou via proxy entreprise si configuré / détecté)
    const proxyUrl = config.proxy || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy || null;
    await client.connect(proxyUrl);

    // 2. Attendre le greeting "* OK"
    await new Promise(resolve => setTimeout(resolve, 500));

    // 3. Authentification
    await client.sendCommand(`LOGIN "${config.user}" "${cleanPassword}"`);

    // 4. Sélection de la boîte de réception
    await client.sendCommand('SELECT INBOX');

    // 5. Recherche des emails non lus
    const searchRes = await client.sendCommand('SEARCH UNSEEN');
    const searchLine = searchRes.raw.split('\r\n').find(l => l.startsWith('* SEARCH'));
    const messageIds = searchLine ? searchLine.replace('* SEARCH', '').trim().split(/\s+/).filter(Boolean) : [];

    results.emailsScanned = messageIds.length;

    if (messageIds.length === 0) {
      await client.close();
      return {
        success: true,
        message: 'Aucun nouvel e-mail non lu dans la boîte.',
        stats: results
      };
    }

    // 6. Parcours de chaque e-mail non lu
    for (const id of messageIds) {
      try {
        // Récupération de l'e-mail complet
        const fetchRes = await client.sendCommand(`FETCH ${id} (RFC822)`);
        const rawContent = fetchRes.raw;

        // Extraction des headers
        const headerEnd = rawContent.search(/\r?\n\r?\n/);
        const headers = headerEnd !== -1 ? parseMIMEHeaders(rawContent.slice(0, headerEnd)) : {};
        const from = headers['from'] || '';
        const subject = headers['subject'] || '(Sans objet)';

        // Filtrage strict : l'expéditeur doit correspondre aux règles Sinch
        if (!isSenderAllowed(from, config.allowedSenders)) {
          // Message non Sinch : on ne le traite pas, on le laisse de côté
          continue;
        }

        results.sinchEmailsFound++;
        console.log(`[MAIL] Message #${id} reçu de : "${from}" | Sujet : "${subject}"`);

        // Extraction des pièces jointes CSV (parcours récursif MIME)
        const attachments = extractCSVAttachments(rawContent);

        if (attachments.length === 0) {
          console.log(`[MAIL] ⚠️ Aucun fichier CSV attaché détecté dans le message #${id}.`);
          results.details.push({
            id,
            from,
            subject,
            status: 'Ignoré (aucun fichier CSV détecté)'
          });
          continue;
        }

        console.log(`[MAIL] ✓ ${attachments.length} fichier(s) CSV trouvé(s) : ${attachments.map(a => a.filename).join(', ')}`);

        // Traitement de chaque CSV trouvé
        for (const att of attachments) {
          const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
          const safeName = `sinch_mail_${timestamp}_${att.filename}`;

          // Appel direct du moteur d'ingestion existant
          const ingestResult = ingestCSVContent(att.content, safeName);

          results.csvProcessed++;
          results.details.push({
            id,
            from,
            subject,
            filename: att.filename,
            recordsUpdated: ingestResult.recordsUpdated,
            newCount: ingestResult.newCount,
            increases: ingestResult.increases,
            decreases: ingestResult.decreases,
            archiveFile: ingestResult.archiveFile,
            status: 'Ingéré avec succès'
          });
          console.log(`[MAIL] ✓ Fichier "${att.filename}" ingéré (${ingestResult.recordsUpdated} tarifs actualisés, archive: ${ingestResult.archiveFile})`);
        }

        // 7. Marquer comme lu UNIQUEMENT si un CSV a été ingéré avec succès
        if (config.markAsRead && attachments.length > 0) {
          await client.sendCommand(`STORE ${id} +FLAGS (\\Seen)`);
        }
      } catch (msgErr) {
        console.error(`[MAIL] ✗ Erreur lors du traitement du message #${id} :`, msgErr.message);
        results.errors.push(`Erreur message #${id} : ${msgErr.message}`);
      }
    }

    await client.close();

    return {
      success: true,
      message: `Synchronisation terminée : ${results.csvProcessed} fichier(s) CSV Sinch traité(s).`,
      stats: results
    };
  } catch (err) {
    if (client) {
      try { await client.close(); } catch (e) {}
    }
    return {
      success: false,
      message: `Échec de la connexion/synchronisation IMAP : ${err.message}`,
      error: err.message
    };
  }
}

/**
 * Calcule le délai en millisecondes jusqu'à la prochaine occurrence de l'heure cible (ex: "02:00").
 */
function calculateMsUntilNextSchedule(timeStr = '02:00') {
  const [targetHour, targetMinute] = timeStr.split(':').map(n => parseInt(n, 10) || 0);
  const now = new Date();
  const next = new Date(now);

  next.setHours(targetHour, targetMinute, 0, 0);
  if (next <= now) {
    // Si l'heure est déjà passée aujourd'hui, programmer pour demain
    next.setDate(next.getDate() + 1);
  }

  return next.getTime() - now.getTime();
}

/**
 * Initialise le planificateur automatique chaque nuit à l'heure configurée (par défaut 02:00).
 */
function initNightlySyncScheduler() {
  const config = loadMailConfig();
  const scheduleTime = (config && config.scheduleTime) ? config.scheduleTime : '02:00';

  function planNextRun() {
    const delayMs = calculateMsUntilNextSchedule(scheduleTime);
    const targetDate = new Date(Date.now() + delayMs);
    console.log(`[PLANIFICATEUR] Prochaine relève automatique des tarifs Sinch : ${targetDate.toLocaleString('fr-FR')} (à ${scheduleTime})`);

    setTimeout(async () => {
      console.log(`\n========================================`);
      console.log(`⏰ [PLANIFICATEUR] Déclenchement de la relève nocturne de ${scheduleTime}`);
      console.log(`========================================`);

      try {
        const result = await syncMailbox();
        console.log(`[PLANIFICATEUR] Résultat :`, result.message);
        if (result.stats && result.stats.csvProcessed > 0) {
          console.log(`[PLANIFICATEUR] ✓ ${result.stats.csvProcessed} catalogue(s) Sinch mis à jour automatiquement.`);
        }
      } catch (err) {
        console.error(`[PLANIFICATEUR] ✗ Erreur lors de la synchronisation :`, err.message);
      } finally {
        planNextRun(); // Reprogramme pour la nuit suivante
      }
    }, delayMs);
  }

  planNextRun();
}

module.exports = {
  loadMailConfig,
  isSenderAllowed,
  extractCSVAttachments,
  parseMIMEHeaders,
  decodeQuotedPrintable,
  decodeRFC2047,
  calculateMsUntilNextSchedule,
  syncMailbox,
  initNightlySyncScheduler
};
