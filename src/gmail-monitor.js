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

/**
 * Marks emails as read by removing the UNREAD label
 * @param {string} account - Account name
 * @param {Array<string>} messageIds - Array of message IDs to mark as read
 * @returns {Array<{id: string, success: boolean, error?: string}>} Results for each message
 */
async function markAsRead(account, messageIds) {
  const gmail = await getGmailClient(account);
  const results = [];

  for (const id of messageIds) {
    try {
      await withRetry(() => gmail.users.messages.modify({
        userId: 'me',
        id: id,
        requestBody: {
          removeLabelIds: ['UNREAD'],
        },
      }));
      results.push({ id, success: true });
    } catch (err) {
      results.push({ id, success: false, error: err.message });
    }
  }

  return results;
}

/**
 * Archives emails by removing the INBOX label
 * @param {string} account - Account name
 * @param {Array<string>} messageIds - Array of message IDs to archive
 * @returns {Array<{id: string, success: boolean, error?: string}>} Results for each message
 */
async function archiveEmails(account, messageIds) {
  const gmail = await getGmailClient(account);
  const results = [];

  for (const id of messageIds) {
    try {
      await withRetry(() => gmail.users.messages.modify({
        userId: 'me',
        id: id,
        requestBody: {
          removeLabelIds: ['INBOX'],
        },
      }));
      results.push({ id, success: true });
    } catch (err) {
      results.push({ id, success: false, error: err.message });
    }
  }

  return results;
}

/**
 * Extracts the domain from a From header value
 * @param {string} from - e.g., "Sender Name <sender@example.com>" or "sender@example.com"
 * @returns {string} Normalized domain (e.g., "example.com") or lowercased from if no domain found
 */
function extractSenderDomain(from) {
  if (!from) return '';
  // Match email in angle brackets or bare email
  const emailMatch = from.match(/<([^>]+)>/) || from.match(/([^\s]+@[^\s]+)/);
  if (emailMatch) {
    const email = emailMatch[1];
    const domain = email.split('@')[1];
    return domain ? domain.toLowerCase() : email.toLowerCase();
  }
  return from.toLowerCase();
}

/**
 * Groups emails by sender domain
 * @param {Array<Object>} emails - Array of email objects with from, id, subject, date, account
 * @returns {{groups: Array<{sender: string, senderDisplay: string, count: number, emails: Array}>, totalCount: number}}
 */
function groupEmailsBySender(emails) {
  const groups = {};

  for (const email of emails) {
    const domain = extractSenderDomain(email.from);
    if (!groups[domain]) {
      groups[domain] = {
        sender: domain,
        senderDisplay: email.from,
        count: 0,
        emails: [],
      };
    }
    groups[domain].count++;
    groups[domain].emails.push({
      id: email.id,
      subject: email.subject,
      date: email.date,
      account: email.account,
    });
  }

  // Convert to array and sort by count descending
  const groupArray = Object.values(groups).sort((a, b) => b.count - a.count);
  return { groups: groupArray, totalCount: emails.length };
}

module.exports = {
  getUnreadEmails,
  getEmailCount,
  trashEmails,
  getEmailById,
  untrashEmails,
  markAsRead,
  archiveEmails,
  extractSenderDomain,
  groupEmailsBySender,
  getEmailContent,
  searchEmails,
  sendEmail,
  replyToEmail,
};

/**
 * Gets full email content by ID
 * @param {string} account - Account name
 * @param {string} messageId - Message ID
 * @returns {Object|null} Email object with body or null if not found
 */
