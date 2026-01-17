const fs = require('fs');
const path = require('path');
const { atomicWriteSync } = require('./utils');
const { TOKEN_DIR } = require('./gmail-auth');

const TEMPLATE_PATH = path.join(__dirname, 'templates', 'user-preferences-template.md');
const CANONICAL_SECTIONS = [
  'About Me',
  'Important People (Never Auto-Delete)',
  'Sender Behaviors',
  'Category Rules',
  'Behavioral Preferences',
];
const SECTION_ALIASES = {
  sender: 'Sender Behaviors',
  senders: 'Sender Behaviors',
  'sender behaviors': 'Sender Behaviors',
  important: 'Important People (Never Auto-Delete)',
  vip: 'Important People (Never Auto-Delete)',
  'never delete': 'Important People (Never Auto-Delete)',
  'important people': 'Important People (Never Auto-Delete)',
  'important people (never auto-delete)': 'Important People (Never Auto-Delete)',
  category: 'Category Rules',
  categories: 'Category Rules',
  'category rules': 'Category Rules',
  behavior: 'Behavioral Preferences',
  behaviors: 'Behavioral Preferences',
  'behavioral preferences': 'Behavioral Preferences',
  about: 'About Me',
  'about me': 'About Me',
};

function normalizeSectionInput(input) {
  if (!input || typeof input !== 'string') {
    return '';
  }
  return input.trim().replace(/^#+\s*/, '').trim().toLowerCase();
}

function resolveSection(input) {
  const normalized = normalizeSectionInput(input);
  if (!normalized) {
    return null;
  }
  if (SECTION_ALIASES[normalized]) {
    return SECTION_ALIASES[normalized];
  }
  const canonical = CANONICAL_SECTIONS.find(section => section.toLowerCase() === normalized);
  return canonical || null;
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'string') {
    return '';
  }
  return entry.trim().replace(/^[-*]\s*/, '').replace(/\s+/g, ' ').toLowerCase();
}

function findSectionIndex(lines, sectionTitle) {
  if (!Array.isArray(lines)) {
    return -1;
  }
  const resolvedSection = resolveSection(sectionTitle) || sectionTitle;
  if (!resolvedSection) {
    return -1;
  }
  const normalized = resolvedSection.trim().toLowerCase();
  return lines.findIndex(line => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('##')) {
      return false;
    }
    const heading = trimmed.replace(/^##\s*/, '');
    const resolvedHeading = resolveSection(heading) || heading;
    return resolvedHeading.trim().toLowerCase() === normalized;
  });
}

/**
 * Returns the path to the user preferences file
 * @returns {string}
 */
function getPreferencesPath() {
  return path.join(TOKEN_DIR, 'user-preferences.md');
}

/**
 * Ensures the config directory exists
 */
function ensureConfigDir() {
  fs.mkdirSync(TOKEN_DIR, { recursive: true });
}

/**
 * Checks if the preferences file exists
 * @returns {boolean}
 */
function preferencesExist() {
  return fs.existsSync(getPreferencesPath());
}

/**
 * Reads preferences file contents
 * @returns {string|null} File content or null if missing
 */
function readPreferences() {
  if (!preferencesExist()) {
    return null;
  }
  try {
    return fs.readFileSync(getPreferencesPath(), 'utf8');
  } catch (_err) {
    return null;
  }
}

/**
 * Returns the line count of the current preferences file (or provided content)
 * @param {string|null} content - Optional content to count lines from
 * @returns {number}
 */
