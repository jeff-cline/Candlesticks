// Candlesticks.ai — dashboard

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const money = (v, dp = 2) => {
  const n = Number(v) || 0;
  return (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: dp, maximumFractionDigits: dp,
  });
};
const pct = (v, dp = 1) => `${(Number(v) || 0).toFixed(dp)}%`;
const cls = (v) => (Number(v) > 0 ? 'pos' : Number(v) < 0 ? 'neg' : '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortId = (id) => '…' + String(id).slice(-4);

let toastTimer;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 5200);
}

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { window.location.href = '/login'; throw new Error('Not authenticated'); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ─── State ──────────────────────────────────────────────────────────────────
const state = { accounts: [], selected: new Set(), side: 'long', profile: null, preview: null };

// ─── Tabs ───────────────────────────────────────────────────────────────────
$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.remove('active'));
    $$('.tabpanel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    $(`#tab-${tab.dataset.tab}`).classList.add('active');
    LOADERS[tab.dataset.tab]?.();
  });
});

$('#logout').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' });
  window.location.href = '/';
});

// ─── Overview ───────────────────────────────────────────────────────────────
async function loadOverview() {
  const d = await api('/dashboard');
  state.profile = state.profile ?? null;

  const periodNote = (p) =>
    `${p.trades} trade${p.trades === 1 ? '' : 's'} · ${money(p.gross)} gross · ${money(p.comm)} fees`;

  $('#ov-day').textContent = money(d.day.net);
  $('#ov-day').className = 'big ' + cls(d.day.net);
  $('#ov-day-note').textContent = periodNote(d.day);
  $('#ov-week').textContent = money(d.week.net);
  $('#ov-week').className = 'big ' + cls(d.week.net);
  $('#ov-week-note').textContent = periodNote(d.week);
  $('#ov-month').textContent = money(d.month.net);
  $('#ov-month').className = 'big ' + cls(d.month.net);
  $('#ov-month-note').textContent = periodNote(d.month);

  const winRate = d.day.trades ? (d.day.wins / d.day.trades) * 100 : 0;
  $('#ov-tiles').innerHTML = [
    ['Accounts', d.totals.accounts, `${d.totals.live} live · ${d.totals.breached} breached`],
    ['Total cash', money(d.totals.cash, 0), 'across the book'],
    ['Drawdown room', money(d.totals.room, 0), 'combined, live accounts'],
    ['Win rate today', d.day.trades ? pct(winRate) : '—', `${d.day.wins}W / ${d.day.losses}L`],
    ['Never traded', d.totals.untraded, 'accounts at exactly start'],
  ].map(([l, v, n]) => `
    <div class="tile"><div class="tile-label">${l}</div>
    <div class="tile-value">${v}</div><div class="tile-note">${n}</div></div>`).join('');

  // Alerts
  const breached = d.accounts.filter((a) => a.is_breached);
  const thin = d.accounts.filter((a) => !a.is_breached && a.roomPct < 40);
  let html = '';
  for (const a of breached) {
    html += `<div class="alert alert-critical"><div class="alert-icon">⚠</div><div>
      <p class="alert-title">${esc(a.external_id)} has breached its trailing drawdown</p>
      <p>Cash ${money(a.cash)} · distance ${money(a.dist_to_liq)}. Excluded from all allocations.</p>
    </div></div>`;
  }
  if (thin.length) {
    html += `<div class="alert alert-warn"><div class="alert-icon">▲</div><div>
      <p class="alert-title">${thin.length} account${thin.length === 1 ? '' : 's'} below 40% of drawdown allowance</p>
      <p>${thin.map((a) => `${shortId(a.external_id)} (${money(a.dist_to_liq)})`).join(' · ')}</p>
    </div></div>`;
  }
  if (!d.session.open) {
    html += `<div class="alert"><div class="alert-icon">🕐</div><div>
      <p class="alert-title">Entries locked</p><p>${esc(d.session.reason || 'Outside the trading window')}</p>
    </div></div>`;
  }
  $('#alerts').innerHTML = html;

  // Badges
  $('#session-badge').textContent = d.session.open ? 'Session open' : 'Entries locked';
  $('#session-badge').className = 'badge ' + (d.session.open ? 'badge-ok' : 'badge-warn');
  $('#trading-badge').textContent = d.tradingEnabled ? 'Live trading ON' : 'Live trading off';
  $('#trading-badge').className = 'badge ' + (d.tradingEnabled ? 'badge-critical' : 'badge-info');

  drawEquity(d.equityCurve);
  drawBars(d.accounts);
}

