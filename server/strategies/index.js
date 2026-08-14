// Candlesticks.ai — strategy library
//
// Each strategy is a declarative definition: what it is, when it fires, what
// parameters it exposes, and how it sits against Apex PA rules. The engine
// reads these; the UI renders toggles and parameter forms straight from them.
//
// `apex` field values:
//   'clear'    — no known conflict with Apex PA rules
//   'caution'  — permissible but has a rule that constrains how it may run
//   'conflict' — collides with a documented Apex prohibition; ships disabled
//
// Sources for the strategy definitions are in docs/strategies.md.

export const CATEGORIES = {
  sniper:   { label: 'Sniper / Scalp',  hold: 'seconds – minutes' },
  intraday: { label: 'Intraday',        hold: 'minutes – hours' },
  swing:    { label: 'Swing',           hold: 'hours – days' },
};

export const STRATEGIES = [
  // ─── Sniper / scalp ──────────────────────────────────────────────────────
  {
    key: 'orb',
    name: 'Opening Range Breakout',
    category: 'intraday',
    apex: 'clear',
    summary:
      'Marks the high and low of the first N minutes after the cash open, then trades the break of that range. Works best when the opening range is compressed — a narrow range signals stored energy.',
    rationale:
      'The open concentrates overnight order imbalance into a short window. A tight range means buyers and sellers are in balance; the break resolves it. Widely documented on ES and NQ.',
    edgeNotes:
      'Degrades badly on wide opening ranges — an ORB on a 60-point NQ range is a coin flip with a huge stop. The range-width filter is what makes this tradable.',
    session: 'day',
    defaultParams: {
      range_minutes: 15,
      max_range_points: 25,
      confirm_close_beyond: true,
      stop_ticks: 40,
      target_ticks: 60,
      one_shot_per_side: true,
    },
    paramSchema: {
      range_minutes:        { type: 'int',  min: 1,  max: 60,  label: 'Opening range (minutes)' },
      max_range_points:     { type: 'num',  min: 5,  max: 200, label: 'Max range width (points)' },
      confirm_close_beyond: { type: 'bool', label: 'Require candle close beyond range' },
      stop_ticks:           { type: 'int',  min: 4,  max: 400, label: 'Stop (ticks)' },
      target_ticks:         { type: 'int',  min: 4,  max: 800, label: 'Target (ticks)' },
      one_shot_per_side:    { type: 'bool', label: 'One attempt per side per day' },
    },
  },
  {
    key: 'vwap_reversion',
    name: 'VWAP Mean Reversion',
    category: 'sniper',
    apex: 'clear',
    summary:
      'Fades price when it extends a set distance from session VWAP on declining relative volume, targeting a snapback toward VWAP.',
    rationale:
      'VWAP is the benchmark institutional desks are measured against, so it acts as a real magnet rather than a drawn line. Extension on thinning volume means the move lacks participation.',
    edgeNotes:
      'This is a counter-trend strategy. It fails catastrophically on trend days, which is what the volume filter and the hard stop exist to catch. Roughly 70% of NQ/ES sessions are range-bound — the other 30% are where this bleeds.',
    session: 'day',
    defaultParams: {
      extension_points: 25,
      volume_filter: true,
      rel_volume_max: 0.8,
      stop_ticks: 32,
      target_mode: 'vwap',
      max_attempts_per_session: 3,
    },
    paramSchema: {
      extension_points:         { type: 'num',  min: 2,  max: 200, label: 'Extension from VWAP (points)' },
      volume_filter:            { type: 'bool', label: 'Require declining relative volume' },
      rel_volume_max:           { type: 'num',  min: 0.1, max: 2, step: 0.1, label: 'Max relative volume' },
      stop_ticks:               { type: 'int',  min: 4,  max: 400, label: 'Stop (ticks)' },
      target_mode:              { type: 'enum', options: ['vwap', 'half_way', 'fixed'], label: 'Target' },
      max_attempts_per_session: { type: 'int',  min: 1,  max: 20,  label: 'Max attempts / session' },
    },
  },
  {
    key: 'liquidity_sweep',
    name: 'Liquidity Sweep Reversal',
    category: 'sniper',
    apex: 'clear',
    summary:
      'Waits for price to poke through an obvious prior high or low — where retail stops rest — then reverse sharply. Enters on the reclaim of the swept level.',
    rationale:
      'Resting stop clusters above swing highs and below swing lows are the liquidity larger participants need to fill size. The sweep-and-reclaim is the visible footprint of that.',
    edgeNotes:
      'Requires the reclaim as confirmation. Entering on the sweep alone is just catching a knife. The invalidation is clean, which makes the risk definable.',
    session: 'both',
    defaultParams: {
      lookback_bars: 30,
      min_sweep_ticks: 8,
      require_reclaim: true,
      reclaim_within_bars: 3,
      stop_ticks: 24,
      target_ticks: 60,
    },
    paramSchema: {
      lookback_bars:       { type: 'int',  min: 5,  max: 200, label: 'Swing lookback (bars)' },
      min_sweep_ticks:     { type: 'int',  min: 1,  max: 80,  label: 'Min sweep depth (ticks)' },
      require_reclaim:     { type: 'bool', label: 'Require level reclaim' },
      reclaim_within_bars: { type: 'int',  min: 1,  max: 20,  label: 'Reclaim within (bars)' },
      stop_ticks:          { type: 'int',  min: 4,  max: 400, label: 'Stop (ticks)' },
      target_ticks:        { type: 'int',  min: 4,  max: 800, label: 'Target (ticks)' },
    },
  },
  {
    key: 'momentum_scalp',
    name: 'Momentum Scalp',
    category: 'sniper',
    apex: 'caution',
    apexNote:
      'Very short holds with small targets attract scrutiny under the 5:1 stop-to-target rule. Keep the stop tight enough that the ratio holds.',
    summary:
      'Enters in the direction of a sharp impulse once a shallow pullback holds, exiting after a fixed number of ticks. Holds measured in seconds.',
    rationale:
      'Momentum has short-horizon autocorrelation in index futures: a large displacement candle on volume is more often followed by continuation than immediate reversal.',
    edgeNotes:
      'Commission-sensitive. At $1.55 per contract round-turn, a 4-tick target on MNQ nets very little. Size and instrument choice matter more here than signal quality.',
    session: 'day',
    defaultParams: {
      impulse_ticks: 20,
      pullback_max_pct: 38,
      stop_ticks: 12,
      target_ticks: 20,
      max_hold_seconds: 120,
    },
    paramSchema: {
      impulse_ticks:    { type: 'int', min: 4,  max: 200, label: 'Impulse size (ticks)' },
      pullback_max_pct: { type: 'int', min: 10, max: 80,  label: 'Max pullback (% of impulse)' },
      stop_ticks:       { type: 'int', min: 2,  max: 200, label: 'Stop (ticks)' },
      target_ticks:     { type: 'int', min: 2,  max: 400, label: 'Target (ticks)' },
      max_hold_seconds: { type: 'int', min: 5,  max: 1800, label: 'Max hold (seconds)' },
    },
  },

  // ─── Intraday ────────────────────────────────────────────────────────────
  {
    key: 'vwap_trend_pullback',
    name: 'VWAP Trend Pullback',
    category: 'intraday',
    apex: 'clear',
    summary:
      'On a trending session, waits for price to pull back to VWAP and hold, then enters with the trend. The trend-following mirror of VWAP reversion.',
    rationale:
      'On directional days institutions accumulate below VWAP and distribute above it, so the first touch back to VWAP is where their bid or offer sits.',
    edgeNotes:
      'Needs a trend filter or it fires all day in chop. The first and second touches are the tradable ones; by the fourth, VWAP is no longer defending.',
    session: 'day',
    defaultParams: {
      trend_filter_ema: 50,
      max_touches: 2,
      hold_confirmation_bars: 1,
      stop_ticks: 40,
      target_ticks: 80,
    },
    paramSchema: {
      trend_filter_ema:       { type: 'int', min: 5,  max: 400, label: 'Trend filter EMA' },
      max_touches:            { type: 'int', min: 1,  max: 10,  label: 'Max VWAP touches traded' },
      hold_confirmation_bars: { type: 'int', min: 0,  max: 10,  label: 'Confirmation bars' },
      stop_ticks:             { type: 'int', min: 4,  max: 400, label: 'Stop (ticks)' },
      target_ticks:           { type: 'int', min: 4,  max: 800, label: 'Target (ticks)' },
    },
  },
  {
    key: 'range_fade',
    name: 'Range Fade',
    category: 'intraday',
    apex: 'clear',
    summary:
      'Identifies a developing balance area and sells the top edge / buys the bottom edge while the range holds.',
    rationale:
      'Roughly 70% of index futures sessions are range-bound. Fading the extremes of an established balance is the base-rate trade.',
    edgeNotes:
      'The whole game is detecting when balance breaks. A range fade that keeps re-entering as the range breaks is how accounts die. The consecutive-loss halt matters here.',
    session: 'day',
    defaultParams: {
      min_touches_to_confirm: 2,
      range_lookback_min: 60,
      edge_buffer_ticks: 4,
      stop_ticks: 32,
      halt_after_consecutive_losses: 2,
    },
    paramSchema: {
      min_touches_to_confirm:        { type: 'int', min: 1, max: 10,  label: 'Touches to confirm range' },
      range_lookback_min:            { type: 'int', min: 15, max: 480, label: 'Range lookback (minutes)' },
      edge_buffer_ticks:             { type: 'int', min: 0, max: 40,  label: 'Edge buffer (ticks)' },
      stop_ticks:                    { type: 'int', min: 4, max: 400, label: 'Stop (ticks)' },
      halt_after_consecutive_losses: { type: 'int', min: 1, max: 10,  label: 'Halt after N consecutive losses' },
    },
  },
  {
    key: 'ema_trend',
    name: 'EMA Trend Follow',
    category: 'intraday',
    apex: 'clear',
    summary:
      'Classic dual-EMA crossover with a slope filter, entering on pullbacks in the direction of the cross.',
    rationale:
      'Simple, transparent, and the behaviour is easy to reason about — which matters when a rule requires you to supervise the system.',
    edgeNotes:
      'Low win rate, positive expectancy from a handful of large winners. Psychologically the hardest to run, because most trades lose small.',
    session: 'both',
    defaultParams: {
      fast_ema: 9,
      slow_ema: 21,
      slope_filter: true,
      stop_ticks: 48,
      target_ticks: 144,
      trail_after_ticks: 60,
    },
    paramSchema: {
      fast_ema:          { type: 'int',  min: 2,  max: 100, label: 'Fast EMA' },
      slow_ema:          { type: 'int',  min: 3,  max: 400, label: 'Slow EMA' },
      slope_filter:      { type: 'bool', label: 'Require slope confirmation' },
      stop_ticks:        { type: 'int',  min: 4,  max: 400, label: 'Stop (ticks)' },
      target_ticks:      { type: 'int',  min: 4,  max: 1200, label: 'Target (ticks)' },
      trail_after_ticks: { type: 'int',  min: 0,  max: 400, label: 'Start trailing after (ticks)' },
    },
  },
  {
    key: 'bollinger_reversion',
    name: 'Bollinger Band Reversion',
    category: 'intraday',
    apex: 'clear',
    summary:
      'Fades tags of the outer band back toward the midline when volatility is contracting.',
    rationale:
      'A band tag is a standardised measure of extension. Pairing it with contracting volatility avoids fading genuine expansion.',
    edgeNotes:
      'Band tags during a squeeze-expansion are continuation signals, not reversals. The volatility filter inverts the meaning of the same signal.',
    session: 'day',
    defaultParams: {
      period: 20,
      std_dev: 2.0,
      require_contracting_vol: true,
      stop_ticks: 36,
      target_mode: 'midline',
    },
    paramSchema: {
      period:                  { type: 'int',  min: 5,  max: 200, label: 'Period' },
      std_dev:                 { type: 'num',  min: 1,  max: 4, step: 0.1, label: 'Std deviations' },
      require_contracting_vol: { type: 'bool', label: 'Require contracting volatility' },
      stop_ticks:              { type: 'int',  min: 4,  max: 400, label: 'Stop (ticks)' },
      target_mode:             { type: 'enum', options: ['midline', 'opposite_band', 'fixed'], label: 'Target' },
    },
  },

  // ─── Swing ───────────────────────────────────────────────────────────────
  {
    key: 'swing_trend',
    name: 'Multi-Day Swing Trend',
    category: 'swing',
    apex: 'caution',
    apexNote:
      'Holding overnight exposes the position to gaps that can breach a trailing drawdown while you sleep. Apex drawdown does not pause outside RTH.',
    summary:
      'Holds positions across sessions in the direction of the higher-timeframe trend, using daily structure for stops.',
    rationale:
      'Wider stops and larger targets reduce the commission drag and the noise sensitivity that make scalping so unforgiving on a small drawdown.',
    edgeNotes:
      'Structurally at odds with a $1,500 trailing drawdown. A daily-structure stop on NQ is routinely 100+ points; at even one full-size contract that is $2,000 — more than the entire account. Micros are effectively mandatory here.',
    session: 'overnight',
    defaultParams: {
      htf_period: 'daily',
      trend_ema: 20,
      stop_mode: 'structure',
      stop_atr_mult: 1.5,
      target_r_multiple: 3.0,
      max_hold_days: 5,
    },
    paramSchema: {
      htf_period:        { type: 'enum', options: ['4h', 'daily', 'weekly'], label: 'Higher timeframe' },
      trend_ema:         { type: 'int',  min: 5,  max: 200, label: 'Trend EMA' },
      stop_mode:         { type: 'enum', options: ['structure', 'atr', 'fixed'], label: 'Stop mode' },
      stop_atr_mult:     { type: 'num',  min: 0.5, max: 5, step: 0.1, label: 'ATR multiple' },
      target_r_multiple: { type: 'num',  min: 1,  max: 10, step: 0.5, label: 'Target (R multiple)' },
      max_hold_days:     { type: 'int',  min: 1,  max: 30, label: 'Max hold (days)' },
    },
  },
  {
    key: 'overnight_gap',
    name: 'Overnight Gap Fade',
    category: 'swing',
    apex: 'caution',
    apexNote:
      'Positions held into the cash open sit through the single most volatile window of the day.',
    summary:
      'Takes a position in the Globex session anticipating that a gap away from the prior settlement partially fills after the cash open.',
    rationale:
      'Gaps into thin overnight liquidity are frequently retraced once RTH participants arrive and price back toward prior value.',
    edgeNotes:
      'Overnight liquidity is thin, so slippage on the stop is materially worse than in RTH. Size for a stop that fills badly.',
    session: 'overnight',
    defaultParams: {
      min_gap_points: 30,
      fill_target_pct: 50,
      stop_points: 40,
      abandon_after_minutes: 90,
    },
    paramSchema: {
      min_gap_points:        { type: 'num', min: 5,  max: 300, label: 'Min gap (points)' },
      fill_target_pct:       { type: 'int', min: 10, max: 100, label: 'Target (% of gap filled)' },
      stop_points:           { type: 'num', min: 5,  max: 300, label: 'Stop (points)' },
      abandon_after_minutes: { type: 'int', min: 5,  max: 480, label: 'Abandon after (minutes)' },
    },
  },

  // ─── Restricted ──────────────────────────────────────────────────────────
  {
    key: 'news_straddle',
    name: 'News Event Straddle',
    category: 'sniper',
    apex: 'conflict',
    apexNote:
      'Apex restricts trading around major economic events, and news-straddle bots are named among prohibited automation. Ships permanently disabled and is retained only so the economic calendar can BLOCK other strategies during these windows.',
    disabled: true,
    summary:
      'Places bracketing orders either side of price ahead of a scheduled release to capture the impulse.',
    rationale: 'Documented for completeness. Not available for use.',
    edgeNotes:
      'The economic calendar integration that would drive this is instead wired to suppress signal generation from every other strategy during flagged windows.',
    session: 'day',
    defaultParams: {},
    paramSchema: {},
  },
];

export const byKey = Object.fromEntries(STRATEGIES.map((s) => [s.key, s]));

export function listByCategory() {
  return Object.entries(CATEGORIES).map(([key, meta]) => ({
    key,
    ...meta,
    strategies: STRATEGIES.filter((s) => s.category === key),
  }));
}

export default STRATEGIES;
