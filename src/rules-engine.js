function getEmailKey(email) {
  const account = email.account || 'default';
  return `${account}:${email.id}`;
}

function buildRuleQuery(rule) {
  if (!rule || !rule.sender) {
    return '';
  }

  const trimmed = rule.sender.trim();
  const safeValue = /\s/.test(trimmed)
    ? `"${trimmed.replace(/"/g, '\\"')}"`
    : trimmed;

  const parts = [`from:${safeValue}`];
  if (rule.olderThanDays) {
    parts.push(`older_than:${rule.olderThanDays}d`);
  }
  return parts.join(' ');
}

function isOlderThan(dateValue, olderThanDays) {
  if (!olderThanDays) return true;
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);
  return parsed < cutoff;
}

function emailMatchesRule(email, rule) {
  if (!email || !rule || !rule.sender) {
    return false;
  }
  const from = (email.from || '').toLowerCase();
  const sender = rule.sender.toLowerCase();
  if (!from.includes(sender)) {
    return false;
  }
  if (!isOlderThan(email.date, rule.olderThanDays)) {
    return false;
  }
  return true;
}

function buildActionPlan(ruleMatches) {
  const protectedKeys = new Set();
  const deleteCandidates = [];
  const archiveCandidates = [];
  const markReadCandidates = [];
  const deleteKeys = new Set();
  const archiveKeys = new Set();
  const markReadKeys = new Set();
  const appliedByRule = new Map();
  const protectedByRule = new Map();

  ruleMatches.forEach(({ rule, emails }) => {
    const uniqueKeys = new Set(emails.map(getEmailKey));
    if (rule.action === 'never-delete') {
      protectedByRule.set(rule.id, uniqueKeys.size);
      uniqueKeys.forEach((key) => protectedKeys.add(key));
    }
  });

  ruleMatches.forEach(({ rule, emails }) => {
    if (rule.action !== 'always-delete') {
      return;
    }
    emails.forEach((email) => {
      const key = getEmailKey(email);
      if (protectedKeys.has(key) || deleteKeys.has(key)) {
        return;
      }
      deleteKeys.add(key);
      deleteCandidates.push(email);
      appliedByRule.set(rule.id, (appliedByRule.get(rule.id) || 0) + 1);
    });
  });

  ruleMatches.forEach(({ rule, emails }) => {
    if (rule.action !== 'auto-archive') {
      return;
    }
    emails.forEach((email) => {
      const key = getEmailKey(email);
      if (protectedKeys.has(key) || deleteKeys.has(key) || archiveKeys.has(key)) {
        return;
      }
      archiveKeys.add(key);
      archiveCandidates.push(email);
      appliedByRule.set(rule.id, (appliedByRule.get(rule.id) || 0) + 1);
    });
  });

  ruleMatches.forEach(({ rule, emails }) => {
    if (rule.action !== 'auto-mark-read') {
      return;
    }
    emails.forEach((email) => {
      const key = getEmailKey(email);
      // Skip if protected, already marked for delete/archive/mark-read, or already read
      if (protectedKeys.has(key) || deleteKeys.has(key) || archiveKeys.has(key) || markReadKeys.has(key)) {
        return;
      }
      // Only mark as read if email is currently unread
      const labelIds = email.labelIds || [];
      if (!labelIds.includes('UNREAD')) {
        return;
      }
      markReadKeys.add(key);
      markReadCandidates.push(email);
      appliedByRule.set(rule.id, (appliedByRule.get(rule.id) || 0) + 1);
    });
  });

  const ruleSummaries = ruleMatches.map(({ rule, emails }) => {
    const uniqueKeys = new Set(emails.map(getEmailKey));
    return {
      id: rule.id,
      action: rule.action,
      sender: rule.sender,
      olderThanDays: rule.olderThanDays || null,
      matches: uniqueKeys.size,
      applied: appliedByRule.get(rule.id) || 0,
      protected: protectedByRule.get(rule.id) || 0,
    };
  });

  return {
    protectedKeys,
    deleteCandidates,
    archiveCandidates,
    markReadCandidates,
    ruleSummaries,
  };
}

module.exports = {
  getEmailKey,
  buildRuleQuery,
  emailMatchesRule,
  buildActionPlan,
};
