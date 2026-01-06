# inboxd

CLI tool for Gmail monitoring with multi-account support and macOS notifications.

## Quick Reference

```bash
npm test                    # Run tests
npm run test:watch          # Watch mode
inbox setup                 # First-time setup wizard
inbox auth -a <name>        # Add account
inbox summary               # Check all inboxes
inbox check -q              # Background check
inbox install-service       # Install background service (macOS/Linux)
```

## Architecture

```
src/
├── cli.js            # Entry point, command definitions (commander)
├── gmail-auth.js     # OAuth2 flow, token storage, multi-account management
├── gmail-monitor.js  # Gmail API: fetch, count, trash, restore, archive
├── state.js          # Tracks seen emails per account
├── deletion-log.js   # Logs deleted emails for restore capability
├── archive-log.js    # Logs archived emails for unarchive capability
├── sent-log.js       # Logs sent emails for audit trail
├── notifier.js       # macOS notifications (node-notifier)
└── skill-installer.js # Copies skill to ~/.claude/skills/

scripts/
└── postinstall.js    # npm postinstall hint about install-skill

tests/                # Vitest tests with mocked Google APIs
__mocks__/            # Manual mocks for googleapis, @google-cloud/local-auth
```

## Tech Stack

- **Runtime**: Node.js 18+ (CommonJS)
- **Gmail API**: `googleapis`, `@google-cloud/local-auth`
- **CLI**: `commander`
- **UI**: `chalk`, `boxen` (ESM packages, loaded via dynamic import)
- **Notifications**: `node-notifier`
- **Testing**: `vitest`

## Data Storage

All user data lives in `~/.config/inboxd/`:

| File | Content |
|------|---------|
| `credentials.json` | OAuth client ID/secret from Google Cloud |
| `accounts.json` | `[{ name, email }]` for each linked account |
| `token-<name>.json` | OAuth refresh/access tokens |
| `state-<name>.json` | `{ seenEmailIds, lastCheck, lastNotifiedAt }` |
| `deletion-log.json` | Audit log for deleted emails |
| `archive-log.json` | Audit log for archived emails |
| `sent-log.json` | Audit log for sent emails |

## Code Patterns

- **CommonJS** for all source files
- **Dynamic import** for ESM-only deps (`chalk`, `boxen`)
- **Functional style**, no classes
- **Retry with backoff** in `gmail-monitor.js` for API calls
- **Silent fail** for missing config files (returns defaults)

## Key Behaviors

- `inbox setup` guides first-time users through credentials and auth
- `inbox check` marks emails as seen after notifying
- `inbox delete` logs to `deletion-log.json` before trashing
- `inbox restore` moves from Trash to Inbox, removes log entry
- `inbox archive` logs to `archive-log.json` before archiving
- `inbox unarchive` moves archived emails back to Inbox, removes log entry
- `inbox send/reply` prompts for interactive confirmation (or use `--confirm` to skip)
- `install-service` creates and enables launchd (macOS) or systemd (Linux) service

## OAuth Notes

- Gmail API requires OAuth consent screen with test users for external accounts
- Tokens auto-refresh; delete token file to force re-auth
- Credentials can be in project root (dev) or `~/.config/inboxd/` (installed)

## Release Process

**After merging a feature/fix PR to main, always release:**

1. `npm version patch` (or `minor`/`major` as appropriate)
2. Commit and push: `git add package*.json && git commit -m "chore: bump version to X.X.X" && git push`
3. Create release with quality notes:
   ```bash
   gh release create vX.X.X --title "vX.X.X" --notes "$(cat <<'EOF'
   ## What's New
   - Feature 1: description
   - Feature 2: description

   ## Fixes
   - Fix 1: description
   EOF
   )"
   ```
4. The `publish.yml` workflow will automatically test and publish to npm

Note: `src/cli.js` dynamically imports version from `package.json` to ensure consistency.

## AI Agent Integration

This package follows the **Agent-Ready CLI** pattern: a CLI designed for both humans and AI agents.

### The Pattern

Traditional CLIs are for humans. Agent-ready CLIs add:
1. **Structured output** (`--json`, `analyze`) for agents to parse
2. **Opinionated commands** with built-in safety (log before delete, undo)
3. **Skills** that teach agents how to use the tool effectively

### Skill Installation

The skill can be installed globally for all Claude Code sessions:

