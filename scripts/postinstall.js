#!/usr/bin/env node
/**
 * Postinstall script - shows helpful hints after npm install
 * and auto-updates skill if already installed
 */

// Skip during CI or if quiet mode
if (process.env.CI || process.env.npm_config_loglevel === 'silent') {
  process.exit(0);
}

const { getSkillStatus, checkForUpdate, installSkill } = require('../src/skill-installer');

/**
 * Show the install hint message for new users
 */
function showInstallHint() {
  const message = `
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  inboxd installed successfully!                             │
│                                                             │
│  Quick start:                                               │
│    inboxd setup             # First-time configuration      │
│                                                             │
│  AI Agent Integration:                                      │
│    inboxd install-skill     # Enable Claude Code skill      │
│                                                             │
│  This lets AI agents manage your inbox with expert triage.  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
`;
  console.log(message);
}

/**
 * Handle skill auto-update logic
 */
function handleSkillUpdate() {
  try {
    const status = getSkillStatus();

    if (!status.installed) {
      // Not installed → show manual install hint
      showInstallHint();
      return;
    }

    if (!status.isOurs) {
      // Someone else's skill with same name → don't touch, warn
      console.log(`\n⚠️  ~/.claude/skills/inbox-assistant exists but isn't from inboxd`);
      console.log(`   The existing skill has source: "${status.source || 'none'}"`);
      console.log(`   Run 'inboxd install-skill --force' to replace it\n`);
      return;
    }

    // It's ours → check for updates
    const update = checkForUpdate();

    if (update.updateAvailable) {
      const result = installSkill();

      if (result.success) {
        if (result.backedUp) {
          console.log(`\n✓ inbox-assistant skill updated`);
          console.log(`  Your previous version was saved to: SKILL.md.backup\n`);
        } else {
          console.log(`\n✓ inbox-assistant skill updated\n`);
        }
      } else if (result.reason === 'backup_failed') {
        console.log(`\n⚠️  Could not backup existing skill - update skipped`);
        console.log(`   Run 'inboxd install-skill' manually to update\n`);
      }
    }
    // Up-to-date → silent (no message)
  } catch (err) {
    // Fail silently - postinstall should not break npm install
    // User can always run 'inboxd install-skill' manually
  }
}

// Run the update logic
handleSkillUpdate();
