// Candlesticks.ai — subscriber preview page
document.getElementById('logout')?.addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' });
  window.location.href = '/';
});
fetch('/auth/me')
  .then((r) => r.json())
  .then(({ user }) => { if (user) document.getElementById('who').textContent = user.email; })
  .catch(() => {});
