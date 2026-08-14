// Candlesticks.ai — authentication

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { get, run, audit } from '../db.js';

const router = Router();

// ─── Middleware ─────────────────────────────────────────────────────────────
export function requireAuth(req, res, next) {
  if (!req.session?.user) {
    if (req.path.startsWith('/api') || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.redirect('/login');
  }
  next();
}

export function requirePasswordChanged(req, res, next) {
  if (req.session.user.must_change_password && !req.path.startsWith('/me/password')) {
    return res.status(403).json({ error: 'Password change required', mustChangePassword: true });
  }
  next();
}

export function requireGod(req, res, next) {
  if (req.session.user?.role !== 'god') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// ─── Rate limiting (simple in-memory, per IP) ───────────────────────────────
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function rateLimited(ip) {
  const now = Date.now();
  const rec = attempts.get(ip) ?? { n: 0, start: now };
  if (now - rec.start > WINDOW_MS) { rec.n = 0; rec.start = now; }
  rec.n++;
  attempts.set(ip, rec);
  return rec.n > MAX_ATTEMPTS;
}

// ─── Login ──────────────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const ip = req.ip;
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }

  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = get('SELECT * FROM users WHERE lower(email) = ?', email);
  // Constant-ish time: always run a hash comparison.
  const hash = user?.password_hash || '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const ok = bcrypt.compareSync(password, hash);

  if (!user || !ok) {
    audit(user?.id ?? null, 'login_failed', { email, ip });
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  attempts.delete(ip);
  run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", user.id);
  req.session.user = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    must_change_password: !!user.must_change_password,
  };
  audit(user.id, 'login', { ip });

  res.json({
    ok: true,
    mustChangePassword: !!user.must_change_password,
    redirect: user.must_change_password ? '/change-password' : '/app',
    user: { email: user.email, name: user.name, role: user.role },
  });
});

// ─── Signup (subscribers) ───────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const name = String(req.body.name || '').trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  if (password.length < 10) {
    return res.status(400).json({ error: 'Password must be at least 10 characters' });
  }
  if (get('SELECT id FROM users WHERE lower(email) = ?', email)) {
    return res.status(409).json({ error: 'An account with that email already exists' });
  }

  const hash = bcrypt.hashSync(password, 12);
  run(
    `INSERT INTO users (email, password_hash, name, role, must_change_password)
     VALUES (?, ?, ?, 'subscriber', 0)`,
    email, hash, name || null
  );
  const user = get('SELECT * FROM users WHERE lower(email) = ?', email);

  // Notify the operator that someone signed up.
  try {
    const { notifyLead } = await import('../services/mailer.js');
    await notifyLead({ form: 'join', name, email, ip: req.ip, message: 'Created an account on the site' });
  } catch (e) { console.error('lead notify failed', e.message); }

  req.session.user = {
    id: user.id, email: user.email, name: user.name,
    role: user.role, must_change_password: false,
  };
  audit(user.id, 'signup', { ip: req.ip });

  res.json({ ok: true, redirect: '/app', user: { email, name, role: 'subscriber' } });
});

// ─── Change password ────────────────────────────────────────────────────────
router.post('/change-password', requireAuth, (req, res) => {
  const current = String(req.body.currentPassword || '');
  const next = String(req.body.newPassword || '');
  const confirm = String(req.body.confirmPassword || '');

  const user = get('SELECT * FROM users WHERE id = ?', req.session.user.id);
  if (!bcrypt.compareSync(current, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  if (next.length < 12) {
    return res.status(400).json({ error: 'New password must be at least 12 characters' });
  }
  if (next !== confirm) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }
  if (bcrypt.compareSync(next, user.password_hash)) {
    return res.status(400).json({ error: 'New password must differ from the current one' });
  }

  run(
    'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
    bcrypt.hashSync(next, 12), user.id
  );
  req.session.user.must_change_password = false;
  audit(user.id, 'password_changed', {});

  res.json({ ok: true, redirect: '/app' });
});

// ─── Session ────────────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: req.session.user });
});

router.post('/logout', (req, res) => {
  const id = req.session?.user?.id;
  req.session.destroy(() => {
    if (id) audit(id, 'logout', {});
    res.json({ ok: true, redirect: '/' });
  });
});

export default router;
