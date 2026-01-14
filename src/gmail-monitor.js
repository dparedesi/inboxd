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

function getHeaderValue(headers, name) {
  if (!Array.isArray(headers)) return '';
  const target = name.toLowerCase();
  const header = headers.find((h) => (h.name || '').toLowerCase() === target);
  return header ? header.value : '';
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
 * Unarchives emails by adding the INBOX label back
 * @param {string} account - Account name
 * @param {Array<string>} messageIds - Array of message IDs to unarchive
 * @returns {Array<{id: string, success: boolean, error?: string}>} Results for each message
 */
async function unarchiveEmails(account, messageIds) {
  const gmail = await getGmailClient(account);
  const results = [];

  for (const id of messageIds) {
    try {
      await withRetry(() => gmail.users.messages.modify({
        userId: 'me',
        id: id,
        requestBody: {
          addLabelIds: ['INBOX'],
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
 * Groups emails by thread ID
 * @param {Array<Object>} emails - Array of email objects with threadId, id, subject, from, date, account
 * @returns {{groups: Array<{threadId: string, subject: string, count: number, participants: Array<string>, emails: Array}>, totalCount: number}}
 */
function groupEmailsByThread(emails) {
  const groups = {};

  for (const email of emails) {
    const threadId = email.threadId || email.id;
    if (!groups[threadId]) {
      groups[threadId] = {
        threadId,
        subject: email.subject || '',
        count: 0,
        participants: new Set(),
        emails: [],
      };
    }
    groups[threadId].count++;
    if (email.from) {
      groups[threadId].participants.add(email.from);
    }
    groups[threadId].emails.push({
      id: email.id,
      subject: email.subject,
      date: email.date,
      account: email.account,
    });
  }

  const groupArray = Object.values(groups)
    .map(group => ({
      threadId: group.threadId,
      subject: group.subject,
      count: group.count,
      participants: Array.from(group.participants),
      emails: group.emails,
    }))
    .sort((a, b) => b.count - a.count);

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
 * Parses List-Unsubscribe header value
 * @param {string} headerValue - Raw List-Unsubscribe header
 * @returns {{links: string[], mailtos: string[]}}
 */
function parseListUnsubscribe(headerValue) {
  if (!headerValue) {
    return { links: [], mailtos: [] };
  }

  const candidates = [];
  const angleMatches = headerValue.match(/<[^>]+>/g);
  if (angleMatches) {
    angleMatches.forEach(match => {
      candidates.push(match.slice(1, -1));
    });
  } else {
    candidates.push(...headerValue.split(','));
  }

  const links = [];
  const mailtos = [];

  candidates.forEach((entry) => {
    const trimmed = entry.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('mailto:')) {
      mailtos.push(trimmed);
      return;
    }
    if (lower.startsWith('http://') || lower.startsWith('https://')) {
      links.push(trimmed);
    }
  });

  return { links, mailtos };
}

/**
 * Finds unsubscribe links in email body
 * @param {string} body - Email body content
 * @param {string} mimeType - Body mime type
 * @returns {string[]} List of unsubscribe URLs
 */
function findUnsubscribeLinksInBody(body, mimeType) {
  if (!body) {
    return { unsubscribeLinks: [], preferenceLinks: [] };
  }

  const urlKeywords = ['unsubscribe', 'optout', 'opt-out'];
  const textKeywords = ['unsubscribe', 'opt out', 'opt-out'];
  const preferenceKeywords = [
    'manage preferences',
    'email preferences',
    'subscription preferences',
    'manage subscription',
    'update preferences',
    'preferences center',
    'preference center',
  ];

  const links = extractLinks(body, mimeType);
  const unsubscribeLinks = [];
  const preferenceLinks = [];
  const seen = new Set();

  links.forEach((link) => {
    const url = link.url || '';
    const lowerUrl = url.toLowerCase();
    const text = link.text || '';
    const lowerText = text.toLowerCase();

    const isUnsubscribe = urlKeywords.some(keyword => lowerUrl.includes(keyword)) ||
      textKeywords.some(keyword => lowerText.includes(keyword));

    if (isUnsubscribe) {
      if (!seen.has(url)) {
        seen.add(url);
        unsubscribeLinks.push(url);
      }
      return;
    }

    const isPreference = preferenceKeywords.some(keyword => lowerText.includes(keyword)) ||
      (lowerText.includes('preferences') && (
        lowerText.includes('email') ||
        lowerText.includes('subscription') ||
        lowerText.includes('newsletter') ||
        lowerText.includes('manage')
      ));

    if (isPreference && !seen.has(url)) {
      seen.add(url);
      preferenceLinks.push(url);
    }
  });

  return { unsubscribeLinks, preferenceLinks };
}

/**
 * Extracts unsubscribe info from headers and body
 * @param {Array<Object>} headers - Message headers
 * @param {string} body - Message body content
 * @param {string} mimeType - Body mime type
 * @returns {{unsubscribeLinks: string[], unsubscribeEmails: string[], oneClick: boolean, sources: {header: boolean, body: boolean}, listUnsubscribe: string, listUnsubscribePost: string}}
 */
function extractUnsubscribeInfo(headers, body, mimeType) {
  const listUnsubscribe = getHeaderValue(headers, 'List-Unsubscribe');
  const listUnsubscribePost = getHeaderValue(headers, 'List-Unsubscribe-Post');

  const { links: headerLinks, mailtos } = parseListUnsubscribe(listUnsubscribe);
  const bodyMatches = findUnsubscribeLinksInBody(body, mimeType);
  const bodyLinks = bodyMatches.unsubscribeLinks;
  const preferenceLinks = bodyMatches.preferenceLinks;

  const unsubscribeLinks = [...headerLinks, ...bodyLinks];
  const unsubscribeEmails = mailtos.map((mailto) => mailto.replace(/^mailto:/i, ''));

  return {
    unsubscribeLinks,
    unsubscribeEmails,
    headerLinks,
    bodyLinks,
    preferenceLinks,
    oneClick: /one-click/i.test(listUnsubscribePost || ''),
    sources: {
      header: headerLinks.length > 0 || mailtos.length > 0,
      body: bodyLinks.length > 0 || preferenceLinks.length > 0,
    },
    listUnsubscribe: listUnsubscribe || '',
    listUnsubscribePost: listUnsubscribePost || '',
  };
}

/**
 * Gets full email content by ID
 * @param {string} account - Account name
 * @param {string} messageId - Message ID
 * @param {Object} options - { preferHtml: boolean } - prefer HTML for link extraction
 * @returns {Object|null} Email object with body or null if not found
 */
async function getEmailContent(account, messageId, options = {}) {
  const { metadataOnly = false, preferHtml = false } = options;

  try {
    const gmail = await getGmailClient(account);

    // Use metadata format for lightweight lookups (no body)
    if (metadataOnly) {
      const detail = await withRetry(() => gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      }));

      const headers = detail.data.payload?.headers || [];
      const getHeader = (name) => {
        const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
        return header ? header.value : '';
      };

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
        // No body, mimeType, or headers - that's the point of metadata-only
      };
    }

    // Full format with body
    const detail = await withRetry(() => gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    }));

    const headers = detail.data.payload.headers || [];
    const getHeader = (name) => {
      const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
      return header ? header.value : '';
    };

    const bodyData = extractBody(detail.data.payload, { preferHtml });

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
      mimeType: bodyData.type,
      headers,
    };
  } catch (error) {
    console.error(`Error fetching email content ${messageId}:`, error.message);
    return null;
  }
}

/**
 * Gets thread details by thread ID
 * @param {string} account - Account name
 * @param {string} threadId - Thread ID
 * @returns {Object|null} Thread object with messages
 */
async function getThread(account, threadId, options = {}) {
  try {
    const gmail = await getGmailClient(account);
    const includeContent = options.includeContent || false;

    const res = await withRetry(() => gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: includeContent ? 'full' : 'metadata',
      metadataHeaders: ['From', 'To', 'Subject', 'Date'],
    }));

    const messages = (res.data.messages || []).map((message) => {
      const headers = message.payload?.headers || [];
      const result = {
        id: message.id,
        threadId: message.threadId || threadId,
        labelIds: message.labelIds || [],
        account,
        from: getHeaderValue(headers, 'From'),
        to: getHeaderValue(headers, 'To'),
        subject: getHeaderValue(headers, 'Subject'),
        date: getHeaderValue(headers, 'Date'),
        snippet: message.snippet || '',
      };

      // Include body content if requested
      if (includeContent && message.payload) {
        result.body = extractBodyFromPayload(message.payload);
      }

      return result;
    });

    return {
      id: res.data.id || threadId,
      historyId: res.data.historyId,
      snippet: res.data.snippet || '',
      messages,
    };
  } catch (error) {
    console.error(`Error fetching thread ${threadId}:`, error.message);
    return null;
  }
}

