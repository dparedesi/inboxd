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
inbox install-service       # Install launchd service (macOS only)
```

## Architecture

```
src/
├── cli.js            # Entry point, command definitions (commander)
├── gmail-auth.js     # OAuth2 flow, token storage, multi-account management
├── gmail-monitor.js  # Gmail API: fetch, count, trash, restore
├── state.js          # Tracks seen emails per account
├── deletion-log.js   # Logs deleted emails for restore capability
└── notifier.js       # macOS notifications (node-notifier)

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
- `install-service` generates launchd plist dynamically (macOS only, warns on other platforms)

## OAuth Notes

- Gmail API requires OAuth consent screen with test users for external accounts
- Tokens auto-refresh; delete token file to force re-auth
- Credentials can be in project root (dev) or `~/.config/inboxd/` (installed)

## Release Process

1. Bump version in `package.json`
2. Commit changes
3. Create a GitHub Release (e.g., `gh release create v1.0.3`)
4. The `publish.yml` workflow will automatically test and publish to npm
   - Note: `src/cli.js` dynamically imports version from `package.json` to ensure consistency

