const fs = require('fs');
const path = require('path');
const { TOKEN_DIR } = require('./gmail-auth');
const { atomicWriteJsonSync } = require('./utils');

const LOG_DIR = TOKEN_DIR;
const LOG_FILE = path.join(LOG_DIR, 'deletion-log.json');

/**
 * Ensures the log directory exists
 */
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Reads the current deletion log
 * @returns {Array} Array of deletion entries
 */
function readLog() {
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
 * Logs deleted emails to the deletion log
 * @param {Array} emails - Array of email objects with id, threadId, account, from, subject, snippet
 */
function logDeletions(emails) {
  ensureLogDir();
  const log = readLog();
  const timestamp = new Date().toISOString();

  for (const email of emails) {
    log.push({
      deletedAt: timestamp,
      account: email.account,
      id: email.id,
      threadId: email.threadId,
      from: email.from,
      subject: email.subject,
      snippet: email.snippet,
    });
  }

  atomicWriteJsonSync(LOG_FILE, log);
}

/**
 * Gets recent deletions from the log
 * @param {number} days - Number of days to look back (default: 30)
 * @returns {Array} Array of deletion entries within the time range
 */
function getRecentDeletions(days = 30) {
  const log = readLog();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  return log.filter((entry) => {
    const deletedAt = new Date(entry.deletedAt);
    return deletedAt >= cutoff;
  });
}

/**
 * Gets the path to the log file (for display purposes)
 * @returns {string} The log file path
 */
function getLogPath() {
  return LOG_FILE;
}

/**
 * Removes entries from the deletion log (e.g., after restoration)
 * @param {Array<string>} ids - Array of message IDs to remove
 */
function removeLogEntries(ids) {
  ensureLogDir();
  const log = readLog();

  const newLog = log.filter(entry => !ids.includes(entry.id));

  if (log.length !== newLog.length) {
    atomicWriteJsonSync(LOG_FILE, newLog);
  }
}

module.exports = {
  logDeletions,
  getRecentDeletions,
  getLogPath,
  readLog,
  removeLogEntries,
};
