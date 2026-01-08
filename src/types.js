/**
 * Type definitions for inboxd data structures.
 * This file contains JSDoc @typedef definitions for data shapes used in the project.
 * It helps with type hinting and documentation.
 */

/**
 * @typedef {Object} Account
 * @property {string} name - Unique account identifier (e.g., "work", "personal")
 * @property {string} email - Gmail address for this account
 */

/**
 * @typedef {Object} DeletionEntry
 * @property {string} id - Email message ID
 * @property {string} threadId - Thread ID
 * @property {string} subject - Email subject
 * @property {string} from - Sender
 * @property {string} account - Account name that owns this email
 * @property {string} deletedAt - ISO timestamp
 */

/**
 * @typedef {Object} Email
 * @property {string} id - Message ID
 * @property {string} threadId - Thread ID
 * @property {string} subject - Email subject
 * @property {string} from - Sender
 * @property {string} snippet - Preview text
 * @property {string} date - Date string
 */

/**
 * @typedef {Object} Credentials
 * @property {{client_id: string, client_secret: string, redirect_uris: string[]}} installed - OAuth client config
 */

module.exports = {};