function drawEquity(points) {
  const svg = $('#equity');
  if (!points.length) { svg.innerHTML = '<text x="300" y="64" fill="#6f787e" font-size="13" text-anchor="middle">No history yet</text>'; return; }
  let cum = 0;
  const series = points.map((p) => (cum += p.net));
  const min = Math.min(0, ...series), max = Math.max(0, ...series);
  const range = (max - min) || 1;
  const x = (i) => points.length === 1 ? 300 : (i / (points.length - 1)) * 600;
  const y = (v) => 110 - ((v - min) / range) * 100;
  const zeroY = y(0);
  const path = series.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = series[series.length - 1];
  svg.innerHTML = `
    <line x1="0" y1="${zeroY.toFixed(1)}" x2="600" y2="${zeroY.toFixed(1)}" stroke="#2c2c2a" stroke-width="1"/>
    <path d="${path}" fill="none" stroke="${last >= 0 ? '#3987e5' : '#d03b3b'}" stroke-width="2"
          stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    ${series.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" fill="${v >= 0 ? '#3987e5' : '#d03b3b'}"/>`).join('')}`;
}

function drawBars(accounts) {
  const max = Math.max(...accounts.map((a) => Math.abs(a.dist_to_liq)), 1);
  $('#ov-bars').innerHTML = accounts.map((a) => {
    const w = Math.min(100, (Math.abs(a.dist_to_liq) / max) * 100);
    const k = a.is_breached ? 'crit' : a.roomPct < 40 ? 'warn' : '';
    return `<div class="bar-row">
      <div class="bar-label">${shortId(a.external_id)}${a.is_breached ? ' ⚠' : ''}</div>
      <div class="bar-track"><div class="bar-fill ${k}" style="width:${w.toFixed(1)}%"></div></div>
      <div class="bar-val ${a.is_breached ? 'neg' : ''}">${money(a.dist_to_liq, 0)}</div>
    </div>`;
  }).join('');
}

// ─── Accounts ───────────────────────────────────────────────────────────────
async function loadAccounts() {
  const { accounts } = await api('/accounts');
  state.accounts = accounts;
  $('#acct-count').textContent = `${accounts.length} accounts`;
  $('#acct-rows').innerHTML = accounts.map((a) => {
    const roomPct = a.drawdown_limit > 0 ? (a.dist_to_liq / a.drawdown_limit) * 100 : 0;
    return `<tr class="clickable ${a.is_breached ? 'breach' : ''}" data-id="${a.id}">
      <td class="mono">${esc(a.external_id)}</td>
      <td>${money(a.cash)}</td>
      <td>${money(a.dist_to_liq)}</td>
      <td>${pct(roomPct, 0)}</td>
      <td class="${cls(a.today_net)}">${a.today_trades ? money(a.today_net) : '—'}</td>
      <td class="${cls(a.total_pl)}">${money(a.total_pl)}</td>
      <td>${a.is_breached
        ? '<span class="badge badge-critical">Breached</span>'
        : roomPct < 40 ? '<span class="badge badge-warn">Thin</span>'
        : '<span class="badge badge-ok">Healthy</span>'}</td>
    </tr>`;
  }).join('');

  $$('#acct-rows tr').forEach((tr) =>
    tr.addEventListener('click', () => showAccount(tr.dataset.id)));
}

async function showAccount(id) {
  const d = await api(`/accounts/${id}`);
  const s = d.stats;
  $('#acct-detail').innerHTML = `
    <div class="card acct-detail mt-3">
      <div class="row between mb-2">
        <h3 style="margin:0" class="mono">${esc(d.account.external_id)}</h3>
        <span class="badge ${d.account.is_breached ? 'badge-critical' : 'badge-ok'}">
          ${d.account.is_breached ? 'Breached' : 'Active'}</span>
      </div>
      <div class="tiles mb-3">
        <div class="tile"><div class="tile-label">Cash</div><div class="tile-value">${money(d.account.cash)}</div></div>
        <div class="tile"><div class="tile-label">Room</div><div class="tile-value ${cls(d.account.dist_to_liq)}">${money(d.account.dist_to_liq)}</div>
          <div class="tile-note">liq at ${money(d.account.auto_liq_level)}</div></div>
        <div class="tile"><div class="tile-label">Trades</div><div class="tile-value">${s.tradeCount}</div>
          <div class="tile-note">${pct(s.winRate, 0)} win rate</div></div>
        <div class="tile"><div class="tile-label">Expectancy</div><div class="tile-value ${cls(s.expectancy)}">${money(s.expectancy)}</div>
          <div class="tile-note">per trade</div></div>
        <div class="tile"><div class="tile-label">Payoff ratio</div>
          <div class="tile-value">${s.payoffRatio ? s.payoffRatio.toFixed(2) + ':1' : '—'}</div>
          <div class="tile-note">${s.breakevenWinRate ? pct(s.breakevenWinRate, 0) + ' to break even' : '—'}</div></div>
      </div>
      ${d.trades.length ? `<div class="tablewrap"><table>
        <thead><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Exit</th><th>Hold</th><th>Net</th></tr></thead>
        <tbody>${d.trades.map((t) => `<tr>
          <td class="mono">${esc(t.symbol)}</td><td>${esc(t.side)}</td><td>${t.qty}</td>
          <td>${t.entry_price?.toLocaleString() ?? '—'}</td><td>${t.exit_price?.toLocaleString() ?? '—'}</td>
          <td>${t.duration_sec != null ? t.duration_sec + 's' : '—'}</td>
          <td class="${cls(t.net_pl)}">${money(t.net_pl)}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="muted small">No trades recorded on this account.</p>'}
    </div>`;
  $('#acct-detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ─── Trade ──────────────────────────────────────────────────────────────────
async function loadTrade() {
  if (!state.accounts.length) {
    const { accounts } = await api('/accounts');
    state.accounts = accounts;
  }
  $('#acct-pick').innerHTML = state.accounts.map((a) => {
    const dead = a.is_breached || !a.is_active;
    return `<div class="acct-chip ${dead ? 'dead' : ''} ${state.selected.has(a.id) ? 'sel' : ''}"
                 data-id="${a.id}" ${dead ? 'title="Breached — cannot trade"' : ''}>
      <span class="mono">${shortId(a.external_id)}</span>
      <span class="dim" style="margin-left:auto">${money(a.dist_to_liq, 0)}</span>
    </div>`;
  }).join('');

  $$('#acct-pick .acct-chip').forEach((chip) => {
    if (chip.classList.contains('dead')) return;
    chip.addEventListener('click', () => {
      const id = Number(chip.dataset.id);
      if (state.selected.has(id)) { state.selected.delete(id); chip.classList.remove('sel'); }
      else { state.selected.add(id); chip.classList.add('sel'); }
    });
  });
}

$('#pick-all').addEventListener('click', () => {
  state.accounts.filter((a) => !a.is_breached && a.is_active).forEach((a) => state.selected.add(a.id));
  loadTrade();
});
$('#pick-none').addEventListener('click', () => { state.selected.clear(); loadTrade(); });

$('#side-long').addEventListener('click', () => {
  state.side = 'long';
  $('#side-long').classList.add('active'); $('#side-short').classList.remove('active');
});
$('#side-short').addEventListener('click', () => {
  state.side = 'short';
  $('#side-short').classList.add('active'); $('#side-long').classList.remove('active');
});

$('#t-preview').addEventListener('click', async () => {
  const entryPrice = Number($('#t-entry').value);
  if (!entryPrice) return toast('Enter an entry price', 'error');
  if (!state.selected.size) return toast('Select at least one account', 'error');

  const btn = $('#t-preview');
  btn.disabled = true; btn.textContent = 'Computing…';
  try {
    const d = await api('/trade/preview', {
      method: 'POST',
      body: {
        symbol: $('#t-symbol').value,
        side: state.side,
        accountIds: [...state.selected],
        stopTicks: Number($('#t-stop').value),
        targetTicks: Number($('#t-target').value),
        baseQty: Number($('#t-qty').value) || 1,
        entryPrice,
        mode: $('#t-mode').value,
      },
    });
    state.preview = d;
    renderPreview(d);
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Preview allocation'; }
});

function renderPreview(d) {
  const t = d.sizing.totals;
  const warns = d.sizing.warnings.map((w) =>
    `<div class="alert alert-warn"><div class="alert-icon">⚠</div><div><p>${esc(w)}</p></div></div>`).join('');

  const rows = d.previews.map((p) => {
    const ev = p.evaluation;
    const issues = [...ev.violations, ...ev.warnings];
    return `<div class="pv-row">
      <div>
        <span class="mono">${esc(shortId(p.externalId))}</span>
        ${issues.map((v) => `<span class="badge ${v.severity === 'block' ? 'badge-critical' : 'badge-warn'}"
          title="${esc(v.message)}" style="margin-left:6px">${v.code}</span>`).join('')}
      </div>
      <div class="tnum">${p.qty} lot${p.qty === 1 ? '' : 's'}</div>
      <div class="tnum ${p.pctOfRoom > 50 ? 'neg' : ''}">${money(p.riskDollars, 0)} · ${pct(p.pctOfRoom, 0)}</div>
      <div>${ev.allowed
        ? '<span class="badge badge-ok">OK</span>'
        : '<span class="badge badge-critical">Blocked</span>'}</div>
    </div>`;
  }).join('');

  const detail = d.previews.flatMap((p) =>
    [...p.evaluation.violations, ...p.evaluation.warnings].map((v) =>
      `<li><strong class="mono">${esc(shortId(p.externalId))}</strong> — ${esc(v.message)}</li>`)
  ).join('');

  $('#preview-out').innerHTML = `
    <div class="card">
      <div class="row between mb-2">
        <h3 style="margin:0">${d.side === 'long' ? 'Long' : 'Short'} ${esc(d.symbol)} @ ${d.entryPrice.toLocaleString()}</h3>
        <span class="small muted">stop ${d.stopPrice.toLocaleString()} · target ${d.targetPrice.toLocaleString()}</span>
      </div>
      <div class="tiles mb-3">
        <div class="tile"><div class="tile-label">Accounts</div><div class="tile-value">${t.accounts}</div></div>
        <div class="tile"><div class="tile-label">Contracts</div><div class="tile-value">${t.contracts}</div></div>
        <div class="tile"><div class="tile-label">Total risk</div><div class="tile-value neg">${money(t.riskDollars, 0)}</div></div>
        <div class="tile"><div class="tile-label">% of book</div>
          <div class="tile-value ${t.pctOfBookRisked > 40 ? 'neg' : ''}">${pct(t.pctOfBookRisked, 1)}</div>
          <div class="tile-note">of all drawdown room</div></div>
        <div class="tile"><div class="tile-label">Stageable</div><div class="tile-value">${d.stageable}<span class="dim" style="font-size:1rem"> / ${d.previews.length}</span></div>
          <div class="tile-note">${d.blocked} blocked</div></div>
      </div>
      ${warns}
      <div class="mb-2">${rows}</div>
      ${detail ? `<details class="small muted"><summary style="cursor:pointer">Compliance detail (${d.previews.reduce((s,p)=>s+p.evaluation.violations.length+p.evaluation.warnings.length,0)})</summary>
        <ul style="line-height:1.7;padding-left:18px">${detail}</ul></details>` : ''}
      <button class="btn btn-primary mt-3" id="t-stage" style="width:100%" ${d.stageable ? '' : 'disabled'}>
        Stage ${d.stageable} order${d.stageable === 1 ? '' : 's'} for your confirmation
      </button>
      <p class="xs dim center mt-1 mb-0">Staging does not submit. You fire each batch manually.</p>
    </div>`;

  $('#t-stage')?.addEventListener('click', async () => {
    try {
      const r = await api('/trade/stage', { method: 'POST', body: { ...state.preview, previews: state.preview.previews } });
      toast(`${r.staged} order(s) staged — batch ${r.batchId.slice(0, 8)}`, 'ok');
    } catch (e) { toast(e.message, 'error'); }
  });
}

// ─── Strategies ─────────────────────────────────────────────────────────────
async function loadStrategies() {
  const { categories } = await api('/strategies');
  $('#strat-list').innerHTML = categories.map((c) => `
    <h3 class="mt-3">${esc(c.label)} <span class="dim small" style="font-weight:400">· ${esc(c.hold)}</span></h3>
    ${c.strategies.map((s) => `
      <div class="strat" data-key="${s.key}">
        <div class="strat-head">
          <div style="flex:1">
            <div class="row" style="gap:8px">
              <strong>${esc(s.name)}</strong>
              ${s.apex === 'conflict' ? '<span class="badge badge-critical">Rule conflict</span>'
                : s.apex === 'caution' ? '<span class="badge badge-warn">Caution</span>'
                : '<span class="badge badge-ok">Clear</span>'}
            </div>
            <p class="small muted mt-1 mb-0">${esc(s.summary)}</p>
          </div>
          <label class="switch">
            <input type="checkbox" data-toggle="${s.key}" ${s.enabled ? 'checked' : ''} ${s.disabled ? 'disabled' : ''}>
            <span class="slider"></span>
          </label>
        </div>
        <button class="btn btn-sm btn-ghost mt-2" data-expand="${s.key}">Details &amp; parameters</button>
        <div class="strat-body">
          <p class="small"><strong>Why it works:</strong> <span class="muted">${esc(s.rationale)}</span></p>
          <p class="small"><strong>Where it fails:</strong> <span class="muted">${esc(s.edgeNotes)}</span></p>
          ${s.apexNote ? `<p class="small"><strong>Apex:</strong> <span class="muted">${esc(s.apexNote)}</span></p>` : ''}
          <div class="params">
            ${Object.entries(s.paramSchema || {}).map(([k, def]) => `
              <div>
                <label for="p-${s.key}-${k}">${esc(def.label || k)}</label>
                ${def.type === 'bool'
                  ? `<label class="switch"><input type="checkbox" id="p-${s.key}-${k}" data-param="${s.key}.${k}" ${s.params[k] ? 'checked' : ''}><span class="slider"></span></label>`
                  : def.type === 'enum'
                  ? `<select id="p-${s.key}-${k}" data-param="${s.key}.${k}">${def.options.map((o) =>
                      `<option ${s.params[k] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
                  : `<input id="p-${s.key}-${k}" type="number" data-param="${s.key}.${k}"
                       value="${s.params[k] ?? ''}" ${def.min != null ? `min="${def.min}"` : ''}
                       ${def.max != null ? `max="${def.max}"` : ''} ${def.step ? `step="${def.step}"` : ''}>`}
              </div>`).join('')}
          </div>
        </div>
      </div>`).join('')}`).join('');

  $$('[data-expand]').forEach((b) => b.addEventListener('click', () =>
    b.closest('.strat').classList.toggle('open')));

  $$('[data-toggle]').forEach((cb) => cb.addEventListener('change', async () => {
    try {
      await api(`/strategies/${cb.dataset.toggle}`, { method: 'POST', body: { enabled: cb.checked } });
      toast(`${cb.dataset.toggle} ${cb.checked ? 'enabled' : 'disabled'}`, 'ok');
    } catch (e) { cb.checked = !cb.checked; toast(e.message, 'error'); }
  }));

  $$('[data-param]').forEach((inp) => inp.addEventListener('change', async () => {
    const [key, param] = inp.dataset.param.split('.');
    const strat = $(`.strat[data-key="${key}"]`);
    const params = {};
    $$('[data-param]', strat).forEach((i) => {
      const p = i.dataset.param.split('.')[1];
      params[p] = i.type === 'checkbox' ? i.checked : (i.type === 'number' ? Number(i.value) : i.value);
    });
    try {
      await api(`/strategies/${key}`, {
        method: 'POST',
        body: { enabled: $(`[data-toggle="${key}"]`).checked, params },
      });
      toast('Saved', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }));
}

// ─── Risk ───────────────────────────────────────────────────────────────────
async function loadRisk() {
  const { profile } = await api('/risk');
  state.profile = profile;
  $('#r-open').value = profile.open_delay_min;
  $('#r-flat').value = profile.flatten_before_close_min;
  $('#r-loss').value = profile.max_daily_loss_pct;
  $('#r-floor').value = profile.drawdown_floor_pct;
  $('#r-target').value = profile.profit_target_daily;
  $('#r-max').value = profile.max_contracts;
  $('#r-mart').checked = !!profile.martingale_enabled;
  $('#r-mult').value = profile.martingale_multiplier;
  $('#r-steps').value = profile.martingale_max_steps;
  $('#r-lb').value = profile.load_balance_mode;
  setSession(profile.session_mode);
}

function setSession(mode) {
  state.sessionMode = mode;
  $('#sess-day').classList.toggle('active', mode === 'day');
  $('#sess-night').classList.toggle('active', mode === 'overnight');
}
$('#sess-day').addEventListener('click', () => setSession('day'));
$('#sess-night').addEventListener('click', () => setSession('overnight'));

$('#r-save').addEventListener('click', async () => {
  try {
    await api('/risk', {
      method: 'POST',
      body: {
        open_delay_min: Number($('#r-open').value),
        flatten_before_close_min: Number($('#r-flat').value),
        max_daily_loss_pct: Number($('#r-loss').value),
        drawdown_floor_pct: Number($('#r-floor').value),
        profit_target_daily: Number($('#r-target').value),
        max_contracts: Number($('#r-max').value),
        martingale_enabled: $('#r-mart').checked,
        martingale_multiplier: Number($('#r-mult').value),
        martingale_max_steps: Number($('#r-steps').value),
        load_balance_mode: $('#r-lb').value,
        session_mode: state.sessionMode,
      },
    });
    toast('Risk profile saved', 'ok');
  } catch (e) { toast(e.message, 'error'); }
});

// ─── Integrations ───────────────────────────────────────────────────────────
async function loadIntegrations() {
  const d = await api('/integrations');
  $('#host-card').innerHTML = `
    <div class="card">
      <div class="row between mb-2">
        <h3 style="margin:0">Current host</h3>
        <span class="badge badge-ok">Active</span>
      </div>
      <div class="tiles mb-2">
        <div class="tile"><div class="tile-label">IP</div><div class="tile-value mono" style="font-size:1rem">${esc(d.host.ip)}</div></div>
        <div class="tile"><div class="tile-label">Location</div><div class="tile-value" style="font-size:1rem">${esc(d.host.location)}</div></div>
        <div class="tile"><div class="tile-label">To CME Aurora</div><div class="tile-value">${d.host.milesToCme} mi</div></div>
        <div class="tile"><div class="tile-label">Mail</div><div class="tile-value" style="font-size:1rem">${d.mailer.configured ? 'SMTP' : 'Console'}</div>
          <div class="tile-note">${d.mailer.configured ? esc(d.mailer.host) : 'not configured'}</div></div>
      </div>
      <p class="small muted mb-0">${esc(d.host.note)}</p>
    </div>`;

  const badge = (s) => ({
    active: '<span class="badge badge-ok">Active</span>',
    configured: '<span class="badge badge-ok">Configured</span>',
    partial: '<span class="badge badge-warn">Partial</span>',
    not_configured: '<span class="badge">Not configured</span>',
    informational: '<span class="badge badge-info">Reference</span>',
  }[s] || '');

  const prio = (p) => ({
    required: '<span class="badge badge-critical">Required</span>',
    recommended: '<span class="badge badge-info">Recommended</span>',
    active: '',
    alternative: '<span class="badge">Alternative</span>',
    optional: '<span class="badge">Optional</span>',
    upgrade_path: '<span class="badge badge-warn">Upgrade path</span>',
  }[p] || '');

  $('#int-list').innerHTML = d.categories.map((c) => `
    <h3 class="mt-3">${esc(c.label)}</h3>
    <p class="small muted">${esc(c.blurb)}</p>
    ${c.items.map((i) => `
      <div class="int-item">
        <div class="row between">
          <div class="row" style="gap:8px">
            <strong>${esc(i.name)}</strong>
            <span class="dim xs">${esc(i.vendor)}</span>
            ${prio(i.priority)}
          </div>
          ${badge(i.status)}
        </div>
        <p class="small muted mt-1 mb-0">${esc(i.summary)}</p>
        <p class="small mt-1 mb-0"><span class="dim">Why:</span> <span class="muted">${esc(i.why)}</span></p>
        ${i.caveat ? `<p class="xs mt-1 mb-0" style="color:var(--amber)">⚠ ${esc(i.caveat)}</p>` : ''}
        <div class="row xs dim mt-1" style="gap:14px">
          ${i.cost ? `<span>${esc(i.cost)}</span>` : ''}
          ${i.envKeys ? `<span class="mono">${i.envKeys.join(' · ')}</span>` : ''}
          ${i.docs ? `<a href="${esc(i.docs)}" target="_blank" rel="noopener">Docs ↗</a>` : ''}
        </div>
      </div>`).join('')}`).join('');
}

// ─── Leads ──────────────────────────────────────────────────────────────────
async function loadLeads() {
  const { leads } = await api('/leads');
  $('#lead-count').textContent = `${leads.length} total`;
  $('#lead-rows').innerHTML = leads.length ? leads.map((l) => `<tr>
    <td>${esc(l.created_at)}</td>
    <td><span class="badge">${esc(l.form)}</span></td>
    <td>${esc(l.name)}</td>
    <td>${esc(l.email)}</td>
    <td>${esc(l.phone || '—')}</td>
    <td>${l.emailed ? '<span class="badge badge-ok">Sent</span>' : '<span class="badge badge-warn">Queued</span>'}</td>
  </tr>`).join('') : '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">No enquiries yet.</td></tr>';
}

// ─── Boot ───────────────────────────────────────────────────────────────────
const LOADERS = {
  overview: loadOverview,
  accounts: loadAccounts,
  trade: loadTrade,
  strategies: loadStrategies,
  risk: loadRisk,
  integrations: loadIntegrations,
  leads: loadLeads,
};

(async () => {
  try {
    const { user } = await (await fetch('/auth/me')).json();
    $('#who').textContent = user.email;
  } catch { /* nav label is cosmetic */ }
  loadOverview().catch((e) => toast(e.message, 'error'));
  setInterval(() => {
    if ($('#tab-overview').classList.contains('active')) loadOverview().catch(() => {});
  }, 60_000);
})();
