// Candlesticks.ai — Tradovate client
//
// Reads account state and (when explicitly enabled) submits bracket orders that
// the operator has confirmed. Never places an order on its own initiative.
//
// Live submission requires ALL of:
//   1. TRADING_ENABLED=true
//   2. Valid Tradovate credentials
//   3. An explicit call from a confirmed staged batch
//
// Apex prohibits unsupervised automation on PA accounts. This module has no
// polling loop that opens positions and no scheduler that fires orders.

const API = process.env.TRADOVATE_API_URL || 'https://demo.tradovateapi.com/v1';

let token = null;
let tokenExpiry = 0;

export function isConfigured() {
  return !!(process.env.TRADOVATE_USERNAME && process.env.TRADOVATE_PASSWORD);
}

export function isLiveEnabled() {
  return process.env.TRADING_ENABLED === 'true' && isConfigured();
}

async function authenticate() {
  if (token && Date.now() < tokenExpiry - 60_000) return token;
  if (!isConfigured()) throw new Error('Tradovate credentials are not configured');

  const res = await fetch(`${API}/auth/accesstokenrequest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: process.env.TRADOVATE_USERNAME,
      password: process.env.TRADOVATE_PASSWORD,
      appId: process.env.TRADOVATE_APP_ID || 'Candlesticks',
      appVersion: process.env.TRADOVATE_APP_VERSION || '0.1.0',
      cid: process.env.TRADOVATE_CID,
      sec: process.env.TRADOVATE_SEC,
    }),
  });
  if (!res.ok) throw new Error(`Tradovate auth failed: ${res.status}`);
  const data = await res.json();
  if (data.errorText) throw new Error(`Tradovate auth: ${data.errorText}`);
  token = data.accessToken;
  tokenExpiry = new Date(data.expirationTime).getTime();
  return token;
}

async function call(path, opts = {}) {
  const t = await authenticate();
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${t}`,
      ...opts.headers,
    },
  });
  if (!res.ok) throw new Error(`Tradovate ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ─── Reads ──────────────────────────────────────────────────────────────────
export const listAccounts    = () => call('/account/list');
export const listPositions   = () => call('/position/list');
export const listOrders      = () => call('/order/list');
export const listFills       = () => call('/fill/list');
export const cashBalance     = (accountId) =>
  call('/cashBalance/getcashbalancesnapshot', {
    method: 'POST', body: JSON.stringify({ accountId }),
  });

/**
 * Sync account state into the local DB shape.
 * Returns rows ready for the `accounts` table.
 */
export async function syncAccounts() {
  const accounts = await listAccounts();
  const out = [];
  for (const a of accounts) {
    let snapshot = {};
    try { snapshot = await cashBalance(a.id); } catch { /* per-account failure is non-fatal */ }
    out.push({
      external_id: a.name,
      tradovate_id: a.id,
      cash: snapshot.totalCashValue ?? null,
      open_pl: snapshot.openPnL ?? 0,
      synced_at: new Date().toISOString(),
    });
  }
  return out;
}

// ─── Writes ─────────────────────────────────────────────────────────────────

/**
 * Submit a confirmed bracket order.
 *
 * Refuses unless live trading is explicitly enabled, and refuses any order
 * without both a stop and a target — Tradovate rejects unbracketed orders on
 * Apex accounts, and so does this function, earlier and with a clearer message.
 */
export async function submitBracket({ accountId, accountSpec, symbol, side, qty, stopPrice, targetPrice }) {
  if (!isLiveEnabled()) {
    throw new Error(
      'Live trading is disabled. Set TRADING_ENABLED=true and configure Tradovate credentials.'
    );
  }
  if (!Number.isFinite(stopPrice) || !Number.isFinite(targetPrice)) {
    throw new Error('Bracket orders require both a stop-loss and a take-profit.');
  }
  if (!qty || qty < 1) throw new Error('Quantity must be at least 1.');

  const action = side === 'long' ? 'Buy' : 'Sell';
  const exit = side === 'long' ? 'Sell' : 'Buy';

  return call('/order/placeoso', {
    method: 'POST',
    body: JSON.stringify({
      accountSpec,
      accountId,
      action,
      symbol,
      orderQty: qty,
      orderType: 'Market',
      isAutomated: false, // human-confirmed; Apex requires supervision on PA
      bracket1: { action: exit, orderType: 'Stop',  stopPrice,  orderQty: qty },
      bracket2: { action: exit, orderType: 'Limit', price: targetPrice, orderQty: qty },
    }),
  });
}

/** Flatten a position. Used by the pre-close flatten routine. */
export async function liquidatePosition(accountId, contractId) {
  if (!isLiveEnabled()) throw new Error('Live trading is disabled.');
  return call('/order/liquidateposition', {
    method: 'POST',
    body: JSON.stringify({ accountId, contractId, admin: false }),
  });
}

export default {
  isConfigured, isLiveEnabled, syncAccounts, listAccounts, listPositions,
  listOrders, listFills, submitBracket, liquidatePosition,
};
