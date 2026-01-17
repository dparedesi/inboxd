# inboxd

CLI tool for Gmail monitoring with multi-account support.

## Design Philosophy

**Why a CLI wrapper instead of raw Gmail API/MCP access?**

The CLI is a **trust boundary**. It encodes safe behaviors as *code* rather than *instructions*:

- **Deletion logging is enforced** - `gmail-monitor.js` always logs before trashing. An AI can't skip it.
- **Restore works reliably** - Because logging is guaranteed, `restore --last N` always works.
- **State persists across sessions** - Preferences, deletion log, archive log survive between AI conversations.
- **Opinions encoded as code** - `cleanup-suggest`, `analyze --group-by sender` implement domain logic the AI doesn't need to reinvent.

With raw MCP/API access, the skill says "please log deletions" and hopes the AI complies. With inboxd, compliance is guaranteed by architecture.

**The pattern:** CLI = safe primitives, Skill = domain expertise on top.

## Quick Reference

```bash
npm test                    # Run tests
npm run test:watch          # Watch mode
inboxd setup                 # First-time setup wizard
inboxd auth -a <name>        # Add account
inboxd summary               # Check all inboxes
```

## Architecture

```
src/
├── cli.js            # Entry point, command definitions (commander)
├── gmail-auth.js     # OAuth2 flow, token storage, multi-account management
├── gmail-monitor.js  # Gmail API: fetch, count, trash, restore, archive
├── deletion-log.js   # Logs deleted emails for restore capability
├── archive-log.js    # Logs archived emails for unarchive capability
├── sent-log.js       # Logs sent emails for audit trail
├── usage-log.js      # Logs command usage locally for analytics
└── skill-installer.js # Copies skill to ~/.claude/skills/

scripts/
└── postinstall.js    # npm postinstall - auto-installs skill

tests/                # Vitest tests with mocked Google APIs
__mocks__/            # Manual mocks for googleapis, @google-cloud/local-auth
```

## Tech Stack

- **Runtime**: Node.js 18+ (CommonJS)
- **Gmail API**: `googleapis`, `@google-cloud/local-auth`
- **CLI**: `commander`
- **UI**: `chalk`, `boxen` (ESM packages, loaded via dynamic import)
- **Testing**: `vitest`

## Data Storage

All user data lives in `~/.config/inboxd/`:

| File | Content |
|------|---------|
| `credentials.json` | OAuth client ID/secret from Google Cloud |
| `accounts.json` | `[{ name, email }]` for each linked account |
| `token-<name>.json` | OAuth refresh/access tokens |
| `deletion-log.json` | Audit log for deleted emails |
| `archive-log.json` | Audit log for archived emails |
| `sent-log.json` | Audit log for sent emails |
| `usage-log.jsonl` | Local command usage analytics (JSONL) |

## Code Patterns

- **CommonJS** for all source files
- **Dynamic import** for ESM-only deps (`chalk`, `boxen`)
- **Functional style**, no classes
- **Retry with backoff** in `gmail-monitor.js` for API calls
- **Silent fail** for missing config files (returns defaults)

## Key Behaviors

- `inboxd setup` guides first-time users through credentials and auth
- `inboxd delete` logs to `deletion-log.json` before trashing
- `inboxd restore` moves from Trash to Inbox, removes log entry
- `inboxd archive` logs to `archive-log.json` before archiving
- `inboxd unarchive` moves archived emails back to Inbox, removes log entry
- `inboxd send/reply` prompts for interactive confirmation (or use `--confirm` to skip)

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

The skill is installed automatically on `npm install -g inboxd` via the postinstall script.

The `inboxd setup` wizard also offers to install the skill interactively.

### Skill Location & Update Detection

| Location | Purpose |
|----------|---------|
| `.claude/skills/inbox-assistant/SKILL.md` | Source (bundled with package) |
| `~/.claude/skills/inbox-assistant/SKILL.md` | Installed (global for Claude Code) |

The skill uses content-hash detection (no version field). Updates are detected automatically on `npm install`.

Safety features:
- `source: inboxd` marker identifies ownership (won't overwrite user's own skills)
- Creates `SKILL.md.backup` before replacing modified files

**IMPORTANT:** Never modify the installed skill at `~/.claude/skills/` directly.
The update flow is:
1. Modify source in `.claude/skills/inbox-assistant/SKILL.md`
2. Create `gh release`
3. `publish.yml` workflow publishes to npm
4. User runs `npm install -g inboxd` to update

### Architecture

```
src/skill-installer.js    # Handles copying skill to ~/.claude/skills/
scripts/postinstall.js    # npm postinstall - auto-installs skill
```

### What the Skill Provides
- **Triage**: Classify emails (Important, Newsletters, Promotions, Notifications, Low-Priority)
- **Cleanup**: Identify and delete low-value emails with user confirmation
- **Restore**: Undo accidental deletions
- **Safety**: Never auto-deletes, batch limits, always shows what will be deleted

### Key Commands for AI Use
| Command | Purpose |
|---------|---------|
| `inboxd summary --json` | Quick status check (unread counts) |
| `inboxd analyze --count 50` | Get email data as JSON for classification |
| `inboxd analyze --group-by sender` | Group emails by sender domain |
| `inboxd analyze --older-than 30d` | Find emails older than 30 days (server-side filtering) |
| `inboxd delete --ids "id1,id2" --confirm` | Delete specific emails by ID |
| `inboxd delete --sender "pattern" --dry-run` | Preview deletion by sender filter |
| `inboxd delete --match "pattern" --dry-run` | Preview deletion by subject filter |
| `inboxd restore --last N` | Undo last N deletions |
| `inboxd read --id <id>` | Read full email content |
| `inboxd read --id <id> --links` | Extract links from email |
| `inboxd search -q <query>` | Search using Gmail query syntax (default 100 results) |
| `inboxd search -q <query> --count` | Quick count without fetching details |
| `inboxd search -q <query> --all --max 200` | Fetch all matches with pagination |
| `inboxd send -t <to> -s <subj> -b <body> --confirm` | Send email (requires --confirm) |
| `inboxd reply --id <id> -b <body> --confirm` | Reply to email (requires --confirm) |
| `inboxd mark-read --ids "id1,id2"` | Mark emails as read |
| `inboxd mark-unread --ids "id1,id2"` | Mark emails as unread (undo mark-read) |
| `inboxd archive --ids "id1,id2" --confirm` | Archive emails (remove from inbox) |
| `inboxd unarchive --last N` | Undo last N archives |
| `inboxd stats` | Show email activity dashboard (deletions, sent) |
| `inboxd stats --json` | Get stats as JSON |
| `inboxd usage` | Show local command usage dashboard |
| `inboxd usage --json` | Get usage stats as JSON |
| `inboxd usage --export` | Export raw usage log (JSONL) |
| `inboxd usage --clear` | Clear local usage log |
| `inboxd cleanup-suggest` | Get smart cleanup suggestions based on patterns |
| `inboxd accounts --json` | List accounts as JSON |
| `inboxd deletion-log --json` | Get deletion log as JSON |
| `inboxd delete --dry-run --json` | Preview deletion as JSON |
| `inboxd preferences` | View/validate AI preferences |
| `inboxd preferences set --section <s> --entry "<text>"` | Add preference entry (idempotent) |
| `inboxd preferences remove --section <s> --match "<pat>"` | Remove entries by pattern |
| `inboxd preferences list --section <s> --json` | List section entries as JSON |

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
