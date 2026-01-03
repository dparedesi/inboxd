const { getGmailClient } = require('./gmail-auth');

/**
 * Executes an async operation with a single retry on network errors.
 * Max 2 attempts total (initial + 1 retry).
 * Delays 1 second before retry.
 */
async function withRetry(operation) {
  try {
    return await operation();
  } catch (error) {
    // Do not retry on auth errors
    if (error.code === 401 || error.code === 403 || error.response?.status === 401 || error.response?.status === 403) {
      throw error;
    }

    const networkErrors = ['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'];
    const isNetworkError = networkErrors.includes(error.code);
    const isServerError = error.response?.status >= 500;

    if (isNetworkError || isServerError) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return operation();
    }

    throw error;
  }
}

async function getUnreadEmails(account = 'default', maxResults = 20, includeRead = false) {
  try {
    const gmail = await getGmailClient(account);

    const res = await withRetry(() => gmail.users.messages.list({
      userId: 'me',
      q: includeRead ? '' : 'is:unread',
      maxResults,
    }));

    const messages = res.data.messages;
    if (!messages || messages.length === 0) {
      return [];
    }

    const emailPromises = messages.map(async (msg) => {
      try {
        const detail = await withRetry(() => gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        }));

        const headers = detail.data.payload.headers;
        const getHeader = (name) => {
          const header = headers.find((h) => h.name === name);
          return header ? header.value : '';
        };

        return {
          id: msg.id,
          threadId: detail.data.threadId,
          labelIds: detail.data.labelIds || [],
          account,
          from: getHeader('From'),
          subject: getHeader('Subject'),
          snippet: detail.data.snippet,
          date: getHeader('Date'),
        };
      } catch (_err) {
        return null;
      }
    });

    const results = await Promise.all(emailPromises);
    return results.filter((email) => email !== null);
  } catch (error) {
    console.error(`Error in getUnreadEmails for ${account}:`, error.message);
    return [];
  }
}

async function getEmailCount(account = 'default') {
  try {
    const gmail = await getGmailClient(account);
    const res = await withRetry(() => gmail.users.labels.get({
      userId: 'me',
      id: 'INBOX',
    }));
    return res.data.messagesUnread || 0;
  } catch (error) {
    console.error(`Error in getEmailCount for ${account}:`, error.message);
    return 0;
  }
}

/**
 * Moves emails to trash
 * @param {string} account - Account name
 * @param {Array<string>} messageIds - Array of message IDs to trash
 * @returns {Array<{id: string, success: boolean, error?: string}>} Results for each message
 */
async function trashEmails(account, messageIds) {
  const gmail = await getGmailClient(account);
  const results = [];

  for (const id of messageIds) {
    try {
      await withRetry(() => gmail.users.messages.trash({
        userId: 'me',
        id: id,
      }));
      results.push({ id, success: true });
    } catch (err) {
      results.push({ id, success: false, error: err.message });
    }
  }

  return results;
}

/**
 * Gets email details by ID (for logging before deletion)
 * @param {string} account - Account name
 * @param {string} messageId - Message ID
 * @returns {Object|null} Email object or null if not found
 */
async function getEmailById(account, messageId) {
  try {
    const gmail = await getGmailClient(account);
    const detail = await withRetry(() => gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date'],
    }));

    const headers = detail.data.payload.headers;
    const getHeader = (name) => {
      const header = headers.find((h) => h.name === name);
      return header ? header.value : '';
    };

    return {
      id: messageId,
      threadId: detail.data.threadId,
      labelIds: detail.data.labelIds || [],
      account,
      from: getHeader('From'),
      subject: getHeader('Subject'),
      snippet: detail.data.snippet,
      date: getHeader('Date'),
    };
  } catch (_err) {
    return null;
  }
}

/**
 * Restores emails from trash (untrash)
 * @param {string} account - Account name
 * @param {Array<string>} messageIds - Array of message IDs to restore
 * @returns {Array<{id: string, success: boolean, error?: string}>} Results for each message
 */
async function untrashEmails(account, messageIds) {
  const gmail = await getGmailClient(account);
  const results = [];

  for (const id of messageIds) {
    try {
      await withRetry(() => gmail.users.messages.untrash({
        userId: 'me',
        id: id,
      }));
      results.push({ id, success: true });
    } catch (err) {
      results.push({ id, success: false, error: err.message });
    }
  }

  return results;
}

module.exports = {
  getUnreadEmails,
  getEmailCount,
  trashEmails,
  getEmailById,
  untrashEmails,
};
