const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

let bcrypt = null;
try {
  bcrypt = require('bcryptjs');
} catch {
  bcrypt = null;
}

const DEFAULT_PERMISSIONS = {
  vehicles: true,
  inspections: true,
  maintenance: true,
  settings: true,
  users: true,
  logs: true
};

function getAppDataDir() {
  return process.env.APP_DATA_DIR || path.join(process.cwd(), '.data');
}

function getSecret() {
  return (
    process.env.LOCAL_AUTH_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    'logistica-c4-dev-only-local-auth-secret'
  );
}

function getStorePath() {
  return path.join(getAppDataDir(), 'users.enc');
}

function deriveKey() {
  return crypto.scryptSync(getSecret(), 'logistica-c4-local-auth-store', 32);
}

async function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv);
  const payload = Buffer.from(JSON.stringify(value, null, 2), 'utf8');
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    version: 1,
    alg: 'AES-256-GCM',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64')
  }, null, 2);
}

async function decryptJson(raw) {
  const envelope = JSON.parse(raw);
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    deriveKey(),
    Buffer.from(envelope.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final()
  ]);
  return JSON.parse(decrypted.toString('utf8'));
}

async function hashPassword(password) {
  if (bcrypt) return bcrypt.hash(password, 10);

  const salt = crypto.randomBytes(16).toString('base64url');
  const derived = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key));
  });
  return `scrypt$${salt}$${derived.toString('base64url')}`;
}

async function comparePassword(password, storedHash) {
  if (storedHash.startsWith('scrypt$')) {
    const [, salt, expected] = storedHash.split('$');
    const derived = await new Promise((resolve, reject) => {
      crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key));
    });
    return crypto.timingSafeEqual(Buffer.from(expected, 'base64url'), derived);
  }

  if (!bcrypt) {
    throw new Error('bcryptjs no está instalado. Ejecutá npm install antes de usar hashes bcrypt.');
  }

  return bcrypt.compare(password, storedHash);
}

function publicUser(user) {
  const { password, ...safeUser } = user;
  return safeUser;
}

async function readUsersRaw() {
  const storePath = getStorePath();

  try {
    const raw = await fs.readFile(storePath, 'utf8');
    const payload = await decryptJson(raw);
    return Array.isArray(payload.users) ? payload.users : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];

    await fs.mkdir(path.dirname(storePath), { recursive: true });
    const backupPath = `${storePath}.invalid-${Date.now()}`;
    try {
      await fs.rename(storePath, backupPath);
    } catch {
      // Si no se pudo respaldar, igual levantamos un store limpio.
    }
    return [];
  }
}

async function writeUsersRaw(users) {
  const storePath = getStorePath();
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, await encryptJson({ users }), 'utf8');
}

async function ensureInitialAdmin() {
  const users = await readUsersRaw();
  if (users.length > 0) return;

  const now = new Date().toISOString();
  users.push({
    id: crypto.randomUUID(),
    username: process.env.APP_ADMIN_USERNAME || 'admin',
    password: await hashPassword(process.env.APP_ADMIN_PASSWORD || 'TuPasswordSeguro123'),
    email: process.env.APP_ADMIN_EMAIL || 'admin@local',
    rank: 'ADMIN',
    role: 'SUPERADMIN',
    permissions: { ...DEFAULT_PERMISSIONS },
    active: true,
    createdAt: now,
    updatedAt: now
  });

  await writeUsersRaw(users);
}

async function listUsers() {
  await ensureInitialAdmin();
  return (await readUsersRaw()).map(publicUser);
}

async function findUserByUsername(username) {
  await ensureInitialAdmin();
  const normalized = String(username || '').trim().toLowerCase();
  return (await readUsersRaw()).find(user => user.username.toLowerCase() === normalized);
}

async function createUser(input) {
  const users = await readUsersRaw();
  const username = String(input.username || '').trim();
  if (!username) throw new Error('Username requerido.');
  if (!input.password || String(input.password).length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
  if (users.some(user => user.username.toLowerCase() === username.toLowerCase())) {
    throw new Error('Ya existe un usuario con ese username.');
  }

  const now = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(),
    username,
    password: await hashPassword(String(input.password)),
    email: String(input.email || '').trim(),
    rank: String(input.rank || '').trim(),
    role: String(input.role || 'USER').trim().toUpperCase(),
    permissions: { ...DEFAULT_PERMISSIONS, ...(input.permissions || {}) },
    active: input.active !== false,
    createdAt: now,
    updatedAt: now
  };

  users.push(user);
  await writeUsersRaw(users);
  return publicUser(user);
}

async function updateUser(id, patch) {
  const users = await readUsersRaw();
  const index = users.findIndex(user => user.id === id);
  if (index === -1) throw new Error('Usuario no encontrado.');

  users[index] = {
    ...users[index],
    email: patch.email ?? users[index].email,
    rank: patch.rank ?? users[index].rank,
    role: patch.role ?? users[index].role,
    permissions: patch.permissions ? { ...users[index].permissions, ...patch.permissions } : users[index].permissions,
    active: typeof patch.active === 'boolean' ? patch.active : users[index].active,
    updatedAt: new Date().toISOString()
  };

  if (patch.password) {
    users[index].password = await hashPassword(String(patch.password));
  }

  await writeUsersRaw(users);
  return publicUser(users[index]);
}

module.exports = {
  DEFAULT_PERMISSIONS,
  comparePassword,
  createUser,
  ensureInitialAdmin,
  findUserByUsername,
  getAppDataDir,
  listUsers,
  publicUser,
  updateUser
};
