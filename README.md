# Inboxd

[![npm version](https://img.shields.io/npm/v/inboxd.svg)](https://www.npmjs.com/package/inboxd)
[![npm downloads](https://img.shields.io/npm/dm/antigravity-claude-proxy.svg)](https://www.npmjs.com/package/inboxd)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

<a href="https://buymeacoffee.com/dparedesi" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="50"></a>

A CLI tool for monitoring Gmail inboxes with multi-account support and macOS notifications.

![VoxScriber Banner](images/banner.png)

## Features

- **Multi-account support** - Monitor multiple Gmail accounts from one command
- **macOS notifications** - Get notified when new emails arrive
- **Background monitoring** - Run as a launchd service
- **Delete & restore** - Safely trash emails with undo capability
- **AI-ready output** - JSON mode for integration with AI agents
- **Interactive setup** - Guided wizard for first-time configuration

## Installation

```bash
npm install -g inboxd
```

## Quick Start

Run the interactive setup wizard:

```bash
inbox setup
```

The wizard will guide you through:
1. Opening Google Cloud Console to create OAuth credentials
2. Validating and installing your credentials file
3. Authenticating your first Gmail account

That's it! You're ready to go.

## Manual Setup

If you prefer to set up manually:

### 1. Get Gmail API Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project and enable the **Gmail API**
3. Configure OAuth consent screen (add yourself as test user)
4. Create OAuth credentials (Desktop app)
5. Download and save as `~/.config/inboxd/credentials.json`:

```bash
mkdir -p ~/.config/inboxd
mv ~/Downloads/client_secret_*.json ~/.config/inboxd/credentials.json
```

### 2. Authenticate

```bash
inbox auth --account personal
```

### 3. Check Your Inbox

```bash
inbox summary
```

## Commands

| Command | Description |
|---------|-------------|
| `inbox setup` | Interactive setup wizard |
| `inbox auth -a <name>` | Authenticate a Gmail account |
| `inbox accounts` | List configured accounts |
| `inbox summary` | Show inbox summary for all accounts |
| `inbox check` | Check for new emails + send notifications |
| `inbox check -q` | Silent check (for background use) |
| `inbox delete --ids <ids>` | Move emails to trash |
| `inbox restore --last 1` | Restore last deleted email |
| `inbox deletion-log` | View deletion history |
| `inbox logout --all` | Remove all accounts |
| `inbox install-service` | Install background monitoring (macOS) |
| `inbox install-skill` | Install Claude Code skill for AI agents |

## Configuration

All configuration is stored in `~/.config/inboxd/`:

| File | Purpose |
|------|---------|
| `credentials.json` | Your OAuth client credentials |
| `accounts.json` | List of configured accounts |
| `token-<account>.json` | OAuth tokens per account |
| `state-<account>.json` | Seen email tracking per account |
| `deletion-log.json` | Record of deleted emails |

## Background Monitoring

Install as a macOS launchd service to check for new emails periodically:

```bash
# Install and start with default 5-minute interval
inbox install-service

# Or customize the interval
inbox install-service --interval 10
```

The service starts automatically after installation. Manage it with:

```bash
# Check status
launchctl list | grep inboxd

# View logs
tail -f /tmp/inboxd.log

# Stop service
launchctl unload ~/Library/LaunchAgents/com.danielparedes.inboxd.plist
```

**Note:** `install-service` is macOS-only. For Linux, use cron:
```bash
*/5 * * * * /path/to/node /path/to/inbox check --quiet
```

## JSON Output

For AI agent integration, use the `--json` flag:

```bash
inbox summary --json
```

Or use the `analyze` command for structured output:

```bash
inbox analyze --count 20
```

## AI Agent Integration

This package is designed to be used by both humans and AI agents. While the CLI works great on its own, it really shines when paired with an AI coding assistant like Claude Code.

### The Pattern: Agent-Ready CLI Tools

Traditional CLI tools are designed for humans. But with AI agents becoming capable of using tools, we can make CLIs that work for both:

1. **Structured output** (`--json`, `analyze`) for agents to parse
2. **Opinionated commands** with built-in safety (logging before delete, undo capability)
3. **Skills** that teach agents how to use the tool effectively

This package includes a **skill** that can be installed globally, enabling any Claude Code session to manage your inbox intelligently.

### Installing the Skill

After installing inboxd, run:

```bash
inbox install-skill
```

This copies the inbox-assistant skill to `~/.claude/skills/`, making it available in all your Claude Code sessions.

The setup wizard (`inbox setup`) also offers to install the skill automatically.

### What the Skill Enables

Once installed, you can ask Claude Code things like:

- "Check my emails" → Summary + recommendations
- "Clean up my inbox" → Identifies deletable emails, confirms before removing
- "What's important?" → Surfaces action-required emails only
- "Undo" → Restores recently deleted emails

The skill provides:

| Capability | Description |
|------------|-------------|
| **Triage** | Classifies emails into Important, Newsletters, Promotions, Notifications, Low-Priority |
| **Cleanup** | Identifies deletable emails and presents them for confirmation |
| **Restore** | Provides undo capability for accidental deletions |
| **Safety** | Never auto-deletes, enforces batch limits, always shows before deleting |

### Updating the Skill

When you update inboxd, run `inbox install-skill` again to get the latest skill version:

```bash
npm update -g inboxd
inbox install-skill
```

### CLI vs MCP

Unlike an MCP server that exposes raw Gmail API primitives, `inboxd` provides **opinionated commands** with built-in safety:

| inboxd CLI | Raw Gmail MCP |
|------------|---------------|
| `inbox delete` logs before trashing | Just trashes |
| `inbox restore` removes from log | Just untrashes |
| `inbox analyze` formats for AI consumption | Raw API response |

The skill layer adds expert workflow guidance on top of these commands.

## Uninstalling

To remove the package:

```bash
npm uninstall -g inboxd
```

To also remove all account data and tokens:

```bash
inbox logout --all
```

To completely remove all data including credentials:

```bash
rm -rf ~/.config/inboxd
```

**Note:** `npm uninstall` only removes the package itself. Your OAuth credentials and account data in `~/.config/inboxd/` are preserved so you can reinstall without reconfiguring. Use the commands above if you want to remove that data.

## Troubleshooting

**"credentials.json not found"**
Run `inbox setup` or manually download OAuth credentials from Google Cloud Console and save to `~/.config/inboxd/credentials.json`.

**"Token expired"**
Delete the token file and re-authenticate:
```bash
rm ~/.config/inboxd/token-<account>.json
inbox auth -a <account>
```

**No notifications appearing**
Check macOS notification settings for Terminal/Node.js in System Preferences > Notifications.

**"install-service is only supported on macOS"**
The launchd service is macOS-specific. For other platforms, set up a cron job or scheduled task manually.

## License

MIT
