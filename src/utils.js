/**
 * Utility functions for inboxd
 */
const fs = require('fs');

/**
 * Writes data to a file atomically (write to temp, then rename)
 * This prevents data corruption if the process crashes during write.
 * @param {string} filePath - Target file path
 * @param {string} data - Data to write
 */
function atomicWriteSync(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, filePath);
}

/**
 * Writes JSON data to a file atomically with pretty formatting
 * @param {string} filePath - Target file path
 * @param {*} data - Data to serialize as JSON
 */
function atomicWriteJsonSync(filePath, data) {
  atomicWriteSync(filePath, JSON.stringify(data, null, 2));
}

module.exports = {
  atomicWriteSync,
  atomicWriteJsonSync,
};