```bash
inbox install-skill      # Install to ~/.claude/skills/
inbox install-skill --uninstall  # Remove
```

The `inbox setup` wizard also offers to install the skill automatically.

### Skill Location & Update Detection

| Location | Purpose |
|----------|---------|
| `.claude/skills/inbox-assistant/SKILL.md` | Source (bundled with package) |
| `~/.claude/skills/inbox-assistant/SKILL.md` | Installed (global for Claude Code) |

The skill uses content-hash detection (no version field). Updates are detected automatically:
- On `npm install`: Auto-updates if skill already installed
- Manual: Run `inbox install-skill` to update

Safety features:
- `source: inboxd` marker identifies ownership (won't overwrite user's own skills)
- Creates `SKILL.md.backup` before replacing modified files
- Use `--force` to override ownership check

### Architecture

```
src/skill-installer.js    # Handles copying skill to ~/.claude/skills/
scripts/postinstall.js    # npm postinstall hint about install-skill
```

### What the Skill Provides
- **Triage**: Classify emails (Important, Newsletters, Promotions, Notifications, Low-Priority)
- **Cleanup**: Identify and delete low-value emails with user confirmation
- **Restore**: Undo accidental deletions
- **Safety**: Never auto-deletes, batch limits, always shows what will be deleted

### Key Commands for AI Use
| Command | Purpose |
|---------|---------|
| `inbox summary --json` | Quick status check (unread counts) |
| `inbox analyze --count 50` | Get email data as JSON for classification |
| `inbox analyze --group-by sender` | Group emails by sender domain |
| `inbox analyze --older-than 30d` | Find emails older than 30 days (server-side filtering) |
| `inbox delete --ids "id1,id2" --confirm` | Delete specific emails by ID |
| `inbox delete --sender "pattern" --dry-run` | Preview deletion by sender filter |
| `inbox delete --match "pattern" --dry-run` | Preview deletion by subject filter |
| `inbox restore --last N` | Undo last N deletions |
| `inbox read --id <id>` | Read full email content |
| `inbox read --id <id> --links` | Extract links from email |
| `inbox search -q <query>` | Search using Gmail query syntax |
| `inbox send -t <to> -s <subj> -b <body> --confirm` | Send email (requires --confirm) |
| `inbox reply --id <id> -b <body> --confirm` | Reply to email (requires --confirm) |
| `inbox mark-read --ids "id1,id2"` | Mark emails as read |
| `inbox mark-unread --ids "id1,id2"` | Mark emails as unread (undo mark-read) |
| `inbox archive --ids "id1,id2" --confirm` | Archive emails (remove from inbox) |
| `inbox unarchive --last N` | Undo last N archives |
| `inbox stats` | Show email activity dashboard (deletions, sent) |
| `inbox stats --json` | Get stats as JSON |
| `inbox cleanup-suggest` | Get smart cleanup suggestions based on patterns |
| `inbox accounts --json` | List accounts as JSON |
| `inbox deletion-log --json` | Get deletion log as JSON |
| `inbox delete --dry-run --json` | Preview deletion as JSON |
| `inbox install-skill` | Install/update the Claude Code skill |
| `inbox install-service --uninstall` | Remove background service |

### Smart Filtering Options
| Option | Description |
|--------|-------------|
| `--sender <pattern>` | Case-insensitive substring match on From field |
| `--match <pattern>` | Case-insensitive substring match on Subject field |
| `--limit <N>` | Max emails for filter operations (default: 50) |
| `--force` | Override safety warnings (short patterns, large batches) |
| `--dry-run` | Preview what would be deleted without deleting |

### Send/Reply Safety
The `send` and `reply` commands have built-in safety features:
- **Interactive confirmation**: Prompts "Send this email? (y/N)" when no flags provided
- **`--dry-run`**: Preview the email without sending
- **`--confirm`**: Skip the interactive prompt (for automation/scripts)
- **Audit logging**: All sent emails are logged to `~/.config/inboxd/sent-log.json`
- **Account resolution**: Prompts for account selection when multiple accounts exist

### Email Object Shape (from `analyze`)
```json
{
  "id": "18e9abc123",
  "from": "Sender <email@example.com>",
  "subject": "Email Subject",
  "snippet": "Preview text...",
  "date": "Fri, 03 Jan 2026 10:30:00 -0800",
  "account": "personal",
  "labelIds": ["UNREAD", "CATEGORY_PROMOTIONS"]
}
```