function getLineCount(content = null) {
  const text = content !== null ? content : readPreferences();
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

/**
 * Writes preferences to disk, creating a backup if the file already exists
 * @param {string} content - Content to write
 * @returns {{ path: string, backupPath: string|null }}
 */
function writePreferences(content) {
  ensureConfigDir();
  const prefPath = getPreferencesPath();
  let backupPath = null;

  if (fs.existsSync(prefPath)) {
    backupPath = `${prefPath}.backup`;
    try {
      fs.copyFileSync(prefPath, backupPath);
    } catch (_err) {
      // If backup fails, better to abort than risk data loss
      throw new Error(`Failed to create backup at ${backupPath}`);
    }
  }

  atomicWriteSync(prefPath, content);
  return { path: prefPath, backupPath };
}

/**
 * Validates preferences content for basic safety rules
 * @param {string|null} content - Content to validate (reads current file if null)
 * @returns {{ valid: boolean, errors: string[], warnings: string[], lineCount: number }}
 */
function validatePreferences(content = null) {
  const text = content !== null ? content : readPreferences();

  if (!text) {
    return {
      valid: false,
      errors: ['Preferences file not found or empty'],
      warnings: [],
      lineCount: 0,
    };
  }

  const errors = [];
  const warnings = [];
  const lineCount = getLineCount(text);

  if (lineCount > 500) {
    errors.push(`Preferences exceed 500 lines (currently ${lineCount}). Consider consolidating rules.`);
  }

  const requiredSections = [
    '## About Me',
    '## Important People',
    '## Sender Behaviors',
    '## Category Rules',
    '## Behavioral Preferences',
  ];
  const missingSections = requiredSections.filter(section => !text.toLowerCase().includes(section.toLowerCase()));
  if (missingSections.length > 0) {
    warnings.push(`Missing sections: ${missingSections.join(', ')}`);
  }

  if (!text.trimStart().toLowerCase().startsWith('# inbox preferences')) {
    warnings.push('Missing top-level heading "# Inbox Preferences"');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    lineCount,
  };
}

/**
 * Appends content to a specific section, creating it if missing
 * @param {string} sectionTitle - Section heading without hashes (e.g., "Important People (Never Auto-Delete)")
 * @param {string} entry - Entry to append (bullet text)
 * @returns {{ path: string, backupPath: string|null, createdSection: boolean }}
 */
function appendToSection(sectionTitle, entry) {
  const prefPath = getPreferencesPath();
  ensureConfigDir();

  let content = readPreferences();
  if (!content) {
    content = fs.existsSync(TEMPLATE_PATH)
      ? fs.readFileSync(TEMPLATE_PATH, 'utf8')
      : `# Inbox Preferences\n\n## ${sectionTitle}\n`;
  }

  const lines = content.split(/\r?\n/);
  const resolvedSection = resolveSection(sectionTitle) || sectionTitle;
  const sectionHeader = `## ${resolvedSection}`;

  let sectionIndex = findSectionIndex(lines, resolvedSection);
  let createdSection = false;

  if (sectionIndex === -1) {
    // Append new section at end
    if (lines[lines.length - 1].trim() !== '') {
      lines.push('');
    }
    lines.push(sectionHeader, `- ${entry}`);
    createdSection = true;
  } else {
    // Find insertion point (before next header or end of file)
    let insertIndex = lines.length;
    for (let i = sectionIndex + 1; i < lines.length; i++) {
      if (lines[i].startsWith('#')) {
        insertIndex = i;
        break;
      }
    }

    // Ensure a blank line before the append if needed
    if (lines[insertIndex - 1] && lines[insertIndex - 1].trim() !== '') {
      lines.splice(insertIndex, 0, '');
      insertIndex++;
    }

    const bullet = entry.trim().startsWith('-') ? entry.trim() : `- ${entry.trim()}`;
    lines.splice(insertIndex, 0, bullet);
  }

  const { backupPath } = writePreferences(lines.join('\n'));
  return { path: prefPath, backupPath, createdSection };
}

/**
 * Returns the entries in a specific section
 * @param {string} sectionTitle - Section heading without hashes or alias
 * @returns {string[]} entries
 */
function getEntriesInSection(sectionTitle) {
  const resolvedSection = resolveSection(sectionTitle) || sectionTitle;
  if (!resolvedSection) {
    return [];
  }
  const content = readPreferences();
  if (!content) {
    return [];
  }
  const lines = content.split(/\r?\n/);
  const sectionIndex = findSectionIndex(lines, resolvedSection);
  if (sectionIndex === -1) {
    return [];
  }

  const entries = [];
  for (let i = sectionIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      break;
    }
    if (!trimmed || trimmed.startsWith('<!--')) {
      continue;
    }
    const match = trimmed.match(/^[-*]\s+(.*)$/);
    if (match) {
      entries.push(match[1].trim());
    }
  }

  return entries;
}