/**
 * Extracts text body from a message payload
 * @param {Object} payload - Gmail message payload
 * @returns {string} The message body text
 */
function extractBodyFromPayload(payload) {
  // Check for direct body in payload
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf8');
  }

  // Check parts for text/plain or text/html
  if (payload.parts) {
    // Prefer text/plain
    const textPart = payload.parts.find(p => p.mimeType === 'text/plain');
    if (textPart?.body?.data) {
      return Buffer.from(textPart.body.data, 'base64').toString('utf8');
    }

    // Fall back to text/html
    const htmlPart = payload.parts.find(p => p.mimeType === 'text/html');
    if (htmlPart?.body?.data) {
      const html = Buffer.from(htmlPart.body.data, 'base64').toString('utf8');
      // Strip HTML tags for readable output
      return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    }

    // Recursively check nested parts (for multipart/alternative)
    for (const part of payload.parts) {
      if (part.parts) {
        const nested = extractBodyFromPayload(part);
        if (nested) return nested;
      }
    }
  }

  return '';
}

/**
 * Searches for emails using Gmail query syntax
 * @param {string} account - Account name
 * @param {string} query - Gmail search query (e.g. "is:unread from:google")
 * @param {number} maxResults - Max results to return
 * @returns {Array} List of email metadata objects
 */
