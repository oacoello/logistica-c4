const fs = require('fs/promises');
const path = require('path');
const { getAppDataDir } = require('./local-auth-store');

const VALID_TYPES = new Set(['INPUT', 'OUTPUT', 'SYSTEM', 'ACTION', 'ERROR']);

function sanitizePathSegment(value) {
  return String(value || 'unknown')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80) || 'unknown';
}

function timestampLabel() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

async function writeUserLog({ username, sessionId, type, content }) {
  const safeUser = sanitizePathSegment(username);
  const safeSession = sanitizePathSegment(sessionId);
  const safeType = VALID_TYPES.has(type) ? type : 'SYSTEM';
  const logDir = path.join(getAppDataDir(), 'logs', safeUser);
  const logFile = path.join(logDir, `${safeSession}.log`);
  const line = `[${timestampLabel()}] ${safeType}: ${String(content || '').replace(/\r?\n/g, ' ')}\n`;

  await fs.mkdir(logDir, { recursive: true });
  await fs.appendFile(logFile, line, 'utf8');
}

module.exports = {
  sanitizePathSegment,
  writeUserLog
};
