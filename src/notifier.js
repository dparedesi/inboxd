const notifier = require('node-notifier');

function notify({ title, message, subtitle }) {
  notifier.notify({
    title: title || 'Inboxd',
    message: message,
    subtitle: subtitle || 'Inboxd',
    sound: true,
    wait: false
  });
}

function extractSenderName(from) {
  if (!from) return 'Unknown';
  const match = from.match(/^"?(.*?)"?\s*<.*>$/);
  return match ? match[1] : from.split('@')[0];
}

function notifyNewEmails(emails) {
  if (!Array.isArray(emails) || emails.length === 0) {
    return;
  }

  const count = emails.length;
  const senders = emails.map(email => extractSenderName(email.from));

  // Get first 3 unique senders for the preview
  const uniqueSenders = [...new Set(senders)];
  const previewSenders = uniqueSenders.slice(0, 3);

  let message = `From: ${previewSenders.join(', ')}`;

  if (uniqueSenders.length > 3) {
    message += `, and ${uniqueSenders.length - 3} others`;
  }

  notify({
    title: `${count} New Email${count === 1 ? '' : 's'}`,
    message: message,
    subtitle: 'Inboxd'
  });
}

module.exports = {
  notify,
  notifyNewEmails,
  extractSenderName
};