async function getEmailContent(account, messageId) {
  try {
    const gmail = await getGmailClient(account);
    const detail = await withRetry(() => gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    }));

    const headers = detail.data.payload.headers;
    const getHeader = (name) => {
      const header = headers.find((h) => h.name === name);
      return header ? header.value : '';
    };

    // Helper to decode base64url content
    const decode = (str) => {
      if (!str) return '';
      return Buffer.from(str, 'base64url').toString('utf8');
    };

    // Helper to find body in payload parts
    const getBody = (payload) => {
      if (payload.body && payload.body.data) {
        return {
          type: payload.mimeType,
          content: decode(payload.body.data)
        };
      }

      if (payload.parts) {
        // Prefer text/plain, then text/html
        let part = payload.parts.find(p => p.mimeType === 'text/plain');
        if (!part) {
          part = payload.parts.find(p => p.mimeType === 'text/html');
        }

        // Recursive check for nested parts (multipart/alternative inside multipart/mixed)
        if (!part) {
           for (const p of payload.parts) {
             if (p.parts) {
               const found = getBody(p);
               if (found && found.content) return found;
             }
           }
        }

        if (part && part.body && part.body.data) {
          return {
            type: part.mimeType,
            content: decode(part.body.data)
          };
        }
      }

      return { type: 'text/plain', content: '(No content found)' };
    };

    const bodyData = getBody(detail.data.payload);

    return {
      id: messageId,
      threadId: detail.data.threadId,
      labelIds: detail.data.labelIds || [],
      account,
      from: getHeader('From'),
      subject: getHeader('Subject'),
      date: getHeader('Date'),
      snippet: detail.data.snippet,
      body: bodyData.content,
      mimeType: bodyData.type
    };
  } catch (error) {
    console.error(`Error fetching email content ${messageId}:`, error.message);
    return null;
  }
}

/**
 * Searches for emails using Gmail query syntax
 * @param {string} account - Account name
 * @param {string} query - Gmail search query (e.g. "is:unread from:google")
 * @param {number} maxResults - Max results to return
 * @returns {Array} List of email metadata objects
 */
async function searchEmails(account, query, maxResults = 20) {
  try {
    const gmail = await getGmailClient(account);
    const res = await withRetry(() => gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults,
    }));

    const messages = res.data.messages;
    if (!messages || messages.length === 0) {
      return [];
    }

    const emailPromises = messages.map(async (msg) => {
      try {
        // Reuse getEmailById logic but simpler inline here since we might want specific fields
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
    console.error(`Error searching emails for ${account}:`, error.message);
    return [];
  }
}

/**
 * Sends an email
 * @param {string} account - Account name
 * @param {Object} options - { to, subject, body }
 * @returns {Object} Result object
 */
async function sendEmail(account, { to, subject, body }) {
  try {
    const gmail = await getGmailClient(account);

    // Construct raw email RFC 2822
    // Simple text/plain construction
    const messageParts = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'MIME-Version: 1.0',
      '',
      body
    ];

    const message = messageParts.join('\n');
    const encodedMessage = Buffer.from(message).toString('base64url');

    const res = await withRetry(() => gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage
      }
    }));

    return { success: true, id: res.data.id, threadId: res.data.threadId };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Reply to an email
 * @param {string} account - Account name
 * @param {string} messageId - ID of the message to reply to
 * @param {string} body - Reply content
 * @returns {Object} Result object
 */
async function replyToEmail(account, messageId, body) {
  try {
    const gmail = await getGmailClient(account);

    // Get original message to find Reference/In-Reply-To headers and Subject
    const original = await withRetry(() => gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata',
      metadataHeaders: ['Subject', 'Message-ID', 'References', 'To', 'From']
    }));

    const headers = original.data.payload.headers;
    const getHeader = (name) => {
      const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
      return header ? header.value : '';
    };

    const originalSubject = getHeader('Subject');
    const originalMessageId = getHeader('Message-ID');
    const originalReferences = getHeader('References');
    const originalFrom = getHeader('From'); // We reply to this person

    // Construct subject (add Re: if not present)
    const subject = originalSubject.toLowerCase().startsWith('re:')
      ? originalSubject
      : `Re: ${originalSubject}`;

    // Construct references
    const references = originalReferences
      ? `${originalReferences} ${originalMessageId}`
      : originalMessageId;

    // Extract email from "From" header for "To" field
    const to = originalFrom;

    const messageParts = [
      `To: ${to}`,
      `Subject: ${subject}`,
      `In-Reply-To: ${originalMessageId}`,
      `References: ${references}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'MIME-Version: 1.0',
      '',
      body
    ];

    const message = messageParts.join('\n');
    const encodedMessage = Buffer.from(message).toString('base64url');

    const res = await withRetry(() => gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
        threadId: original.data.threadId
      }
    }));

    return { success: true, id: res.data.id, threadId: res.data.threadId };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
