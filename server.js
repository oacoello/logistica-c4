const crypto = require('crypto');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const {
  comparePassword,
  createUser,
  ensureInitialAdmin,
  findUserByUsername,
  listUsers,
  publicUser,
  updateUser
} = require('./server/lib/local-auth-store');
const { sanitizePathSegment, writeUserLog } = require('./server/lib/local-logger');

const app = express();
const port = Number(process.env.PORT || 4174);
const sessions = new Map();
const COOKIE_NAME = 'logistica_c4_session';

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 1000 * 60 * 60 * 12
  };
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString('base64url');
  const appSessionId = `app-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
  const session = {
    token,
    sessionId: appSessionId,
    user: publicUser(user),
    createdAt: new Date().toISOString()
  };
  sessions.set(token, session);
  return session;
}

function getSession(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  return sessions.get(token) || null;
}

function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'No autenticado.' });
  req.session = session;
  req.user = session.user;
  next();
}

function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== 'SUPERADMIN') {
    return res.status(403).json({ error: 'Solo SUPERADMIN puede gestionar usuarios.' });
  }
  next();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mode: 'local' });
});

app.post('/api/login', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const user = await findUserByUsername(username);

    if (!user || user.active === false || !(await comparePassword(password, user.password))) {
      return res.status(401).json({ error: 'Usuario o contraseña inválidos.' });
    }

    const session = createSession(user);
    res.cookie(COOKIE_NAME, session.token, sessionCookieOptions());
    await writeUserLog({
      username: user.username,
      sessionId: session.sessionId,
      type: 'SYSTEM',
      content: 'NUEVA SESIÓN'
    });

    res.json({ user: session.user, sessionId: session.sessionId });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Error iniciando sesión.' });
  }
});

app.post('/api/logout', requireAuth, async (req, res) => {
  sessions.delete(req.session.token);
  res.clearCookie(COOKIE_NAME);
  await writeUserLog({
    username: req.user.username,
    sessionId: req.session.sessionId,
    type: 'SYSTEM',
    content: 'SESIÓN CERRADA'
  });
  res.json({ ok: true });
});

app.get('/api/session', requireAuth, (req, res) => {
  res.json({ user: req.user, sessionId: req.session.sessionId });
});

app.get('/api/users', requireAuth, requireSuperAdmin, async (_req, res) => {
  res.json({ users: await listUsers() });
});

app.post('/api/users', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const user = await createUser(req.body || {});
    await writeUserLog({
      username: req.user.username,
      sessionId: req.session.sessionId,
      type: 'ACTION',
      content: `Usuario local creado: ${user.username}`
    });
    res.status(201).json({ user });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.patch('/api/users/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const user = await updateUser(req.params.id, req.body || {});
    res.json({ user });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/log', requireAuth, async (req, res) => {
  const body = req.body || {};
  const username = sanitizePathSegment(body.user || req.user.username);
  const sessionId = sanitizePathSegment(body.sessionId || req.session.sessionId);

  await writeUserLog({
    username,
    sessionId,
    type: body.type,
    content: body.content
  });

  res.json({ ok: true });
});

app.use(express.static(process.cwd()));

ensureInitialAdmin()
  .then(() => {
    app.listen(port, () => {
      console.log(`Logística C4 local listo en http://localhost:${port}`);
    });
  })
  .catch(error => {
    console.error('No se pudo inicializar auth local:', error);
    process.exit(1);
  });
