/**
 * Skill Installer - Copies the inbox-assistant skill to ~/.claude/skills/
 * Enables AI agents (like Claude Code) to use inboxd effectively.
 *
 * Safety features:
 * - Source marker: Only manages skills with `source: inboxd` in front matter
 * - Content hash: Detects changes without version numbers
 * - Backup: Creates .backup before replacing modified files
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const SKILL_NAME = 'inbox-assistant';
const SOURCE_MARKER = 'inboxd';
const SKILL_SOURCE_DIR = path.join(__dirname, '..', '.claude', 'skills', SKILL_NAME);
const SKILL_DEST_DIR = path.join(os.homedir(), '.claude', 'skills', SKILL_NAME);

/**
 * Compute MD5 hash of file content
 * @param {string} filePath - Path to file
 * @returns {string|null} Hash string or null if file doesn't exist
 */
function getFileHash(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return crypto.createHash('md5').update(content).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Extract the source field from SKILL.md front matter
 * @param {string} skillPath - Path to SKILL.md
 * @returns {string|null} Source string or null if not found
 */
function getSkillSource(skillPath) {
  try {
    const content = fs.readFileSync(skillPath, 'utf8');
    const match = content.match(/^---[\s\S]*?source:\s*["']?([^"'\n]+)["']?[\s\S]*?---/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Create a backup of the skill file
 * @param {string} skillDir - Directory containing SKILL.md
 * @returns {string|null} Backup path or null if failed
 */
function createBackup(skillDir) {
  const skillPath = path.join(skillDir, 'SKILL.md');
  // Backup to parent directory to survive directory deletion
  const backupPath = path.join(path.dirname(skillDir), `${SKILL_NAME}-SKILL.md.backup`);

  try {
    if (fs.existsSync(skillPath)) {
      fs.copyFileSync(skillPath, backupPath);
      return backupPath;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Move backup file into the skill directory after installation
 * @param {string} tempBackupPath - Path to temporary backup in parent directory
 * @param {string} skillDir - Skill directory to move backup into
 * @returns {string|null} Final backup path or null if failed
 */
function moveBackupToSkillDir(tempBackupPath, skillDir) {
  if (!tempBackupPath || !fs.existsSync(tempBackupPath)) {
    return null;
  }

  const finalBackupPath = path.join(skillDir, 'SKILL.md.backup');

  try {
    fs.renameSync(tempBackupPath, finalBackupPath);
    return finalBackupPath;
  } catch {
    // If rename fails (cross-device), try copy + delete
    try {
      fs.copyFileSync(tempBackupPath, finalBackupPath);
      fs.unlinkSync(tempBackupPath);
      return finalBackupPath;
    } catch {
      return null;
    }
  }
}

/**
 * Check if the skill is already installed and get its status
 * @returns {{ installed: boolean, currentHash: string|null, sourceHash: string|null, isOurs: boolean, source: string|null }}
 */
function getSkillStatus() {
  const destSkillMd = path.join(SKILL_DEST_DIR, 'SKILL.md');
  const sourceSkillMd = path.join(SKILL_SOURCE_DIR, 'SKILL.md');

  const installed = fs.existsSync(destSkillMd);
  const currentHash = installed ? getFileHash(destSkillMd) : null;
  const sourceHash = getFileHash(sourceSkillMd);
  const source = installed ? getSkillSource(destSkillMd) : null;
  const isOurs = source === SOURCE_MARKER;

  return { installed, currentHash, sourceHash, isOurs, source };
}

/**
 * Check if an update is available
 * @returns {{ updateAvailable: boolean, isOurs: boolean, hashMismatch: boolean }}
 */
function checkForUpdate() {
  const status = getSkillStatus();

  if (!status.installed) {
    return { updateAvailable: false, isOurs: false, hashMismatch: false };
  }

  const hashMismatch = status.currentHash !== status.sourceHash;

  return {
    updateAvailable: status.isOurs && hashMismatch,
    isOurs: status.isOurs,
    hashMismatch
  };
}

/**
 * Copy directory recursively
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 */
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Install or update the skill
 * @param {{ force?: boolean }} options - Installation options
 * @returns {{ success: boolean, action: 'installed'|'updated'|'unchanged'|'skipped', reason?: string, backedUp?: boolean, backupPath?: string, path: string }}
 */
function installSkill(options = {}) {
  const { force = false } = options;

  // Ensure source exists
  if (!fs.existsSync(SKILL_SOURCE_DIR)) {
    throw new Error(`Skill source not found at ${SKILL_SOURCE_DIR}`);
  }

  const status = getSkillStatus();
  const updateInfo = checkForUpdate();

  // Check ownership if skill already exists
  if (status.installed && !status.isOurs && !force) {
    return {
      success: false,
      action: 'skipped',
      reason: 'not_owned',
      path: SKILL_DEST_DIR
    };
  }

  // Check if already up-to-date
  if (status.installed && status.isOurs && !updateInfo.hashMismatch) {
    return {
      success: true,
      action: 'unchanged',
      path: SKILL_DEST_DIR
    };
  }

  // Ensure parent directory exists
  const skillsDir = path.dirname(SKILL_DEST_DIR);
  fs.mkdirSync(skillsDir, { recursive: true });

  // Backup if replacing existing (user may have modified)
  let backedUp = false;
  let backupPath = null;
  let tempBackupPath = null;
  if (status.installed) {
    tempBackupPath = createBackup(SKILL_DEST_DIR);

    // Remove existing for clean update
    fs.rmSync(SKILL_DEST_DIR, { recursive: true, force: true });
  }

  // Copy the skill directory
  copyDirSync(SKILL_SOURCE_DIR, SKILL_DEST_DIR);

  // Move backup into the new skill directory
  if (tempBackupPath) {
    backupPath = moveBackupToSkillDir(tempBackupPath, SKILL_DEST_DIR);
    backedUp = !!backupPath;
  }

  const action = status.installed ? 'updated' : 'installed';

  return {
    success: true,
    action,
    backedUp,
    backupPath,
    path: SKILL_DEST_DIR
  };
}

/**
 * Uninstall the skill
 * @returns {{ success: boolean, existed: boolean }}
 */
function uninstallSkill() {
  const existed = fs.existsSync(SKILL_DEST_DIR);

  if (existed) {
    fs.rmSync(SKILL_DEST_DIR, { recursive: true, force: true });
  }

  return { success: true, existed };
}

module.exports = {
  SKILL_NAME,
  SOURCE_MARKER,
  SKILL_SOURCE_DIR,
  SKILL_DEST_DIR,
  getFileHash,
  getSkillSource,
  createBackup,
  getSkillStatus,
  checkForUpdate,
  installSkill,
  uninstallSkill
};
