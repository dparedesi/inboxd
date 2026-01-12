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
      labelIds: email.labelIds || [],
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

/**
 * Extracts domain from email address
 * @param {string} from - From field like "Name <email@domain.com>" or "email@domain.com"
 * @returns {string} Domain or 'unknown'
 */
function extractDomain(from) {
  const match = from.match(/@([a-zA-Z0-9.-]+)/);
  return match ? match[1].toLowerCase() : 'unknown';
}

/**
 * Gets deletion statistics for the specified period
 * @param {number} days - Number of days to look back (default: 30)
 * @returns {Object} Statistics object with counts and breakdowns
 */
function getStats(days = 30) {
  const deletions = getRecentDeletions(days);

  // Count by account
  const byAccount = {};
  deletions.forEach(d => {
    const account = d.account || 'default';
    byAccount[account] = (byAccount[account] || 0) + 1;
  });

  // Count by sender domain
  const bySender = {};
  deletions.forEach(d => {
    const domain = extractDomain(d.from || '');
    bySender[domain] = (bySender[domain] || 0) + 1;
  });

  // Sort senders by count (descending)
  const topSenders = Object.entries(bySender)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([domain, count]) => ({ domain, count }));

  return {
    total: deletions.length,
    byAccount,
    topSenders,
  };
}

/**
 * Analyzes deletion patterns to suggest cleanup actions
 * @param {number} days - Number of days to analyze (default: 30)
 * @returns {Object} Analysis with suggestions
 */
function analyzePatterns(days = 30) {
  const deletions = getRecentDeletions(days);

  // Group by sender domain with details
  const senderStats = {};
  deletions.forEach(d => {
    const domain = extractDomain(d.from || '');
    if (!senderStats[domain]) {
      senderStats[domain] = { count: 0, unreadCount: 0, subjects: new Set() };
    }
    senderStats[domain].count++;
    // Check if it was unread when deleted (labelIds contains UNREAD)
    if (d.labelIds && d.labelIds.includes('UNREAD')) {
      senderStats[domain].unreadCount++;
    }
    // Store unique subject patterns (first 30 chars)
    if (d.subject) {
      senderStats[domain].subjects.add(d.subject.substring(0, 30));
    }
  });

  // Find frequent deleters (deleted 3+ times)
  const frequentDeleters = Object.entries(senderStats)
    .filter(([_, stats]) => stats.count >= 3)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([domain, stats]) => ({
      domain,
      deletedCount: stats.count,
      suggestion: 'Consider unsubscribing',
    }));

  // Find never-read senders (all deleted emails were unread)
  const neverReadSenders = Object.entries(senderStats)
    .filter(([_, stats]) => stats.count >= 2 && stats.unreadCount === stats.count)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([domain, stats]) => ({
      domain,
      deletedCount: stats.count,
      suggestion: 'You never read these - consider bulk cleanup',
    }));

  return {
    period: days,
    totalDeleted: deletions.length,
    frequentDeleters,
    neverReadSenders,
  };
}

module.exports = {
  logDeletions,
  getRecentDeletions,
  getLogPath,
  readLog,
  removeLogEntries,
  getStats,
  analyzePatterns,
};
