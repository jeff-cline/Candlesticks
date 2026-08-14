// Candlesticks.ai — public lead capture (Join + footer forms)

import { Router } from 'express';
import { run, get, audit } from '../db.js';
import { notifyLead } from '../services/mailer.js';

const router = Router();

const FORMS = new Set(['join', 'investor', 'press', 'advertise', 'sponsor', 'algos']);

// Simple per-IP throttle so the public forms can't be hammered.
const hits = new Map();
function throttled(ip) {
  const now = Date.now();
  const rec = hits.get(ip) ?? { n: 0, start: now };
  if (now - rec.start > 60 * 60 * 1000) { rec.n = 0; rec.start = now; }
  rec.n++;
  hits.set(ip, rec);
  return rec.n > 20;
}

router.post('/', async (req, res) => {
  if (throttled(req.ip)) {
    return res.status(429).json({ error: 'Too many submissions. Try again later.' });
  }

  const form = String(req.body.form || '').trim();
  if (!FORMS.has(form)) return res.status(400).json({ error: 'Unknown form' });

  // Honeypot — bots fill hidden fields, humans don't.
  if (req.body.website) return res.json({ ok: true });

  const name = String(req.body.name || '').trim().slice(0, 200);
  const company = String(req.body.company || '').trim().slice(0, 200);
  const email = String(req.body.email || '').trim().slice(0, 200);
  const phone = String(req.body.phone || '').trim().slice(0, 60);
  const message = String(req.body.message || '').trim().slice(0, 4000);

  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }

  run(
    `INSERT INTO leads (form, name, company, email, phone, message, ip, user_agent)
     VALUES (?,?,?,?,?,?,?,?)`,
    form, name, company || null, email, phone || null, message || null,
    req.ip, String(req.headers['user-agent'] || '').slice(0, 500)
  );
  const lead = get('SELECT * FROM leads ORDER BY id DESC LIMIT 1');

  let delivered = false;
  try {
    const result = await notifyLead({ form, name, company, email, phone, message, ip: req.ip });
    delivered = result.delivered;
    if (delivered) run('UPDATE leads SET emailed = 1 WHERE id = ?', lead.id);
  } catch (e) {
    console.error('Lead notification failed:', e.message);
  }

  audit(null, 'lead_submitted', { form, email, delivered });

  res.json({
    ok: true,
    message:
      form === 'join'
        ? "You're on the list. We'll be in touch when access opens."
        : "Thanks — your message is in. We'll get back to you shortly.",
  });
});

export default router;
