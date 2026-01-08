const fs = require('fs');
const path = require('path');
const { atomicWriteSync } = require('./utils');
const { TOKEN_DIR } = require('./gmail-auth');

const TEMPLATE_PATH = path.join(__dirname, 'templates', 'user-preferences-template.md');

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
  const normalized = sectionTitle.trim().toLowerCase();
  const sectionHeader = `## ${sectionTitle}`;

  let sectionIndex = lines.findIndex(line => line.trim().toLowerCase() === `## ${normalized}`);
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
  getLineCount,
  getTemplatePath,
};
