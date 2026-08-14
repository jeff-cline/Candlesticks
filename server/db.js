// Candlesticks.ai — data layer
// Uses Node's built-in SQLite (node:sqlite, Node 22.5+). No native build deps.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'candlesticks.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
-- ─── Users ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  email             TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  name              TEXT,
  role              TEXT NOT NULL DEFAULT 'subscriber',  -- 'god' | 'subscriber'
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at     TEXT
);

-- ─── Trading accounts (the Apex book) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_id       TEXT NOT NULL,          -- e.g. PAAPEX1758950000012
  nickname          TEXT,
  firm              TEXT NOT NULL DEFAULT 'Apex',
  account_type      TEXT NOT NULL DEFAULT 'PA',   -- 'EVAL' | 'PA' | 'LIVE'
  starting_balance  REAL NOT NULL DEFAULT 25000,
  drawdown_limit    REAL NOT NULL DEFAULT 1500,   -- trailing threshold
  cash              REAL NOT NULL DEFAULT 0,
  auto_liq_level    REAL NOT NULL DEFAULT 0,
  dist_to_liq       REAL NOT NULL DEFAULT 0,
  total_pl          REAL NOT NULL DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1,
  is_breached       INTEGER NOT NULL DEFAULT 0,
  synced_at         TEXT,
  UNIQUE(user_id, external_id)
);

-- ─── Daily per-account P&L rollups ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_pl (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id        INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  trade_date        TEXT NOT NULL,          -- YYYY-MM-DD
  gross_pl          REAL NOT NULL DEFAULT 0,
  commissions       REAL NOT NULL DEFAULT 0,
  net_pl            REAL NOT NULL DEFAULT 0,
  trade_count       INTEGER NOT NULL DEFAULT 0,
  win_count         INTEGER NOT NULL DEFAULT 0,
  loss_count        INTEGER NOT NULL DEFAULT 0,
  contracts         INTEGER NOT NULL DEFAULT 0,
  UNIQUE(account_id, trade_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_pl_date ON daily_pl(trade_date);

-- ─── Individual trades ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trades (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id        INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  strategy_key      TEXT,
  symbol            TEXT NOT NULL,
  side              TEXT NOT NULL,          -- 'long' | 'short'
  qty               INTEGER NOT NULL,
  entry_price       REAL,
  exit_price        REAL,
  stop_price        REAL,
  target_price      REAL,
  entered_at        TEXT,
  exited_at         TEXT,
  duration_sec      INTEGER,
  gross_pl          REAL DEFAULT 0,
  commissions       REAL DEFAULT 0,
  net_pl            REAL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'closed',  -- 'staged'|'working'|'open'|'closed'|'cancelled'
  notes             TEXT
);
CREATE INDEX IF NOT EXISTS idx_trades_account ON trades(account_id);
CREATE INDEX IF NOT EXISTS idx_trades_entered ON trades(entered_at);

-- ─── Strategy enable/disable + parameters, per user ───────────────────────
CREATE TABLE IF NOT EXISTS strategy_settings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_key      TEXT NOT NULL,
  enabled           INTEGER NOT NULL DEFAULT 0,
  params_json       TEXT NOT NULL DEFAULT '{}',
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, strategy_key)
);

-- ─── Risk profile, per user ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS risk_profile (
  user_id                 INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  max_daily_loss_pct      REAL NOT NULL DEFAULT 40,   -- % of drawdown room
  drawdown_floor_pct      REAL NOT NULL DEFAULT 20,   -- stop trading below this % of room
  profit_target_daily     REAL NOT NULL DEFAULT 500,  -- $ per account
  max_contracts           INTEGER NOT NULL DEFAULT 4,
  default_stop_ticks      INTEGER NOT NULL DEFAULT 40,
  default_target_ticks    INTEGER NOT NULL DEFAULT 40,
  martingale_enabled      INTEGER NOT NULL DEFAULT 0,
  martingale_multiplier   REAL NOT NULL DEFAULT 2.0,
  martingale_max_steps    INTEGER NOT NULL DEFAULT 3,
  load_balance_mode       TEXT NOT NULL DEFAULT 'equal', -- 'equal'|'proportional'|'all_in'
  session_mode            TEXT NOT NULL DEFAULT 'day',   -- 'day'|'overnight'
  flatten_before_close_min INTEGER NOT NULL DEFAULT 5,
  open_delay_min          INTEGER NOT NULL DEFAULT 5,
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Staged orders awaiting the operator's click ──────────────────────────
CREATE TABLE IF NOT EXISTS staged_orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  batch_id          TEXT NOT NULL,
  account_id        INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  strategy_key      TEXT,
  symbol            TEXT NOT NULL,
  side              TEXT NOT NULL,
  qty               INTEGER NOT NULL,
  entry_type        TEXT NOT NULL DEFAULT 'market',
  entry_price       REAL,
  stop_price        REAL NOT NULL,
  target_price      REAL NOT NULL,
  risk_dollars      REAL NOT NULL,
  reward_dollars    REAL NOT NULL,
  compliance_json   TEXT NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'staged', -- 'staged'|'fired'|'rejected'|'expired'
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  fired_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_staged_batch ON staged_orders(batch_id);

-- ─── Leads from Join + footer forms ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  form              TEXT NOT NULL,   -- 'join'|'investor'|'press'|'advertise'|'sponsor'|'algos'
  name              TEXT,
  company           TEXT,
  email             TEXT,
  phone             TEXT,
  message           TEXT,
  ip                TEXT,
  user_agent        TEXT,
  emailed           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Integration credentials/status ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS integrations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key               TEXT NOT NULL,
  enabled           INTEGER NOT NULL DEFAULT 0,
  config_json       TEXT NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'not_configured',
  last_checked_at   TEXT,
  UNIQUE(user_id, key)
);

-- ─── Audit log ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER,
  action            TEXT NOT NULL,
  detail_json       TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ─── Helpers ────────────────────────────────────────────────────────────────

export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

export function audit(userId, action, detail = {}) {
  run(
    'INSERT INTO audit_log (user_id, action, detail_json) VALUES (?, ?, ?)',
    userId ?? null,
    action,
    JSON.stringify(detail)
  );
}

export default db;
