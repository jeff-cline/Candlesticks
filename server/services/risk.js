// Candlesticks.ai — risk & Apex compliance engine
//
// Every order proposal passes through evaluateOrder() before it can be staged.
// This module encodes the Apex PA rules as executable checks so a violation is
// a data structure, not a memory.
//
// Severity:
//   'block' — a documented Apex prohibition. The order cannot be staged.
//   'warn'  — operator-configured risk limit, or a rule the operator has
//             explicitly chosen to run past. Surfaced, never silently dropped.

// ─── Contract specifications ────────────────────────────────────────────────
export const CONTRACTS = {
  NQ:  { name: 'E-mini Nasdaq 100',   tickSize: 0.25, tickValue: 5.00,  pointValue: 20   },
  MNQ: { name: 'Micro Nasdaq 100',    tickSize: 0.25, tickValue: 0.50,  pointValue: 2    },
  ES:  { name: 'E-mini S&P 500',      tickSize: 0.25, tickValue: 12.50, pointValue: 50   },
  MES: { name: 'Micro S&P 500',       tickSize: 0.25, tickValue: 1.25,  pointValue: 5    },
  YM:  { name: 'E-mini Dow',          tickSize: 1.0,  tickValue: 5.00,  pointValue: 5    },
  MYM: { name: 'Micro Dow',           tickSize: 1.0,  tickValue: 0.50,  pointValue: 0.5  },
  RTY: { name: 'E-mini Russell 2000', tickSize: 0.10, tickValue: 5.00,  pointValue: 50   },
  M2K: { name: 'Micro Russell 2000',  tickSize: 0.10, tickValue: 0.50,  pointValue: 5    },
  GC:  { name: 'Gold',                tickSize: 0.10, tickValue: 10.00, pointValue: 100  },
  MGC: { name: 'Micro Gold',          tickSize: 0.10, tickValue: 1.00,  pointValue: 10   },
  CL:  { name: 'Crude Oil',           tickSize: 0.01, tickValue: 10.00, pointValue: 1000 },
  MCL: { name: 'Micro Crude Oil',     tickSize: 0.01, tickValue: 1.00,  pointValue: 100  },
};

// Tradovate symbols carry a contract-month suffix (NQU6, MNQZ5). Strip it.
export function rootSymbol(symbol) {
  const m = String(symbol).toUpperCase().match(/^([A-Z0-9]*?[A-Z])([FGHJKMNQUVXZ]\d{1,2})$/);
  const root = m ? m[1] : String(symbol).toUpperCase();
  return CONTRACTS[root] ? root : root;
}

export function contractSpec(symbol) {
  return CONTRACTS[rootSymbol(symbol)] ?? null;
}

/** Dollar value of a price move, for a given symbol and quantity. */
export function dollarsPerPoint(symbol, qty = 1) {
  const spec = contractSpec(symbol);
  if (!spec) return null;
  return spec.pointValue * qty;
}

export function ticksToDollars(symbol, ticks, qty = 1) {
  const spec = contractSpec(symbol);
  if (!spec) return null;
  return spec.tickValue * ticks * qty;
}

// ─── Apex rule constants ────────────────────────────────────────────────────
// Sourced from third-party summaries of Apex's published rules; Apex's own
// help center blocks automated retrieval. Verify before enabling live trading.
export const APEX_RULES = {
  MAX_STOP_TO_TARGET_RATIO: 5,      // stop must not exceed 5x the profit target
  REQUIRE_BRACKET: true,            // SL+TP required at submission (since Mar 2026)
  FULL_AUTO_ON_PA: false,           // fully automated entry+exit prohibited on PA
  DCA_ON_LOSERS_ON_PA: false,       // averaging down prohibited on PA
};

// ─── Session windows (US/Central, CME) ──────────────────────────────────────
export const SESSION = {
  rthOpen:  { h: 8,  m: 30 },   // 08:30 CT
  rthClose: { h: 15, m: 0  },   // 15:00 CT
  globexOpen:  { h: 17, m: 0 }, // 17:00 CT previous day
  globexClose: { h: 16, m: 0 }, // 16:00 CT
};

function ctParts(date = new Date()) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour12: false,
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  }).formatToParts(date);
  const o = Object.fromEntries(f.map((p) => [p.type, p.value]));
  return { weekday: o.weekday, hour: Number(o.hour) % 24, minute: Number(o.minute) };
}

