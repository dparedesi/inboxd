#!/usr/bin/env node
/**
 * Postinstall script - auto-installs/updates Claude skill
 */

// Skip during CI or if quiet mode
if (process.env.CI || process.env.npm_config_loglevel === 'silent') {
  process.exit(0);
}

const { installSkill } = require('../src/skill-installer');

// ANSI colors
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

console.log('');
console.log(`${BOLD}inboxd${RESET} - AI-powered Gmail inbox management`);
console.log('');

// Auto-install/update skill
try {
  const result = installSkill();
  if (result.success && result.action === 'installed') {
    console.log(`${CYAN}Claude skill installed.${RESET}`);
  } else if (result.success && result.action === 'updated') {
    console.log(`${CYAN}Claude skill updated.${RESET}`);
  } else if (result.success && result.action === 'unchanged') {
    console.log(`${CYAN}Claude skill up to date.${RESET}`);
  } else if (!result.success && result.reason === 'not_owned') {
    console.log(`${CYAN}Skill exists but was not installed by inboxd.${RESET}`);
  } else if (!result.success && result.reason === 'backup_failed') {
    console.log(`${CYAN}Skill backup failed.${RESET}`);
  }
} catch (err) {
  console.log(`${CYAN}Skill install failed.${RESET}`);
}

console.log('');
console.log('Quick start:');
console.log(`  ${CYAN}inboxd setup${RESET}             # First-time configuration`);
console.log(`  ${CYAN}inboxd triage${RESET}            # Smart inbox triage`);
console.log(`  ${CYAN}inboxd status${RESET}            # Check inbox status`);
console.log('');
