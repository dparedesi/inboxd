const fs = require('fs');
const path = require('path');
const { TOKEN_DIR, getAccounts } = require('./gmail-auth');
const { atomicWriteSync } = require('./utils');

const LOG_DIR = TOKEN_DIR;
const LOG_FILE = path.join(LOG_DIR, 'usage-log.jsonl');
const MAX_ENTRIES = 10000;
const TRIM_RATIO = 0.2;

/**
 * Ensures the log directory exists
 */
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Checks whether usage analytics are enabled
 * @returns {boolean}
 */
function isEnabled() {
  const value = process.env.INBOXD_NO_ANALYTICS;
  return value !== '1' && value !== 'true';
}

/**
 * Returns the path to the usage log file
 * @returns {string}
 */
function getUsagePath() {
  return LOG_FILE;
}

function getAccountMarker() {
  try {
    const accounts = getAccounts();
    return accounts.length > 1 ? 'multi' : null;
  } catch (_err) {
    return null;
  }
}

function rotateLogIfNeeded() {
  if (!fs.existsSync(LOG_FILE)) {
    return;
  }

  let content = '';
  try {
    content = fs.readFileSync(LOG_FILE, 'utf8');
  } catch (_err) {
    return;
  }

  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length <= MAX_ENTRIES) {
    return;
  }

  const trimCount = Math.ceil(lines.length * TRIM_RATIO);
  const remaining = lines.slice(trimCount);
  const trimmed = remaining.length > 0 ? `${remaining.join('\n')}\n` : '';

  try {
    atomicWriteSync(LOG_FILE, trimmed);
  } catch (_err) {
    // Ignore rotation failures
  }
}

function readUsageEntries() {
  if (!fs.existsSync(LOG_FILE)) {
    return [];
  }

  let content = '';
  try {
    content = fs.readFileSync(LOG_FILE, 'utf8');
  } catch (_err) {
    return [];
  }

  if (!content.trim()) {
    return [];
  }

  const entries = [];
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    try {
      entries.push(JSON.parse(line));
    } catch (_err) {
      // Skip malformed line
    }
  }
  return entries;
}

/**
 * Logs a usage entry to the JSONL file
 * @param {Object} entry - { cmd, flags, success }
 */
function logUsage(entry) {
  if (!isEnabled()) {
    return;
  }

  ensureLogDir();

  const usageEntry = {
    cmd: entry?.cmd || 'unknown',
    flags: Array.isArray(entry?.flags) ? entry.flags : [],
    ts: new Date().toISOString(),
    success: entry?.success === undefined ? true : Boolean(entry.success),
    account: getAccountMarker(),
  };

  try {
    fs.appendFileSync(LOG_FILE, `${JSON.stringify(usageEntry)}\n`);
  } catch (_err) {
    return;
  }

  rotateLogIfNeeded();
}

function getCutoffDate(daysOrSince) {
  if (daysOrSince instanceof Date) {
    return daysOrSince;
  }

  const days = typeof daysOrSince === 'number' && !Number.isNaN(daysOrSince)
    ? daysOrSince
    : 30;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Aggregates usage stats for the specified period
 * @param {number|Date} daysOrSince - Number of days or a Date cutoff
 * @returns {Object}
 */
function getUsageStats(daysOrSince = 30) {
  const cutoff = getCutoffDate(daysOrSince);
  const entries = readUsageEntries();

  const byCommand = {};
  const flagStats = {};
  let successCount = 0;
  let failureCount = 0;
  let total = 0;

  for (const entry of entries) {
    const ts = new Date(entry.ts);
    if (Number.isNaN(ts.getTime()) || ts < cutoff) {
      continue;
    }

    total++;
    const cmd = entry.cmd || 'unknown';
    byCommand[cmd] = (byCommand[cmd] || 0) + 1;

    if (entry.success) {
      successCount++;
    } else {
      failureCount++;
    }

    if (Array.isArray(entry.flags)) {
      for (const flag of entry.flags) {
        if (!flag) {
          continue;
        }
        if (!flagStats[flag]) {
          flagStats[flag] = { count: 0, commands: new Set() };
        }
        flagStats[flag].count++;
        flagStats[flag].commands.add(cmd);
      }
    }
  }

  const byFlag = {};
  for (const [flag, data] of Object.entries(flagStats)) {
    byFlag[flag] = { count: data.count, commands: data.commands.size };
  }

  return {
    total,
    success: successCount,
    failure: failureCount,
    byCommand,
    byFlag,
    since: cutoff.toISOString(),
  };
}

/**
 * Clears the usage log file
 */
function clearUsageLog() {
  try {
    fs.rmSync(LOG_FILE, { force: true });
  } catch (_err) {
    // Ignore
  }
}

module.exports = {
  logUsage,
  getUsageStats,
  getUsagePath,
  clearUsageLog,
  isEnabled,
};
