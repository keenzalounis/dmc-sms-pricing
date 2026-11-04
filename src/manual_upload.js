const { ingestCSVContent } = require('./ingest');
const { sendSinchAlert } = require('./alert_mailer');

async function ingestManualCSV(csvContent, filename, alertSender = sendSinchAlert) {
  try {
    return {
      success: true,
      details: ingestCSVContent(csvContent, filename)
    };
  } catch (error) {
    if (error.statusCode !== 400) throw error;

    let alertResult;
    try {
      alertResult = await alertSender({
        type: 'CSV_SCHEMA_INVALID',
        origin: 'manual-upload',
        reason: error.message,
        sender: 'Interface d’import DMC',
        subject: `Import CSV refusé : ${filename}`,
        attachmentName: filename,
        details: Array.isArray(error.details) ? error.details.join(' ') : undefined
      });
    } catch (alertError) {
      alertResult = { success: false, error: alertError.message };
    }

    return {
      success: false,
      statusCode: 400,
      message: `Erreur lors de l'ingestion : ${error.message}`,
      details: error.details,
      alertSent: Boolean(alertResult && alertResult.success),
      alertError: alertResult && !alertResult.success
        ? (alertResult.reason || alertResult.error || 'Le transport de messagerie a refusé l’envoi.')
        : undefined
    };
  }
}

module.exports = { ingestManualCSV };
