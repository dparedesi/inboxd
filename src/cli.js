#!/usr/bin/env node

const { program } = require('commander');
const { getUnreadEmails, getEmailCount, trashEmails, getEmailById, untrashEmails } = require('./gmail-monitor');
const { getState, updateLastCheck, markEmailsSeen, getNewEmailIds, clearOldSeenEmails } = require('./state');
const { notifyNewEmails } = require('./notifier');
const { authorize, addAccount, getAccounts, getAccountEmail, removeAccount, removeAllAccounts, renameTokenFile, validateCredentialsFile, hasCredentials, isConfigured, installCredentials } = require('./gmail-auth');
const { logDeletions, getRecentDeletions, getLogPath, readLog, removeLogEntries } = require('./deletion-log');
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

async function main() {
  const chalk = (await import('chalk')).default;
  const boxen = (await import('boxen')).default;

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
        const allEmails = [];

        for (const account of accounts) {
          const emails = await getUnreadEmails(account, maxPerAccount, includeRead);
          allEmails.push(...emails);
        }

        // Output pure JSON for AI consumption
        console.log(JSON.stringify(allEmails, null, 2));
      } catch (error) {
        console.error(JSON.stringify({ error: error.message }));
        process.exit(1);
      }
    });

  program
    .command('delete')
    .description('Move emails to trash')
    .requiredOption('--ids <ids>', 'Comma-separated message IDs to delete')
    .option('-a, --account <name>', 'Account name (required for single-account delete)')
    .option('--confirm', 'Skip confirmation prompt')
    .option('--dry-run', 'Show what would be deleted without deleting')
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

        // Fetch email details for logging before deletion
        console.log(chalk.cyan(`Fetching ${ids.length} email(s) for deletion...`));
        const emailsToDelete = [];

        for (const id of ids) {
          const email = await getEmailById(account, id);
          if (email) {
            emailsToDelete.push(email);
          } else {
            console.log(chalk.yellow(`Could not find email with ID: ${id}`));
          }
        }

        if (emailsToDelete.length === 0) {
          console.log(chalk.yellow('No valid emails found to delete.'));
          return;
        }

        // Show what will be deleted
        if (!options.confirm || options.dryRun) {
          console.log(chalk.bold('\nEmails to be moved to trash:\n'));
          emailsToDelete.forEach(e => {
            const from = e.from.length > 40 ? e.from.substring(0, 37) + '...' : e.from;
            const subject = e.subject.length > 50 ? e.subject.substring(0, 47) + '...' : e.subject;
            console.log(chalk.white(`  ${from}`));
            console.log(chalk.gray(`    ${subject}\n`));
          });

          if (options.dryRun) {
            console.log(chalk.yellow(`\nDry run: ${emailsToDelete.length} email(s) would be deleted.`));
            return;
          }

          console.log(chalk.yellow(`\nThis will move ${emailsToDelete.length} email(s) to trash.`));
          console.log(chalk.gray('Use --confirm to skip this prompt.\n'));
        }

        // Log deletions BEFORE actually deleting
        logDeletions(emailsToDelete);
        console.log(chalk.gray(`Logged to: ${getLogPath()}`));

        // Perform the deletion
        const results = await trashEmails(account, emailsToDelete.map(e => e.id));

        const succeeded = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        if (succeeded > 0) {
          console.log(chalk.green(`\nMoved ${succeeded} email(s) to trash.`));
        }
        if (failed > 0) {
          console.log(chalk.red(`Failed to delete ${failed} email(s).`));
          results.filter(r => !r.success).forEach(r => {
            console.log(chalk.red(`  - ${r.id}: ${r.error}`));
          });
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
        console.log(chalk.green(`\nService configuration generated at: ${plistPath}`));
        console.log(chalk.white('To enable the background service, run:'));
        console.log(chalk.cyan(`  launchctl unload ${plistPath} 2>/dev/null`));
        console.log(chalk.cyan(`  launchctl load ${plistPath}`));
        console.log('');
      } catch (error) {
        console.error(chalk.red('Error creating service file:'), error.message);
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
