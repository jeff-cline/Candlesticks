// Candlesticks.ai — seed
//
// Creates the god account and loads the Apex account book as read live from
// Tradovate on 14 Aug 2026 at 08:42 CDT. Idempotent: safe to re-run.
//
//   npm run seed              seed everything (skips existing)
//   npm run reset-god         reset the god account password to GOD_TEMP_PASSWORD

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db, all, get, run, audit } from './db.js';
import { STRATEGIES } from './strategies/index.js';

const GOD_EMAIL = process.env.GOD_EMAIL || 'jeff.cline@me.com';
const GOD_TEMP = process.env.GOD_TEMP_PASSWORD || 'TEMP!234';

// ─── Account book, read from Tradovate 2026-08-14 08:42 CDT ─────────────────
// starting_balance / drawdown_limit for the 25k and 50k accounts are confirmed
// by arithmetic (cash - dist === auto_liq_level, and cash - 25000 === total_pl).
// Account …0002's plan size is INFERRED from its balance; verify in Apex.
const ACCOUNTS = [
  { ext: 'PAAPEX1758950000002', start: 250000, dd: 6500, cash: 251964.78, liq: 247942.32, dist: 4022.46, pl: 107.60, inferred: true },
  { ext: 'PAAPEX1758950000010', start: 50000,  dd: 2500, cash: 49479.02,  liq: 47527.28,  dist: 1951.74, pl: 67.60 },
  { ext: 'PAAPEX1758950000011', start: 50000,  dd: 2500, cash: 50361.32,  liq: 47861.32,  dist: 2500.00, pl: 235.20 },
  { ext: 'PAAPEX1758950000012', start: 25000,  dd: 1500, cash: 25187.60,  liq: 23687.60,  dist: 1500.00, pl: 187.60 },
  { ext: 'PAAPEX1758950000013', start: 25000,  dd: 1500, cash: 25127.60,  liq: 23627.60,  dist: 1500.00, pl: 127.60 },
  { ext: 'PAAPEX1758950000014', start: 25000,  dd: 1500, cash: 25147.60,  liq: 23647.60,  dist: 1500.00, pl: 147.60 },
  { ext: 'PAAPEX1758950000015', start: 25000,  dd: 1500, cash: 25087.60,  liq: 23587.60,  dist: 1500.00, pl: 87.60 },
  { ext: 'PAAPEX1758950000016', start: 25000,  dd: 1500, cash: 25047.60,  liq: 23593.80, dist: 1453.80, pl: 47.60 },
  { ext: 'PAAPEX1758950000017', start: 25000,  dd: 1500, cash: 25000.00,  liq: 23500.00, dist: 1500.00, pl: 0.00 },
  { ext: 'PAAPEX1758950000018', start: 25000,  dd: 1500, cash: 25087.60,  liq: 23587.60, dist: 1500.00, pl: 87.60 },
  { ext: 'PAAPEX1758950000019', start: 25000,  dd: 1500, cash: 25187.60,  liq: 23687.60, dist: 1500.00, pl: 187.60 },
  { ext: 'PAAPEX1758950000020', start: 25000,  dd: 1500, cash: 25067.60,  liq: 23573.80, dist: 1493.80, pl: 67.60 },
  { ext: 'PAAPEX1758950000021', start: 25000,  dd: 1500, cash: 25867.60,  liq: 24367.60, dist: 1500.00, pl: 867.60 },
  { ext: 'PAAPEX1758950000022', start: 25000,  dd: 1500, cash: 25427.60,  liq: 23927.60, dist: 1500.00, pl: 427.60 },
  { ext: 'PAAPEX1758950000023', start: 25000,  dd: 1500, cash: 25000.00,  liq: 23500.00, dist: 1500.00, pl: 0.00 },
  { ext: 'PAAPEX1758950000024', start: 25000,  dd: 1500, cash: 25347.60,  liq: 23847.60, dist: 1500.00, pl: 347.60 },
  { ext: 'PAAPEX1758950000025', start: 25000,  dd: 1500, cash: 25127.60,  liq: 23627.60, dist: 1500.00, pl: 127.60 },
  { ext: 'PAAPEX1758950000026', start: 25000,  dd: 1500, cash: 23542.80,  liq: 23815.20, dist: -272.40, pl: -1457.20, breached: true },
];

// Today's three trades — all on …0026, all NQU6, all shorts.
const TRADES = [
  { ext: 'PAAPEX1758950000026', symbol: 'NQU6', side: 'short', qty: 4, entry: 30201.00, exit: 30199.75, in: '2026-08-14T13:35:42Z', out: '2026-08-14T13:35:44Z', dur: 2,  gross: 100.00,   comm: 12.40 },
  { ext: 'PAAPEX1758950000026', symbol: 'NQU6', side: 'short', qty: 4, entry: 30183.00, exit: 30180.00, in: '2026-08-14T13:37:14Z', out: '2026-08-14T13:37:47Z', dur: 33, gross: 240.00,   comm: 12.40 },
  { ext: 'PAAPEX1758950000026', symbol: 'NQU6', side: 'short', qty: 4, entry: 30199.75, exit: 30221.75, in: '2026-08-14T13:39:11Z', out: '2026-08-14T13:39:59Z', dur: 48, gross: -1760.00, comm: 12.40 },
];

