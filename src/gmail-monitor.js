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
 * Marks emails as unread by adding the UNREAD label
 * @param {string} account - Account name
 * @param {Array<string>} messageIds - Array of message IDs to mark as unread
 * @returns {Array<{id: string, success: boolean, error?: string}>} Results for each message
 */
async function markAsUnread(account, messageIds) {
  const gmail = await getGmailClient(account);
  const results = [];

  for (const id of messageIds) {
    try {
      await withRetry(() => gmail.users.messages.modify({
        userId: 'me',
        id: id,
        requestBody: {
          addLabelIds: ['UNREAD'],
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

/**
 * Decodes base64url encoded content
 * @param {string} str - Base64url encoded string
 * @returns {string} Decoded UTF-8 string
 */
function decodeBase64Url(str) {
  if (!str) return '';
  return Buffer.from(str, 'base64url').toString('utf8');
}

/**
 * Extracts body content from a Gmail message payload
 * Handles multipart messages recursively
 * @param {Object} payload - Gmail message payload
 * @param {Object} options - { preferHtml: boolean } - prefer HTML for link extraction
 * @returns {{type: string, content: string}} Body content with mime type
 */
function extractBody(payload, options = {}) {
  const { preferHtml = false } = options;

  // Simple case: body data directly in payload
  if (payload.body && payload.body.data) {
    return {
      type: payload.mimeType,
      content: decodeBase64Url(payload.body.data)
    };
  }

  if (!payload.parts) {
    return { type: 'text/plain', content: '' };
  }

  // Determine preference order based on options
  const mimeOrder = preferHtml
    ? ['text/html', 'text/plain']
    : ['text/plain', 'text/html'];

  for (const mimeType of mimeOrder) {
    const part = payload.parts.find(p => p.mimeType === mimeType);
    if (part && part.body && part.body.data) {
      return {
        type: mimeType,
        content: decodeBase64Url(part.body.data)
      };
    }
  }

  // Recursive check for nested multipart (e.g., multipart/mixed containing multipart/alternative)
  for (const part of payload.parts) {
    if (part.parts) {
      const found = extractBody(part, options);
      if (found.content) {
        return found;
      }
    }
  }

  return { type: 'text/plain', content: '' };
}

/**
 * Validates URL scheme - filters out non-http(s) schemes
 * @param {string} url - URL to validate
 * @returns {boolean} True if URL should be included
 */
function isValidUrl(url) {
  if (!url) return false;
  const lowerUrl = url.toLowerCase().trim();
  // Only allow http and https
  return lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://');
}

/**
 * Extracts links from email body content
 * @param {string} body - Email body content
 * @param {string} mimeType - 'text/html' or 'text/plain'
 * @returns {Array<{url: string, text: string|null}>} Extracted links
 */
function extractLinks(body, mimeType) {
  if (!body) return [];

  const links = [];
  const seenUrls = new Set();

  // For HTML, extract from anchor tags first (captures link text)
  if (mimeType === 'text/html') {
    // Match <a href="URL">Text</a> - handles attributes in any order
    const hrefRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
    let match;
    while ((match = hrefRegex.exec(body)) !== null) {
      const url = decodeHtmlEntities(match[1].trim());
      const text = match[2].trim() || null;
      if (!seenUrls.has(url) && isValidUrl(url)) {
        seenUrls.add(url);
        links.push({ url, text });
      }
    }
  }

  // Also extract plain URLs (works for both HTML and plain text)
  // This catches URLs not in anchor tags
  const urlRegex = /https?:\/\/[^\s<>"']+/gi;
  let urlMatch;
  while ((urlMatch = urlRegex.exec(body)) !== null) {
    // Clean trailing punctuation that's likely not part of the URL
    let url = urlMatch[0].replace(/[.,;:!?)>\]]+$/, '');
    // Also handle HTML entity at end
    url = url.replace(/&[a-z]+;?$/i, '');
    // Decode HTML entities for consistency (important for HTML content)
    url = decodeHtmlEntities(url);
    if (!seenUrls.has(url) && isValidUrl(url)) {
      seenUrls.add(url);
      links.push({ url, text: null });
    }
  }

  return links;
}

/**
 * Decodes common HTML entities in URLs
 * @param {string} str - String potentially containing HTML entities
 * @returns {string} Decoded string
 */
function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Gets full email content by ID
 * @param {string} account - Account name
 * @param {string} messageId - Message ID
 * @param {Object} options - { preferHtml: boolean } - prefer HTML for link extraction
 * @returns {Object|null} Email object with body or null if not found
 */
async function getEmailContent(account, messageId, options = {}) {
  try {
    const gmail = await getGmailClient(account);
    const detail = await withRetry(() => gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    }));

    const headers = detail.data.payload.headers;
    const getHeader = (name) => {
      const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
      return header ? header.value : '';
    };

    const bodyData = extractBody(detail.data.payload, options);

    return {
      id: messageId,
      threadId: detail.data.threadId,
      labelIds: detail.data.labelIds || [],
      account,
      from: getHeader('From'),
      to: getHeader('To'),
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
        const detail = await withRetry(() => gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        }));

        const headers = detail.data.payload.headers;
        const getHeader = (name) => {
          const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
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
 * Composes a raw RFC 2822 email message
 * @param {Object} options - { to, subject, body, inReplyTo?, references? }
 * @returns {string} Base64url encoded message
 */
function composeMessage({ to, subject, body, inReplyTo, references }) {
  const messageParts = [
    `To: ${to}`,
    `Subject: ${subject}`,
  ];

  if (inReplyTo) {
    messageParts.push(`In-Reply-To: ${inReplyTo}`);
  }
  if (references) {
    messageParts.push(`References: ${references}`);
  }

  messageParts.push(
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    '',
    body
  );

  return Buffer.from(messageParts.join('\n')).toString('base64url');
}

/**
 * Sends an email
 * @param {string} account - Account name
 * @param {Object} options - { to, subject, body }
 * @returns {Object} Result object with success, id, threadId, or error
 */
async function sendEmail(account, { to, subject, body }) {
  try {
    const gmail = await getGmailClient(account);
    const encodedMessage = composeMessage({ to, subject, body });

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
 * @returns {Object} Result object with success, id, threadId, or error
 */
async function replyToEmail(account, messageId, body) {
  try {
    const gmail = await getGmailClient(account);

    // Get original message headers
    const original = await withRetry(() => gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata',
      metadataHeaders: ['Subject', 'Message-ID', 'References', 'Reply-To', 'From']
    }));

    const headers = original.data.payload.headers;
    const getHeader = (name) => {
      const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
      return header ? header.value : '';
    };

    const originalSubject = getHeader('Subject');
    const originalMessageId = getHeader('Message-ID');
    const originalReferences = getHeader('References');
    // Prefer Reply-To header, fallback to From
    const replyTo = getHeader('Reply-To');
    const originalFrom = getHeader('From');
    const to = replyTo || originalFrom;

    // Add Re: prefix if not present
    const subject = originalSubject.toLowerCase().startsWith('re:')
      ? originalSubject
      : `Re: ${originalSubject}`;

    // Build references chain
    const references = originalReferences
      ? `${originalReferences} ${originalMessageId}`
      : originalMessageId;

    const encodedMessage = composeMessage({
      to,
      subject,
      body,
      inReplyTo: originalMessageId,
      references
    });

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

module.exports = {
  getUnreadEmails,
  getEmailCount,
  trashEmails,
  getEmailById,
  untrashEmails,
  markAsRead,
  markAsUnread,
  archiveEmails,
  extractSenderDomain,
  groupEmailsBySender,
  getEmailContent,
  searchEmails,
  sendEmail,
  replyToEmail,
  extractLinks,
  // Exposed for testing
  extractBody,
  decodeBase64Url,
  composeMessage,
  isValidUrl,
  decodeHtmlEntities,
};
