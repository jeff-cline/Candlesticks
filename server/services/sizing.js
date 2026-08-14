// Candlesticks.ai — position sizing, load balancing, martingale
//
// ─────────────────────────────────────────────────────────────────────────────
// OPERATOR DIRECTIVE
// The martingale and all-in load-balance modes are implemented WITHOUT hard
// caps at the explicit direction of the account owner, who was shown both the
// Apex rule (DCA/averaging down on losing positions is prohibited on PA
// accounts) and the arithmetic, and elected to proceed.
//
// This module therefore sizes as instructed. It does NOT silently clamp.
// It attaches a `warnings` array to every result so the UI can surface what
// the sizing implies, and risk.js still evaluates the resulting order.
// ─────────────────────────────────────────────────────────────────────────────

import { contractSpec, rootSymbol } from './risk.js';

/**
 * Distribute a trade across selected accounts.
 *
 * @param {object[]} accounts  rows from `accounts`
 * @param {object} opts
 *   symbol, stopTicks, mode ('equal'|'proportional'|'all_in'),
 *   baseQty, maxContracts, martingaleStep, martingaleMultiplier
 * @returns {{ allocations: object[], totals: object, warnings: string[] }}
 */
export function allocate(accounts, opts) {
  const {
    symbol,
    stopTicks,
    mode = 'equal',
    baseQty = 1,
    maxContracts = 4,
    martingaleStep = 0,
    martingaleMultiplier = 2.0,
  } = opts;

  const spec = contractSpec(symbol);
  if (!spec) throw new Error(`Unknown contract: ${symbol}`);

  const warnings = [];
  const riskPerContract = spec.tickValue * stopTicks;
  if (riskPerContract <= 0) throw new Error('stopTicks must be > 0');

  // Martingale multiplier applies to the base size, uncapped.
  const martingaleFactor = martingaleStep > 0
    ? Math.pow(martingaleMultiplier, martingaleStep)
    : 1;

  if (martingaleStep > 0) {
    warnings.push(
      `Martingale step ${martingaleStep} — base size multiplied by ${martingaleFactor.toFixed(2)}x. ` +
      `Apex prohibits averaging down on losers in PA accounts; enabled by operator directive, uncapped.`
    );
  }

  const live = accounts.filter((a) => a.is_active && !a.is_breached);
  const skipped = accounts.filter((a) => !a.is_active || a.is_breached);
  if (skipped.length) {
    warnings.push(
      `${skipped.length} account(s) skipped — breached or inactive: ${skipped.map((a) => a.external_id).join(', ')}`
    );
  }

  const totalRoom = live.reduce((s, a) => s + Math.max(0, a.dist_to_liq), 0);

  const allocations = live.map((a) => {
    const room = Math.max(0, a.dist_to_liq);
    let qty;

    switch (mode) {
      case 'all_in': {
        // Size so the stop consumes as close to the account's entire remaining
        // room as possible while still leaving it alive if the stop fills.
        //
        // Sizing to exactly 100% means risk === room, which risk.js blocks as
        // RISK_EXCEEDS_ROOM — a stop-out there closes the account outright.
        // We therefore take the largest quantity STRICTLY under the room so the
        // order is stageable. This is the only place sizing is adjusted, it is
        // one contract's worth, and it is surfaced in `warnings`.
        qty = Math.floor(room / riskPerContract);
        if (qty * riskPerContract >= room) qty -= 1;
        break;
      }

      case 'proportional': {
        // Share the aggregate size out by each account's share of total room.
        const share = totalRoom > 0 ? room / totalRoom : 0;
        const pool = baseQty * live.length * martingaleFactor;
        qty = Math.round(pool * share);
        break;
      }

      case 'equal':
      default:
        qty = Math.round(baseQty * martingaleFactor);
        break;
    }

    // maxContracts is an operator preference, not a compliance cap. All-in
    // deliberately ignores it — that is what "all in" means.
    if (mode !== 'all_in' && maxContracts > 0) {
      qty = Math.min(qty, maxContracts);
    }
    qty = Math.max(0, qty);

    const riskDollars = qty * riskPerContract;
    const pctOfRoom = room > 0 ? (riskDollars / room) * 100 : 0;
    const pointsWide = qty > 0 ? room / (spec.pointValue * qty) : Infinity;

    return {
      accountId: a.id,
      externalId: a.external_id,
      nickname: a.nickname,
      room,
      qty,
      riskDollars,
      pctOfRoom,
      pointsWide,
      wouldExhaust: riskDollars >= room,
    };
  });

  const exhausting = allocations.filter((x) => x.wouldExhaust && x.qty > 0);
  if (exhausting.length) {
    warnings.push(
      `${exhausting.length} account(s) sized so a single stop-out consumes all remaining drawdown room: ` +
      `${exhausting.map((x) => x.externalId).join(', ')}`
    );
  }

  if (mode === 'all_in') {
    warnings.push(
      'All-in mode: every selected account is sized to its maximum drawdown, less one ' +
      'contract so a stop-out leaves the account alive rather than closing it outright. ' +
      'A single adverse move at the stop still takes the entire book to the edge simultaneously.'
    );
  }

  const totals = {
    accounts: allocations.filter((x) => x.qty > 0).length,
    contracts: allocations.reduce((s, x) => s + x.qty, 0),
    riskDollars: allocations.reduce((s, x) => s + x.riskDollars, 0),
    totalRoom,
    pctOfBookRisked: totalRoom > 0
      ? (allocations.reduce((s, x) => s + x.riskDollars, 0) / totalRoom) * 100
      : 0,
    contract: rootSymbol(symbol),
    dollarsPerPointEach: spec.pointValue,
  };

  if (totals.pctOfBookRisked > 50) {
    warnings.push(
      `This allocation risks ${totals.pctOfBookRisked.toFixed(0)}% of the entire book's remaining drawdown room on one signal.`
    );
  }

  return { allocations, totals, warnings };
}

/**
 * Next martingale step given a run of results.
 * Returns 0 when the last trade won (sequence resets).
 */
export function nextMartingaleStep(recentResults, { maxSteps = 3, capped = false } = {}) {
  let step = 0;
  for (let i = recentResults.length - 1; i >= 0; i--) {
    if (recentResults[i] < 0) step++;
    else break;
  }
  // Uncapped by operator directive; `capped` is available for sim/backtest.
  return capped ? Math.min(step, maxSteps) : step;
}

/** Convert a stop distance in ticks to a price, given side and entry. */
export function stopPriceFor(symbol, side, entryPrice, stopTicks) {
  const spec = contractSpec(symbol);
  if (!spec) return null;
  const delta = spec.tickSize * stopTicks;
  return side === 'long' ? entryPrice - delta : entryPrice + delta;
}

export function targetPriceFor(symbol, side, entryPrice, targetTicks) {
  const spec = contractSpec(symbol);
  if (!spec) return null;
  const delta = spec.tickSize * targetTicks;
  return side === 'long' ? entryPrice + delta : entryPrice - delta;
}

export default { allocate, nextMartingaleStep, stopPriceFor, targetPriceFor };
