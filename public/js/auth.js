// Candlesticks.ai — auth pages (login, change password)
// External file by necessity: the CSP is script-src 'self', which blocks inline
// scripts. That block previously caused the login form to fall back to a native
// GET submit, putting the password in the URL.

const $ = (s) => document.querySelector(s);

let toastTimer;
function toast(msg, kind = '') {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 5200);
}

async function submitJson(form, url, busyLabel) {
  const btn = form.querySelector('button[type=submit]');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = busyLabel;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    window.location.href = data.redirect || '/app';
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = original;
  }
}

const loginForm = $('#login-form');
if (loginForm) {
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submitJson(loginForm, '/auth/login', 'Checking…');
  });
}

const pwForm = $('#pw-form');
if (pwForm) {
  pwForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submitJson(pwForm, '/auth/change-password', 'Saving…');
  });

  const next = $('#next');
  next?.addEventListener('input', (e) => {
    const v = e.target.value;
    let score = 0;
    if (v.length >= 12) score++;
    if (v.length >= 16) score++;
    if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score++;
    if (/\d/.test(v)) score++;
    if (/[^\w\s]/.test(v)) score++;
    const bar = $('#meter');
    bar.style.width = (score / 5) * 100 + '%';
    bar.style.background = score <= 2 ? 'var(--red)' : score <= 3 ? 'var(--amber)' : 'var(--green)';
  });
}