async function searchEmails(account, query, maxResults = 100) {
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
 * Gets a quick count estimate for emails matching a query
 * Uses Gmail's resultSizeEstimate which is approximate but fast
 * @param {string} account - Account name
 * @param {string} query - Gmail search query
 * @returns {{estimate: number, isApproximate: boolean, hasMore: boolean}} Count result
 */
async function searchEmailsCount(account, query) {
  try {
    const gmail = await getGmailClient(account);
    const res = await withRetry(() => gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 1,  // Minimize data transfer
    }));
    return {
      estimate: res.data.resultSizeEstimate || 0,
      isApproximate: true,
      hasMore: !!res.data.nextPageToken,
    };
  } catch (error) {
    console.error(`Error counting emails for ${account}:`, error.message);
    return { estimate: 0, isApproximate: true, hasMore: false };
  }
}

/**
 * Searches for emails with pagination support
 * Fetches all matching emails up to maxResults, handling pagination automatically
 * @param {string} account - Account name
 * @param {string} query - Gmail search query
 * @param {Object} options - { maxResults: number, onProgress: function }
 * @returns {{emails: Array, nextPageToken: string|null, totalFetched: number, hasMore: boolean}}
 */
async function searchEmailsPaginated(account, query, options = {}) {
  const { maxResults = 500, onProgress } = options;
  const HARD_CAP = 2000;  // Memory safety limit
  const BATCH_SIZE = 100;  // Gmail API max per request

  const effectiveMax = Math.min(maxResults, HARD_CAP);
  const allEmails = [];
  let pageToken = null;

  try {
    const gmail = await getGmailClient(account);

    while (allEmails.length < effectiveMax) {
      const remaining = effectiveMax - allEmails.length;
      const fetchCount = Math.min(BATCH_SIZE, remaining);

      const listParams = {
        userId: 'me',
        q: query,
        maxResults: fetchCount,
      };

      if (pageToken) {
        listParams.pageToken = pageToken;
      }

      const res = await withRetry(() => gmail.users.messages.list(listParams));

      const messages = res.data.messages;
      if (!messages || messages.length === 0) {
        break;
      }

      // Batch fetch details (10 at a time to avoid rate limits)
      const DETAIL_BATCH_SIZE = 10;
      for (let i = 0; i < messages.length; i += DETAIL_BATCH_SIZE) {
        const batch = messages.slice(i, i + DETAIL_BATCH_SIZE);

        const emailPromises = batch.map(async (msg) => {
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
        const validEmails = results.filter((email) => email !== null);
        allEmails.push(...validEmails);

        // Report progress
        if (onProgress) {
          onProgress(allEmails.length);
        }
      }

      pageToken = res.data.nextPageToken;
      if (!pageToken) {
        break;
      }
    }

    return {
      emails: allEmails,
      nextPageToken: pageToken,
      totalFetched: allEmails.length,
      hasMore: !!pageToken,
    };
  } catch (error) {
    console.error(`Error in paginated search for ${account}:`, error.message);
    return {
      emails: allEmails,
      nextPageToken: null,
      totalFetched: allEmails.length,
      hasMore: false,
    };
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

// ============================================================================
// Labels Management
// ============================================================================

/**
 * Lists all labels for an account
 * @param {string} account - Account name
 * @returns {Array} Array of label objects
 */
async function listLabels(account) {
  const gmail = await getGmailClient(account);
  const res = await withRetry(() => gmail.users.labels.list({
    userId: 'me',
  }));

  return (res.data.labels || []).map(label => ({
    id: label.id,
    name: label.name,
    type: label.type, // 'system' or 'user'
    messageListVisibility: label.messageListVisibility,
    labelListVisibility: label.labelListVisibility,
    messagesTotal: label.messagesTotal,
    messagesUnread: label.messagesUnread,
  }));
}

/**
 * Creates a new label
 * @param {string} account - Account name
 * @param {string} labelName - Name for the new label (supports nested: "Parent/Child")
 * @returns {Object} Created label object
 */
async function createLabel(account, labelName) {
  const gmail = await getGmailClient(account);
  const res = await withRetry(() => gmail.users.labels.create({
    userId: 'me',
    requestBody: {
      name: labelName,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    },
  }));

  return {
    id: res.data.id,
    name: res.data.name,
    type: res.data.type,
  };
}

/**
 * Applies a label to messages
 * @param {string} account - Account name
 * @param {Array<string>} messageIds - Message IDs
 * @param {string} labelId - Label ID to apply
 * @returns {Array} Results for each message
 */
async function applyLabel(account, messageIds, labelId) {
  const gmail = await getGmailClient(account);
  const results = [];

  for (const id of messageIds) {
    try {
      await withRetry(() => gmail.users.messages.modify({
        userId: 'me',
        id: id,
        requestBody: {
          addLabelIds: [labelId],
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
 * Removes a label from messages
 * @param {string} account - Account name
 * @param {Array<string>} messageIds - Message IDs
 * @param {string} labelId - Label ID to remove
 * @returns {Array} Results for each message
 */
async function removeLabel(account, messageIds, labelId) {
  const gmail = await getGmailClient(account);
  const results = [];

  for (const id of messageIds) {
    try {
      await withRetry(() => gmail.users.messages.modify({
        userId: 'me',
        id: id,
        requestBody: {
          removeLabelIds: [labelId],
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
 * Finds a label by name (case-insensitive)
 * @param {string} account - Account name
 * @param {string} labelName - Label name to find
 * @returns {Object|null} Label object or null
 */
async function findLabelByName(account, labelName) {
  const labels = await listLabels(account);
  return labels.find(l => l.name.toLowerCase() === labelName.toLowerCase()) || null;
}

// ============================================================================
// Attachment Management
// ============================================================================

/**
 * Extracts attachment metadata from a message payload
 * @param {Object} payload - Gmail message payload
 * @returns {Array} Array of attachment info
 */
function extractAttachments(payload) {
  const attachments = [];

  function walkParts(parts) {
    if (!parts) return;
    for (const part of parts) {
      if (part.filename && part.filename.length > 0) {
        attachments.push({
          partId: part.partId,
          filename: part.filename,
          mimeType: part.mimeType,
          size: part.body?.size || 0,
          attachmentId: part.body?.attachmentId || null,
        });
      }
      if (part.parts) {
        walkParts(part.parts);
      }
    }
  }

  // Check top-level parts
  if (payload.parts) {
    walkParts(payload.parts);
  }
  // Also check for single-part messages with attachments
  if (payload.filename && payload.filename.length > 0 && payload.body?.attachmentId) {
    attachments.push({
      partId: '0',
      filename: payload.filename,
      mimeType: payload.mimeType,
      size: payload.body?.size || 0,
      attachmentId: payload.body?.attachmentId,
    });
  }

  return attachments;
}

/**
 * Gets emails with attachments
 * @param {string} account - Account name
 * @param {Object} options - { maxResults, query }
 * @returns {Array} Emails with attachment info
 */
async function getEmailsWithAttachments(account, options = {}) {
  const gmail = await getGmailClient(account);
  const maxResults = options.maxResults || 50;
  const baseQuery = 'has:attachment';
  const query = options.query ? `${baseQuery} ${options.query}` : baseQuery;

  const res = await withRetry(() => gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults,
  }));

  if (!res.data.messages) return [];

  const results = [];
  // Process in batches to avoid overwhelming the API
  const batchSize = 10;
  for (let i = 0; i < res.data.messages.length; i += batchSize) {
    const batch = res.data.messages.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(async (msg) => {
      try {
        const detail = await withRetry(() => gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full',
        }));

        const headers = detail.data.payload?.headers || [];
        const attachments = extractAttachments(detail.data.payload);

        if (attachments.length === 0) return null;

        return {
          id: msg.id,
          threadId: detail.data.threadId,
          account,
          from: getHeaderValue(headers, 'From'),
          subject: getHeaderValue(headers, 'Subject'),
          date: getHeaderValue(headers, 'Date'),
          attachments,
        };
      } catch (err) {
        return null;
      }
    }));
    results.push(...batchResults.filter(Boolean));
  }

  return results;
}

/**
 * Searches attachments by filename
 * @param {string} account - Account name
 * @param {string} filenamePattern - Pattern to search (case-insensitive)
 * @param {Object} options - { maxResults }
 * @returns {Array} Matching emails with attachments
 */
async function searchAttachments(account, filenamePattern, options = {}) {
  const emails = await getEmailsWithAttachments(account, options);
  const pattern = filenamePattern.toLowerCase();

  return emails
    .filter(email => email.attachments.some(att => att.filename.toLowerCase().includes(pattern)))
    .map(email => ({
      ...email,
      attachments: email.attachments.filter(att => att.filename.toLowerCase().includes(pattern)),
    }));
}

/**
 * Downloads an attachment
 * @param {string} account - Account name
 * @param {string} messageId - Message ID
 * @param {string} attachmentId - Attachment ID
 * @returns {Buffer} Attachment data
 */
async function downloadAttachment(account, messageId, attachmentId) {
  const gmail = await getGmailClient(account);

  const res = await withRetry(() => gmail.users.messages.attachments.get({
    userId: 'me',
    messageId: messageId,
    id: attachmentId,
  }));

  // Gmail returns base64url encoded data
  return Buffer.from(res.data.data, 'base64url');
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
  unarchiveEmails,
  extractSenderDomain,
  groupEmailsBySender,
  groupEmailsByThread,
  getEmailContent,
  getThread,
  searchEmails,
  searchEmailsCount,
  searchEmailsPaginated,
  sendEmail,
  replyToEmail,
  extractLinks,
  extractUnsubscribeInfo,
  // Labels management
  listLabels,
  createLabel,
  applyLabel,
  removeLabel,
  findLabelByName,
  // Attachment management
  extractAttachments,
  getEmailsWithAttachments,
  searchAttachments,
  downloadAttachment,
  // Exposed for testing
  extractBody,
  extractBodyFromPayload,
  decodeBase64Url,
  composeMessage,
  isValidUrl,
  decodeHtmlEntities,
  parseListUnsubscribe,
  findUnsubscribeLinksInBody,
};
