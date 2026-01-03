const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const { authenticate } = require('@google-cloud/local-auth');
const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];

const TOKEN_DIR = process.env.INBOXD_TOKEN_DIR || path.join(os.homedir(), '.config', 'inboxd');
const ACCOUNTS_FILE = path.join(TOKEN_DIR, 'accounts.json');

function getCredentialsPath() {
  if (process.env.GMAIL_CREDENTIALS_PATH) {
    return process.env.GMAIL_CREDENTIALS_PATH;
  }

  // Priority 1: Current directory (useful for development)
  const localPath = path.join(process.cwd(), 'credentials.json');
  if (fsSync.existsSync(localPath)) {
    return localPath;
  }

  // Priority 2: Config directory (standard for npm global install)
  return path.join(TOKEN_DIR, 'credentials.json');
}

function getTokenPath(account = 'default') {
  return path.join(TOKEN_DIR, `token-${account}.json`);
}

function loadAccounts() {
  try {
    if (fsSync.existsSync(ACCOUNTS_FILE)) {
      return JSON.parse(fsSync.readFileSync(ACCOUNTS_FILE, 'utf8'));
    }
  } catch (_err) {}
  return { accounts: [], defaultAccount: null };
}

function saveAccounts(data) {
  fsSync.mkdirSync(TOKEN_DIR, { recursive: true });
  fsSync.writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2));
}

function getAccounts() {
  return loadAccounts().accounts;
}

function addAccount(name, email) {
  const data = loadAccounts();
  const existing = data.accounts.find(a => a.name === name);
  if (existing) {
    existing.email = email;
  } else {
    data.accounts.push({ name, email });
  }
  if (!data.defaultAccount) {
    data.defaultAccount = name;
  }
  saveAccounts(data);
}

function getDefaultAccount() {
  const data = loadAccounts();
  return data.defaultAccount || (data.accounts[0]?.name) || 'default';
}

function removeAccount(name) {
  const data = loadAccounts();
  data.accounts = data.accounts.filter(a => a.name !== name);
  if (data.defaultAccount === name) {
    data.defaultAccount = data.accounts[0]?.name || null;
  }
  saveAccounts(data);

  // Remove token file
  const tokenPath = getTokenPath(name);
  if (fsSync.existsSync(tokenPath)) {
    fsSync.unlinkSync(tokenPath);
  }

  // Remove state file
  const statePath = path.join(TOKEN_DIR, `state-${name}.json`);
  if (fsSync.existsSync(statePath)) {
    fsSync.unlinkSync(statePath);
  }
}

function removeAllAccounts() {
  const data = loadAccounts();
  const accountNames = data.accounts.map(a => a.name);

  for (const name of accountNames) {
    const tokenPath = getTokenPath(name);
    if (fsSync.existsSync(tokenPath)) {
      fsSync.unlinkSync(tokenPath);
    }
    const statePath = path.join(TOKEN_DIR, `state-${name}.json`);
    if (fsSync.existsSync(statePath)) {
      fsSync.unlinkSync(statePath);
    }
  }

  // Also clean up any legacy files
  const legacyToken = path.join(TOKEN_DIR, 'token.json');
  if (fsSync.existsSync(legacyToken)) {
    fsSync.unlinkSync(legacyToken);
  }
  const legacyState = path.join(TOKEN_DIR, 'state.json');
  if (fsSync.existsSync(legacyState)) {
    fsSync.unlinkSync(legacyState);
  }

  saveAccounts({ accounts: [], defaultAccount: null });
}

function renameTokenFile(oldName, newName) {
  const oldPath = getTokenPath(oldName);
  const newPath = getTokenPath(newName);
  if (fsSync.existsSync(oldPath)) {
    fsSync.renameSync(oldPath, newPath);
  }
}

/**
 * Validates a credentials.json file structure
 * @param {string} filePath - Path to the credentials file
 * @returns {{ valid: boolean, error?: string }} Validation result
 */
function validateCredentialsFile(filePath) {
  if (!fsSync.existsSync(filePath)) {
    return { valid: false, error: 'File not found' };
  }

  try {
    const content = fsSync.readFileSync(filePath, 'utf8');
    const json = JSON.parse(content);

    if (!json.installed && !json.web) {
      return {
        valid: false,
        error: 'Invalid format: missing "installed" or "web" key. Make sure you downloaded OAuth Desktop app credentials.',
      };
    }

    const key = json.installed || json.web;
    if (!key.client_id || !key.client_secret) {
      return {
        valid: false,
        error: 'Invalid format: missing client_id or client_secret',
      };
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, error: `Invalid JSON: ${err.message}` };
  }
}

/**
 * Checks if credentials are configured
 * @returns {boolean}
 */
function hasCredentials() {
  const credentialsPath = getCredentialsPath();
  return fsSync.existsSync(credentialsPath);
}

/**
 * Checks if any accounts are configured
 * @returns {boolean}
 */
function isConfigured() {
  return hasCredentials() && getAccounts().length > 0;
}

/**
 * Copies a credentials file to the config directory
 * @param {string} sourcePath - Source file path
 */
function installCredentials(sourcePath) {
  fsSync.mkdirSync(TOKEN_DIR, { recursive: true });
  const destPath = path.join(TOKEN_DIR, 'credentials.json');
  fsSync.copyFileSync(sourcePath, destPath);
  return destPath;
}

async function loadSavedCredentialsIfExist(account = 'default') {
  try {
    const tokenPath = getTokenPath(account);
    const content = await fs.readFile(tokenPath, 'utf8');
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (_err) {
    return null;
  }
}

async function saveCredentials(client, account = 'default') {
  const credentialsPath = getCredentialsPath();
  const content = await fs.readFile(credentialsPath, 'utf8');
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });

  await fs.mkdir(TOKEN_DIR, { recursive: true });
  await fs.writeFile(getTokenPath(account), payload);
}

async function authorize(account = 'default') {
  let client = await loadSavedCredentialsIfExist(account);
  if (client) {
    return client;
  }

  const credentialsPath = getCredentialsPath();

  try {
    await fs.access(credentialsPath);
  } catch (_err) {
    throw new Error(
      `credentials.json not found at ${credentialsPath}\n\n` +
      `Run 'inbox setup' to configure Gmail API access, or manually:\n` +
      `1. Go to https://console.cloud.google.com/\n` +
      `2. Create a project and enable the Gmail API\n` +
      `3. Configure OAuth consent screen (add yourself as test user)\n` +
      `4. Create OAuth credentials (Desktop app)\n` +
      `5. Download and save to ~/.config/inboxd/credentials.json`
    );
  }

  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: credentialsPath,
  });

  if (client.credentials) {
    await saveCredentials(client, account);
  }
  return client;
}

async function getGmailClient(account = 'default') {
  const auth = await authorize(account);
  return google.gmail({ version: 'v1', auth });
}

async function getAccountEmail(account = 'default') {
  try {
    const gmail = await getGmailClient(account);
    const profile = await gmail.users.getProfile({ userId: 'me' });
    return profile.data.emailAddress;
  } catch (_err) {
    return null;
  }
}

module.exports = {
  getGmailClient,
  authorize,
  getTokenPath,
  getCredentialsPath,
  getAccounts,
  addAccount,
  removeAccount,
  removeAllAccounts,
  getDefaultAccount,
  getAccountEmail,
  renameTokenFile,
  validateCredentialsFile,
  hasCredentials,
  isConfigured,
  installCredentials,
  TOKEN_DIR,
};
