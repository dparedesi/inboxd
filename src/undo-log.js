const fs = require('fs');
const path = require('path');
const { TOKEN_DIR } = require('./gmail-auth');
const { atomicWriteJsonSync } = require('./utils');

const LOG_FILE = path.join(TOKEN_DIR, 'undo-log.json');
const SUPPORTED_ACTIONS = new Set(['delete', 'archive']);

function ensureLogDir() {
  fs.mkdirSync(TOKEN_DIR, { recursive: true });
}

function getUndoLogPath() {
  return LOG_FILE;
}

function readUndoLog() {
  ensureLogDir();
  if (!fs.existsSync(LOG_FILE)) {
    return [];
  }
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function writeUndoLog(entries) {
  ensureLogDir();
  atomicWriteJsonSync(LOG_FILE, entries);
}

function createUndoId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `undo_${Date.now()}_${rand}`;
}

function normalizeItems(items) {
  return items.map(item => ({
    id: item.id,
    threadId: item.threadId,
    account: item.account,
    from: item.from,
    subject: item.subject,
  }));
}

function logUndoAction(action, items) {
  if (!SUPPORTED_ACTIONS.has(action)) {
    throw new Error(`Unsupported undo action "${action}".`);
  }
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const log = readUndoLog();
  const entry = {
    id: createUndoId(),
    action,
    createdAt: new Date().toISOString(),
    count: items.length,
    items: normalizeItems(items),
  };

  log.push(entry);
  writeUndoLog(log);
  return entry;
}

function getRecentUndoActions(limit = 20) {
  const log = readUndoLog();
  const sorted = log.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return sorted.slice(0, limit);
}

function removeUndoEntry(entryId) {
  const log = readUndoLog();
  const next = log.filter(entry => entry.id !== entryId);
  if (next.length !== log.length) {
    writeUndoLog(next);
    return true;
  }
  return false;
}

function updateUndoEntry(entryId, updates) {
  const log = readUndoLog();
  const index = log.findIndex(entry => entry.id === entryId);
  if (index === -1) {
    return null;
  }

  const nextEntry = {
    ...log[index],
    ...updates,
  };
  if (updates.items) {
    nextEntry.count = updates.items.length;
  }
  log[index] = nextEntry;
  writeUndoLog(log);
  return nextEntry;
}

module.exports = {
  SUPPORTED_ACTIONS,
  getUndoLogPath,
  readUndoLog,
  logUndoAction,
  getRecentUndoActions,
  removeUndoEntry,
  updateUndoEntry,
};