export function minutesUntilClose(date = new Date(), mode = 'day') {
  const { hour, minute } = ctParts(date);
  const now = hour * 60 + minute;
  const close = mode === 'overnight'
    ? SESSION.globexClose.h * 60 + SESSION.globexClose.m
    : SESSION.rthClose.h * 60 + SESSION.rthClose.m;
  return close - now;
}

export function minutesSinceOpen(date = new Date(), mode = 'day') {
  const { hour, minute } = ctParts(date);
  const now = hour * 60 + minute;
  const open = mode === 'overnight'
    ? SESSION.globexOpen.h * 60 + SESSION.globexOpen.m
    : SESSION.rthOpen.h * 60 + SESSION.rthOpen.m;
  return now - open;
}

export function isWeekend(date = new Date()) {
  const { weekday } = ctParts(date);
  return weekday === 'Sat' || weekday === 'Sun';
}

/**
 * Session gate: are we inside the tradable window, accounting for the
 * operator's open-delay and flatten-before-close settings?
 */
export function sessionGate(profile, date = new Date()) {
  const mode = profile.session_mode ?? 'day';
  const sinceOpen = minutesSinceOpen(date, mode);
  const untilClose = minutesUntilClose(date, mode);
  const openDelay = profile.open_delay_min ?? 5;
  const flattenAt = profile.flatten_before_close_min ?? 5;

  if (isWeekend(date)) {
    return { open: false, reason: 'Market closed (weekend)', untilClose, sinceOpen };
  }
  if (sinceOpen < openDelay) {
    return {
      open: false,
      reason: `Open delay active — ${openDelay - sinceOpen} min until entries unlock`,
      untilClose, sinceOpen,
    };
  }
  if (untilClose <= flattenAt) {
    return {
      open: false,
      reason: `Flatten window — ${untilClose} min to close, entries locked`,
      untilClose, sinceOpen, flatten: true,
    };
  }
  return { open: true, reason: null, untilClose, sinceOpen };
}

// ─── Order evaluation ───────────────────────────────────────────────────────

/**
 * @param {object} order    { symbol, side, qty, entryPrice, stopPrice, targetPrice, strategyKey }
 * @param {object} account  row from `accounts`
 * @param {object} profile  row from `risk_profile`
 * @param {object} context  { todayNetPl, openPositions, date, martingaleStep }
 * @returns {{ allowed, violations, warnings, metrics }}
 */
