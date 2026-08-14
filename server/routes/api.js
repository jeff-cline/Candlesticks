// Candlesticks.ai — authenticated API

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { all, get, run, audit } from '../db.js';
import { STRATEGIES, byKey, listByCategory } from '../strategies/index.js';
import { resolveStatus, CURRENT_HOST } from '../services/integrations.js';
import { evaluateOrder, sessionGate, CONTRACTS, APEX_RULES, contractSpec } from '../services/risk.js';
import { allocate, stopPriceFor, targetPriceFor, nextMartingaleStep } from '../services/sizing.js';
import { mailerStatus } from '../services/mailer.js';

const router = Router();
const uid = (req) => req.session.user.id;

// ─── Accounts ───────────────────────────────────────────────────────────────
router.get('/accounts', (req, res) => {
  const accounts = all(
    `SELECT a.*,
            COALESCE(d.net_pl, 0)      AS today_net,
            COALESCE(d.gross_pl, 0)    AS today_gross,
            COALESCE(d.commissions, 0) AS today_comm,
            COALESCE(d.trade_count, 0) AS today_trades
     FROM accounts a
     LEFT JOIN daily_pl d ON d.account_id = a.id AND d.trade_date = date('now')
     WHERE a.user_id = ?
     ORDER BY a.is_breached DESC, a.dist_to_liq ASC`,
    uid(req)
  );
  res.json({ accounts });
});

router.get('/accounts/:id', (req, res) => {
  const account = get('SELECT * FROM accounts WHERE id = ? AND user_id = ?', req.params.id, uid(req));
  if (!account) return res.status(404).json({ error: 'Account not found' });

  const trades = all(
    'SELECT * FROM trades WHERE account_id = ? ORDER BY COALESCE(entered_at, id) DESC LIMIT 200',
    account.id
  );
  const daily = all(
    'SELECT * FROM daily_pl WHERE account_id = ? ORDER BY trade_date DESC LIMIT 90',
    account.id
  );

  const wins = trades.filter((t) => t.net_pl > 0);
  const losses = trades.filter((t) => t.net_pl < 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.net_pl, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.net_pl, 0) / losses.length) : 0;

  res.json({
    account,
    trades,
    daily,
    stats: {
      tradeCount: trades.length,
      winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
      avgWin,
      avgLoss,
      payoffRatio: avgWin > 0 && avgLoss > 0 ? avgWin / avgLoss : null,
      breakevenWinRate: avgWin > 0 && avgLoss > 0 ? (avgLoss / (avgWin + avgLoss)) * 100 : null,
      expectancy: trades.length ? trades.reduce((s, t) => s + t.net_pl, 0) / trades.length : 0,
      largestWin: wins.length ? Math.max(...wins.map((t) => t.net_pl)) : 0,
      largestLoss: losses.length ? Math.min(...losses.map((t) => t.net_pl)) : 0,
    },
  });
});

// ─── Global dashboard: day / week / month ───────────────────────────────────
router.get('/dashboard', (req, res) => {
  const userId = uid(req);
  const accounts = all('SELECT * FROM accounts WHERE user_id = ?', userId);
  const live = accounts.filter((a) => !a.is_breached && a.is_active);

  const period = (sql) => get(
    `SELECT COALESCE(SUM(d.net_pl),0) net, COALESCE(SUM(d.gross_pl),0) gross,
            COALESCE(SUM(d.commissions),0) comm, COALESCE(SUM(d.trade_count),0) trades,
            COALESCE(SUM(d.win_count),0) wins, COALESCE(SUM(d.loss_count),0) losses
     FROM daily_pl d JOIN accounts a ON a.id = d.account_id
     WHERE a.user_id = ? AND ${sql}`, userId);

  const day = period("d.trade_date = date('now')");
  const week = period("d.trade_date >= date('now','weekday 0','-7 days')");
  const month = period("d.trade_date >= date('now','start of month')");

  const equityCurve = all(
    `SELECT d.trade_date AS date, SUM(d.net_pl) AS net
     FROM daily_pl d JOIN accounts a ON a.id = d.account_id
     WHERE a.user_id = ? GROUP BY d.trade_date ORDER BY d.trade_date`,
    userId
  );

  const profile = get('SELECT * FROM risk_profile WHERE user_id = ?', userId) ?? {};

  res.json({
    totals: {
      accounts: accounts.length,
      live: live.length,
      breached: accounts.filter((a) => a.is_breached).length,
      cash: accounts.reduce((s, a) => s + a.cash, 0),
      room: live.reduce((s, a) => s + Math.max(0, a.dist_to_liq), 0),
      untraded: accounts.filter((a) => a.total_pl === 0).length,
    },
    day, week, month,
    equityCurve,
    accounts: accounts
      .map((a) => ({
        id: a.id, external_id: a.external_id, nickname: a.nickname,
        cash: a.cash, dist_to_liq: a.dist_to_liq, total_pl: a.total_pl,
        is_breached: !!a.is_breached, starting_balance: a.starting_balance,
        drawdown_limit: a.drawdown_limit,
        roomPct: a.drawdown_limit > 0 ? (a.dist_to_liq / a.drawdown_limit) * 100 : 0,
      }))
      .sort((x, y) => x.dist_to_liq - y.dist_to_liq),
    session: sessionGate(profile),
    tradingEnabled: process.env.TRADING_ENABLED === 'true',
  });
});

