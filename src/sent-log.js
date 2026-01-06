const fs = require('fs');
const path = require('path');
const { TOKEN_DIR } = require('./gmail-auth');
const { atomicWriteJsonSync } = require('./utils');

const LOG_DIR = TOKEN_DIR;
const LOG_FILE = path.join(LOG_DIR, 'sent-log.json');

/**
 * Ensures the log directory exists
 */
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Reads the current sent log
 * @returns {Array} Array of sent email entries
 */
function readSentLog() {
  ensureLogDir();
  if (!fs.existsSync(LOG_FILE)) {
    return [];
  }
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    return JSON.parse(content);
  } catch (_err) {
    return [];
  }
}

/**
 * Logs a sent email to the sent log
 * @param {Object} entry - { account, to, subject, body, id, threadId, replyToId? }
 */
function logSentEmail(entry) {
  ensureLogDir();
  const log = readSentLog();
  const timestamp = new Date().toISOString();

  log.push({
    sentAt: timestamp,
    account: entry.account,
    id: entry.id,
    threadId: entry.threadId,
    to: entry.to,
    subject: entry.subject,
    bodyPreview: entry.body.substring(0, 200),
    replyToId: entry.replyToId || null,
  });

  atomicWriteJsonSync(LOG_FILE, log);
}

/**
 * Gets recent sent emails from the log
 * @param {number} days - Number of days to look back (default: 30)
 * @returns {Array} Array of sent email entries within the time range
 */
function getRecentSent(days = 30) {
  const log = readSentLog();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  return log.filter((entry) => {
    const sentAt = new Date(entry.sentAt);
    return sentAt >= cutoff;
  });
}

/**
 * Gets the path to the log file (for display purposes)
 * @returns {string} The log file path
 */
function getSentLogPath() {
  return LOG_FILE;
}

module.exports = {
  logSentEmail,
  getRecentSent,
  getSentLogPath,
  readSentLog,
};
