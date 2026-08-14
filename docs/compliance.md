# Apex compliance notes

Researched 14 August 2026. **These are third-party summaries.** Apex's own help
center (`apextraderfunding.com`, `support.apextraderfunding.com`) returns HTTP 403
to automated retrieval, so none of this was read from the primary source.

**Verify directly with Apex before enabling live execution.** Seventeen funded
accounts depend on these rules being right.

---

## Rules encoded in the system

| # | Rule | Where enforced |
|---|---|---|
| 1 | Fully automated trading (unsupervised entry *and* exit) is prohibited on PA/Live accounts. Bots are permitted on evaluations. | Architectural — there is no scheduler or polling loop that opens positions. `services/tradovate.js` submits only from a confirmed batch, with `isAutomated: false`. |
| 2 | Since March 2026, Tradovate and Rithmic reject orders without an attached stop-loss and take-profit on Apex accounts. | `risk.js` → `MISSING_STOP` / `MISSING_TARGET` (block). `tradovate.js#submitBracket` refuses too. |
| 3 | Stop loss must not exceed 5× the profit target. | `risk.js` → `STOP_TARGET_RATIO` (block). |
| 4 | DCA / averaging down on losing positions is prohibited on PA accounts. | `sizing.js` — **built uncapped by operator directive.** Surfaces `MARTINGALE_ACTIVE` warning. See below. |
| 5 | HFT, latency arbitrage, news-straddle bots, copy-trading another trader's account → immediate closure. | Not implemented. `news_straddle` strategy ships permanently disabled. |
| 6 | Trading around major economic events is restricted. | Economic-calendar integration gates signal generation. Requires `TRADINGECONOMICS_API_KEY`. |

---

## The martingale decision

Rule 4 above conflicts with a feature the operator requested. The conflict was
surfaced explicitly, alongside the arithmetic and the same-day example of account
`…0026` breaching its drawdown. The operator elected to build it **without hard
caps**.

It is therefore implemented as specified. Two things bound it in practice:

1. **Execution is semi-automatic.** Aggressive sizing is *proposed*; a human
   fires every entry. The module cannot compound losses unattended.
2. **`risk.js` still evaluates the result.** A martingale step that would risk
   more than an account's remaining room is blocked by `RISK_EXCEEDS_ROOM`
   regardless of what the sizing module proposed.

The one place sizing is adjusted rather than obeyed literally is `all_in` mode:
it targets the largest quantity **strictly under** the account's remaining room,
because sizing to exactly 100% guarantees the account closes on a stop-out and
would be blocked. The adjustment is one contract and is reported in `warnings`.

---

## Rules NOT yet encoded

These are known to exist but are not implemented, because the exact current
thresholds could not be confirmed from a primary source:

- **30% consistency rule** — no single day may exceed 30% of an account's total
  profit at payout time. Needs per-account cumulative profit history; the
  `daily_pl` table accumulates this going forward.
- **Minimum trading days** before a payout may be requested.
- **Scaling plan / contract limits** by account size and profit level.
- **Trailing threshold values** per plan size. The system reads live `DIST` from
  Tradovate rather than computing it, which sidesteps the need — but the
  `drawdown_limit` column is seeded from inference for account `…0002`.

---

## Sources

- [Does Apex Trader Funding Allow Automated Trading Bots? — QuantVPS](https://www.quantvps.com/blog/apex-trader-funding-automated-trading-bots)
- [Bot Policies of 6 Prop Firms (2026) — Sentinel](https://sentinel.redclawey.com/blog/automated-trading-allowed-prop-firms-policy-guide-2026)
- [Prop Firms That Allow Automated Trading & Bots (2026) — PickMyTrade](https://pickmytrade.io/faq/prop-firm-automation)
- [Apex Trader Funding Rules 2026 — TradeTanto](https://tradetanto.com/learn/apex-trader-funding-rules-what-you-need-to-know)
- [Apex PA Account Rules — QuantVPS](https://www.quantvps.com/blog/apex-pa-account-rules)
- [Prohibited Activities — Apex Trader Funding](https://apextraderfunding.com/help-center/getting-started/prohibited-activities/) *(403 to automated fetch; read manually)*
- [Consistency Rules for PA and Funded Accounts — Apex](https://apextraderfunding.com/help-center/legacy-helpful-items/what-are-the-consistency-rules-for-legacy-pa-and-funded-accounts/)
- [Apex 4.0 Rules 2026 — TradeCovex](https://tradecovex.com/guides/apex-trader-funding-rules-2026)
