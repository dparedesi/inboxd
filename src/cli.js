#!/usr/bin/env node

const { program } = require('commander');
const fs = require('fs');
const { getUnreadEmails, getEmailCount, trashEmails, getEmailById, untrashEmails, markAsRead, markAsUnread, archiveEmails, unarchiveEmails, groupEmailsBySender, groupEmailsByThread, getEmailContent, getThread, searchEmails, searchEmailsCount, searchEmailsPaginated, sendEmail, replyToEmail, extractLinks, extractUnsubscribeInfo, listLabels, createLabel, applyLabel, removeLabel, findLabelByName, extractAttachments, getEmailsWithAttachments, searchAttachments, downloadAttachment } = require('./gmail-monitor');
const { logArchives, getRecentArchives, getArchiveLogPath, removeArchiveLogEntries } = require('./archive-log');
const { authorize, addAccount, getAccounts, getAccountEmail, removeAccount, removeAllAccounts, renameTokenFile, validateCredentialsFile, hasCredentials, isConfigured, installCredentials } = require('./gmail-auth');
const { logDeletions, getRecentDeletions, getLogPath, readLog, removeLogEntries, getStats: getDeletionStats, analyzePatterns } = require('./deletion-log');
const { getSkillStatus, checkForUpdate, installSkill, SKILL_DEST_DIR, SOURCE_MARKER } = require('./skill-installer');
const { logSentEmail, getSentLogPath, getSentStats } = require('./sent-log');
const { getPreferencesPath, preferencesExist, readPreferences, writePreferences, validatePreferences, getTemplatePath } = require('./preferences');
const { getRulesPath, listRules, addRule, removeRule, buildSuggestedRules, SUPPORTED_ACTIONS } = require('./rules');
const { logUndoAction, getRecentUndoActions, removeUndoEntry, updateUndoEntry, getUndoLogPath } = require('./undo-log');
const { buildRuleQuery, emailMatchesRule, buildActionPlan } = require('./rules-engine');
const { parseIdsInput } = require('./id-utils');
const { logUsage, getUsageStats, getUsagePath, clearUsageLog } = require('./usage-log');
const readline = require('readline');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const pkg = require('../package.json');

/**
 * Prompts user for input
 */
function prompt(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Resolves a file path, expanding ~ to home directory
 */
function resolvePath(filePath) {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return path.resolve(filePath);
}

/**
 * Formats a file size in bytes to a human-readable string
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size (e.g., "1.2 MB")
 */
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * Parses a duration string like "7d", "24h", "3d" and returns a Date
 * representing that time in the past from now
 * @param {string} duration - Duration string (e.g., "7d", "24h", "1d")
 * @returns {Date|null} Date object or null if invalid format
 */
function parseSinceDuration(duration) {
  const match = duration.match(/^(\d+)([dhm])$/i);
  if (!match) {
    return null;
  }

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const now = new Date();

  switch (unit) {
    case 'd': // days
      return new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
    case 'h': // hours
      return new Date(now.getTime() - value * 60 * 60 * 1000);
    case 'm': // minutes
      return new Date(now.getTime() - value * 60 * 1000);
    default:
      return null;
  }
}

/**
 * Parses a duration string for Gmail's older_than query
 * Gmail only supports days (d) for older_than, so we convert weeks/months to days
 * @param {string} duration - Duration string (e.g., "30d", "2w", "1m")
 * @returns {string|null} Gmail query component (e.g., "30d") or null if invalid
 */
function parseOlderThanDuration(duration) {
  const match = duration.match(/^(\d+)([dwm])$/i);
  if (!match) {
    return null;
  }

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 'd': // days
      return `${value}d`;
    case 'w': // weeks -> days
      return `${value * 7}d`;
    case 'm': // months (approximate as 30 days)
      return `${value * 30}d`;
    default:
      return null;
  }
}

function readIdsFromStdin() {
  if (process.stdin.isTTY) {
    return [];
  }
  try {
    const input = fs.readFileSync(0, 'utf8');
    return parseIdsInput(input);
  } catch (_err) {
    return [];
  }
}

function parseMailtoLink(mailto) {
  if (!mailto) return null;
  const withoutPrefix = mailto.replace(/^mailto:/i, '');
  const [addressPart, query = ''] = withoutPrefix.split('?');
  const params = new URLSearchParams(query);
  const decodeValue = (value) => decodeURIComponent((value || '').replace(/\+/g, ' '));

  const to = decodeValue(addressPart);
  if (!to) {
    return null;
  }

  return {
    to,
    subject: decodeValue(params.get('subject')) || '',
    body: decodeValue(params.get('body')) || '',
  };
}

/**
 * Resolves the account to use, prompting user if ambiguous
 * @param {string|undefined} specifiedAccount - Account specified via option
 * @param {Object} chalk - Chalk instance for coloring
 * @returns {{account: string|null, error: string|null}} Account name or error
 */
function resolveAccount(specifiedAccount, chalk) {
  if (specifiedAccount) {
    return { account: specifiedAccount, error: null };
  }

  const accounts = getAccounts();
  if (accounts.length === 0) {
    return { account: 'default', error: null };
  }
  if (accounts.length === 1) {
    return { account: accounts[0].name, error: null };
  }

  // Multiple accounts, must specify
  let errorMsg = chalk.yellow('Multiple accounts configured. Please specify --account <name>\n');
  errorMsg += chalk.gray('Available accounts:\n');
  accounts.forEach(a => {
    errorMsg += chalk.gray(`  - ${a.name} (${a.email || 'unknown'})\n`);
  });
  return { account: null, error: errorMsg };
}

function extractFlagNames(command) {
  if (!command || !command.options || typeof command.getOptionValueSource !== 'function') {
    return [];
  }

  const flags = [];
  for (const option of command.options) {
    const source = command.getOptionValueSource(option.attributeName());
    if (source !== 'cli') {
      continue;
    }
    if (option.long) {
      flags.push(option.long);
    } else if (option.short) {
      flags.push(option.short);
    }
  }

  return flags;
}

function wrapAction(actionFn) {
  return async (...args) => {
    const command = args[args.length - 1];
    const cmdName = command?.name?.() || 'unknown';
    const flags = extractFlagNames(command);
    let success = true;
    let exitCalled = false;
    const originalExit = process.exit;

    const logOnce = () => {
      try {
        logUsage({ cmd: cmdName, flags, success });
      } catch (_err) {
        // Ignore logging failures
      }
    };

    process.exit = (code = 0) => {
      exitCalled = true;
      if (code !== 0) {
        success = false;
      }
      logOnce();
      process.exit = originalExit;
      return originalExit(code);
    };

    try {
      await actionFn(...args);
    } catch (err) {
      success = false;
      throw err;
    } finally {
      if (!exitCalled) {
        logOnce();
      }
      process.exit = originalExit;
    }
  };
}