export function evaluateOrder(order, account, profile, context = {}) {
  const violations = [];
  const warnings = [];
  const date = context.date ?? new Date();

  const spec = contractSpec(order.symbol);
  if (!spec) {
    violations.push({
      code: 'UNKNOWN_CONTRACT',
      severity: 'block',
      message: `No contract specification for "${order.symbol}". Cannot compute risk.`,
    });
    return { allowed: false, violations, warnings, metrics: {} };
  }

  // ── Account state ────────────────────────────────────────────────────────
  if (account.is_breached) {
    violations.push({
      code: 'ACCOUNT_BREACHED',
      severity: 'block',
      message: `${account.external_id} has breached its trailing drawdown (distance ${fmt(account.dist_to_liq)}). It cannot be traded.`,
    });
  }
  if (!account.is_active) {
    violations.push({
      code: 'ACCOUNT_INACTIVE',
      severity: 'block',
      message: `${account.external_id} is marked inactive.`,
    });
  }

  // ── Bracket requirement (Apex / platform-enforced since Mar 2026) ────────
  if (APEX_RULES.REQUIRE_BRACKET) {
    if (!Number.isFinite(order.stopPrice)) {
      violations.push({
        code: 'MISSING_STOP',
        severity: 'block',
        message: 'No stop-loss attached. Tradovate rejects unbracketed orders on Apex accounts.',
      });
    }
    if (!Number.isFinite(order.targetPrice)) {
      violations.push({
        code: 'MISSING_TARGET',
        severity: 'block',
        message: 'No take-profit attached. Tradovate rejects unbracketed orders on Apex accounts.',
      });
    }
  }

  // ── Risk / reward geometry ───────────────────────────────────────────────
  let riskDollars = null, rewardDollars = null, ratio = null;
  if (Number.isFinite(order.entryPrice) && Number.isFinite(order.stopPrice) && Number.isFinite(order.targetPrice)) {
    const stopPoints   = Math.abs(order.entryPrice - order.stopPrice);
    const targetPoints = Math.abs(order.targetPrice - order.entryPrice);
    riskDollars   = stopPoints * spec.pointValue * order.qty;
    rewardDollars = targetPoints * spec.pointValue * order.qty;
    ratio = targetPoints > 0 ? stopPoints / targetPoints : Infinity;

    if (ratio > APEX_RULES.MAX_STOP_TO_TARGET_RATIO) {
      violations.push({
        code: 'STOP_TARGET_RATIO',
        severity: 'block',
        message: `Stop is ${ratio.toFixed(1)}x the target. Apex requires no more than ${APEX_RULES.MAX_STOP_TO_TARGET_RATIO}x.`,
      });
    }

    // ── Drawdown headroom ──────────────────────────────────────────────────
    const room = account.dist_to_liq;
    if (riskDollars >= room) {
      violations.push({
        code: 'RISK_EXCEEDS_ROOM',
        severity: 'block',
        message: `Risk of ${fmt(riskDollars)} meets or exceeds the account's remaining ${fmt(room)} of drawdown room. This trade can end the account.`,
      });
    } else {
      const pctOfRoom = (riskDollars / room) * 100;
      const floorPct = profile.drawdown_floor_pct ?? 20;
      if (pctOfRoom > 100 - floorPct) {
        warnings.push({
          code: 'RISK_BREACHES_FLOOR',
          severity: 'warn',
          message: `Risk is ${pctOfRoom.toFixed(0)}% of remaining room, leaving less than your ${floorPct}% floor.`,
        });
      } else if (pctOfRoom > 25) {
        warnings.push({
          code: 'LARGE_RISK',
          severity: 'warn',
          message: `Risk is ${pctOfRoom.toFixed(0)}% of this account's remaining drawdown room.`,
        });
      }
    }
  }

  // ── Position sizing sanity: how many points is the whole account wide? ────
  const accountPointsWide = account.dist_to_liq / (spec.pointValue * order.qty);
  if (accountPointsWide < 25) {
    warnings.push({
      code: 'THIN_ACCOUNT_WIDTH',
      severity: 'warn',
      message: `At ${order.qty} ${rootSymbol(order.symbol)}, this account is only ${accountPointsWide.toFixed(1)} points from liquidation.`,
    });
  }

  // ── Daily loss limit ─────────────────────────────────────────────────────
  const todayNet = context.todayNetPl ?? 0;
  const maxDailyLoss = (account.dist_to_liq + Math.max(0, -todayNet)) * ((profile.max_daily_loss_pct ?? 40) / 100);
  if (todayNet < 0 && Math.abs(todayNet) >= maxDailyLoss) {
    violations.push({
      code: 'DAILY_LOSS_LIMIT',
      severity: 'block',
      message: `Account is down ${fmt(todayNet)} today, at or past your ${profile.max_daily_loss_pct}% daily loss limit.`,
    });
  }

  // ── Session window ───────────────────────────────────────────────────────
  const gate = sessionGate(profile, date);
  if (!gate.open) {
    violations.push({ code: 'SESSION_CLOSED', severity: 'block', message: gate.reason });
  }

  // ── Martingale disclosure ────────────────────────────────────────────────
  if (context.martingaleStep && context.martingaleStep > 0) {
    warnings.push({
      code: 'MARTINGALE_ACTIVE',
      severity: 'warn',
      message: `Martingale step ${context.martingaleStep}: size increased after a loss. Apex prohibits averaging down on losing positions in PA accounts — this is enabled by explicit operator direction and is not capped.`,
    });
  }

  return {
    allowed: violations.length === 0,
    violations,
    warnings,
    metrics: {
      riskDollars,
      rewardDollars,
      stopToTargetRatio: ratio,
      pctOfRoom: riskDollars != null && account.dist_to_liq > 0
        ? (riskDollars / account.dist_to_liq) * 100 : null,
      accountPointsWide,
      dollarsPerPoint: spec.pointValue * order.qty,
      contract: spec.name,
      session: gate,
    },
  };
}

function fmt(v) {
  const n = Number(v) || 0;
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

export default { evaluateOrder, sessionGate, CONTRACTS, APEX_RULES, contractSpec, rootSymbol };
