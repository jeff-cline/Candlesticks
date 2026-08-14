// Candlesticks.ai — landing page behaviour

const FORM_META = {
  investor:  { title: 'Investor Relations',  blurb: 'Tell us about your firm and what you\'re looking for. We reply to every enquiry.' },
  press:     { title: 'Press & Media',       blurb: 'Outlet, deadline and what you\'re working on — we\'ll get back to you quickly.' },
  advertise: { title: 'Advertise with Us',   blurb: 'Let us know your product and the audience you want to reach.' },
  sponsor:   { title: 'Sponsor Us',          blurb: 'Sponsorship and partnership opportunities across the platform and content.' },
  algos:     { title: 'Build Custom Algos',  blurb: 'Describe the strategy you want built. Include the instrument, timeframe and rules if you have them.' },
};

const $ = (s, r = document) => r.querySelector(s);

// ─── Toast ──────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 5200);
}

// ─── Modal ──────────────────────────────────────────────────────────────────
const modal = $('#modal');

function openModal(formKey) {
  const meta = FORM_META[formKey];
  if (!meta) return;
  $('#modal-title').textContent = meta.title;
  $('#modal-blurb').textContent = meta.blurb;
  $('#c-form').value = formKey;
  modal.classList.add('open');
  setTimeout(() => $('#c-name').focus(), 60);
}

function closeModal() {
  modal.classList.remove('open');
  $('#contact-form').reset();
}

document.querySelectorAll('.foot-btns button').forEach((b) =>
  b.addEventListener('click', () => openModal(b.dataset.form))
);
$('#modal-close').addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
});

// ─── Contact form ───────────────────────────────────────────────────────────
$('#contact-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Sending…';

  const payload = Object.fromEntries(new FormData(e.target));
  try {
    const res = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    closeModal();
    toast(data.message, 'ok');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

// ─── Join / signup ──────────────────────────────────────────────────────────
$('#join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Creating…';

  const payload = Object.fromEntries(new FormData(e.target));
  try {
    const res = await fetch('/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not create account');
    toast('Account created — taking you in…', 'ok');
    setTimeout(() => { window.location.href = data.redirect || '/app'; }, 700);
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = original;
  }
});

// ─── Smooth scroll for in-page anchors ──────────────────────────────────────
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const target = document.querySelector(a.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});