// ─── Strategies ─────────────────────────────────────────────────────────────
router.get('/strategies', (req, res) => {
  const settings = Object.fromEntries(
    all('SELECT * FROM strategy_settings WHERE user_id = ?', uid(req))
      .map((r) => [r.strategy_key, r])
  );
  res.json({
    categories: listByCategory().map((c) => ({
      ...c,
      strategies: c.strategies.map((s) => ({
        ...s,
        enabled: !s.disabled && !!settings[s.key]?.enabled,
        params: settings[s.key] ? JSON.parse(settings[s.key].params_json) : s.defaultParams,
      })),
    })),
  });
});

router.post('/strategies/:key', (req, res) => {
  const def = byKey[req.params.key];
  if (!def) return res.status(404).json({ error: 'Unknown strategy' });
  if (def.disabled && req.body.enabled) {
    return res.status(403).json({
      error: 'This strategy is permanently disabled.',
      reason: def.apexNote,
    });
  }

  const enabled = req.body.enabled ? 1 : 0;
  const params = req.body.params ? JSON.stringify(req.body.params) : null;

  const existing = get(
    'SELECT id FROM strategy_settings WHERE user_id = ? AND strategy_key = ?',
    uid(req), def.key
  );
  if (existing) {
    run(
      `UPDATE strategy_settings SET enabled = ?, params_json = COALESCE(?, params_json),
              updated_at = datetime('now') WHERE id = ?`,
      enabled, params, existing.id
    );
  } else {
    run(
      `INSERT INTO strategy_settings (user_id, strategy_key, enabled, params_json)
       VALUES (?,?,?,?)`,
      uid(req), def.key, enabled, params ?? JSON.stringify(def.defaultParams ?? {})
    );
  }
  audit(uid(req), 'strategy_toggled', { key: def.key, enabled: !!enabled });
  res.json({ ok: true });
});

// ─── Risk profile ───────────────────────────────────────────────────────────
router.get('/risk', (req, res) => {
  res.json({
    profile: get('SELECT * FROM risk_profile WHERE user_id = ?', uid(req)),
    contracts: CONTRACTS,
    apexRules: APEX_RULES,
  });
});

