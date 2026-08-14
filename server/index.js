// Candlesticks.ai — application entry point

import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { db } from './db.js';
import authRoutes, { requireAuth, requirePasswordChanged } from './routes/auth.js';
import apiRoutes from './routes/api.js';
import leadRoutes from './routes/leads.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PROD = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));
app.use(cookieParser());

if (!process.env.SESSION_SECRET && PROD) {
  console.error('FATAL: SESSION_SECRET must be set in production.');
  process.exit(1);
}

app.use(session({
  name: 'csai.sid',
  secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: PROD,
    maxAge: 1000 * 60 * 60 * 12,
  },
}));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'"
  );
  next();
});

// ─── Routes ─────────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api', requireAuth, requirePasswordChanged, apiRoutes);

// ─── Pages ──────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(join(PUBLIC, 'index.html')));
app.get('/login', (req, res) => res.sendFile(join(PUBLIC, 'login.html')));

app.get('/change-password', requireAuth, (req, res) =>
  res.sendFile(join(PUBLIC, 'change-password.html')));

app.get('/app', requireAuth, (req, res) => {
  if (req.session.user.must_change_password) return res.redirect('/change-password');
  // Subscribers see the simulated "Coming Soon" dashboard; god sees the real one.
  const file = req.session.user.role === 'god' ? 'dashboard.html' : 'preview.html';
  res.sendFile(join(PUBLIC, file));
});

// Authenticated views must never be reachable as plain static files.
// express.static would otherwise serve /dashboard.html and /preview.html
// directly, bypassing the /app route's auth check.
const GATED = new Set(['/dashboard.html', '/preview.html', '/change-password.html']);
app.use((req, res, next) => {
  if (GATED.has(req.path)) return res.redirect('/app');
  next();
});

app.use(express.static(PUBLIC, { extensions: ['html'], index: false }));

app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.status(404).sendFile(join(PUBLIC, '404.html'), (err) => {
    if (err) res.status(404).type('text/plain').send('Not found');
  });
});

app.use((err, req, res, _next) => {
  console.error(err);
  const payload = PROD ? { error: 'Internal error' } : { error: err.message, stack: err.stack };
  res.status(500).json(payload);
});

const server = app.listen(PORT, () => {
  console.log(`\n  Candlesticks.ai  ·  http://localhost:${PORT}`);
  console.log(`  env=${process.env.NODE_ENV || 'development'}  trading=${process.env.TRADING_ENABLED === 'true' ? 'ENABLED' : 'disabled'}\n`);
});

function shutdown(sig) {
  console.log(`\n${sig} — shutting down`);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