async function main() {
  const chalk = (await import('chalk')).default;
  const boxen = (await import('boxen')).default;

  // Check for updates (non-blocking, cached)
  const updateNotifier = (await import('update-notifier')).default;
  updateNotifier({ pkg }).notify();

  program
    .name('inboxd')
    .description('Gmail monitoring CLI with multi-account support')
    .version(pkg.version);

  const applyRulesAction = wrapAction(async (options) => {
    try {
      const rules = listRules();
      if (rules.length === 0) {
        if (options.json) {
          console.log(JSON.stringify({ error: 'No rules defined', path: getRulesPath() }, null, 2));
        } else {
          console.log(chalk.gray('No rules saved yet.'));
          console.log(chalk.gray(`Rules file: ${getRulesPath()}`));
        }
        return;
      }

      const accountNames = options.account === 'all'
        ? getAccounts().map(a => a.name)
        : [options.account];

      if (accountNames.length === 0) {
        accountNames.push('default');
      }

      const limit = parseInt(options.limit, 10);
      if (!Number.isFinite(limit) || limit <= 0) {
        console.log(chalk.red('Error: --limit must be a positive number.'));
        return;
      }

      const ruleMatches = [];
      const skippedRules = [];

      for (const rule of rules) {
        const query = buildRuleQuery(rule);
        if (!query) {
          skippedRules.push(rule);
          ruleMatches.push({ rule, emails: [] });
          continue;
        }

        const emails = [];
        for (const account of accountNames) {
          const matches = await searchEmails(account, query, limit);
          const filtered = matches.filter(email => emailMatchesRule(email, rule));
          emails.push(...filtered);
        }

        ruleMatches.push({ rule, emails });
      }

      const plan = buildActionPlan(ruleMatches);
      const deleteCandidates = plan.deleteCandidates;
      const archiveCandidates = plan.archiveCandidates;
      const protectedCount = plan.protectedKeys.size;

      const totals = {
        delete: deleteCandidates.length,
        archive: archiveCandidates.length,
        protected: protectedCount,
      };

      const summarizeEmail = (email) => ({
        id: email.id,
        account: email.account || 'default',
        from: email.from,
        subject: email.subject,
        date: email.date,
        threadId: email.threadId,
      });

      const displayEmails = (label, emails) => {
        if (emails.length === 0) return;
        const displayLimit = 50;
        console.log(chalk.bold(`\n${label} (${emails.length}):\n`));
        emails.slice(0, displayLimit).forEach(e => {
          const from = e.from.length > 40 ? e.from.substring(0, 37) + '...' : e.from;
          const subject = e.subject.length > 50 ? e.subject.substring(0, 47) + '...' : e.subject;
          const accountTag = e.account ? chalk.gray(`[${e.account}] `) : '';
          console.log(chalk.white(`  ${accountTag}${from}`));
          console.log(chalk.gray(`    ${subject}\n`));
        });
        if (emails.length > displayLimit) {
          console.log(chalk.gray(`  ...and ${emails.length - displayLimit} more\n`));
        }
      };

      if (totals.delete + totals.archive === 0) {
        if (options.json) {
          console.log(JSON.stringify({
            dryRun: !!options.dryRun,
            totals,
            rules: plan.ruleSummaries,
            delete: { count: 0, emails: [] },
            archive: { count: 0, emails: [] },
            skippedRules: skippedRules.map(rule => rule.id),
          }, null, 2));
        } else {
          console.log(chalk.gray('No emails matched actionable rules.'));
          if (protectedCount > 0) {
            console.log(chalk.gray(`Protected by never-delete rules: ${protectedCount}`));
          }
        }
        return;
      }

      if (options.dryRun) {
        if (options.json) {
          console.log(JSON.stringify({
            dryRun: true,
            totals,
            rules: plan.ruleSummaries,
            delete: { count: deleteCandidates.length, emails: deleteCandidates.map(summarizeEmail) },
            archive: { count: archiveCandidates.length, emails: archiveCandidates.map(summarizeEmail) },
            skippedRules: skippedRules.map(rule => rule.id),
            limit,
          }, null, 2));
          return;
        }

        console.log(chalk.bold('\nRule Application Preview'));
        console.log(chalk.gray(`Accounts: ${accountNames.join(', ')}`));
        console.log(chalk.gray(`Limit: ${limit} per rule per account`));
        console.log(chalk.gray(`Protected: ${protectedCount}\n`));
        displayEmails('Delete', deleteCandidates);
        displayEmails('Archive', archiveCandidates);
        return;
      }

      if (!options.confirm && !options.json) {
        console.log(chalk.bold('\nRule Application Preview'));
        console.log(chalk.gray(`Accounts: ${accountNames.join(', ')}`));
        console.log(chalk.gray(`Limit: ${limit} per rule per account`));
        console.log(chalk.gray(`Protected: ${protectedCount}\n`));
        displayEmails('Delete', deleteCandidates);
        displayEmails('Archive', archiveCandidates);

        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const answer = await prompt(
          rl,
          chalk.yellow(`\nApply rules to delete ${deleteCandidates.length} and archive ${archiveCandidates.length} emails? (y/N): `)
        );
        rl.close();

        if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
          console.log(chalk.gray('Cancelled. No changes made.\n'));
          return;
        }
      }

      const deleteResults = [];
      const archiveResults = [];

      if (deleteCandidates.length > 0) {
        logDeletions(deleteCandidates);
        if (!options.json) {
          console.log(chalk.gray(`Logged deletions to: ${getLogPath()}`));
        }

        const byAccount = {};
        deleteCandidates.forEach(email => {
          const acc = email.account || 'default';
          if (!byAccount[acc]) {
            byAccount[acc] = [];
          }
          byAccount[acc].push(email);
        });

        const successfulEmails = [];

        for (const [account, emails] of Object.entries(byAccount)) {
          const results = await trashEmails(account, emails.map(e => e.id));
          const succeededIds = new Set(results.filter(r => r.success).map(r => r.id));
          successfulEmails.push(...emails.filter(e => succeededIds.has(e.id)));

          emails.forEach(email => {
            const result = results.find(r => r.id === email.id);
            deleteResults.push({
              id: email.id,
              account,
              from: email.from,
              subject: email.subject,
              success: result ? result.success : false,
              error: result && !result.success ? result.error : undefined,
            });
          });
        }

        if (successfulEmails.length > 0) {
          logUndoAction('delete', successfulEmails);
          if (!options.json) {
            console.log(chalk.gray(`Undo log: ${getUndoLogPath()}`));
          }
        }
      }

      if (archiveCandidates.length > 0) {
        logArchives(archiveCandidates);
        if (!options.json) {
          console.log(chalk.gray(`Logged archives to: ${getArchiveLogPath()}`));
        }

        const byAccount = {};
        archiveCandidates.forEach(email => {
          const acc = email.account || 'default';
          if (!byAccount[acc]) {
            byAccount[acc] = [];
          }
          byAccount[acc].push(email);
        });

        const successfulEmails = [];

        for (const [account, emails] of Object.entries(byAccount)) {
          const results = await archiveEmails(account, emails.map(e => e.id));
          const succeededIds = new Set(results.filter(r => r.success).map(r => r.id));
          successfulEmails.push(...emails.filter(e => succeededIds.has(e.id)));

          emails.forEach(email => {
            const result = results.find(r => r.id === email.id);
            archiveResults.push({
              id: email.id,
              account,
              from: email.from,
              subject: email.subject,
              success: result ? result.success : false,
              error: result && !result.success ? result.error : undefined,
            });
          });
        }

        if (successfulEmails.length > 0) {
          logUndoAction('archive', successfulEmails);
          if (!options.json) {
            console.log(chalk.gray(`Undo log: ${getUndoLogPath()}`));
          }
        }
      }

      if (options.json) {
        console.log(JSON.stringify({
          dryRun: false,
          totals,
          rules: plan.ruleSummaries,
          delete: { count: deleteCandidates.length, results: deleteResults },
          archive: { count: archiveCandidates.length, results: archiveResults },
          skippedRules: skippedRules.map(rule => rule.id),
          limit,
        }, null, 2));
        return;
      }

      if (deleteCandidates.length > 0) {
        const successCount = deleteResults.filter(result => result.success).length;
        const failureCount = deleteResults.length - successCount;
        console.log(chalk.green(`\nDeleted ${successCount} email(s) based on rules.`));
        if (failureCount > 0) {
          console.log(chalk.red(`Failed to delete ${failureCount} email(s).`));
        }
      }

      if (archiveCandidates.length > 0) {
        const successCount = archiveResults.filter(result => result.success).length;
        const failureCount = archiveResults.length - successCount;
        console.log(chalk.green(`\nArchived ${successCount} email(s) based on rules.`));
        if (failureCount > 0) {
          console.log(chalk.red(`Failed to archive ${failureCount} email(s).`));
        }
      }
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ error: error.message }, null, 2));
      } else {
        console.error(chalk.red('Error applying rules:'), error.message);
      }
      process.exit(1);
    }
  });

  // Setup command - interactive wizard for first-time users
  program
    .command('setup')
    .description('Interactive setup wizard for first-time configuration')
    .action(wrapAction(async () => {
      const open = (await import('open')).default;

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      // Handle Ctrl+C gracefully
      rl.on('close', () => {
        // Only show message if we're exiting unexpectedly (not from normal flow)
      });

      process.on('SIGINT', () => {
        console.log(chalk.gray('\n\nSetup cancelled.\n'));
        rl.close();
        process.exit(0);
      });

      try {
        console.log(chalk.bold.cyan('\nWelcome to inboxd! Let\'s get you set up.\n'));

        // Check if already configured
        if (hasCredentials()) {
          const accounts = getAccounts();
          if (accounts.length > 0) {
            console.log(chalk.yellow('You already have accounts configured:'));
            accounts.forEach(a => console.log(chalk.gray(`  - ${a.name} (${a.email})`)));
            console.log('');
            const answer = await prompt(rl, chalk.white('Do you want to add another account? (y/N): '));
            if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
              console.log(chalk.gray('\nSetup cancelled. Run "inboxd summary" to check your inbox.\n'));
              rl.close();
              return;
            }
            // Skip credentials step, go directly to auth
            console.log(chalk.cyan('\n🔐 Authenticate another Gmail account\n'));
            let accountName = await prompt(rl, chalk.white('   What should we call this account? (Leave empty to use email): '));
            const tempName = `temp_${Date.now()}`;

            rl.close();
            console.log(chalk.gray('\n   A browser window will open for authorization...\n'));
            await authorize(tempName);
            const email = await getAccountEmail(tempName);

            if (email) {
              if (accountName) {
                renameTokenFile(tempName, accountName);
              } else {
                renameTokenFile(tempName, email);
                accountName = email;
              }

              addAccount(accountName, email);
              console.log(chalk.green(`\n   ✓ Authenticated as ${email}\n`));
            }
            console.log(chalk.bold.green('🎉 Setup complete! Try: inboxd summary\n'));
            return;
          }
        }

        // Step 1: Google Cloud Console
        console.log(chalk.cyan('📋 Step 1: Create Google Cloud Credentials\n'));
        console.log(chalk.white('   You\'ll need to create OAuth credentials in Google Cloud Console.'));
        console.log(chalk.white('   This is a one-time setup that takes about 5 minutes.\n'));
        console.log(chalk.gray('   Quick guide:'));
        console.log(chalk.gray('   1. Create a project (or select existing)'));
        console.log(chalk.gray('   2. Enable the Gmail API'));
        console.log(chalk.gray('   3. Configure OAuth consent screen'));
        console.log(chalk.gray('      - Choose "External" user type'));
        console.log(chalk.gray('      - Add your email as a test user'));
        console.log(chalk.gray('   4. Create credentials → OAuth client ID → Desktop app'));
        console.log(chalk.gray('   5. Download the JSON file\n'));

        const openConsole = await prompt(rl, chalk.white('   Open Google Cloud Console? (Y/n): '));

        if (openConsole.toLowerCase() !== 'n' && openConsole.toLowerCase() !== 'no') {
          try {
            await open('https://console.cloud.google.com/apis/credentials');
            console.log(chalk.green('\n   ✓ Opened Google Cloud Console in your browser\n'));
          } catch (_err) {
            console.log(chalk.yellow('\n   Could not open browser automatically.'));
            console.log(chalk.white('   Please visit: https://console.cloud.google.com/apis/credentials\n'));
          }
        } else {
          console.log(chalk.gray('\n   Skipping browser open. URL: https://console.cloud.google.com/apis/credentials\n'));
        }

        // Step 2: Get credentials file
        console.log(chalk.cyan('📁 Step 2: Provide your credentials file\n'));
        console.log(chalk.gray('   After downloading, enter the path to the file.'));
        console.log(chalk.gray('   Tip: You can drag and drop the file into this terminal.\n'));

        let credentialsPath = '';
        let validated = false;

        while (!validated) {
          const input = await prompt(rl, chalk.white('   Path to credentials file: '));

          if (!input) {
            console.log(chalk.yellow('   Please provide a file path.\n'));
            continue;
          }

          credentialsPath = resolvePath(input.replace(/['"]/g, '').trim()); // Remove quotes from drag-drop

          const validation = validateCredentialsFile(credentialsPath);
          if (!validation.valid) {
            console.log(chalk.red(`\n   ✗ ${validation.error}\n`));
            const retry = await prompt(rl, chalk.white('   Try again? (Y/n): '));
            if (retry.toLowerCase() === 'n' || retry.toLowerCase() === 'no') {
              console.log(chalk.gray('\nSetup cancelled.\n'));
              rl.close();
              return;
            }
            continue;
          }

          validated = true;
        }

        // Install credentials
        const destPath = installCredentials(credentialsPath);
        console.log(chalk.green(`\n   ✓ Credentials saved to ${destPath}\n`));

        // Step 3: Authenticate
        console.log(chalk.cyan('🔐 Step 3: Authenticate your Gmail account\n'));
        let accountName = await prompt(rl, chalk.white('   What should we call this account? (Leave empty to use email): '));
        const tempName = `temp_${Date.now()}`;

        rl.close();

        console.log(chalk.gray('\n   A browser window will open for authorization...'));
        console.log(chalk.gray('   Sign in and allow access to your Gmail.\n'));

        await authorize(tempName);
        const email = await getAccountEmail(tempName);

        if (email) {
          if (accountName) {
            renameTokenFile(tempName, accountName);
          } else {
            renameTokenFile(tempName, email);
            accountName = email;
          }

          addAccount(accountName, email);
          console.log(chalk.green(`   ✓ Authenticated as ${email}\n`));
        } else {
          console.log(chalk.yellow('   Warning: Could not verify email address.\n'));
        }

        // Success
        console.log(chalk.bold.green('🎉 You\'re all set!\n'));
        console.log(chalk.white('   Try these commands:'));
        console.log(chalk.cyan('     inboxd summary') + chalk.gray('        - View your inbox'));
        console.log(chalk.cyan('     inboxd auth -a work') + chalk.gray('   - Add another account'));
        console.log('');

        // Offer to install Claude Code skill
        const rl2 = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const installSkillAnswer = await prompt(rl2, chalk.cyan('   Install Claude Code skill for AI-powered inbox management? (Y/n): '));
        rl2.close();

        if (installSkillAnswer.toLowerCase() !== 'n' && installSkillAnswer.toLowerCase() !== 'no') {
          try {
            const result = installSkill();
            console.log(chalk.green('\n   ✓ Claude Code skill installed!'));
            console.log(chalk.gray(`     Location: ${result.path}`));
            console.log(chalk.gray('     In Claude Code, ask: "check my emails" or "clean up my inbox"\n'));
          } catch (skillError) {
            console.log(chalk.yellow(`\n   Could not install skill: ${skillError.message}`));
            console.log(chalk.gray('     You can install it later with: inboxd install-skill\n'));
          }
        } else {
          console.log(chalk.gray('\n   Skipped. Install later with: inboxd install-skill\n'));
        }

      } catch (error) {
        rl.close();
        console.error(chalk.red('\nSetup failed:'), error.message);
        process.exit(1);
      }
    }));

  program
    .command('auth')
    .description('Authenticate a Gmail account')
    .option('-a, --account <name>', 'Account name (e.g., personal, work)')
    .action(wrapAction(async (options) => {
      try {
        // If account name is provided, use it. Otherwise start with a temporary name
        // that we'll swap for the email address later
        const isExplicitAccount = !!options.account;
        let accountName = options.account || `temp_${Date.now()}`;

        console.log(chalk.cyan(`Authenticating...`));
        console.log(chalk.gray('A browser window will open for you to authorize access.\n'));

        await authorize(accountName);
        const email = await getAccountEmail(accountName);

        if (!email) {
          throw new Error('Could not retrieve email address from the authenticated account.');
        }

        // If user didn't specify an account name, we use the email
        if (!isExplicitAccount) {
          // Check if this email is already registered
          const accounts = getAccounts();
          const existing = accounts.find(a => a.email === email);

          if (existing) {
            console.log(chalk.yellow(`Account already registered as "${existing.name}" (${email})`));
            // Clean up the temporary token
            removeAccount(accountName);
            return;
          }

          // Rename the token file from temp to email
          renameTokenFile(accountName, email);
          accountName = email;
        }

        addAccount(accountName, email);
        console.log(chalk.green(`Authentication successful!`));
        console.log(chalk.white(`Account "${accountName}" linked to ${email}`));

      } catch (error) {
        console.error(chalk.red('Authentication failed:'), error.message);
        process.exit(1);
      }
    }));

  program
    .command('accounts')
    .description('List all configured accounts')
    .option('--json', 'Output as JSON')
    .action(wrapAction(async (options) => {
      const accounts = getAccounts();

      if (options.json) {
        console.log(JSON.stringify({ accounts }, null, 2));
        return;
      }

      if (accounts.length === 0) {
        console.log(chalk.gray('No accounts configured. Run: inboxd setup'));
        return;
      }

      console.log(chalk.bold('\nConfigured Accounts:\n'));
      for (const acc of accounts) {
        console.log(`  ${chalk.cyan(acc.name)} - ${acc.email || 'unknown email'}`);
      }
      console.log('');
      console.log(chalk.gray('To add another account: inboxd auth -a <name>'));
      console.log('');
    }));

  program
    .command('logout')
    .description('Remove an account or all accounts')
    .option('-a, --account <name>', 'Account to remove (or "all" to remove all)')
    .option('--all', 'Remove all accounts')
    .action(wrapAction(async (options) => {
      if (options.all || options.account === 'all') {
        const accounts = getAccounts();
        if (accounts.length === 0) {
          console.log(chalk.gray('No accounts to remove.'));
          return;
        }
        removeAllAccounts();
        console.log(chalk.green(`Removed ${accounts.length} account(s) and cleared all tokens.`));
      } else if (options.account) {
        const accounts = getAccounts();
        const exists = accounts.find(a => a.name === options.account);
        if (!exists) {
          console.log(chalk.yellow(`Account "${options.account}" not found.`));
          return;
        }
        removeAccount(options.account);
        console.log(chalk.green(`Removed account "${options.account}"`));
      } else {
        console.log(chalk.gray('Usage: inboxd logout --account <name> or inboxd logout --all'));
      }
    }));

  program
    .command('summary')
    .description('Show summary of unread emails')
    .option('-a, --account <name>', 'Show specific account (or "all")', 'all')
    .option('-n, --count <number>', 'Number of emails per account', '5')
    .option('--json', 'Output as JSON')
    .action(wrapAction(async (options) => {
      try {
        const accounts = options.account === 'all'
          ? getAccounts().map(a => a.name)
          : [options.account];

        if (accounts.length === 0) {
          accounts.push('default');
        }

        if (options.json) {
          const result = {
            accounts: [],
            totalUnread: 0
          };

          for (const account of accounts) {
            const count = await getEmailCount(account);
            const accountInfo = getAccounts().find(a => a.name === account);

            result.accounts.push({
              name: account,
              email: accountInfo?.email || account,
              unreadCount: count
            });
            result.totalUnread += count;
          }

          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const maxPerAccount = parseInt(options.count, 10);
        const sections = [];

        for (const account of accounts) {
          const count = await getEmailCount(account);
          const emails = await getUnreadEmails(account, maxPerAccount);
          const accountInfo = getAccounts().find(a => a.name === account);
          const label = accountInfo?.email || account;

          let content = `${chalk.bold.cyan(label)} - ${count} unread\n\n`;

          if (emails.length > 0) {
            content += emails.map((e) => {
              const from = e.from.length > 35 ? e.from.substring(0, 32) + '...' : e.from;
              const subject = e.subject.length > 50 ? e.subject.substring(0, 47) + '...' : e.subject;
              return `${chalk.white(from)}\n  ${chalk.gray(subject)}`;
            }).join('\n\n');
          } else {
            content += chalk.gray('No unread emails');
          }

          sections.push(content);
        }

        const output = boxen(sections.join('\n\n' + chalk.gray('─'.repeat(50)) + '\n\n'), {
          padding: 1,
          margin: 1,
          borderStyle: 'round',
          borderColor: 'cyan',
          title: 'Inbox Summary',
          titleAlignment: 'center',
        });

        console.log(output);
      } catch (error) {
        console.error(chalk.red('Error fetching summary:'), error.message);
        process.exit(1);
      }
    }));

  program
    .command('analyze')
    .description('Output structured email data for AI analysis (unread only by default)')
    .option('-a, --account <name>', 'Account to analyze (or "all")', 'all')
    .option('-n, --count <number>', 'Number of emails to analyze per account', '20')
    .option('--all', 'Include read and unread emails (default: unread only)')
    .option('--since <duration>', 'Only include emails from last N days/hours (e.g., "7d", "24h", "3d")')
    .option('--older-than <duration>', 'Only include emails older than N days/weeks (e.g., "30d", "2w", "1m")')
    .option('--group-by <field>', 'Group emails by field (sender, thread)')
    .option('--ids-only', 'Output only email IDs, one per line')
    .action(wrapAction(async (options) => {
      try {
        const accounts = options.account === 'all'
          ? getAccounts().map(a => a.name)
          : [options.account];

        if (accounts.length === 0) {
          accounts.push('default');
        }

        const maxPerAccount = parseInt(options.count, 10);
        const includeRead = !!options.all;
        let allEmails = [];

        // Build Gmail query for --older-than (server-side filtering)
        let olderThanQuery = null;
        if (options.olderThan) {
          const olderThanDays = parseOlderThanDuration(options.olderThan);
          if (!olderThanDays) {
            console.error(JSON.stringify({
              error: `Invalid --older-than format: "${options.olderThan}". Use format like "30d", "2w", "1m"`
            }));
            process.exit(1);
          }
          olderThanQuery = `older_than:${olderThanDays}`;
        }

        for (const account of accounts) {
          let emails;
          if (olderThanQuery) {
            // Use searchEmails for server-side filtering when --older-than is specified
            const query = includeRead
              ? olderThanQuery
              : `is:unread ${olderThanQuery}`;
            emails = await searchEmails(account, query, maxPerAccount);
          } else {
            emails = await getUnreadEmails(account, maxPerAccount, includeRead);
          }
          allEmails.push(...emails);
        }

        // Filter by --since if provided (client-side, for newer emails)
        if (options.since) {
          const sinceDate = parseSinceDuration(options.since);
          if (sinceDate) {
            allEmails = allEmails.filter(email => {
              const emailDate = new Date(email.date);
              return emailDate >= sinceDate;
            });
          }
        }

        if (options.idsOnly) {
          if (options.groupBy) {
            console.error(JSON.stringify({ error: 'Cannot combine --ids-only with --group-by' }));
            process.exit(1);
          }
          const ids = allEmails.map(email => email.id).filter(Boolean);
          console.log(ids.join('\n'));
          return;
        }

        // Group by sender if requested
        if (options.groupBy) {
          if (options.groupBy !== 'sender' && options.groupBy !== 'thread') {
            console.error(JSON.stringify({ error: `Unsupported group-by field: ${options.groupBy}. Supported: sender, thread` }));
            process.exit(1);
          }
          const grouped = options.groupBy === 'thread'
            ? groupEmailsByThread(allEmails)
            : groupEmailsBySender(allEmails);
          console.log(JSON.stringify(grouped, null, 2));
        } else {
          // Output pure JSON for AI consumption
          console.log(JSON.stringify(allEmails, null, 2));
        }
      } catch (error) {
        console.error(JSON.stringify({ error: error.message }));
        process.exit(1);
      }
    }));

  program
    .command('read')
    .description('Read full content of an email')
    .requiredOption('--id <id>', 'Message ID to read')
    .option('-a, --account <name>', 'Account name')
    .option('--json', 'Output as JSON')
    .option('--links', 'Extract and display links from email')
    .option('--unsubscribe', 'Extract unsubscribe details from headers/body')
    .action(wrapAction(async (options) => {
      try {
        const id = options.id.trim();
        if (!id) {
          console.log(chalk.yellow('No message ID provided.'));
          return;
        }

        const { account, error } = resolveAccount(options.account, chalk);
        if (error) {
          console.log(error);
          return;
        }

        if (options.links && options.unsubscribe) {
          console.log(chalk.red('Error: --links and --unsubscribe cannot be used together.'));
          return;
        }

        // When --links or --unsubscribe is used, prefer HTML for better extraction
        const emailOptions = (options.links || options.unsubscribe) ? { preferHtml: true } : {};
        const email = await getEmailContent(account, id, emailOptions);

        if (!email) {
          console.log(chalk.red(`Email ${id} not found in account "${account}".`));
          return;
        }

        if (options.unsubscribe) {
          const unsubInfo = extractUnsubscribeInfo(email.headers, email.body, email.mimeType);
          const primaryLink = unsubInfo.unsubscribeLinks[0] || null;
          const primaryEmail = unsubInfo.unsubscribeEmails[0] || null;
          const preferenceLink = unsubInfo.preferenceLinks[0] || null;

          if (options.json) {
            console.log(JSON.stringify({
              id: email.id,
              subject: email.subject,
              from: email.from,
              unsubscribeLink: primaryLink,
              unsubscribeEmail: primaryEmail,
              oneClick: unsubInfo.oneClick,
              sources: unsubInfo.sources,
              unsubscribeLinks: unsubInfo.unsubscribeLinks,
              unsubscribeEmails: unsubInfo.unsubscribeEmails,
              preferenceLinks: unsubInfo.preferenceLinks,
              headerLinks: unsubInfo.headerLinks,
              bodyLinks: unsubInfo.bodyLinks,
              listUnsubscribe: unsubInfo.listUnsubscribe,
              listUnsubscribePost: unsubInfo.listUnsubscribePost,
            }, null, 2));
            return;
          }

          console.log(chalk.cyan('From: ') + chalk.white(email.from));
          console.log(chalk.cyan('Subject: ') + chalk.white(email.subject));
          console.log(chalk.gray('─'.repeat(50)));

          if (!primaryLink && !primaryEmail && !preferenceLink) {
            console.log(chalk.gray('No unsubscribe information found.'));
            return;
          }

          if (primaryLink) {
            console.log(chalk.bold('\nUnsubscribe link:'));
            console.log(chalk.cyan(`  ${primaryLink}`));
          }
          if (primaryEmail) {
            console.log(chalk.bold('\nUnsubscribe email:'));
            console.log(chalk.cyan(`  ${primaryEmail}`));
          }
          if (preferenceLink) {
            console.log(chalk.bold('\nPreference center:'));
            console.log(chalk.cyan(`  ${preferenceLink}`));
          }

          if (unsubInfo.oneClick) {
            console.log(chalk.gray('\nOne-click unsubscribe supported by sender.'));
          }
          return;
        }

        // If --links flag is used, extract and display links
        if (options.links) {
          const links = extractLinks(email.body, email.mimeType);

          if (options.json) {
            console.log(JSON.stringify({
              id: email.id,
              subject: email.subject,
              from: email.from,
              linkCount: links.length,
              links
            }, null, 2));
            return;
          }

          console.log(chalk.cyan('From: ') + chalk.white(email.from));
          console.log(chalk.cyan('Subject: ') + chalk.white(email.subject));
          console.log(chalk.gray('─'.repeat(50)));

          if (links.length === 0) {
            console.log(chalk.gray('No links found in this email.'));
          } else {
            console.log(chalk.bold(`\nLinks (${links.length}):\n`));
            links.forEach((link, i) => {
              if (link.text) {
                console.log(chalk.white(`${i + 1}. ${link.text}`));
                console.log(chalk.cyan(`   ${link.url}`));
              } else {
                console.log(chalk.cyan(`${i + 1}. ${link.url}`));
              }
            });
          }
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(email, null, 2));
          return;
        }

        console.log(chalk.cyan('From: ') + chalk.white(email.from));
        if (email.to) {
          console.log(chalk.cyan('To: ') + chalk.white(email.to));
        }
        console.log(chalk.cyan('Date: ') + chalk.white(email.date));
        console.log(chalk.cyan('Subject: ') + chalk.white(email.subject));
        console.log(chalk.gray('─'.repeat(50)));
        console.log(email.body || chalk.gray('(No content)'));
        console.log(chalk.gray('─'.repeat(50)));

      } catch (error) {
        console.error(chalk.red('Error reading email:'), error.message);
        process.exit(1);
      }
    }));

  program
    .command('unsubscribe')
    .description('Unsubscribe using List-Unsubscribe headers or body links')
    .requiredOption('--id <id>', 'Message ID to unsubscribe from')
    .option('-a, --account <name>', 'Account name')
    .option('--open', 'Open unsubscribe link in browser')
    .option('--email', 'Send unsubscribe email if available')
    .option('--one-click', 'Send one-click unsubscribe request if supported')
    .option('--confirm', 'Skip confirmation prompt')
    .option('--json', 'Output unsubscribe details as JSON')
    .action(wrapAction(async (options) => {
      try {
        const id = options.id.trim();
        if (!id) {
          console.log(chalk.yellow('No message ID provided.'));
          return;
        }

        if (options.open && options.email) {
          console.log(chalk.red('Error: Use either --open or --email, not both.'));
          return;
        }

        if (options.oneClick && (options.open || options.email)) {
          console.log(chalk.red('Error: --one-click cannot be combined with --open or --email.'));
          return;
        }

        if (options.json && (options.open || options.email)) {
          console.log(chalk.red('Error: --json cannot be combined with --open or --email or --one-click.'));
          return;
        }

        const { account, error } = resolveAccount(options.account, chalk);
        if (error) {
          console.log(error);
          return;
        }

        const email = await getEmailContent(account, id, { preferHtml: true });
        if (!email) {
          console.log(chalk.red(`Email ${id} not found in account "${account}".`));
          return;
        }

        const unsubInfo = extractUnsubscribeInfo(email.headers, email.body, email.mimeType);
        const primaryLink = unsubInfo.unsubscribeLinks[0] || null;
        const primaryEmail = unsubInfo.unsubscribeEmails[0] || null;
        const preferenceLink = unsubInfo.preferenceLinks[0] || null;
        const headerLink = unsubInfo.headerLinks[0] || null;

        if (options.json) {
          console.log(JSON.stringify({
            id: email.id,
            account,
            subject: email.subject,
            from: email.from,
            unsubscribeLink: primaryLink,
            unsubscribeEmail: primaryEmail,
            oneClick: unsubInfo.oneClick,
            sources: unsubInfo.sources,
            unsubscribeLinks: unsubInfo.unsubscribeLinks,
            unsubscribeEmails: unsubInfo.unsubscribeEmails,
            preferenceLinks: unsubInfo.preferenceLinks,
            headerLinks: unsubInfo.headerLinks,
            bodyLinks: unsubInfo.bodyLinks,
            listUnsubscribe: unsubInfo.listUnsubscribe,
            listUnsubscribePost: unsubInfo.listUnsubscribePost,
          }, null, 2));
          return;
        }

        if (!options.open && !options.email && !options.oneClick) {
          if (!primaryLink && !primaryEmail && !preferenceLink) {
            console.log(chalk.gray('No unsubscribe information found.'));
            return;
          }
          console.log(chalk.bold('Unsubscribe options found:'));
          if (primaryLink) {
            console.log(chalk.cyan(`  Link: ${primaryLink}`));
          }
          if (primaryEmail) {
            console.log(chalk.cyan(`  Email: ${primaryEmail}`));
          }
          if (preferenceLink) {
            console.log(chalk.cyan(`  Preferences: ${preferenceLink}`));
          }
          if (unsubInfo.oneClick && headerLink) {
            console.log(chalk.cyan(`  One-click: ${headerLink}`));
          }
          console.log(chalk.gray('\nUse --open to open the link or --email to send an unsubscribe email.'));
          console.log(chalk.gray('Use --one-click to send a one-click unsubscribe request.\n'));
          return;
        }

        if (options.open) {
          const openTarget = primaryLink || preferenceLink;
          if (!openTarget) {
            console.log(chalk.yellow('No unsubscribe or preferences link available for this email.'));
            return;
          }

          if (!options.confirm) {
            const rl = readline.createInterface({
              input: process.stdin,
              output: process.stdout,
            });
            const label = primaryLink ? 'unsubscribe link' : 'preferences link';
            const answer = await prompt(rl, chalk.yellow(`\nOpen ${label}? (y/N): `));
            rl.close();

            if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
              console.log(chalk.gray('Cancelled. Link was not opened.\n'));
              return;
            }
          }

          const open = (await import('open')).default;
          try {
            await open(openTarget);
            if (primaryLink) {
              console.log(chalk.green('\n✓ Unsubscribe link opened in your browser.'));
            } else {
              console.log(chalk.green('\n✓ Preferences link opened in your browser.'));
            }
          } catch (err) {
            console.log(chalk.red(`Failed to open link: ${err.message}`));
          }
          return;
        }

        if (options.oneClick) {
          if (!unsubInfo.oneClick || !headerLink) {
            console.log(chalk.yellow('No one-click unsubscribe link available for this email.'));
            return;
          }

          if (!options.confirm) {
            const rl = readline.createInterface({
              input: process.stdin,
              output: process.stdout,
            });
            const answer = await prompt(
              rl,
              chalk.yellow(`\nSend one-click unsubscribe request to ${headerLink}? (y/N): `)
            );
            rl.close();

            if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
              console.log(chalk.gray('Cancelled. No request sent.\n'));
              return;
            }
          }

          try {
            const response = await fetch(headerLink, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: 'List-Unsubscribe=One-Click',
            });

            if (response.ok) {
              console.log(chalk.green('\n✓ One-click unsubscribe request sent.'));
            } else {
              console.log(chalk.red(`\n✗ One-click request failed (${response.status} ${response.statusText}).`));
              process.exit(1);
            }
          } catch (err) {
            console.log(chalk.red(`\n✗ One-click request failed: ${err.message}`));
            process.exit(1);
          }
          return;
        }

        if (options.email) {
          if (!primaryEmail) {
            console.log(chalk.yellow('No unsubscribe email available for this message.'));
            return;
          }

          const mailto = parseMailtoLink(primaryEmail);
          if (!mailto) {
            console.log(chalk.red('Unable to parse unsubscribe email details.'));
            return;
          }

          const subject = mailto.subject || 'unsubscribe';
          const body = mailto.body || '';

          if (!options.confirm) {
            const rl = readline.createInterface({
              input: process.stdin,
              output: process.stdout,
            });
            const answer = await prompt(
              rl,
              chalk.yellow(`\nSend unsubscribe email to ${mailto.to}? (y/N): `)
            );
            rl.close();

            if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
              console.log(chalk.gray('Cancelled. Unsubscribe email not sent.\n'));
              return;
            }
          }

          console.log(chalk.cyan('\nSending unsubscribe email...'));
          const result = await sendEmail(account, { to: mailto.to, subject, body });

          if (result.success) {
            logSentEmail({
              account,
              to: mailto.to,
              subject,
              body,
              id: result.id,
              threadId: result.threadId,
            });

            console.log(chalk.green('\n✓ Unsubscribe email sent.'));
            console.log(chalk.gray(`  Logged to: ${getSentLogPath()}`));
          } else {
            console.log(chalk.red(`\n✗ Failed to send unsubscribe email: ${result.error}`));
            process.exit(1);
          }
        }
      } catch (error) {
        console.error(chalk.red('Error unsubscribing:'), error.message);
        process.exit(1);
      }
    }));

  program
    .command('thread')
    .description('View thread summary and messages')
    .requiredOption('--id <id>', 'Thread ID to view')
    .option('-a, --account <name>', 'Account name')
    .option('--json', 'Output as JSON')
    .option('--summary', 'Show snippets only (default)')
    .option('--content', 'Include full message bodies')
    .action(wrapAction(async (options) => {
      try {
        const threadId = options.id.trim();
        if (!threadId) {
          console.log(chalk.yellow('No thread ID provided.'));
          return;
        }

        const { account, error } = resolveAccount(options.account, chalk);
        if (error) {
          console.log(error);
          return;
        }

        const includeContent = options.content || false;
        const thread = await getThread(account, threadId, { includeContent });
        if (!thread || thread.messages.length === 0) {
          console.log(chalk.gray('No messages found for this thread.'));
          return;
        }

        const participants = new Set();
        thread.messages.forEach(message => {
          if (message.from) {
            participants.add(message.from);
          }
          if (message.to) {
            participants.add(message.to);
          }
        });

        if (options.json) {
          console.log(JSON.stringify({
            threadId: thread.id,
            messageCount: thread.messages.length,
            participants: Array.from(participants),
            messages: thread.messages,
          }, null, 2));
          return;
        }

        console.log(chalk.bold(`\nThread ${thread.id}`));
        console.log(chalk.gray(`Messages: ${thread.messages.length}`));
        if (participants.size > 0) {
          console.log(chalk.gray(`Participants: ${Array.from(participants).slice(0, 5).join(', ')}`));
        }
        console.log(chalk.gray('─'.repeat(50)));

        thread.messages.forEach((message, index) => {
          const from = message.from ? message.from : '(unknown sender)';
          const subject = message.subject ? message.subject : '(no subject)';
          console.log(chalk.white(`${index + 1}. ${from}`));
          console.log(chalk.gray(`   ${subject}`));
          if (message.date) {
            console.log(chalk.gray(`   ${message.date}`));
          }
          console.log(chalk.gray(`   ID: ${message.id}`));

          // Show content based on flags
          if (includeContent && message.body) {
            console.log(chalk.cyan('\n   --- Message Body ---'));
            // Truncate very long bodies for display
            const body = message.body.length > 1000
              ? message.body.substring(0, 1000) + '...\n   (truncated, use --json for full content)'
              : message.body;
            console.log('   ' + body.split('\n').join('\n   '));
            console.log(chalk.cyan('   --- End Body ---\n'));
          } else {
            // Show snippet (default/summary mode)
            if (message.snippet) {
              console.log(chalk.gray(`   ${message.snippet.substring(0, 100)}${message.snippet.length > 100 ? '...' : ''}`));
            }
          }
          console.log('');
        });
      } catch (error) {
        console.error(chalk.red('Error fetching thread:'), error.message);
        process.exit(1);
      }
    }));

  program
    .command('search')
    .description('Search emails using Gmail query syntax')
    .requiredOption('-q, --query <query>', 'Search query (e.g. "from:boss is:unread")')
    .option('-a, --account <name>', 'Account to search')
    .option('-n, --limit <number>', 'Max results (default: 100)', '100')
    .option('--count', 'Return only count without email details')
    .option('--all', 'Fetch all matching emails (up to --max limit)')
    .option('--max <number>', 'Maximum emails with --all (default: 500)', '500')
    .option('--json', 'Output as JSON')
    .option('--ids-only', 'Output only email IDs, one per line')
    .action(wrapAction(async (options) => {
      try {
        const { account, error } = resolveAccount(options.account, chalk);
        if (error) {
          console.log(error);
          return;
        }

        if (options.idsOnly && options.json) {
          console.log(chalk.red('Error: --ids-only cannot be combined with --json.'));
          return;
        }

        // Handle --count flag (quick count without fetching details)
        if (options.count) {
          if (options.idsOnly) {
            console.log(chalk.red('Error: --ids-only cannot be combined with --count.'));
            return;
          }
          const result = await searchEmailsCount(account, options.query);

          if (options.json) {
            console.log(JSON.stringify({
              account,
              query: options.query,
              estimate: result.estimate,
              isApproximate: result.isApproximate,
              hasMore: result.hasMore,
            }, null, 2));
            return;
          }

          const prefix = result.isApproximate ? '~' : '';
          console.log(chalk.bold(`${prefix}${result.estimate}`) + chalk.gray(` emails matching "${options.query}"${result.hasMore ? ' (more available)' : ''}`));
          return;
        }

        // Handle --all flag (paginated fetch)
        if (options.all) {
          const maxEmails = parseInt(options.max, 10);
          const MAX_WARN = 1000;

          if (maxEmails > MAX_WARN) {
            console.error(chalk.yellow(`Warning: Fetching ${maxEmails} emails may use significant memory`));
          }

          const onProgress = (count) => {
            process.stderr.write(`\rFetched ${count}...`);
          };

          const result = await searchEmailsPaginated(account, options.query, {
            maxResults: maxEmails,
            onProgress,
          });

          // Clear progress line
          process.stderr.write('\r' + ' '.repeat(20) + '\r');

          if (options.idsOnly) {
            const ids = result.emails.map(email => email.id).filter(Boolean);
            console.log(ids.join('\n'));
            return;
          }

          if (options.json) {
            console.log(JSON.stringify({
              account,
              query: options.query,
              totalFetched: result.totalFetched,
              hasMore: result.hasMore,
              emails: result.emails,
            }, null, 2));
            return;
          }

          if (result.emails.length === 0) {
            console.log(chalk.gray('No emails found matching query.'));
            return;
          }

          console.log(chalk.bold(`Fetched ${result.totalFetched} emails matching "${options.query}"${result.hasMore ? ' (more available)' : ''}:\n`));

          result.emails.forEach(e => {
            const from = e.from.length > 35 ? e.from.substring(0, 32) + '...' : e.from;
            const subject = e.subject.length > 50 ? e.subject.substring(0, 47) + '...' : e.subject;
            console.log(chalk.cyan(e.id) + ' ' + chalk.white(from));
            console.log(chalk.gray(`  ${subject}\n`));
          });
          return;
        }

        // Standard search (existing behavior, but with new default limit of 100)
        const limit = parseInt(options.limit, 10);
        const emails = await searchEmails(account, options.query, limit);

        if (options.idsOnly) {
          const ids = emails.map(email => email.id).filter(Boolean);
          console.log(ids.join('\n'));
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(emails, null, 2));
          return;
        }

        if (emails.length === 0) {
          console.log(chalk.gray('No emails found matching query.'));
          return;
        }

        console.log(chalk.bold(`Found ${emails.length} emails matching "${options.query}":\n`));

        emails.forEach(e => {
          const from = e.from.length > 35 ? e.from.substring(0, 32) + '...' : e.from;
          const subject = e.subject.length > 50 ? e.subject.substring(0, 47) + '...' : e.subject;
          console.log(chalk.cyan(e.id) + ' ' + chalk.white(from));
          console.log(chalk.gray(`  ${subject}\n`));
        });

      } catch (error) {
        console.error(chalk.red('Error searching emails:'), error.message);
        process.exit(1);
      }
    }));

  program
    .command('send')
    .description('Send an email')
    .requiredOption('-t, --to <email>', 'Recipient email')
    .requiredOption('-s, --subject <subject>', 'Email subject')
    .requiredOption('-b, --body <body>', 'Email body text')
    .option('-a, --account <name>', 'Account to send from')
    .option('--dry-run', 'Preview the email without sending')
    .option('--confirm', 'Skip confirmation prompt')
    .action(wrapAction(async (options) => {
      try {
        const { account, error } = resolveAccount(options.account, chalk);
        if (error) {
          console.log(error);
          return;
        }

        // Get account email for display
        const accountInfo = getAccounts().find(a => a.name === account);
        const fromEmail = accountInfo?.email || account;

        // Always show preview
        console.log(chalk.bold('\nEmail to send:\n'));
        console.log(chalk.cyan('From: ') + chalk.white(fromEmail));
        console.log(chalk.cyan('To: ') + chalk.white(options.to));
        console.log(chalk.cyan('Subject: ') + chalk.white(options.subject));
        console.log(chalk.gray('─'.repeat(50)));
        console.log(options.body);
        console.log(chalk.gray('─'.repeat(50)));

        if (options.dryRun) {
          console.log(chalk.yellow('\nDry run: Email was not sent.'));
          return;
        }

        if (!options.confirm) {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });

          const answer = await prompt(rl, chalk.yellow('\nSend this email? (y/N): '));
          rl.close();

          if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
            console.log(chalk.gray('Cancelled. Email was not sent.\n'));
            return;
          }
        }

        console.log(chalk.cyan('\nSending...'));

        const result = await sendEmail(account, {
          to: options.to,
          subject: options.subject,
          body: options.body
        });

        if (result.success) {
          // Log the sent email
          logSentEmail({
            account,
            to: options.to,
            subject: options.subject,
            body: options.body,
            id: result.id,
            threadId: result.threadId
          });

          console.log(chalk.green(`\n✓ Email sent successfully!`));
          console.log(chalk.gray(`  ID: ${result.id}`));
          console.log(chalk.gray(`  Logged to: ${getSentLogPath()}`));
        } else {
          console.log(chalk.red(`\n✗ Failed to send email: ${result.error}`));
          process.exit(1);
        }
      } catch (error) {
        console.error(chalk.red('Error sending email:'), error.message);
        process.exit(1);
      }
    }));

  program
    .command('reply')
    .description('Reply to an email')
    .requiredOption('--id <id>', 'Message ID to reply to')
    .requiredOption('-b, --body <body>', 'Reply body text')
    .option('-a, --account <name>', 'Account to reply from')
    .option('--dry-run', 'Preview the reply without sending')
    .option('--confirm', 'Skip confirmation prompt')
    .action(wrapAction(async (options) => {
      try {
        const { account, error } = resolveAccount(options.account, chalk);
        if (error) {
          console.log(error);
          return;
        }

        // Fetch original email to show context
        const original = await getEmailContent(account, options.id);
        if (!original) {
          console.log(chalk.red(`Email ${options.id} not found in account "${account}".`));
          return;
        }

        // Build the subject we'll use
        const replySubject = original.subject.toLowerCase().startsWith('re:')
          ? original.subject
          : `Re: ${original.subject}`;

        // Show preview
        console.log(chalk.bold('\nReply to:\n'));
        console.log(chalk.gray('Original from: ') + chalk.white(original.from));
        console.log(chalk.gray('Original subject: ') + chalk.white(original.subject));
        console.log(chalk.gray('─'.repeat(50)));
        console.log(chalk.bold('\nYour reply:\n'));
        console.log(chalk.cyan('To: ') + chalk.white(original.from));
        console.log(chalk.cyan('Subject: ') + chalk.white(replySubject));
        console.log(chalk.gray('─'.repeat(50)));
        console.log(options.body);
        console.log(chalk.gray('─'.repeat(50)));

        if (options.dryRun) {
          console.log(chalk.yellow('\nDry run: Reply was not sent.'));
          return;
        }

        if (!options.confirm) {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });

          const answer = await prompt(rl, chalk.yellow('\nSend this reply? (y/N): '));
          rl.close();

          if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
            console.log(chalk.gray('Cancelled. Reply was not sent.\n'));
            return;
          }
        }

        console.log(chalk.cyan('\nSending reply...'));

        const result = await replyToEmail(account, options.id, options.body);

        if (result.success) {
          // Log the sent reply
          logSentEmail({
            account,
            to: original.from,
            subject: replySubject,
            body: options.body,
            id: result.id,
            threadId: result.threadId,
            replyToId: options.id
          });

          console.log(chalk.green(`\n✓ Reply sent successfully!`));
          console.log(chalk.gray(`  ID: ${result.id}`));
          console.log(chalk.gray(`  Logged to: ${getSentLogPath()}`));
        } else {
          console.log(chalk.red(`\n✗ Failed to send reply: ${result.error}`));
          process.exit(1);
        }
      } catch (error) {
        console.error(chalk.red('Error replying:'), error.message);
        process.exit(1);
      }
    }));

  program
    .command('delete')
    .description('Move emails to trash')
    .option('--ids <ids>', 'Comma-separated message IDs to delete')
    .option('--ids-stdin', 'Read message IDs from stdin')
    .option('--thread <id>', 'Delete all messages in a thread')
    .option('--sender <pattern>', 'Filter by sender (case-insensitive substring)')
    .option('--match <pattern>', 'Filter by subject (case-insensitive substring)')
    .option('-a, --account <name>', 'Account name (or "all" for filter-based deletion)', 'all')
    .option('--limit <number>', 'Max emails when using filters (default: 50)', '50')
    .option('--confirm', 'Skip confirmation prompt')
    .option('--dry-run', 'Show what would be deleted without deleting')
    .option('--force', 'Override safety warnings (required for short patterns or large matches)')
    .option('--json', 'Output as JSON (for --dry-run)')
    .action(wrapAction(async (options) => {
      try {
        let emailsToDelete = [];
        const limit = parseInt(options.limit, 10);
        const idsFromStdin = options.idsStdin ? readIdsFromStdin() : null;

        if (options.ids && options.idsStdin) {
          console.log(chalk.red('Error: Use either --ids or --ids-stdin, not both.'));
          return;
        }

        if (options.thread && (options.ids || options.idsStdin)) {
          console.log(chalk.red('Error: --thread cannot be combined with --ids or --ids-stdin.'));
          return;
        }

        // Scenario A: Thread provided
        if (options.thread) {
          const threadId = options.thread.trim();
          if (!threadId) {
            console.log(chalk.yellow('No thread ID provided.'));
            return;
          }

          // Get account for thread-based deletion
          let account = options.account === 'all' ? null : options.account;
          if (!account) {
            const accounts = getAccounts();
            if (accounts.length === 1) {
              account = accounts[0].name;
            } else if (accounts.length > 1) {
              console.log(chalk.yellow('Multiple accounts configured. Please specify --account <name>'));
              console.log(chalk.gray('Available accounts:'));
              accounts.forEach(a => console.log(chalk.gray(`  - ${a.name}`)));
              return;
            } else {
              account = 'default';
            }
          }

          console.log(chalk.cyan(`Fetching thread ${threadId} for deletion...`));
          const thread = await getThread(account, threadId);

          if (!thread || thread.messages.length === 0) {
            console.log(chalk.yellow('No emails found for this thread.'));
            return;
          }

          emailsToDelete = thread.messages.map(message => ({
            ...message,
            account,
          }));

          // Apply optional filters to thread selection
          if (options.sender || options.match) {
            emailsToDelete = emailsToDelete.filter(e => {
              const matchesSender = !options.sender ||
                e.from.toLowerCase().includes(options.sender.toLowerCase());
              const matchesSubject = !options.match ||
                e.subject.toLowerCase().includes(options.match.toLowerCase());
              return matchesSender && matchesSubject;
            });
          }
        }
        // Scenario B: IDs provided (explicit or via stdin)
        else if (options.ids || options.idsStdin) {
          const ids = options.ids
            ? options.ids.split(',').map(id => id.trim()).filter(Boolean)
            : (idsFromStdin || []);

          if (ids.length === 0) {
            console.log(chalk.yellow('No message IDs provided.'));
            return;
          }

          // Get account for ID-based deletion
          let account = options.account === 'all' ? null : options.account;
          if (!account) {
            const accounts = getAccounts();
            if (accounts.length === 1) {
              account = accounts[0].name;
            } else if (accounts.length > 1) {
              console.log(chalk.yellow('Multiple accounts configured. Please specify --account <name>'));
              console.log(chalk.gray('Available accounts:'));
              accounts.forEach(a => console.log(chalk.gray(`  - ${a.name}`)));
              return;
            } else {
              account = 'default';
            }
          }

          // Fetch email details for logging before deletion
          console.log(chalk.cyan(`Fetching ${ids.length} email(s) for deletion...`));

          for (const id of ids) {
            const email = await getEmailById(account, id);
            if (email) {
              emailsToDelete.push(email);
            } else {
              console.log(chalk.yellow(`Could not find email with ID: ${id}`));
            }
          }

          // Apply optional filters to ID-based selection
          if (options.sender || options.match) {
            emailsToDelete = emailsToDelete.filter(e => {
              const matchesSender = !options.sender ||
                e.from.toLowerCase().includes(options.sender.toLowerCase());
              const matchesSubject = !options.match ||
                e.subject.toLowerCase().includes(options.match.toLowerCase());
              return matchesSender && matchesSubject;
            });
          }
        }
        // Scenario C: No IDs, use filters to find emails
        else if (options.sender || options.match) {
          // Determine accounts
          let accountNames;
          if (options.account === 'all') {
            const accounts = getAccounts();
            accountNames = accounts.length > 0 ? accounts.map(a => a.name) : ['default'];
          } else {
            accountNames = [options.account];
          }

          console.log(chalk.cyan(`Searching for emails matching filters...`));

          // Fetch and filter from each account
          for (const accountName of accountNames) {
            const emails = await getUnreadEmails(accountName, limit);
            const filtered = emails.filter(e => {
              const matchesSender = !options.sender ||
                e.from.toLowerCase().includes(options.sender.toLowerCase());
              const matchesSubject = !options.match ||
                e.subject.toLowerCase().includes(options.match.toLowerCase());
              return matchesSender && matchesSubject;
            });
            emailsToDelete.push(...filtered);
          }

          // Enforce safety limit
          if (emailsToDelete.length > limit) {
            console.log(chalk.yellow(`Found ${emailsToDelete.length} emails. Limiting to ${limit}.`));
            console.log(chalk.gray(`Use --limit N to increase.`));
            emailsToDelete = emailsToDelete.slice(0, limit);
          }

          if (emailsToDelete.length === 0) {
            console.log(chalk.yellow('No emails found matching filters.'));
            return;
          }
        }
        // Scenario D: Neither IDs nor filters - error
        else {
          console.log(chalk.red('Error: Must specify --ids, --ids-stdin, --thread, or filter flags (--sender, --match)'));
          console.log(chalk.gray('Examples:'));
          console.log(chalk.gray('  inboxd delete --ids "id1,id2" --confirm'));
          console.log(chalk.gray('  inboxd delete --ids-stdin --confirm'));
          console.log(chalk.gray('  inboxd delete --thread <threadId> --confirm'));
          console.log(chalk.gray('  inboxd delete --sender "linkedin" --dry-run'));
          console.log(chalk.gray('  inboxd delete --sender "newsletter" --match "weekly" --confirm'));
          return;
        }

        if (emailsToDelete.length === 0) {
          console.log(chalk.yellow('No valid emails found to delete.'));
          return;
        }

        // Safety warnings for filter-based deletion
        if (!options.ids && !options.idsStdin && !options.thread && (options.sender || options.match)) {
          const warnings = [];

          if (options.sender && options.sender.length < 3) {
            warnings.push(`Short sender pattern "${options.sender}" may match broadly`);
          }
          if (options.match && options.match.length < 3) {
            warnings.push(`Short subject pattern "${options.match}" may match broadly`);
          }
          if (emailsToDelete.length > 100) {
            warnings.push(`${emailsToDelete.length} emails match - large batch deletion`);
          }

          // If warnings exist and no --force, block execution
          if (warnings.length > 0 && !options.force) {
            console.log(chalk.yellow('\n⚠️  Safety warnings:'));
            warnings.forEach(w => console.log(chalk.yellow(`   - ${w}`)));
            console.log(chalk.gray('\nUse --force to proceed anyway, or narrow your filters.'));
            return;
          }
        }

        // Always show preview for filter-based deletion (even with --confirm)
        const isFilterBased = !options.ids && !options.idsStdin && !options.thread && (options.sender || options.match);
        if (isFilterBased || !options.confirm || options.dryRun) {
          console.log(chalk.bold('\nEmails to be moved to trash:\n'));
          emailsToDelete.forEach(e => {
            const from = e.from.length > 40 ? e.from.substring(0, 37) + '...' : e.from;
            const subject = e.subject.length > 50 ? e.subject.substring(0, 47) + '...' : e.subject;
            const accountTag = e.account ? chalk.gray(`[${e.account}] `) : '';
            console.log(chalk.white(`  ${accountTag}${from}`));
            console.log(chalk.gray(`    ${subject}\n`));
          });

          if (options.dryRun) {
            if (options.json) {
              console.log(JSON.stringify({
                dryRun: true,
                count: emailsToDelete.length,
                emails: emailsToDelete.map(e => ({
                  id: e.id,
                  account: e.account || 'default',
                  from: e.from,
                  subject: e.subject,
                  date: e.date
                }))
              }, null, 2));
              return;
            }
            console.log(chalk.yellow(`\nDry run: ${emailsToDelete.length} email(s) would be deleted.`));
            // Output IDs for programmatic use
            console.log(chalk.gray(`\nIDs: ${emailsToDelete.map(e => e.id).join(',')}`));
            return;
          }

          console.log(chalk.yellow(`\nThis will move ${emailsToDelete.length} email(s) to trash.`));
          console.log(chalk.gray('Use --confirm to skip this prompt.\n'));
        }

        // Group emails by account for deletion
        const emailsByAccount = {};
        for (const email of emailsToDelete) {
          const acc = email.account || 'default';
          if (!emailsByAccount[acc]) {
            emailsByAccount[acc] = [];
          }
          emailsByAccount[acc].push(email);
        }

        // Log deletions BEFORE actually deleting
        logDeletions(emailsToDelete);
        console.log(chalk.gray(`Logged to: ${getLogPath()}`));

        // Perform the deletion for each account
        let totalSucceeded = 0;
        let totalFailed = 0;
        const successfulEmails = [];

        for (const [accountName, emails] of Object.entries(emailsByAccount)) {
          const results = await trashEmails(accountName, emails.map(e => e.id));
          const succeeded = results.filter(r => r.success);
          const failed = results.filter(r => !r.success);
          const succeededIds = new Set(succeeded.map(r => r.id));
          successfulEmails.push(...emails.filter(email => succeededIds.has(email.id)));

          totalSucceeded += succeeded.length;
          totalFailed += failed.length;

          if (failed.length > 0) {
            failed.forEach(r => {
              console.log(chalk.red(`  - ${r.id}: ${r.error}`));
            });
          }
        }

        if (successfulEmails.length > 0) {
          logUndoAction('delete', successfulEmails);
          console.log(chalk.gray(`Undo log: ${getUndoLogPath()}`));
        }

        if (totalSucceeded > 0) {
          console.log(chalk.green(`\nMoved ${totalSucceeded} email(s) to trash.`));
          console.log(chalk.gray(`Tip: Use 'inboxd restore --last ${totalSucceeded}' to undo.`));
        }
        if (totalFailed > 0) {
          console.log(chalk.red(`Failed to delete ${totalFailed} email(s).`));
        }

      } catch (error) {
        if (error.message.includes('403') || error.code === 403) {
          console.error(chalk.red('Permission denied. You may need to re-authenticate with updated scopes.'));
          console.error(chalk.yellow('Run: node src/cli.js auth'));
        } else {
          console.error(chalk.red('Error deleting emails:'), error.message);
        }
        process.exit(1);
      }
    }));

  program
    .command('deletion-log')
    .description('View recent email deletions')
    .option('-n, --days <number>', 'Show deletions from last N days', '30')
    .option('--json', 'Output as JSON')
    .action(wrapAction(async (options) => {
      const days = parseInt(options.days, 10);
      const deletions = getRecentDeletions(days);

      if (options.json) {
        console.log(JSON.stringify({
          days,
          count: deletions.length,
          logPath: getLogPath(),
          deletions
        }, null, 2));
        return;
      }

      if (deletions.length === 0) {
        console.log(chalk.gray(`No deletions in the last ${days} days.`));
        console.log(chalk.gray(`Log file: ${getLogPath()}`));
        return;
      }

      console.log(chalk.bold(`\nDeletion Log (last ${days} days):\n`));

      // Group by date
      const byDate = {};
      deletions.forEach(d => {
        const date = new Date(d.deletedAt).toLocaleDateString();
        if (!byDate[date]) byDate[date] = [];
        byDate[date].push(d);
      });

      for (const [date, items] of Object.entries(byDate)) {
        console.log(chalk.cyan(`${date} (${items.length} deleted)`));
        items.forEach(d => {
          const from = d.from.length > 35 ? d.from.substring(0, 32) + '...' : d.from;
          const subject = d.subject.length > 45 ? d.subject.substring(0, 42) + '...' : d.subject;
          console.log(chalk.white(`  ${from}`));
          console.log(chalk.gray(`    ${subject}`));
          console.log(chalk.gray(`    ID: ${d.id} | Account: ${d.account}\n`));
        });
      }

      console.log(chalk.gray(`\nLog file: ${getLogPath()}`));
    }));

  program
    .command('stats')
    .description('Show email activity statistics')
    .option('-n, --days <number>', 'Period in days', '30')
    .option('--json', 'Output as JSON')
    .action(wrapAction(async (options) => {
      const days = parseInt(options.days, 10);
      const deletionStats = getDeletionStats(days);
      const sentStats = getSentStats(days);

      if (options.json) {
        console.log(JSON.stringify({
          period: days,
          deleted: deletionStats,
          sent: sentStats,
        }, null, 2));
        return;
      }

      console.log(boxen(chalk.bold(`Email Activity (Last ${days} days)`), {
        padding: { left: 1, right: 1, top: 0, bottom: 0 },
        borderStyle: 'round',
        borderColor: 'cyan',
      }));

      // Deletion stats
      console.log(chalk.bold('\nDeleted: ') + chalk.white(`${deletionStats.total} emails`));

      if (deletionStats.total > 0) {
        // By account
        const accountEntries = Object.entries(deletionStats.byAccount);
        if (accountEntries.length > 0) {
          const accountStr = accountEntries.map(([acc, cnt]) => `${acc} (${cnt})`).join(', ');
          console.log(chalk.gray(`  By account: ${accountStr}`));
        }

        // Top senders
        if (deletionStats.topSenders.length > 0) {
          const senderStr = deletionStats.topSenders
            .slice(0, 5)
            .map(s => `${s.domain} (${s.count})`)
            .join(', ');
          console.log(chalk.gray(`  Top senders: ${senderStr}`));
        }
      }

      // Sent stats
      console.log(chalk.bold('\nSent: ') + chalk.white(`${sentStats.total} emails`));

      if (sentStats.total > 0) {
        console.log(chalk.gray(`  Replies: ${sentStats.replies}, New: ${sentStats.newEmails}`));

        const accountEntries = Object.entries(sentStats.byAccount);
        if (accountEntries.length > 1) {
          const accountStr = accountEntries.map(([acc, cnt]) => `${acc} (${cnt})`).join(', ');
          console.log(chalk.gray(`  By account: ${accountStr}`));
        }
      }

      console.log('');
    }));

  program
    .command('usage')
    .description('Show local command usage analytics')
    .option('--json', 'Output as JSON')
    .option('--since <duration>', 'Only include usage from last N days/hours/minutes (e.g., "7d", "24h", "60m")')
    .option('--clear', 'Clear usage log')
    .option('--export', 'Export raw usage log (JSONL) to stdout')
    .action(wrapAction(async (options) => {
      if (options.clear && options.export) {
        console.log(chalk.red('Error: --clear and --export cannot be used together.'));
        return;
      }

      if (options.clear) {
        clearUsageLog();
        console.log(chalk.green('Usage log cleared.'));
        return;
      }

      const logPath = getUsagePath();
      if (options.export) {
        if (fs.existsSync(logPath)) {
          process.stdout.write(fs.readFileSync(logPath, 'utf8'));
        }
        return;
      }

      let cutoff = null;
      if (options.since) {
        const parsed = parseSinceDuration(options.since);
        if (!parsed) {
          console.log(chalk.red('Invalid --since format. Use values like "7d", "24h", "60m".'));
          return;
        }
        cutoff = parsed;
      }

      const stats = getUsageStats(cutoff || 30);
      const periodLabel = options.since ? `Last ${options.since}` : 'Last 30 days';

      let totalEntries = 0;
      if (fs.existsSync(logPath)) {
        const content = fs.readFileSync(logPath, 'utf8');
        totalEntries = content.split(/\r?\n/).filter(Boolean).length;
      }

      if (options.json) {
        const payload = {
          periodDays: options.since ? null : 30,
          since: stats.since,
          total: stats.total,
          success: stats.success,
          failure: stats.failure,
          commands: stats.byCommand,
          flags: stats.byFlag,
          logPath,
          entries: totalEntries,
        };
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      console.log(boxen(chalk.bold(`Command Usage (${periodLabel})`), {
        padding: { left: 1, right: 1, top: 0, bottom: 0 },
        borderStyle: 'round',
        borderColor: 'cyan',
      }));

      if (stats.total === 0) {
        console.log(chalk.gray('\nNo usage data yet.\n'));
        console.log(chalk.gray(`Log file: ${logPath}`));
        return;
      }

      const commandEntries = Object.entries(stats.byCommand)
        .sort((a, b) => b[1] - a[1]);

      console.log(chalk.bold('\nTop commands:'));
      commandEntries.slice(0, 10).forEach(([cmd, count], index) => {
        const percent = Math.round((count / stats.total) * 100);
        console.log(`  ${index + 1}. ${cmd.padEnd(12)} ${count} (${percent}%)`);
      });

      const allCommands = program.commands
        .map(cmd => cmd.name())
        .filter(name => name !== 'usage');
      const usedCommands = new Set(Object.keys(stats.byCommand));
      const neverUsed = allCommands.filter(name => !usedCommands.has(name));

      if (neverUsed.length > 0) {
        console.log(chalk.bold('\nNever used:'));
        neverUsed.slice(0, 10).forEach((cmd) => {
          console.log(`  - ${cmd}`);
        });
      }

      const flagEntries = Object.entries(stats.byFlag)
        .sort((a, b) => b[1].count - a[1].count);

      if (flagEntries.length > 0) {
        console.log(chalk.bold('\nFlags usage:'));
        flagEntries.slice(0, 10).forEach(([flag, data]) => {
          const commandLabel = data.commands
            ? ` (across ${data.commands} command${data.commands === 1 ? '' : 's'})`
            : '';
          console.log(`  ${flag.padEnd(14)} ${data.count} times${commandLabel}`);
        });
      }

      console.log(chalk.gray(`\nLog file: ${logPath} (${totalEntries.toLocaleString()} entries)`));
    }));

  program
    .command('cleanup-suggest')
    .description('Get smart cleanup suggestions based on deletion patterns')
    .option('-n, --days <number>', 'Period to analyze', '30')
    .option('--json', 'Output as JSON')
    .action(wrapAction(async (options) => {
      const days = parseInt(options.days, 10);
      const analysis = analyzePatterns(days);

      if (options.json) {
        console.log(JSON.stringify(analysis, null, 2));
        return;
      }

      console.log(boxen(chalk.bold('Cleanup Suggestions'), {
        padding: { left: 1, right: 1, top: 0, bottom: 0 },
        borderStyle: 'round',
        borderColor: 'cyan',
      }));

      if (analysis.totalDeleted === 0) {
        console.log(chalk.gray(`\nNo deletions in the last ${days} days to analyze.\n`));
        return;
      }

      console.log(chalk.gray(`\nBased on ${analysis.totalDeleted} deletions in the last ${days} days:\n`));

      // Frequent deleters
      if (analysis.frequentDeleters.length > 0) {
        console.log(chalk.bold('You frequently delete emails from:'));
        analysis.frequentDeleters.slice(0, 5).forEach(sender => {
          console.log(chalk.yellow(`  ${sender.domain}`) + chalk.gray(` (${sender.deletedCount} deleted this month)`));
          console.log(chalk.cyan(`    → ${sender.suggestion}`));
        });
        console.log('');
      }

      // Never-read senders
      if (analysis.neverReadSenders.length > 0) {
        console.log(chalk.bold('Never-read senders (deleted unread):'));
        analysis.neverReadSenders.slice(0, 5).forEach(sender => {
          console.log(chalk.yellow(`  ${sender.domain}`) + chalk.gray(` (${sender.deletedCount} emails)`));
          console.log(chalk.cyan(`    → ${sender.suggestion}`));
        });
        console.log('');
      }

      if (analysis.frequentDeleters.length === 0 && analysis.neverReadSenders.length === 0) {
        console.log(chalk.gray('No strong patterns detected. Your inbox management looks good!\n'));
      }

      // Helpful tip
      console.log(chalk.gray('Tip: Use these commands to act on suggestions:'));
      console.log(chalk.gray('  inboxd delete --sender "domain.com" --dry-run'));
      console.log(chalk.gray('  inboxd search -q "from:sender@domain.com"\n'));
      console.log(chalk.gray('Tip: Apply saved rules automatically:'));
      console.log(chalk.gray('  inboxd cleanup-auto --dry-run --account personal --limit 50'));
      console.log(chalk.gray('  inboxd rules apply --dry-run --account personal --limit 50\n'));
    }));

  program
    .command('cleanup-auto')
    .description('Apply saved rules to automatically clean up your inbox')
    .option('-a, --account <name>', 'Account to apply rules (or "all")', 'all')
    .option('--limit <number>', 'Max emails per rule per account (default: 50)', '50')
    .option('--dry-run', 'Preview what would be deleted/archived')
    .option('--confirm', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON')
    .action(applyRulesAction);

  program
    .command('restore')
    .description('Restore deleted emails from trash')
    .option('--ids <ids>', 'Comma-separated message IDs to restore')
    .option('--last <number>', 'Restore the N most recent deletions', parseInt)
    .option('--json', 'Output as JSON')
    .action(wrapAction(async (options) => {
      try {
        let emailsToRestore = [];

        // Scenario 1: Restore by explicit IDs
        if (options.ids) {
          const ids = options.ids.split(',').map(id => id.trim()).filter(Boolean);
          const log = readLog();

          for (const id of ids) {
            // Find in log first to get the account
            const entry = log.find(e => e.id === id);
            if (entry) {
              emailsToRestore.push(entry);
            } else {
              console.log(chalk.yellow(`Warning: ID ${id} not found in local deletion log.`));
              console.log(chalk.gray(`Cannot determine account automatically. Please restore manually via Gmail web interface.`));
            }
          }
        }
        // Scenario 2: Restore last N items
        else if (options.last) {
          const count = options.last;
          const deletions = getRecentDeletions(30); // Look back 30 days
          // Sort by deletedAt desc just in case
          deletions.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));

          emailsToRestore = deletions.slice(0, count);
        } else {
          console.log(chalk.red('Error: Must specify either --ids or --last'));
          console.log(chalk.gray('Examples:'));
          console.log(chalk.gray('  inboxd restore --last 1'));
          console.log(chalk.gray('  inboxd restore --ids 12345,67890'));
          return;
        }

        if (emailsToRestore.length === 0) {
          console.log(chalk.yellow('No emails found to restore.'));
          return;
        }

        console.log(chalk.cyan(`Attempting to restore ${emailsToRestore.length} email(s)...`));

        // Group by account to batch API calls
        const byAccount = {};
        for (const email of emailsToRestore) {
          if (!byAccount[email.account]) {
            byAccount[email.account] = [];
          }
          byAccount[email.account].push(email);
        }

        const successfulIds = [];

        for (const [account, emails] of Object.entries(byAccount)) {
          const ids = emails.map(e => e.id);
          console.log(chalk.gray(`Restoring ${ids.length} email(s) for account "${account}"...`));

          const results = await untrashEmails(account, ids);

          const succeeded = results.filter(r => r.success);
          const failed = results.filter(r => !r.success);

          if (succeeded.length > 0) {
            console.log(chalk.green(`  ✓ Restored ${succeeded.length} email(s)`));
            successfulIds.push(...succeeded.map(r => r.id));
          }

          if (failed.length > 0) {
            console.log(chalk.red(`  ✗ Failed to restore ${failed.length} email(s)`));
            failed.forEach(r => {
              console.log(chalk.gray(`    - ID ${r.id}: ${r.error}`));
            });
          }
        }

        // Clean up log
        if (successfulIds.length > 0) {
          removeLogEntries(successfulIds);
          if (!options.json) {
            console.log(chalk.gray(`\nRemoved ${successfulIds.length} entries from deletion log.`));
          }
        }

        // JSON output at the end
        if (options.json) {
          const allResults = [];
          for (const [account, emails] of Object.entries(byAccount)) {
            const ids = emails.map(e => e.id);
            emails.forEach(e => {
              const wasSuccessful = successfulIds.includes(e.id);
              allResults.push({
                id: e.id,
                account,
                from: e.from,
                subject: e.subject,
                success: wasSuccessful
              });
            });
          }
          console.log(JSON.stringify({
            restored: successfulIds.length,
            failed: emailsToRestore.length - successfulIds.length,
            results: allResults
          }, null, 2));
        }

      } catch (error) {
        if (options.json) {
          console.log(JSON.stringify({ error: error.message }, null, 2));
        } else {
          console.error(chalk.red('Error restoring emails:'), error.message);
        }
        process.exit(1);
      }
    }));

  program
    .command('mark-read')
    .description('Mark emails as read')
    .option('--ids <ids>', 'Comma-separated message IDs to mark as read')
    .option('--ids-stdin', 'Read message IDs from stdin')
    .option('-a, --account <name>', 'Account name')
    .action(wrapAction(async (options) => {
      try {
        const idsFromStdin = options.idsStdin ? readIdsFromStdin() : null;

        if (options.ids && options.idsStdin) {
          console.log(chalk.red('Error: Use either --ids or --ids-stdin, not both.'));
          return;
        }

        const ids = options.ids
          ? options.ids.split(',').map(id => id.trim()).filter(Boolean)
          : (idsFromStdin || []);

        if (ids.length === 0) {
          console.log(chalk.yellow('No message IDs provided.'));
          return;
        }

        // Get account - if not specified, try to find from configured accounts
        let account = options.account;
        if (!account) {
          const accounts = getAccounts();
          if (accounts.length === 1) {
            account = accounts[0].name;
          } else if (accounts.length > 1) {
            console.log(chalk.yellow('Multiple accounts configured. Please specify --account <name>'));
            console.log(chalk.gray('Available accounts:'));
            accounts.forEach(a => console.log(chalk.gray(`  - ${a.name}`)));
            return;
          } else {
            account = 'default';
          }
        }

        console.log(chalk.cyan(`Marking ${ids.length} email(s) as read...`));

        const results = await markAsRead(account, ids);

        const succeeded = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        if (succeeded > 0) {
          console.log(chalk.green(`\nMarked ${succeeded} email(s) as read.`));
        }
        if (failed > 0) {
          console.log(chalk.red(`Failed to mark ${failed} email(s) as read.`));
          results.filter(r => !r.success).forEach(r => {
            console.log(chalk.red(`  - ${r.id}: ${r.error}`));
          });
        }

      } catch (error) {
        if (error.message.includes('403') || error.code === 403) {
          console.error(chalk.red('Permission denied. You may need to re-authenticate with updated scopes.'));
          console.error(chalk.yellow('Run: inboxd auth -a <account>'));
        } else {
          console.error(chalk.red('Error marking emails as read:'), error.message);
        }
        process.exit(1);
      }
    }));

  program
    .command('mark-unread')
    .description('Mark emails as unread')
    .option('--ids <ids>', 'Comma-separated message IDs to mark as unread')
    .option('--ids-stdin', 'Read message IDs from stdin')
    .option('-a, --account <name>', 'Account name')
    .action(wrapAction(async (options) => {
      try {
        const idsFromStdin = options.idsStdin ? readIdsFromStdin() : null;

        if (options.ids && options.idsStdin) {
          console.log(chalk.red('Error: Use either --ids or --ids-stdin, not both.'));
          return;
        }

        const ids = options.ids
          ? options.ids.split(',').map(id => id.trim()).filter(Boolean)
          : (idsFromStdin || []);

        if (ids.length === 0) {
          console.log(chalk.yellow('No message IDs provided.'));
          return;
        }

        // Get account - if not specified, try to find from configured accounts
        let account = options.account;
        if (!account) {
          const accounts = getAccounts();
          if (accounts.length === 1) {
            account = accounts[0].name;
          } else if (accounts.length > 1) {
            console.log(chalk.yellow('Multiple accounts configured. Please specify --account <name>'));
            console.log(chalk.gray('Available accounts:'));
            accounts.forEach(a => console.log(chalk.gray(`  - ${a.name}`)));
            return;
          } else {
            account = 'default';
          }
        }

        console.log(chalk.cyan(`Marking ${ids.length} email(s) as unread...`));

        const results = await markAsUnread(account, ids);

        const succeeded = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        if (succeeded > 0) {
          console.log(chalk.green(`\nMarked ${succeeded} email(s) as unread.`));
        }
        if (failed > 0) {
          console.log(chalk.red(`Failed to mark ${failed} email(s) as unread.`));
          results.filter(r => !r.success).forEach(r => {
            console.log(chalk.red(`  - ${r.id}: ${r.error}`));
          });
        }

      } catch (error) {
        if (error.message.includes('403') || error.code === 403) {
          console.error(chalk.red('Permission denied. You may need to re-authenticate with updated scopes.'));
          console.error(chalk.yellow('Run: inboxd auth -a <account>'));
        } else {
          console.error(chalk.red('Error marking emails as unread:'), error.message);
        }
        process.exit(1);
      }
    }));

  program
    .command('archive')
    .description('Archive emails (remove from inbox, keep in All Mail)')
    .option('--ids <ids>', 'Comma-separated message IDs to archive')
    .option('--ids-stdin', 'Read message IDs from stdin')
    .option('--thread <id>', 'Archive all messages in a thread')
    .option('-a, --account <name>', 'Account name')
    .option('--confirm', 'Skip confirmation prompt')
    .action(wrapAction(async (options) => {
      try {
        const idsFromStdin = options.idsStdin ? readIdsFromStdin() : null;

        if (options.ids && options.idsStdin) {
          console.log(chalk.red('Error: Use either --ids or --ids-stdin, not both.'));
          return;
        }

        if (options.thread && (options.ids || options.idsStdin)) {
          console.log(chalk.red('Error: --thread cannot be combined with --ids or --ids-stdin.'));
          return;
        }

        // Get account - if not specified, try to find from configured accounts
        let account = options.account;
        if (!account) {
          const accounts = getAccounts();
          if (accounts.length === 1) {
            account = accounts[0].name;
          } else if (accounts.length > 1) {
            console.log(chalk.yellow('Multiple accounts configured. Please specify --account <name>'));
            console.log(chalk.gray('Available accounts:'));
            accounts.forEach(a => console.log(chalk.gray(`  - ${a.name}`)));
            return;
          } else {
            account = 'default';
          }
        }

        const emailsToArchive = [];

        if (options.thread) {
          const threadId = options.thread.trim();
          if (!threadId) {
            console.log(chalk.yellow('No thread ID provided.'));
            return;
          }

          console.log(chalk.cyan(`Fetching thread ${threadId} for archiving...`));
          const thread = await getThread(account, threadId);
          if (!thread || thread.messages.length === 0) {
            console.log(chalk.yellow('No emails found for this thread.'));
            return;
          }

          emailsToArchive.push(...thread.messages.map(message => ({ ...message, account })));
        } else {
          const ids = options.ids
            ? options.ids.split(',').map(id => id.trim()).filter(Boolean)
            : (idsFromStdin || []);

          if (ids.length === 0) {
            console.log(chalk.yellow('No message IDs provided.'));
            return;
          }

          // Fetch email details for display
          console.log(chalk.cyan(`Fetching ${ids.length} email(s) for archiving...`));

          for (const id of ids) {
            const email = await getEmailById(account, id);
            if (email) {
              emailsToArchive.push(email);
            } else {
              console.log(chalk.yellow(`Could not find email with ID: ${id}`));
            }
          }
        }

        if (emailsToArchive.length === 0) {
          console.log(chalk.yellow('No valid emails found to archive.'));
          return;
        }

        // Show what will be archived (unless --confirm is passed)
        if (!options.confirm) {
          console.log(chalk.bold('\nEmails to be archived:\n'));
          emailsToArchive.forEach(e => {
            const from = e.from.length > 40 ? e.from.substring(0, 37) + '...' : e.from;
            const subject = e.subject.length > 50 ? e.subject.substring(0, 47) + '...' : e.subject;
            console.log(chalk.white(`  ${from}`));
            console.log(chalk.gray(`    ${subject}\n`));
          });

          console.log(chalk.yellow(`\nThis will archive ${emailsToArchive.length} email(s) (remove from inbox).`));
          console.log(chalk.gray('Use --confirm to skip this prompt.\n'));
        }

        // Log archives BEFORE actually archiving (for undo)
        const emailsWithAccount = emailsToArchive.map(e => ({ ...e, account }));
        logArchives(emailsWithAccount);
        console.log(chalk.gray(`Logged to: ${getArchiveLogPath()}`));

        const results = await archiveEmails(account, emailsToArchive.map(e => e.id));

        const succeeded = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        const succeededIds = new Set(succeeded.map(r => r.id));
        const successfulEmails = emailsToArchive.filter(email => succeededIds.has(email.id));

        if (successfulEmails.length > 0) {
          logUndoAction('archive', successfulEmails);
          console.log(chalk.gray(`Undo log: ${getUndoLogPath()}`));
        }

        if (succeeded.length > 0) {
          console.log(chalk.green(`\nArchived ${succeeded.length} email(s).`));
          console.log(chalk.gray(`Tip: Use 'inboxd unarchive --last ${succeeded.length}' to undo.`));
        }
        if (failed.length > 0) {
          console.log(chalk.red(`Failed to archive ${failed.length} email(s).`));
          failed.forEach(r => {
            console.log(chalk.red(`  - ${r.id}: ${r.error}`));
          });
        }

      } catch (error) {
        if (error.message.includes('403') || error.code === 403) {
          console.error(chalk.red('Permission denied. You may need to re-authenticate with updated scopes.'));
          console.error(chalk.yellow('Run: inboxd auth -a <account>'));
        } else {
          console.error(chalk.red('Error archiving emails:'), error.message);
        }
        process.exit(1);
      }
    }));

  program
    .command('unarchive')
    .description('Restore archived emails back to inbox')
    .option('--ids <ids>', 'Comma-separated message IDs to unarchive')
    .option('--last <number>', 'Unarchive the N most recent archives', parseInt)
    .option('--json', 'Output as JSON')
    .action(wrapAction(async (options) => {
      try {
        let emailsToUnarchive = [];

        // Scenario 1: Unarchive by explicit IDs
        if (options.ids) {
          const ids = options.ids.split(',').map(id => id.trim()).filter(Boolean);
          const log = getRecentArchives(30);

          for (const id of ids) {
            // Find in log first to get the account
            const entry = log.find(e => e.id === id);
            if (entry) {
              emailsToUnarchive.push(entry);
            } else {
              if (!options.json) {
                console.log(chalk.yellow(`Warning: ID ${id} not found in local archive log.`));
                console.log(chalk.gray(`Cannot determine account automatically. Please unarchive manually via Gmail.`));
              }
            }
          }
        }
        // Scenario 2: Unarchive last N items
        else if (options.last) {
          const count = options.last;
          const archives = getRecentArchives(30);
          // Sort by archivedAt desc
          archives.sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt));

          emailsToUnarchive = archives.slice(0, count);
        } else {
          if (options.json) {
            console.log(JSON.stringify({ error: 'Must specify either --ids or --last' }, null, 2));
          } else {
            console.log(chalk.red('Error: Must specify either --ids or --last'));
            console.log(chalk.gray('Examples:'));
            console.log(chalk.gray('  inboxd unarchive --last 1'));
            console.log(chalk.gray('  inboxd unarchive --ids 12345,67890'));
          }
          return;
        }

        if (emailsToUnarchive.length === 0) {
          if (options.json) {
            console.log(JSON.stringify({ unarchived: 0, failed: 0, results: [] }, null, 2));
          } else {
            console.log(chalk.yellow('No emails found to unarchive.'));
          }
          return;
        }

        if (!options.json) {
          console.log(chalk.cyan(`Unarchiving ${emailsToUnarchive.length} email(s)...`));
        }

        // Group by account to batch API calls
        const byAccount = {};
        for (const email of emailsToUnarchive) {
          if (!byAccount[email.account]) {
            byAccount[email.account] = [];
          }
          byAccount[email.account].push(email);
        }

        const successfulIds = [];

        for (const [account, emails] of Object.entries(byAccount)) {
          const ids = emails.map(e => e.id);
          if (!options.json) {
            console.log(chalk.gray(`Unarchiving ${ids.length} email(s) for account "${account}"...`));
          }

          const results = await unarchiveEmails(account, ids);

          const succeeded = results.filter(r => r.success);
          const failed = results.filter(r => !r.success);

          if (!options.json) {
            if (succeeded.length > 0) {
              console.log(chalk.green(`  ✓ Unarchived ${succeeded.length} email(s)`));
            }
            if (failed.length > 0) {
              console.log(chalk.red(`  ✗ Failed to unarchive ${failed.length} email(s)`));
              failed.forEach(r => {
                console.log(chalk.gray(`    - ID ${r.id}: ${r.error}`));
              });
            }
          }

          successfulIds.push(...succeeded.map(r => r.id));
        }

        // Clean up log
        if (successfulIds.length > 0) {
          removeArchiveLogEntries(successfulIds);
          if (!options.json) {
            console.log(chalk.gray(`\nRemoved ${successfulIds.length} entries from archive log.`));
          }
        }

        // JSON output
        if (options.json) {
          const allResults = [];
          for (const [account, emails] of Object.entries(byAccount)) {
            emails.forEach(e => {
              const wasSuccessful = successfulIds.includes(e.id);
              allResults.push({
                id: e.id,
                account,
                from: e.from,
                subject: e.subject,
                success: wasSuccessful
              });
            });
          }
          console.log(JSON.stringify({
            unarchived: successfulIds.length,
            failed: emailsToUnarchive.length - successfulIds.length,
            results: allResults
          }, null, 2));
        }

      } catch (error) {
        if (options.json) {
          console.log(JSON.stringify({ error: error.message }, null, 2));
        } else {
          console.error(chalk.red('Error unarchiving emails:'), error.message);
        }
        process.exit(1);
      }
    }));

  program
    .command('undo')
    .description('Undo the most recent delete or archive action')
    .option('--list', 'Show recent undo actions')
    .option('--limit <number>', 'Number of actions to list', '10')
    .option('--confirm', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON')
    .action(wrapAction(async (options) => {
      try {
        const limit = parseInt(options.limit, 10) || 10;
        const actions = getRecentUndoActions(limit);

        if (options.list) {
          if (options.json) {
            console.log(JSON.stringify({
              count: actions.length,
              logPath: getUndoLogPath(),
              actions,
            }, null, 2));
            return;
          }

          if (actions.length === 0) {
            console.log(chalk.gray('No undo actions available.'));
            console.log(chalk.gray(`Log file: ${getUndoLogPath()}`));
            return;
          }

          console.log(chalk.bold('\nUndo History:\n'));
          actions.forEach((entry, index) => {
            const accounts = Array.from(new Set(entry.items.map(item => item.account || 'default')));
            const actionLabel = entry.action === 'delete' ? 'Deleted' : 'Archived';
            const timestamp = new Date(entry.createdAt).toLocaleString();
            console.log(chalk.white(`${index + 1}. ${actionLabel} ${entry.count} email(s)`));
            console.log(chalk.gray(`   Accounts: ${accounts.join(', ')}`));
            console.log(chalk.gray(`   When: ${timestamp}\n`));
          });
          console.log(chalk.gray(`Log file: ${getUndoLogPath()}`));
          return;
        }

        const entry = actions[0];
        if (!entry) {
          if (options.json) {
            console.log(JSON.stringify({ undone: 0, failed: 0, results: [] }, null, 2));
          } else {
            console.log(chalk.gray('No undo actions available.'));
          }
          return;
        }

        if (!options.confirm && !options.json) {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          const actionLabel = entry.action === 'delete' ? 'restore' : 'unarchive';
          const answer = await prompt(rl, chalk.yellow(`\nUndo last action (${actionLabel} ${entry.count} email(s))? (y/N): `));
          rl.close();

          if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
            console.log(chalk.gray('Cancelled. No changes made.\n'));
            return;
          }
        }

        const byAccount = {};
        entry.items.forEach(item => {
          const account = item.account || 'default';
          if (!byAccount[account]) {
            byAccount[account] = [];
          }
          byAccount[account].push(item);
        });

        const successfulIds = [];
        const results = [];

        for (const [account, items] of Object.entries(byAccount)) {
          const ids = items.map(item => item.id);
          const undoResults = entry.action === 'delete'
            ? await untrashEmails(account, ids)
            : await unarchiveEmails(account, ids);

          undoResults.forEach(result => {
            const item = items.find(candidate => candidate.id === result.id);
            results.push({
              id: result.id,
              account,
              from: item?.from || '',
              subject: item?.subject || '',
              success: result.success,
            });
            if (result.success) {
              successfulIds.push(result.id);
            }
          });
        }

        if (entry.action === 'delete') {
          removeLogEntries(successfulIds);
        } else {
          removeArchiveLogEntries(successfulIds);
        }

        const remainingItems = entry.items.filter(item => !successfulIds.includes(item.id));
        if (remainingItems.length === 0) {
          removeUndoEntry(entry.id);
        } else {
          updateUndoEntry(entry.id, { items: remainingItems });
        }

        if (options.json) {
          console.log(JSON.stringify({
            action: entry.action,
            undone: successfulIds.length,
            failed: entry.items.length - successfulIds.length,
            results,
          }, null, 2));
          return;
        }

        console.log(chalk.green(`\nUndid ${successfulIds.length} email(s).`));
        if (entry.items.length - successfulIds.length > 0) {
          console.log(chalk.red(`Failed to undo ${entry.items.length - successfulIds.length} email(s).`));
        }
      } catch (error) {
        if (options.json) {
          console.log(JSON.stringify({ error: error.message }, null, 2));
        } else {
          console.error(chalk.red('Error undoing action:'), error.message);
        }
        process.exit(1);
      }
    }));

  program
    .command('preferences')
    .description('View and manage inbox preferences used by the AI assistant')
    .option('--init', 'Create preferences file from template if missing')
    .option('--edit', 'Open preferences file in $EDITOR (creates if missing)')
    .option('--validate', 'Validate preferences format and line count')
    .option('--json', 'Output preferences and validation as JSON')
    .action(wrapAction(async (options) => {
      try {
        const prefPath = getPreferencesPath();
        const templatePath = getTemplatePath();
        const templateContent = fs.existsSync(templatePath)
          ? fs.readFileSync(templatePath, 'utf8')
          : '# Inbox Preferences\n';
        let createdDuringRun = false;

        const ensurePreferencesFile = () => {
          if (!preferencesExist()) {
            writePreferences(templateContent);
            createdDuringRun = true;
          }
        };

        // Handle init (create if missing)
        if (options.init) {
          ensurePreferencesFile();
          if (!options.json) {
            if (createdDuringRun) {
              console.log(chalk.green('\n✓ Preferences file created from template.'));
              console.log(chalk.gray(`  Path: ${prefPath}\n`));
            } else {
              console.log(chalk.yellow('\nPreferences file already exists.'));
              console.log(chalk.gray(`  Path: ${prefPath}\n`));
            }
          }
        }

        // Handle edit (open editor)
        if (options.edit) {
          ensurePreferencesFile();
          const editor = process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'nano');
          if (!options.json) {
            console.log(chalk.gray(`Opening ${prefPath} with ${editor}...\n`));
          }
          const result = spawnSync(editor, [prefPath], { stdio: 'inherit' });
          if (result.error) {
            console.log(chalk.red(`Failed to open editor "${editor}": ${result.error.message}`));
          }
          return;
        }

        const exists = preferencesExist();
        const content = exists ? readPreferences() : null;
        const validation = validatePreferences(content);

        if (options.json) {
          console.log(JSON.stringify({
            path: prefPath,
            exists,
            created: createdDuringRun,
            lineCount: validation.lineCount,
            valid: validation.valid,
            errors: validation.errors,
            warnings: validation.warnings,
            content: content || '',
          }, null, 2));
          return;
        }

        if (options.validate) {
          if (!exists) {
            console.log(chalk.red('\nPreferences file not found.'));
            console.log(chalk.gray('Create one with: inboxd preferences --init\n'));
            return;
          }

          if (validation.valid) {
            console.log(chalk.green('\n✓ Preferences file is valid.'));
          } else {
            console.log(chalk.red('\nPreferences file has issues:'));
          }
          console.log(chalk.gray(`  Path: ${prefPath}`));
          console.log(chalk.gray(`  Lines: ${validation.lineCount}`));

          if (validation.errors.length > 0) {
            console.log(chalk.red('\nErrors:'));
            validation.errors.forEach(err => console.log(chalk.red(`  - ${err}`)));
          }
          if (validation.warnings.length > 0) {
            console.log(chalk.yellow('\nWarnings:'));
            validation.warnings.forEach(warn => console.log(chalk.yellow(`  - ${warn}`)));
          }
          console.log('');
          return;
        }

        // Default: display preferences or hint to init
        if (!exists) {
          console.log(chalk.yellow('\nNo preferences file found.'));
          console.log(chalk.gray('Create one with: inboxd preferences --init'));
          console.log(chalk.gray('Then edit with: inboxd preferences --edit\n'));
          return;
        }

        if (validation.lineCount > 500) {
          console.log(chalk.red(`\nPreferences file is too long (${validation.lineCount} lines). Please shorten below 500 lines.\n`));
          return;
        }

        console.log(chalk.bold('\nInbox Preferences\n'));
        console.log(content);
        console.log(chalk.gray(`\nPath: ${prefPath}`));
        console.log(chalk.gray(`Lines: ${validation.lineCount}\n`));
      } catch (error) {
        if (options.json) {
          console.log(JSON.stringify({ error: error.message }, null, 2));
        } else {
          console.error(chalk.red('Error managing preferences:'), error.message);
        }
        process.exit(1);
      }
    }));

  const rulesCommand = program
    .command('rules')
    .description('Manage automated preference rules');

  rulesCommand
    .command('list')
    .description('List saved rules')
    .option('--json', 'Output as JSON')
    .action(wrapAction(async (options) => {
      try {
        const rules = listRules();

        if (options.json) {
          console.log(JSON.stringify({
            count: rules.length,
            path: getRulesPath(),
            rules,
          }, null, 2));
          return;
        }

        if (rules.length === 0) {
          console.log(chalk.gray('No rules saved yet.'));
          console.log(chalk.gray(`Rules file: ${getRulesPath()}`));
          return;
        }

        console.log(chalk.bold('\nInbox Rules:\n'));
        rules.forEach(rule => {
          const olderThanLabel = rule.olderThanDays ? ` (older than ${rule.olderThanDays} days)` : '';
          console.log(chalk.white(`${rule.id}`));
          console.log(chalk.gray(`  ${rule.action} → ${rule.sender}${olderThanLabel}\n`));
        });
        console.log(chalk.gray(`Rules file: ${getRulesPath()}`));
      } catch (error) {
        if (options.json) {
          console.log(JSON.stringify({ error: error.message }, null, 2));
        } else {
          console.error(chalk.red('Error listing rules:'), error.message);
        }
        process.exit(1);
      }
    }));

  rulesCommand
    .command('add')
    .description('Add a rule')
    .option('--always-delete', 'Always delete matching emails')
    .option('--never-delete', 'Never delete matching emails')
    .option('--auto-archive', 'Auto-archive matching emails')
    .option('--sender <pattern>', 'Sender email or domain')
    .option('--older-than <duration>', 'Only apply to emails older than N days/weeks (e.g., "30d", "2w")')
    .option('--json', 'Output as JSON')
    .action(wrapAction(async (options) => {
      try {
        const actionFlags = [
          { flag: options.alwaysDelete, action: 'always-delete' },
          { flag: options.neverDelete, action: 'never-delete' },
          { flag: options.autoArchive, action: 'auto-archive' },
        ];
        const selected = actionFlags.filter(item => item.flag).map(item => item.action);

        if (selected.length === 0) {
          console.log(chalk.red(`Error: Must specify one action (${Array.from(SUPPORTED_ACTIONS).join(', ')})`));
          return;
        }
        if (selected.length > 1) {
          console.log(chalk.red('Error: Only one action can be specified.'));
          return;
        }
        if (!options.sender) {
          console.log(chalk.red('Error: --sender is required.'));
          return;
        }

        let olderThanDays = null;
        if (options.olderThan) {
          const olderThanQuery = parseOlderThanDuration(options.olderThan);
          if (!olderThanQuery) {
            console.log(chalk.red(`Error: Invalid --older-than format "${options.olderThan}". Use "30d", "2w", "1m".`));
            return;
          }
          olderThanDays = parseInt(olderThanQuery, 10);
        }

        const result = addRule({
          action: selected[0],
          sender: options.sender,
          olderThanDays,
        });

        if (options.json) {
          console.log(JSON.stringify({
            created: result.created,
            rule: result.rule,
            path: getRulesPath(),
          }, null, 2));
          return;
        }

        if (result.created) {
          console.log(chalk.green('\n✓ Rule added.'));
        } else {
          console.log(chalk.yellow('\nRule already exists.'));
        }
        console.log(chalk.gray(`  ${result.rule.action} → ${result.rule.sender}`));
        if (result.rule.olderThanDays) {
          console.log(chalk.gray(`  Older than: ${result.rule.olderThanDays} days`));
        }
        console.log(chalk.gray(`  ID: ${result.rule.id}`));
      } catch (error) {
        if (options.json) {
          console.log(JSON.stringify({ error: error.message }, null, 2));
        } else {
          console.error(chalk.red('Error adding rule:'), error.message);
        }
        process.exit(1);
      }
    }));

  rulesCommand
    .command('remove')
    .description('Remove a rule by ID')
    .requiredOption('--id <id>', 'Rule ID to remove')
    .option('--json', 'Output as JSON')
    .action(wrapAction(async (options) => {
      try {
        const result = removeRule(options.id);
        if (options.json) {
          console.log(JSON.stringify({
            removed: result.removed,
            rule: result.rule,
            path: getRulesPath(),
          }, null, 2));
          return;
        }

        if (result.removed) {
          console.log(chalk.green('\n✓ Rule removed.'));
          console.log(chalk.gray(`  ${result.rule.action} → ${result.rule.sender}`));
        } else {
          console.log(chalk.yellow('\nRule not found.'));
        }
      } catch (error) {
        if (options.json) {
          console.log(JSON.stringify({ error: error.message }, null, 2));
        } else {
          console.error(chalk.red('Error removing rule:'), error.message);
        }
        process.exit(1);
      }
    }));

  rulesCommand
    .command('apply')
    .description('Apply saved rules to delete or archive matching emails')
    .option('-a, --account <name>', 'Account to apply rules (or "all")', 'all')
    .option('--limit <number>', 'Max emails per rule per account (default: 50)', '50')
    .option('--dry-run', 'Preview what would be deleted/archived')
    .option('--confirm', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON')
    .action(applyRulesAction);

  rulesCommand
    .command('suggest')
    .description('Suggest rules based on deletion patterns')
    .option('-n, --days <number>', 'Period to analyze', '30')
    .option('--apply', 'Interactively add suggested rules')
    .option('--confirm', 'Apply all suggestions without prompting')
    .option('--json', 'Output as JSON')
    .action(wrapAction(async (options) => {
      try {
        const days = parseInt(options.days, 10);
        const analysis = analyzePatterns(days);
        const suggestions = buildSuggestedRules(analysis);

        if (options.apply && options.json) {
          console.log(chalk.red('Error: --apply cannot be combined with --json.'));
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(suggestions, null, 2));
          return;
        }

        if (suggestions.suggestions.length === 0) {
          console.log(chalk.gray('No strong patterns detected for rule suggestions.'));
          return;
        }

        if (options.apply) {
          if (!process.stdin.isTTY && !options.confirm) {
            console.log(chalk.red('Error: --apply requires an interactive terminal (or use --confirm).'));
            return;
          }

          const added = [];
          const skipped = [];
          const existing = [];
          let applyAll = !!options.confirm;

          const rl = applyAll
            ? null
            : readline.createInterface({
              input: process.stdin,
              output: process.stdout,
            });

          for (const suggestion of suggestions.suggestions) {
            let shouldAdd = applyAll;

            if (!applyAll) {
              const answer = await prompt(
                rl,
                chalk.yellow(`\nAdd rule "${suggestion.action} → ${suggestion.sender}"? (y/N/a/q): `)
              );
              const normalized = answer.toLowerCase();

              if (normalized === 'q' || normalized === 'quit') {
                break;
              }
              if (normalized === 'a' || normalized === 'all') {
                applyAll = true;
                shouldAdd = true;
              } else if (normalized === 'y' || normalized === 'yes') {
                shouldAdd = true;
              }
            }

            if (shouldAdd) {
              const result = addRule({
                action: suggestion.action,
                sender: suggestion.sender,
              });
              if (result.created) {
                added.push(result.rule);
              } else {
                existing.push(result.rule);
              }
            } else {
              skipped.push(suggestion);
            }
          }

          if (rl) {
            rl.close();
          }

          console.log(chalk.bold('\nRule Suggestion Summary'));
          console.log(chalk.gray(`Added: ${added.length}`));
          if (existing.length > 0) {
            console.log(chalk.gray(`Already existed: ${existing.length}`));
          }
          if (skipped.length > 0) {
            console.log(chalk.gray(`Skipped: ${skipped.length}`));
          }
          console.log(chalk.gray(`Rules file: ${getRulesPath()}`));
          return;
        }

        console.log(chalk.bold(`\nRule Suggestions (last ${suggestions.period} days):\n`));
        suggestions.suggestions.forEach(suggestion => {
          console.log(chalk.white(`${suggestion.action} → ${suggestion.sender}`));
          console.log(chalk.gray(`  ${suggestion.reason}\n`));
        });
        console.log(chalk.gray('Tip: Use "inboxd rules suggest --apply" to add these rules.'));
      } catch (error) {
        if (options.json) {
          console.log(JSON.stringify({ error: error.message }, null, 2));
        } else {
          console.error(chalk.red('Error suggesting rules:'), error.message);
        }
        process.exit(1);
      }
    }));

  program
    .command('install-skill')
    .description('Install Claude Code skill for AI-powered inbox management')
    .option('--uninstall', 'Remove the skill instead of installing')
    .option('--force', 'Force install even if skill exists with different source')
    .action(wrapAction(async (options) => {
      if (options.uninstall) {
        const { uninstallSkill } = require('./skill-installer');
        const result = uninstallSkill();

        if (result.existed) {
          console.log(chalk.green('\n✓ Skill uninstalled successfully.'));
          console.log(chalk.gray(`  Removed: ${SKILL_DEST_DIR}\n`));
        } else {
          console.log(chalk.gray('\nSkill was not installed.\n'));
        }
        return;
      }

      const status = getSkillStatus();
      const updateInfo = checkForUpdate();

      // Check ownership conflict
      if (status.installed && !status.isOurs && !options.force) {
        console.log(chalk.yellow(`\n⚠️  A skill with the same name already exists but isn't from ${SOURCE_MARKER}.`));
        console.log(chalk.gray(`  Current source: "${status.source || 'none'}"`));
        console.log(chalk.gray(`  Location: ${SKILL_DEST_DIR}\n`));
        console.log(chalk.white(`To replace it, run: inboxd install-skill --force\n`));
        return;
      }

      // Show current state
      if (status.installed && status.isOurs) {
        if (updateInfo.updateAvailable) {
          console.log(chalk.yellow('\nSkill update available (content changed).'));
        } else {
          console.log(chalk.green('\n✓ Skill is already installed and up to date.'));
          console.log(chalk.gray(`  Location: ${SKILL_DEST_DIR}\n`));
          return;
        }
      }

      try {
        const result = installSkill({ force: options.force });

        if (!result.success) {
          if (result.reason === 'not_owned') {
            console.log(chalk.yellow(`\n⚠️  Cannot update: skill exists but isn't from ${SOURCE_MARKER}.`));
            console.log(chalk.white(`Use --force to replace it.\n`));
          }
          return;
        }

        if (result.action === 'installed') {
          console.log(chalk.green('\n✓ Claude Code skill installed successfully!'));
        } else if (result.action === 'updated') {
          if (result.backedUp) {
            console.log(chalk.green('\n✓ Claude Code skill updated! (previous saved to SKILL.md.backup)'));
          } else {
            console.log(chalk.green('\n✓ Claude Code skill updated!'));
          }
        }

        console.log(chalk.gray(`  Location: ${result.path}\n`));

        console.log(chalk.white('What this enables:'));
        console.log(chalk.gray('  • AI agents can now manage your inbox with expert triage'));
        console.log(chalk.gray('  • In Claude Code, ask: "check my emails" or "clean up my inbox"'));
        console.log(chalk.gray('  • The skill provides safe deletion with confirmation + undo\n'));

      } catch (error) {
        console.error(chalk.red('Error installing skill:'), error.message);
        process.exit(1);
      }
    }));

  // ============================================================================
  // Labels Management Commands
  // ============================================================================

  program
    .command('labels')
    .description('List all Gmail labels')
    .option('-a, --account <name>', 'Account name')
    .option('--type <type>', 'Filter by type: user, system, all (default: all)')
    .option('--json', 'Output as JSON')
    .action(wrapAction(async (options) => {
      try {
        const { account, error } = resolveAccount(options.account, chalk);
        if (error) {
          console.log(error);
          return;
        }

        const labels = await listLabels(account);
        const typeFilter = options.type?.toLowerCase();

        let filtered = labels;
        if (typeFilter === 'user') {
          filtered = labels.filter(l => l.type === 'user');
        } else if (typeFilter === 'system') {
          filtered = labels.filter(l => l.type === 'system');
        }

        if (options.json) {
          console.log(JSON.stringify({ account, labels: filtered }, null, 2));
          return;
        }

        const email = await getAccountEmail(account);
        console.log(chalk.bold(`\nLabels (${email || account}):\n`));

        // Group by type
        const systemLabels = filtered.filter(l => l.type === 'system');
        const userLabels = filtered.filter(l => l.type === 'user');

        if (systemLabels.length > 0 && typeFilter !== 'user') {
          console.log(chalk.cyan('System Labels:'));
          systemLabels.forEach(l => {
            const unread = l.messagesUnread ? chalk.yellow(` (${l.messagesUnread} unread)`) : '';
            console.log(`  ${l.name}${unread}`);
          });
          console.log('');
        }

        if (userLabels.length > 0 && typeFilter !== 'system') {
          console.log(chalk.cyan('User Labels:'));
          userLabels.forEach(l => {
            const unread = l.messagesUnread ? chalk.yellow(` (${l.messagesUnread} unread)`) : '';
            console.log(`  ${l.name}${unread}`);
          });
          console.log('');
        }

        console.log(chalk.gray(`Total: ${filtered.length} labels`));
      } catch (error) {
        console.error(chalk.red('Error listing labels:'), error.message);
        process.exit(1);
      }
    }));

  program
    .command('labels-add <name>')
    .description('Create a new Gmail label')
    .option('-a, --account <name>', 'Account name')
    .action(wrapAction(async (labelName, options) => {
      try {
        const { account, error } = resolveAccount(options.account, chalk);
        if (error) {
          console.log(error);
          return;
        }

        // Check if label already exists
        const existing = await findLabelByName(account, labelName);
        if (existing) {
          console.log(chalk.yellow(`Label "${labelName}" already exists.`));
          return;
        }

        const label = await createLabel(account, labelName);
        console.log(chalk.green(`Created label: ${label.name}`));
        console.log(chalk.gray(`  ID: ${label.id}`));
      } catch (error) {
        if (error.message?.includes('already exists')) {
          console.log(chalk.yellow(`Label "${labelName}" already exists.`));
        } else {
          console.error(chalk.red('Error creating label:'), error.message);
          process.exit(1);
        }
      }
    }));

  program
    .command('labels-apply')
    .description('Apply a label to emails')
    .requiredOption('--ids <ids>', 'Comma-separated message IDs')
    .requiredOption('--label <name>', 'Label name to apply')
    .option('-a, --account <name>', 'Account name')
    .option('--json', 'Output as JSON')
    .action(wrapAction(async (options) => {
      try {
        const { account, error } = resolveAccount(options.account, chalk);
        if (error) {
          console.log(error);
          return;
        }

        const ids = options.ids.split(',').map(id => id.trim()).filter(Boolean);
        if (ids.length === 0) {
          console.log(chalk.yellow('No message IDs provided.'));
          return;
        }

        // Find label by name
        const label = await findLabelByName(account, options.label);
        if (!label) {
          console.log(chalk.red(`Label "${options.label}" not found.`));
          console.log(chalk.gray('Run "inboxd labels" to see available labels.'));
          return;
        }

        const results = await applyLabel(account, ids, label.id);
        const succeeded = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);

        if (options.json) {
          console.log(JSON.stringify({ label: label.name, succeeded: succeeded.length, failed: failed.length, results }, null, 2));
          return;
        }

        if (succeeded.length > 0) {
          console.log(chalk.green(`Applied label "${label.name}" to ${succeeded.length} email(s).`));
        }
        if (failed.length > 0) {
          console.log(chalk.red(`Failed to apply to ${failed.length} email(s).`));
          failed.forEach(r => console.log(chalk.gray(`  ${r.id}: ${r.error}`)));
        }
      } catch (error) {
        console.error(chalk.red('Error applying label:'), error.message);
        process.exit(1);
      }
    }));

  program
    .command('labels-remove')
    .description('Remove a label from emails')
    .requiredOption('--ids <ids>', 'Comma-separated message IDs')
    .requiredOption('--label <name>', 'Label name to remove')
    .option('-a, --account <name>', 'Account name')
    .option('--json', 'Output as JSON')
    .action(wrapAction(async (options) => {
      try {
        const { account, error } = resolveAccount(options.account, chalk);
        if (error) {
          console.log(error);
          return;
        }

        const ids = options.ids.split(',').map(id => id.trim()).filter(Boolean);
        if (ids.length === 0) {
          console.log(chalk.yellow('No message IDs provided.'));
          return;
        }

        // Find label by name
        const label = await findLabelByName(account, options.label);
        if (!label) {
          console.log(chalk.red(`Label "${options.label}" not found.`));
          console.log(chalk.gray('Run "inboxd labels" to see available labels.'));
          return;
        }

        const results = await removeLabel(account, ids, label.id);
        const succeeded = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);

        if (options.json) {
          console.log(JSON.stringify({ label: label.name, succeeded: succeeded.length, failed: failed.length, results }, null, 2));
          return;
        }

        if (succeeded.length > 0) {
          console.log(chalk.green(`Removed label "${label.name}" from ${succeeded.length} email(s).`));
        }
        if (failed.length > 0) {
          console.log(chalk.red(`Failed to remove from ${failed.length} email(s).`));
          failed.forEach(r => console.log(chalk.gray(`  ${r.id}: ${r.error}`)));
        }
      } catch (error) {
        console.error(chalk.red('Error removing label:'), error.message);
        process.exit(1);
      }
    }));

  // ============================================================================
  // Attachment Management Commands
  // ============================================================================

  program
    .command('attachments')
    .description('List emails with attachments')
    .option('-a, --account <name>', 'Account name')
    .option('-n, --count <number>', 'Max emails to check (default: 50)', '50')
    .option('--json', 'Output as JSON')
    .action(wrapAction(async (options) => {
      try {
        const { account, error } = resolveAccount(options.account, chalk);
        if (error) {
          console.log(error);
          return;
        }

        const maxResults = parseInt(options.count, 10);
        const emails = await getEmailsWithAttachments(account, { maxResults });

        const totalAttachments = emails.reduce((sum, e) => sum + e.attachments.length, 0);

        if (options.json) {
          console.log(JSON.stringify({
            account,
            emailCount: emails.length,
            attachmentCount: totalAttachments,
            emails,
          }, null, 2));
          return;
        }

        if (emails.length === 0) {
          console.log(chalk.gray('No emails with attachments found.'));
          return;
        }

        const email = await getAccountEmail(account);
        console.log(chalk.bold(`\nEmails with Attachments (${email || account}):\n`));

        emails.forEach((e, idx) => {
          console.log(chalk.white(`${idx + 1}. From: ${e.from || '(unknown)'} | ${e.date || ''}`));
          console.log(chalk.gray(`   Subject: ${e.subject || '(no subject)'}`));
          console.log(chalk.gray(`   ID: ${e.id}`));
          console.log(chalk.cyan('   Attachments:'));
          e.attachments.forEach(att => {
            const size = formatSize(att.size);
            console.log(chalk.gray(`   - ${att.filename} (${size})`));
          });
          console.log('');
        });

        console.log(chalk.gray(`Found ${totalAttachments} attachment(s) across ${emails.length} email(s).`));
      } catch (error) {
        console.error(chalk.red('Error listing attachments:'), error.message);
        process.exit(1);
      }
    }));

  program
    .command('attachments-search <pattern>')
    .description('Search attachments by filename')
    .option('-a, --account <name>', 'Account name')
    .option('-n, --count <number>', 'Max emails to check (default: 50)', '50')
    .option('--json', 'Output as JSON')
    .action(wrapAction(async (pattern, options) => {
      try {
        const { account, error } = resolveAccount(options.account, chalk);
        if (error) {
          console.log(error);
          return;
        }

        const maxResults = parseInt(options.count, 10);
        const emails = await searchAttachments(account, pattern, { maxResults });

        const totalAttachments = emails.reduce((sum, e) => sum + e.attachments.length, 0);

        if (options.json) {
          console.log(JSON.stringify({
            account,
            pattern,
            emailCount: emails.length,
            attachmentCount: totalAttachments,
            emails,
          }, null, 2));
          return;
        }

        if (emails.length === 0) {
          console.log(chalk.gray(`No attachments matching "${pattern}" found.`));
          return;
        }

        console.log(chalk.bold(`\nAttachments matching "${pattern}":\n`));

        emails.forEach((e, idx) => {
          console.log(chalk.white(`${idx + 1}. From: ${e.from || '(unknown)'} | ${e.date || ''}`));
          console.log(chalk.gray(`   Subject: ${e.subject || '(no subject)'}`));
          console.log(chalk.gray(`   ID: ${e.id}`));
          console.log(chalk.cyan('   Matching attachments:'));
          e.attachments.forEach(att => {
            const size = formatSize(att.size);
            console.log(chalk.gray(`   - ${att.filename} (${size})`));
          });
          console.log('');
        });

        console.log(chalk.gray(`Found ${totalAttachments} matching attachment(s) across ${emails.length} email(s).`));
      } catch (error) {
        console.error(chalk.red('Error searching attachments:'), error.message);
        process.exit(1);
      }
    }));

  program
    .command('attachments-download')
    .description('Download attachments from an email')
    .requiredOption('--id <messageId>', 'Message ID')
    .option('-a, --account <name>', 'Account name')
    .option('-o, --output <dir>', 'Output directory (default: current dir)', '.')
    .option('--filename <pattern>', 'Download only attachments matching pattern')
    .action(wrapAction(async (options) => {
      try {
        const { account, error } = resolveAccount(options.account, chalk);
        if (error) {
          console.log(error);
          return;
        }

        // Get email with attachments
        const emails = await getEmailsWithAttachments(account, { query: `rfc822msgid:${options.id}`, maxResults: 1 });

        // If not found by rfc822msgid, try fetching directly
        let attachments = [];
        let emailInfo = null;

        if (emails.length > 0) {
          emailInfo = emails[0];
          attachments = emailInfo.attachments;
        } else {
          // Fetch the email directly
          const email = await getEmailById(account, options.id);
          if (!email) {
            console.log(chalk.red(`Email with ID "${options.id}" not found.`));
            return;
          }
          // Need to get full email with attachments
          const fullEmails = await getEmailsWithAttachments(account, { maxResults: 100 });
          const found = fullEmails.find(e => e.id === options.id);
          if (!found) {
            console.log(chalk.yellow('No attachments found in this email.'));
            return;
          }
          emailInfo = found;
          attachments = found.attachments;
        }

        if (attachments.length === 0) {
          console.log(chalk.yellow('No attachments found in this email.'));
          return;
        }

        // Filter by filename pattern if provided
        if (options.filename) {
          const pattern = options.filename.toLowerCase().replace(/\*/g, '.*');
          const regex = new RegExp(pattern);
          attachments = attachments.filter(att => regex.test(att.filename.toLowerCase()));

          if (attachments.length === 0) {
            console.log(chalk.yellow(`No attachments matching "${options.filename}" found.`));
            return;
          }
        }

        // Ensure output directory exists
        const outputDir = resolvePath(options.output);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        console.log(chalk.cyan(`Downloading ${attachments.length} attachment(s) to ${outputDir}...`));

        for (const att of attachments) {
          if (!att.attachmentId) {
            console.log(chalk.yellow(`  Skipping ${att.filename} (no attachment ID)`));
            continue;
          }

          try {
            const data = await downloadAttachment(account, options.id, att.attachmentId);
            const filePath = path.join(outputDir, att.filename);

            // Avoid overwriting by adding number suffix if exists
            let finalPath = filePath;
            let counter = 1;
            while (fs.existsSync(finalPath)) {
              const ext = path.extname(att.filename);
              const base = path.basename(att.filename, ext);
              finalPath = path.join(outputDir, `${base}_${counter}${ext}`);
              counter++;
            }

            fs.writeFileSync(finalPath, data);
            console.log(chalk.green(`  ✓ ${path.basename(finalPath)} (${formatSize(data.length)})`));
          } catch (err) {
            console.log(chalk.red(`  ✗ ${att.filename}: ${err.message}`));
          }
        }

        console.log(chalk.gray('\nDone.'));
      } catch (error) {
        console.error(chalk.red('Error downloading attachments:'), error.message);
        process.exit(1);
      }
    }));

  // Handle unknown commands gracefully
  program.on('command:*', (operands) => {
    console.error(chalk.red(`\nUnknown command: ${operands[0]}`));
    console.log(chalk.gray('Run "inbox --help" for available commands.\n'));
    process.exit(1);
  });

  // Show helpful message for first-time users when no command is given
  if (process.argv.length === 2) {
    if (!isConfigured()) {
      console.log(chalk.cyan('\nWelcome to inboxd!'));
      console.log(chalk.white('Run ') + chalk.bold('inboxd setup') + chalk.white(' to get started.\n'));
      return;
    }
  }

  program.parse();
}

main().catch(console.error);
