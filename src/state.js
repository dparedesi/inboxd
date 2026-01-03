const fs = require('fs');
const path = require('path');
const { TOKEN_DIR } = require('./gmail-auth');
const { atomicWriteJsonSync } = require('./utils');

const STATE_DIR = TOKEN_DIR;

function getStatePath(account = 'default') {
  return path.join(STATE_DIR, `state-${account}.json`);
}

function ensureDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

function loadState(account = 'default') {
  try {
    const statePath = getStatePath(account);
    if (fs.existsSync(statePath)) {
      const content = fs.readFileSync(statePath, 'utf8');
      return JSON.parse(content);
    }
  } catch (_error) {}
  return {
    lastCheck: null,
    seenEmailIds: [],
    lastNotifiedAt: null,
  };
}

function saveState(state, account = 'default') {
  ensureDir();
  atomicWriteJsonSync(getStatePath(account), state);
}

function getState(account = 'default') {
  return loadState(account);
}

function updateLastCheck(account = 'default') {
  const state = loadState(account);
  state.lastCheck = Date.now();
  saveState(state, account);
}

function markEmailsSeen(ids, account = 'default') {
  if (!Array.isArray(ids) || ids.length === 0) return;

  const state = loadState(account);
  const seen = state.seenEmailIds || [];
  const now = Date.now();

  const existingIds = new Set(seen.map((item) => (typeof item === 'string' ? item : item.id)));

  const newEntries = ids
    .filter((id) => !existingIds.has(id))
    .map((id) => ({ id, timestamp: now }));

  if (newEntries.length > 0) {
    state.seenEmailIds = [...seen, ...newEntries];
    saveState(state, account);
  }
}

function isEmailSeen(id, account = 'default') {
  const state = loadState(account);
  const seen = state.seenEmailIds || [];
  return seen.some((item) => (typeof item === 'string' ? item === id : item.id === id));
}

function clearOldSeenEmails(olderThanDays = 7, account = 'default') {
  const state = loadState(account);
  const seen = state.seenEmailIds || [];
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

  const filtered = seen.filter((item) => {
    if (typeof item === 'string') return true;
    return item.timestamp > cutoff;
  });

  if (filtered.length !== seen.length) {
    state.seenEmailIds = filtered;
    saveState(state, account);
  }
}

function getNewEmailIds(emailIds, account = 'default') {
  return emailIds.filter((id) => !isEmailSeen(id, account));
}

function updateLastNotifiedAt(account = 'default') {
  const state = loadState(account);
  state.lastNotifiedAt = Date.now();
  saveState(state, account);
}

module.exports = {
  getState,
  updateLastCheck,
  markEmailsSeen,
  isEmailSeen,
  clearOldSeenEmails,
  getNewEmailIds,
  updateLastNotifiedAt,
};
