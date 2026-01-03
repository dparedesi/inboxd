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
# Install with default 5-minute interval
inbox install-service

# Or customize the interval
inbox install-service --interval 10
```

Manage the service:

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