function seedGod(reset = false) {
  let user = get('SELECT * FROM users WHERE email = ?', GOD_EMAIL);
  const hash = bcrypt.hashSync(GOD_TEMP, 12);

  if (!user) {
    run(
      `INSERT INTO users (email, password_hash, name, role, must_change_password)
       VALUES (?, ?, ?, 'god', 1)`,
      GOD_EMAIL, hash, 'Jeff Cline'
    );
    user = get('SELECT * FROM users WHERE email = ?', GOD_EMAIL);
    console.log(`✓ God account created: ${GOD_EMAIL}`);
    console.log(`  Temp password from GOD_TEMP_PASSWORD — you must change it at first login.`);
  } else if (reset) {
    run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', hash, user.id);
    console.log(`✓ God account password reset — change required at next login.`);
  } else {
    console.log(`· God account already exists (${GOD_EMAIL})`);
  }

  if (!get('SELECT user_id FROM risk_profile WHERE user_id = ?', user.id)) {
    run(
      `INSERT INTO risk_profile
        (user_id, max_daily_loss_pct, drawdown_floor_pct, flatten_before_close_min, open_delay_min)
       VALUES (?, ?, ?, ?, ?)`,
      user.id,
      Number(process.env.DEFAULT_MAX_DAILY_LOSS_PCT || 40),
      Number(process.env.DEFAULT_DRAWDOWN_FLOOR_PCT || 20),
      Number(process.env.FLATTEN_MINUTES_BEFORE_CLOSE || 5),
      Number(process.env.SESSION_OPEN_DELAY_MINUTES || 5)
    );
    console.log('✓ Risk profile created with defaults');
  }

  return user;
}

function seedAccounts(userId) {
  let created = 0, updated = 0;
  for (const a of ACCOUNTS) {
    const existing = get('SELECT id FROM accounts WHERE user_id = ? AND external_id = ?', userId, a.ext);
    if (existing) {
      run(
        `UPDATE accounts SET cash=?, auto_liq_level=?, dist_to_liq=?, total_pl=?,
                is_breached=?, synced_at=datetime('now') WHERE id=?`,
        a.cash, a.liq, a.dist, a.pl, a.breached ? 1 : 0, existing.id
      );
      updated++;
    } else {
      run(
        `INSERT INTO accounts
          (user_id, external_id, firm, account_type, starting_balance, drawdown_limit,
           cash, auto_liq_level, dist_to_liq, total_pl, is_active, is_breached, synced_at)
         VALUES (?, ?, 'Apex', 'PA', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        userId, a.ext, a.start, a.dd, a.cash, a.liq, a.dist, a.pl,
        a.breached ? 0 : 1, a.breached ? 1 : 0
      );
      created++;
    }
  }
  console.log(`✓ Accounts: ${created} created, ${updated} updated (${ACCOUNTS.length} total)`);
}

function seedTrades(userId) {
  if (get('SELECT COUNT(*) c FROM trades').c > 0) {
    console.log('· Trades already seeded');
    return;
  }
  const byExt = Object.fromEntries(
    all('SELECT id, external_id FROM accounts WHERE user_id = ?', userId).map((r) => [r.external_id, r.id])
  );
  for (const t of TRADES) {
    run(
      `INSERT INTO trades
        (account_id, symbol, side, qty, entry_price, exit_price, entered_at, exited_at,
         duration_sec, gross_pl, commissions, net_pl, status, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'closed', ?)`,
      byExt[t.ext], t.symbol, t.side, t.qty, t.entry, t.exit, t.in, t.out,
      t.dur, t.gross, t.comm, t.gross - t.comm,
      t.gross < 0 ? 'Loss exceeded the account drawdown allowance' : null
    );
  }
  // Daily rollup
  const acct = byExt['PAAPEX1758950000026'];
  const gross = TRADES.reduce((s, t) => s + t.gross, 0);
  const comm = TRADES.reduce((s, t) => s + t.comm, 0);
  run(
    `INSERT OR REPLACE INTO daily_pl
      (account_id, trade_date, gross_pl, commissions, net_pl, trade_count, win_count, loss_count, contracts)
     VALUES (?, '2026-08-14', ?, ?, ?, ?, ?, ?, ?)`,
    acct, gross, comm, gross - comm, TRADES.length,
    TRADES.filter((t) => t.gross > 0).length,
    TRADES.filter((t) => t.gross < 0).length,
    TRADES.reduce((s, t) => s + t.qty * 2, 0)
  );
  console.log(`✓ Trades: ${TRADES.length} seeded, daily rollup written`);
}

function seedStrategies(userId) {
  let n = 0;
  for (const s of STRATEGIES) {
    if (get('SELECT id FROM strategy_settings WHERE user_id = ? AND strategy_key = ?', userId, s.key)) continue;
    run(
      `INSERT INTO strategy_settings (user_id, strategy_key, enabled, params_json)
       VALUES (?, ?, 0, ?)`,
      userId, s.key, JSON.stringify(s.defaultParams ?? {})
    );
    n++;
  }
  console.log(`✓ Strategies: ${n} registered, all disabled by default`);
}

// ─── Run ────────────────────────────────────────────────────────────────────
const reset = process.argv.includes('--reset-god');
const user = seedGod(reset);
seedAccounts(user.id);
seedTrades(user.id);
seedStrategies(user.id);
audit(user.id, 'seed', { reset });

const summary = get(`
  SELECT COUNT(*) n,
         SUM(cash) cash,
         SUM(CASE WHEN is_breached = 0 THEN dist_to_liq ELSE 0 END) room,
         SUM(is_breached) breached
  FROM accounts WHERE user_id = ?`, user.id);

console.log(`\n─────────────────────────────────────────`);
console.log(`  Accounts:       ${summary.n}`);
console.log(`  Total cash:     $${summary.cash.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
console.log(`  Drawdown room:  $${summary.room.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
console.log(`  Breached:       ${summary.breached}`);
console.log(`─────────────────────────────────────────\n`);

db.close();
