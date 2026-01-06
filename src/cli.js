#!/usr/bin/env node

const { program } = require('commander');
const { getUnreadEmails, getEmailCount, trashEmails, getEmailById, untrashEmails, markAsRead, archiveEmails, groupEmailsBySender, getEmailContent, searchEmails, sendEmail, replyToEmail, extractLinks } = require('./gmail-monitor');
const { getState, updateLastCheck, markEmailsSeen, getNewEmailIds, clearOldSeenEmails } = require('./state');
const { notifyNewEmails } = require('./notifier');
const { authorize, addAccount, getAccounts, getAccountEmail, removeAccount, removeAllAccounts, renameTokenFile, validateCredentialsFile, hasCredentials, isConfigured, installCredentials } = require('./gmail-auth');
const { logDeletions, getRecentDeletions, getLogPath, readLog, removeLogEntries } = require('./deletion-log');
const { getSkillStatus, checkForUpdate, installSkill, SKILL_DEST_DIR, SOURCE_MARKER } = require('./skill-installer');
const { logSentEmail, getSentLogPath } = require('./sent-log');
const readline = require('readline');
const path = require('path');
const os = require('os');
const fs = require('fs');
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

async function main() {
  const chalk = (await import('chalk')).default;
  const boxen = (await import('boxen')).default;

  // Check for updates (non-blocking, cached)
  const updateNotifier = (await import('update-notifier')).default;
  updateNotifier({ pkg }).notify();

  program
    .name('inbox')
    .description('Gmail monitoring CLI with multi-account support')
    .version(pkg.version);

  // Setup command - interactive wizard for first-time users
  program
    .command('setup')
    .description('Interactive setup wizard for first-time configuration')
    .action(async () => {
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
              console.log(chalk.gray('\nSetup cancelled. Run "inbox summary" to check your inbox.\n'));
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
            console.log(chalk.bold.green('🎉 Setup complete! Try: inbox summary\n'));
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
        console.log(chalk.cyan('     inbox summary') + chalk.gray('        - View your inbox'));
        console.log(chalk.cyan('     inbox check') + chalk.gray('          - Check for new emails'));
        console.log(chalk.cyan('     inbox auth -a work') + chalk.gray('   - Add another account'));
        console.log(chalk.cyan('     inbox install-service') + chalk.gray(' - Enable background monitoring'));
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
            console.log(chalk.gray('     You can install it later with: inbox install-skill\n'));
          }
        } else {
          console.log(chalk.gray('\n   Skipped. Install later with: inbox install-skill\n'));
        }

      } catch (error) {
        rl.close();
        console.error(chalk.red('\nSetup failed:'), error.message);
        process.exit(1);
      }
    });

  program
    .command('auth')
    .description('Authenticate a Gmail account')
    .option('-a, --account <name>', 'Account name (e.g., personal, work)')
    .action(async (options) => {
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
    });

  program
    .command('accounts')
    .description('List all configured accounts')
    .action(async () => {
      const accounts = getAccounts();
      if (accounts.length === 0) {
        console.log(chalk.gray('No accounts configured. Run: inbox setup'));
        return;
      }

      console.log(chalk.bold('\nConfigured Accounts:\n'));
      for (const acc of accounts) {
        console.log(`  ${chalk.cyan(acc.name)} - ${acc.email || 'unknown email'}`);
      }
      console.log('');
      console.log(chalk.gray('To add another account: inbox auth -a <name>'));
      console.log('');
    });

  program
    .command('logout')
    .description('Remove an account or all accounts')
    .option('-a, --account <name>', 'Account to remove (or "all" to remove all)')
    .option('--all', 'Remove all accounts')
    .action(async (options) => {
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
        console.log(chalk.gray('Usage: inbox logout --account <name> or inbox logout --all'));
      }
    });

  program
    .command('check')
    .description('Check for new emails and send notifications')
    .option('-a, --account <name>', 'Check specific account (or "all")', 'all')
    .option('-q, --quiet', 'Suppress output, only send notifications')
    .action(async (options) => {
      try {
        const accounts = options.account === 'all'
          ? getAccounts().map(a => a.name)
          : [options.account];

        if (accounts.length === 0) {
          accounts.push('default');
        }

        let totalNew = 0;
        const allNewEmails = [];

        for (const account of accounts) {
          clearOldSeenEmails(7, account);

          const emails = await getUnreadEmails(account, 20);
          const newEmailIds = getNewEmailIds(emails.map((e) => e.id), account);
          const newEmails = emails.filter((e) => newEmailIds.includes(e.id));

          if (newEmails.length > 0) {
            markEmailsSeen(newEmailIds, account);
            allNewEmails.push(...newEmails.map(e => ({ ...e, account })));
            totalNew += newEmails.length;
          }

          updateLastCheck(account);

          if (!options.quiet && newEmails.length > 0) {
            console.log(chalk.green(`[${account}] ${newEmails.length} new email(s)`));
            newEmails.forEach((e) => {
              console.log(chalk.white(`  - ${e.subject}`));
              console.log(chalk.gray(`    From: ${e.from}`));
            });
          }
        }

        if (allNewEmails.length > 0) {
          notifyNewEmails(allNewEmails);
        }

        if (!options.quiet && totalNew === 0) {
          console.log(chalk.gray('No new emails since last check.'));
        }
      } catch (error) {
        console.error(chalk.red('Error checking emails:'), error.message);
        process.exit(1);
      }
    });

  program
    .command('summary')
    .description('Show summary of unread emails')
    .option('-a, --account <name>', 'Show specific account (or "all")', 'all')
    .option('-n, --count <number>', 'Number of emails per account', '5')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
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
          const state = getState(account);
          const lastCheckStr = state.lastCheck
            ? new Date(state.lastCheck).toLocaleString()
            : 'Never';

          const accountInfo = getAccounts().find(a => a.name === account);
          const label = accountInfo?.email || account;

          let content = `${chalk.bold.cyan(label)} - ${count} unread\n`;
          content += chalk.gray(`Last check: ${lastCheckStr}\n\n`);

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
    });

  program
    .command('analyze')
    .description('Output structured email data for AI analysis (unread only by default)')
    .option('-a, --account <name>', 'Account to analyze (or "all")', 'all')
    .option('-n, --count <number>', 'Number of emails to analyze per account', '20')
    .option('--all', 'Include read and unread emails (default: unread only)')
    .option('--since <duration>', 'Only include emails from last N days/hours (e.g., "7d", "24h", "3d")')
    .option('--older-than <duration>', 'Only include emails older than N days/weeks (e.g., "30d", "2w", "1m")')
    .option('--group-by <field>', 'Group emails by field (sender)')
    .action(async (options) => {
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

        // Group by sender if requested
        if (options.groupBy) {
          if (options.groupBy !== 'sender') {
            console.error(JSON.stringify({ error: `Unsupported group-by field: ${options.groupBy}. Supported: sender` }));
            process.exit(1);
          }
          const grouped = groupEmailsBySender(allEmails);
          console.log(JSON.stringify(grouped, null, 2));
        } else {
          // Output pure JSON for AI consumption
          console.log(JSON.stringify(allEmails, null, 2));
        }
      } catch (error) {
        console.error(JSON.stringify({ error: error.message }));
        process.exit(1);
      }
    });

  program
    .command('read')
    .description('Read full content of an email')
    .requiredOption('--id <id>', 'Message ID to read')
    .option('-a, --account <name>', 'Account name')
    .option('--json', 'Output as JSON')
    .option('--links', 'Extract and display links from email')
    .action(async (options) => {
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

        // When --links is used, prefer HTML for better link extraction
        const emailOptions = options.links ? { preferHtml: true } : {};
        const email = await getEmailContent(account, id, emailOptions);

        if (!email) {
          console.log(chalk.red(`Email ${id} not found in account "${account}".`));
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
    });

  program
    .command('search')
    .description('Search emails using Gmail query syntax')
    .requiredOption('-q, --query <query>', 'Search query (e.g. "from:boss is:unread")')
    .option('-a, --account <name>', 'Account to search')
    .option('-n, --limit <number>', 'Max results', '20')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const { account, error } = resolveAccount(options.account, chalk);
        if (error) {
          console.log(error);
          return;
        }

        const limit = parseInt(options.limit, 10);
        const emails = await searchEmails(account, options.query, limit);

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
    });

  program
    .command('send')
    .description('Send an email')
    .requiredOption('-t, --to <email>', 'Recipient email')
    .requiredOption('-s, --subject <subject>', 'Email subject')
    .requiredOption('-b, --body <body>', 'Email body text')
    .option('-a, --account <name>', 'Account to send from')
    .option('--dry-run', 'Preview the email without sending')
    .option('--confirm', 'Skip confirmation prompt')
    .action(async (options) => {
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
          console.log(chalk.yellow('\nThis will send the email above.'));
          console.log(chalk.gray('Use --confirm to skip this prompt, or --dry-run to preview without sending.\n'));
          return;
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
    });

  program
    .command('reply')
    .description('Reply to an email')
    .requiredOption('--id <id>', 'Message ID to reply to')
    .requiredOption('-b, --body <body>', 'Reply body text')
    .option('-a, --account <name>', 'Account to reply from')
    .option('--dry-run', 'Preview the reply without sending')
    .option('--confirm', 'Skip confirmation prompt')
    .action(async (options) => {
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
          console.log(chalk.yellow('\nThis will send the reply above.'));
          console.log(chalk.gray('Use --confirm to skip this prompt, or --dry-run to preview without sending.\n'));
          return;
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
    });

  program
    .command('delete')
    .description('Move emails to trash')
    .option('--ids <ids>', 'Comma-separated message IDs to delete')
    .option('--sender <pattern>', 'Filter by sender (case-insensitive substring)')
    .option('--match <pattern>', 'Filter by subject (case-insensitive substring)')
    .option('-a, --account <name>', 'Account name (or "all" for filter-based deletion)', 'all')
    .option('--limit <number>', 'Max emails when using filters (default: 50)', '50')
    .option('--confirm', 'Skip confirmation prompt')
    .option('--dry-run', 'Show what would be deleted without deleting')
    .option('--force', 'Override safety warnings (required for short patterns or large matches)')
    .action(async (options) => {
      try {
        let emailsToDelete = [];
        const limit = parseInt(options.limit, 10);

        // Scenario A: IDs provided
        if (options.ids) {
          const ids = options.ids.split(',').map(id => id.trim()).filter(Boolean);

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
        // Scenario B: No IDs, use filters to find emails
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
        // Scenario C: Neither IDs nor filters - error
        else {
          console.log(chalk.red('Error: Must specify --ids or filter flags (--sender, --match)'));
          console.log(chalk.gray('Examples:'));
          console.log(chalk.gray('  inbox delete --ids "id1,id2" --confirm'));
          console.log(chalk.gray('  inbox delete --sender "linkedin" --dry-run'));
          console.log(chalk.gray('  inbox delete --sender "newsletter" --match "weekly" --confirm'));
          return;
        }

        if (emailsToDelete.length === 0) {
          console.log(chalk.yellow('No valid emails found to delete.'));
          return;
        }

        // Safety warnings for filter-based deletion
        if (!options.ids && (options.sender || options.match)) {
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
        const isFilterBased = !options.ids && (options.sender || options.match);
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

        for (const [accountName, emails] of Object.entries(emailsByAccount)) {
          const results = await trashEmails(accountName, emails.map(e => e.id));
          const succeeded = results.filter(r => r.success).length;
          const failed = results.filter(r => !r.success).length;
          totalSucceeded += succeeded;
          totalFailed += failed;

          if (failed > 0) {
            results.filter(r => !r.success).forEach(r => {
              console.log(chalk.red(`  - ${r.id}: ${r.error}`));
            });
          }
        }

        if (totalSucceeded > 0) {
          console.log(chalk.green(`\nMoved ${totalSucceeded} email(s) to trash.`));
          console.log(chalk.gray(`Tip: Use 'inbox restore --last ${totalSucceeded}' to undo.`));
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
    });

  program
    .command('deletion-log')
    .description('View recent email deletions')
    .option('-n, --days <number>', 'Show deletions from last N days', '30')
    .action(async (options) => {
      const days = parseInt(options.days, 10);
      const deletions = getRecentDeletions(days);

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
    });

  program
    .command('restore')
    .description('Restore deleted emails from trash')
    .option('--ids <ids>', 'Comma-separated message IDs to restore')
    .option('--last <number>', 'Restore the N most recent deletions', parseInt)
    .action(async (options) => {
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
          console.log(chalk.gray('  inbox restore --last 1'));
          console.log(chalk.gray('  inbox restore --ids 12345,67890'));
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
          console.log(chalk.gray(`\nRemoved ${successfulIds.length} entries from deletion log.`));
        }

      } catch (error) {
        console.error(chalk.red('Error restoring emails:'), error.message);
        process.exit(1);
      }
    });

  program
    .command('mark-read')
    .description('Mark emails as read')
    .requiredOption('--ids <ids>', 'Comma-separated message IDs to mark as read')
    .option('-a, --account <name>', 'Account name')
    .action(async (options) => {
      try {
        const ids = options.ids.split(',').map(id => id.trim()).filter(Boolean);

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
          console.error(chalk.yellow('Run: inbox auth -a <account>'));
        } else {
          console.error(chalk.red('Error marking emails as read:'), error.message);
        }
        process.exit(1);
      }
    });

  program
    .command('archive')
    .description('Archive emails (remove from inbox, keep in All Mail)')
    .requiredOption('--ids <ids>', 'Comma-separated message IDs to archive')
    .option('-a, --account <name>', 'Account name')
    .option('--confirm', 'Skip confirmation prompt')
    .action(async (options) => {
      try {
        const ids = options.ids.split(',').map(id => id.trim()).filter(Boolean);

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

        // Fetch email details for display
        console.log(chalk.cyan(`Fetching ${ids.length} email(s) for archiving...`));
        const emailsToArchive = [];

        for (const id of ids) {
          const email = await getEmailById(account, id);
          if (email) {
            emailsToArchive.push(email);
          } else {
            console.log(chalk.yellow(`Could not find email with ID: ${id}`));
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

        const results = await archiveEmails(account, emailsToArchive.map(e => e.id));

        const succeeded = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        if (succeeded > 0) {
          console.log(chalk.green(`\nArchived ${succeeded} email(s).`));
        }
        if (failed > 0) {
          console.log(chalk.red(`Failed to archive ${failed} email(s).`));
          results.filter(r => !r.success).forEach(r => {
            console.log(chalk.red(`  - ${r.id}: ${r.error}`));
          });
        }

      } catch (error) {
        if (error.message.includes('403') || error.code === 403) {
          console.error(chalk.red('Permission denied. You may need to re-authenticate with updated scopes.'));
          console.error(chalk.yellow('Run: inbox auth -a <account>'));
        } else {
          console.error(chalk.red('Error archiving emails:'), error.message);
        }
        process.exit(1);
      }
    });

  program
    .command('install-service')
    .description('Install background service (launchd) for macOS')
    .option('-i, --interval <minutes>', 'Check interval in minutes', '5')
    .action(async (options) => {
      // Platform check
      if (process.platform !== 'darwin') {
        console.log(chalk.red('\nError: install-service is only supported on macOS.'));
        console.log(chalk.gray('This command uses launchd which is macOS-specific.\n'));
        console.log(chalk.white('For other platforms, you can set up a cron job or scheduled task:'));
        console.log(chalk.cyan(`  */5 * * * * ${process.execPath} ${path.resolve(__dirname, 'cli.js')} check --quiet`));
        console.log('');
        return;
      }

      const interval = parseInt(options.interval, 10);
      const seconds = interval * 60;

      // Determine paths
      const nodePath = process.execPath;
      const scriptPath = path.resolve(__dirname, 'cli.js');
      const workingDir = path.resolve(__dirname, '..');
      const plistName = 'com.danielparedes.inboxd.plist';
      const homeDir = os.homedir();
      const launchAgentsDir = path.join(homeDir, 'Library/LaunchAgents');
      const plistPath = path.join(launchAgentsDir, plistName);

      const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.danielparedes.inboxd</string>

    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${scriptPath}</string>
        <string>check</string>
        <string>--quiet</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${workingDir}</string>

    <!-- Run every ${interval} minutes (${seconds} seconds) -->
    <key>StartInterval</key>
    <integer>${seconds}</integer>

    <!-- Run immediately when loaded -->
    <key>RunAtLoad</key>
    <true/>

    <!-- Logging -->
    <key>StandardOutPath</key>
    <string>/tmp/inboxd.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/inboxd.error.log</string>

    <!-- Environment variables -->
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>`;

      try {
        if (!fs.existsSync(launchAgentsDir)) {
          fs.mkdirSync(launchAgentsDir, { recursive: true });
        }

        fs.writeFileSync(plistPath, plistContent);
        
        // Automatically load the service
        const { execSync } = require('child_process');
        
        // Unload any existing service (ignore errors if not loaded)
        try {
          execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: 'ignore' });
        } catch {
          // Ignore - service may not be loaded yet
        }
        
        // Load the new service
        execSync(`launchctl load "${plistPath}"`);
        
        console.log(chalk.green(`\n✓ Background service installed and running!`));
        console.log(chalk.gray(`  Config: ${plistPath}`));
        console.log(chalk.gray(`  Interval: every ${interval} minutes`));
        console.log(chalk.gray(`  Logs: /tmp/inboxd.log\n`));
        console.log(chalk.white('The service will:'));
        console.log(chalk.gray('  • Check your inbox automatically'));
        console.log(chalk.gray('  • Send notifications for new emails'));
        console.log(chalk.gray('  • Start on login\n'));
        console.log(chalk.white('To stop the service:'));
        console.log(chalk.cyan(`  launchctl unload "${plistPath}"\n`));
      } catch (error) {
        console.error(chalk.red('Error installing service:'), error.message);
        console.log(chalk.yellow('\nThe config file was created but could not be loaded.'));
        console.log(chalk.white('Try running manually:'));
        console.log(chalk.cyan(`  launchctl load "${plistPath}"\n`));
      }
    });

  program
    .command('install-skill')
    .description('Install Claude Code skill for AI-powered inbox management')
    .option('--uninstall', 'Remove the skill instead of installing')
    .option('--force', 'Force install even if skill exists with different source')
    .action(async (options) => {
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
        console.log(chalk.white(`To replace it, run: inbox install-skill --force\n`));
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
    });

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
      console.log(chalk.white('Run ') + chalk.bold('inbox setup') + chalk.white(' to get started.\n'));
      return;
    }
  }

  program.parse();
}

main().catch(console.error);
