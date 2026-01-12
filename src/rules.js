const fs = require('fs');
const path = require('path');
const { TOKEN_DIR } = require('./gmail-auth');
const { atomicWriteJsonSync } = require('./utils');

const RULES_FILE = path.join(TOKEN_DIR, 'rules.json');
const RULES_VERSION = 1;
const SUPPORTED_ACTIONS = new Set(['always-delete', 'never-delete', 'auto-archive']);

function ensureRulesDir() {
  fs.mkdirSync(TOKEN_DIR, { recursive: true });
}

function getRulesPath() {
  return RULES_FILE;
}

function getDefaultRules() {
  return { version: RULES_VERSION, rules: [] };
}

function readRules() {
  ensureRulesDir();
  if (!fs.existsSync(RULES_FILE)) {
    return getDefaultRules();
  }
  try {
    const content = fs.readFileSync(RULES_FILE, 'utf8');
    const parsed = JSON.parse(content);
    if (!parsed || !Array.isArray(parsed.rules)) {
      return getDefaultRules();
    }
    return {
      version: parsed.version || RULES_VERSION,
      rules: parsed.rules,
    };
  } catch (_err) {
    return getDefaultRules();
  }
}

function writeRules(data) {
  ensureRulesDir();
  atomicWriteJsonSync(RULES_FILE, data);
}

function normalizeSender(sender) {
  return sender.trim();
}

function normalizeOlderThanDays(olderThanDays) {
  if (olderThanDays === undefined || olderThanDays === null) {
    return null;
  }
  const numeric = Number(olderThanDays);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.floor(numeric);
}

function generateRuleId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `rule_${Date.now()}_${rand}`;
}

function addRule({ action, sender, olderThanDays }) {
  if (!SUPPORTED_ACTIONS.has(action)) {
    throw new Error(`Unsupported action "${action}".`);
  }
  if (!sender || !sender.trim()) {
    throw new Error('Sender is required.');
  }

  const normalizedSender = normalizeSender(sender);
  const normalizedOlderThanDays = normalizeOlderThanDays(olderThanDays);

  const data = readRules();
  const existing = data.rules.find(rule => {
    const sameSender = (rule.sender || '').toLowerCase() === normalizedSender.toLowerCase();
    const sameAction = rule.action === action;
    const sameOlderThan = (rule.olderThanDays || null) === normalizedOlderThanDays;
    return sameSender && sameAction && sameOlderThan;
  });

  if (existing) {
    return { rule: existing, created: false };
  }

  const rule = {
    id: generateRuleId(),
    action,
    sender: normalizedSender,
    olderThanDays: normalizedOlderThanDays,
    createdAt: new Date().toISOString(),
  };

  data.rules.push(rule);
  writeRules(data);

  return { rule, created: true };
}

function removeRule(id) {
  const data = readRules();
  const index = data.rules.findIndex(rule => rule.id === id);
  if (index === -1) {
    return { removed: false, rule: null };
  }
  const [removedRule] = data.rules.splice(index, 1);
  writeRules(data);
  return { removed: true, rule: removedRule };
}

function listRules() {
  return readRules().rules;
}

function buildSuggestedRules(analysis) {
  if (!analysis) {
    return { period: 0, totalDeleted: 0, suggestions: [] };
  }
  const suggestions = [];
  const period = analysis.period || 0;

  for (const sender of analysis.frequentDeleters || []) {
    suggestions.push({
      action: 'always-delete',
      sender: sender.domain,
      reason: `Deleted ${sender.deletedCount} times in the last ${period} days`,
      source: 'frequentDeleters',
    });
  }

  for (const sender of analysis.neverReadSenders || []) {
    suggestions.push({
      action: 'auto-archive',
      sender: sender.domain,
      reason: `Deleted unread ${sender.deletedCount} times in the last ${period} days`,
      source: 'neverReadSenders',
    });
  }

  return {
    period,
    totalDeleted: analysis.totalDeleted || 0,
    suggestions,
  };
}

module.exports = {
  SUPPORTED_ACTIONS,
  getRulesPath,
  readRules,
  writeRules,
  addRule,
  removeRule,
  listRules,
  buildSuggestedRules,
};
