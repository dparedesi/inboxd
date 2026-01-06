const fs = require('fs');
const path = require('path');
const { TOKEN_DIR } = require('./gmail-auth');
const { atomicWriteJsonSync } = require('./utils');

const LOG_DIR = TOKEN_DIR;
const LOG_FILE = path.join(LOG_DIR, 'archive-log.json');

/**
 * Ensures the log directory exists
 */
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Reads the current archive log
 * @returns {Array} Array of archive entries
 */
function readArchiveLog() {
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
 * Logs archived emails to the archive log
 * @param {Array} emails - Array of email objects with id, threadId, account, from, subject, snippet
 */
function logArchives(emails) {
  ensureLogDir();
  const log = readArchiveLog();
  const timestamp = new Date().toISOString();

  for (const email of emails) {
    log.push({
      archivedAt: timestamp,
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
 * Gets recent archives from the log
 * @param {number} days - Number of days to look back (default: 30)
 * @returns {Array} Array of archive entries within the time range
 */
function getRecentArchives(days = 30) {
  const log = readArchiveLog();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  return log.filter((entry) => {
    const archivedAt = new Date(entry.archivedAt);
    return archivedAt >= cutoff;
  });
}

/**
 * Gets the path to the log file (for display purposes)
 * @returns {string} The log file path
 */
function getArchiveLogPath() {
  return LOG_FILE;
}

/**
 * Removes entries from the archive log (e.g., after unarchiving)
 * @param {Array<string>} ids - Array of message IDs to remove
 */
function removeArchiveLogEntries(ids) {
  ensureLogDir();
  const log = readArchiveLog();

  const newLog = log.filter(entry => !ids.includes(entry.id));

  if (log.length !== newLog.length) {
    atomicWriteJsonSync(LOG_FILE, newLog);
  }
}

module.exports = {
  logArchives,
  getRecentArchives,
  getArchiveLogPath,
  readArchiveLog,
  removeArchiveLogEntries,
};