/**
 * Adds an entry to a section if it does not already exist
 * @param {string} sectionTitle - Section heading without hashes or alias
 * @param {string} entry - Entry text to add
 * @returns {{ added: boolean, existed: boolean, section: string, entry: string }}
 */
function setEntry(sectionTitle, entry) {
  const resolvedSection = resolveSection(sectionTitle) || sectionTitle;
  if (!resolvedSection) {
    throw new Error(`Unknown section: ${sectionTitle}`);
  }
  if (!entry || typeof entry !== 'string' || !entry.trim()) {
    throw new Error('Entry is required.');
  }

  const entries = getEntriesInSection(resolvedSection);
  const normalizedEntry = normalizeEntry(entry);
  const existed = entries.some(existing => normalizeEntry(existing) === normalizedEntry);
  if (existed) {
    return { added: false, existed: true, section: resolvedSection, entry: entry.trim() };
  }

  appendToSection(resolvedSection, entry);
  return { added: true, existed: false, section: resolvedSection, entry: entry.trim() };
}

/**
 * Removes entries from a section by exact entry or substring match
 * @param {string} sectionTitle - Section heading without hashes or alias
 * @param {{ match?: string, entry?: string }} options
 * @returns {{ removed: boolean, count: number, entries: string[] }}
 */
function removeFromSection(sectionTitle, options = {}) {
  const resolvedSection = resolveSection(sectionTitle) || sectionTitle;
  if (!resolvedSection) {
    throw new Error(`Unknown section: ${sectionTitle}`);
  }

  const content = readPreferences();
  if (!content) {
    return { removed: false, count: 0, entries: [] };
  }

  const lines = content.split(/\r?\n/);
  const targetNormalized = resolvedSection.trim().toLowerCase();
  const matchValue = options.match ? options.match.trim().toLowerCase() : null;
  const exactValue = options.entry ? normalizeEntry(options.entry) : null;
  const removedEntries = [];

  let inTargetSection = false;
  const nextLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      if (trimmed.startsWith('##')) {
        const heading = trimmed.replace(/^##\s*/, '');
        const resolvedHeading = resolveSection(heading) || heading;
        inTargetSection = resolvedHeading.trim().toLowerCase() === targetNormalized;
      } else {
        inTargetSection = false;
      }
      nextLines.push(line);
      continue;
    }

    if (inTargetSection) {
      const match = trimmed.match(/^[-*]\s+(.*)$/);
      if (match) {
        const entryText = match[1].trim();
        const normalizedEntry = normalizeEntry(entryText);
        const isMatch = exactValue
          ? normalizedEntry === exactValue
          : matchValue
            ? normalizedEntry.includes(matchValue)
            : false;
        if (isMatch) {
          removedEntries.push(entryText);
          continue;
        }
      }
    }

    nextLines.push(line);
  }

  if (removedEntries.length > 0) {
    writePreferences(nextLines.join('\n'));
    return { removed: true, count: removedEntries.length, entries: removedEntries };
  }

  return { removed: false, count: 0, entries: [] };
}

/**
 * Returns the template path (useful for CLI to bootstrap)
 * @returns {string}
 */
function getTemplatePath() {
  return TEMPLATE_PATH;
}

module.exports = {
  getPreferencesPath,
  preferencesExist,
  readPreferences,
  writePreferences,
  validatePreferences,
  appendToSection,
  resolveSection,
  setEntry,
  removeFromSection,
  getEntriesInSection,
  getLineCount,
  getTemplatePath,
};