router.post('/risk', (req, res) => {
  const f = [
    'max_daily_loss_pct', 'drawdown_floor_pct', 'profit_target_daily', 'max_contracts',
    'default_stop_ticks', 'default_target_ticks', 'martingale_enabled',
    'martingale_multiplier', 'martingale_max_steps', 'load_balance_mode',
    'session_mode', 'flatten_before_close_min', 'open_delay_min',
  ];
  const sets = [], vals = [];
  for (const k of f) {
    if (req.body[k] !== undefined) {
      sets.push(`${k} = ?`);
      vals.push(typeof req.body[k] === 'boolean' ? (req.body[k] ? 1 : 0) : req.body[k]);
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(uid(req));
  run(`UPDATE risk_profile SET ${sets.join(', ')}, updated_at = datetime('now') WHERE user_id = ?`, ...vals);
  audit(uid(req), 'risk_profile_updated', req.body);
  res.json({ ok: true, profile: get('SELECT * FROM risk_profile WHERE user_id = ?', uid(req)) });
});

// ─── Trade staging (semi-automatic execution) ───────────────────────────────
// Computes sizing + compliance for a proposed trade across selected accounts
// and returns a preview. NOTHING is submitted. The operator fires it.
router.post('/trade/preview', (req, res) => {
  const userId = uid(req);
  const {
    symbol = 'MNQU6',
    side = 'long',
    accountIds = [],
    stopTicks,
    targetTicks,
    strategyKey = null,
    entryPrice,
    mode,
    baseQty = 1,
  } = req.body;

  const profile = get('SELECT * FROM risk_profile WHERE user_id = ?', userId);
  if (!profile) return res.status(400).json({ error: 'No risk profile configured' });

  const spec = contractSpec(symbol);
  if (!spec) return res.status(400).json({ error: `Unknown contract: ${symbol}` });
  if (!Number.isFinite(entryPrice)) return res.status(400).json({ error: 'entryPrice required' });

  const stop = Number(stopTicks ?? profile.default_stop_ticks);
  const target = Number(targetTicks ?? profile.default_target_ticks);

  const accounts = accountIds.length
    ? all(
        `SELECT * FROM accounts WHERE user_id = ? AND id IN (${accountIds.map(() => '?').join(',')})`,
        userId, ...accountIds
      )
    : all('SELECT * FROM accounts WHERE user_id = ? AND is_active = 1 AND is_breached = 0', userId);

  if (!accounts.length) return res.status(400).json({ error: 'No accounts selected' });

  // Martingale step from the most recent closed trades on the first account.
  let martingaleStep = 0;
  if (profile.martingale_enabled) {
    const recent = all(
      `SELECT net_pl FROM trades WHERE account_id = ? AND status = 'closed'
       ORDER BY COALESCE(exited_at, id) DESC LIMIT 10`, accounts[0].id
    ).map((r) => r.net_pl).reverse();
    martingaleStep = nextMartingaleStep(recent, { capped: false });
  }

  const sizing = allocate(accounts, {
    symbol,
    stopTicks: stop,
    mode: mode ?? profile.load_balance_mode,
    baseQty: Math.max(1, Number(baseQty) || 1),
    maxContracts: profile.max_contracts,
    martingaleStep,
    martingaleMultiplier: profile.martingale_multiplier,
  });

  const stopPrice = stopPriceFor(symbol, side, entryPrice, stop);
  const targetPrice = targetPriceFor(symbol, side, entryPrice, target);

  const previews = sizing.allocations.map((alloc) => {
    const account = accounts.find((a) => a.id === alloc.accountId);
    const today = get(
      "SELECT net_pl FROM daily_pl WHERE account_id = ? AND trade_date = date('now')",
      account.id
    );
    const evaluation = evaluateOrder(
      { symbol, side, qty: alloc.qty, entryPrice, stopPrice, targetPrice, strategyKey },
      account, profile,
      { todayNetPl: today?.net_pl ?? 0, martingaleStep }
    );
    return { ...alloc, evaluation };
  });

  res.json({
    symbol, side, entryPrice, stopPrice, targetPrice,
    stopTicks: stop, targetTicks: target,
    strategyKey, martingaleStep,
    mode: mode ?? profile.load_balance_mode,
    contract: spec,
    sizing: { totals: sizing.totals, warnings: sizing.warnings },
    previews,
    stageable: previews.filter((p) => p.evaluation.allowed && p.qty > 0).length,
    blocked: previews.filter((p) => !p.evaluation.allowed).length,
    session: sessionGate(profile),
  });
});

// Persist a staged batch. Still does NOT submit — creates rows the operator
// confirms. Live submission requires TRADING_ENABLED and Tradovate credentials.
router.post('/trade/stage', (req, res) => {
  const userId = uid(req);
  const { previews = [], symbol, side, entryPrice, stopPrice, targetPrice, strategyKey } = req.body;
  const stageable = previews.filter((p) => p.evaluation?.allowed && p.qty > 0);
  if (!stageable.length) return res.status(400).json({ error: 'Nothing stageable in this batch' });

  const batchId = randomUUID();
  for (const p of stageable) {
    run(
      `INSERT INTO staged_orders
        (user_id, batch_id, account_id, strategy_key, symbol, side, qty,
         entry_type, entry_price, stop_price, target_price,
         risk_dollars, reward_dollars, compliance_json)
       VALUES (?,?,?,?,?,?,?, 'market', ?,?,?,?,?,?)`,
      userId, batchId, p.accountId, strategyKey ?? null, symbol, side, p.qty,
      entryPrice, stopPrice, targetPrice,
      p.evaluation.metrics.riskDollars ?? 0,
      p.evaluation.metrics.rewardDollars ?? 0,
      JSON.stringify(p.evaluation)
    );
  }
  audit(userId, 'batch_staged', { batchId, count: stageable.length, symbol, side });

  res.json({
    ok: true,
    batchId,
    staged: stageable.length,
    note:
      'Orders are staged, not submitted. Live submission requires TRADING_ENABLED=true, ' +
      'Tradovate credentials, and your explicit confirmation — Apex requires a human on every entry.',
  });
});

router.get('/trade/staged', (req, res) => {
  res.json({
    batches: all(
      `SELECT s.*, a.external_id FROM staged_orders s
       JOIN accounts a ON a.id = s.account_id
       WHERE s.user_id = ? AND s.status = 'staged'
       ORDER BY s.created_at DESC LIMIT 200`, uid(req)
    ),
  });
});

// ─── Integrations ───────────────────────────────────────────────────────────
router.get('/integrations', (req, res) => {
  res.json({
    host: CURRENT_HOST,
    categories: resolveStatus(),
    mailer: mailerStatus(),
    tradingEnabled: process.env.TRADING_ENABLED === 'true',
    tradovateEnv: process.env.TRADOVATE_ENV || 'demo',
  });
});

// ─── Leads (god only) ───────────────────────────────────────────────────────
router.get('/leads', (req, res) => {
  if (req.session.user.role !== 'god') return res.status(403).json({ error: 'Forbidden' });
  res.json({ leads: all('SELECT * FROM leads ORDER BY created_at DESC LIMIT 500') });
});

export default router;
