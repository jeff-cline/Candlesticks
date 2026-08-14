# Candlesticks.ai

Machine learning, predictive data, and algorithmic trading applied to prop-firm
futures accounts.

Public landing page + authenticated backend for managing a book of Apex Trader
Funding accounts routed through Tradovate.

---

## Status

**v0.1 — in development.** Nothing touches a live account. `TRADING_ENABLED`
defaults to `false` and no Tradovate credentials ship in the repo.

---

## Compliance posture — read this first

The execution design is constrained by Apex Trader Funding's rules for
Performance Accounts (PA). These constraints are architectural, not cosmetic:

| Rule | How the system honors it |
|---|---|
| Fully automated trading is prohibited on PA/Live accounts; bots are permitted only on evaluations | **Semi-automatic execution.** The engine computes the signal, sizes it, and pre-stages a bracket order. A human clicks to fire. Nothing enters the market unattended. |
| Since March 2026, Tradovate/Rithmic reject orders without attached SL/TP | Every staged order carries a stop-loss and take-profit before it can be submitted. Orders lacking either are rejected client-side. |
| Stop loss must not exceed 5× the profit target | The risk engine computes the ratio at stage time and flags violations. |
| DCA / averaging down on losing positions is prohibited on PA accounts | The martingale/load-balance module is built **unrestricted at the operator's explicit direction**, and surfaces a persistent warning in the UI. See "Martingale" below. |
| HFT, latency arbitrage, copy-trading another trader's account | Not implemented. Out of scope by design. |
| Trading around major economic events is restricted | Economic-calendar integration gates signal generation during flagged windows. |

**These rules were sourced from third-party summaries** — Apex's own help center
returns HTTP 403 to automated fetching. Before enabling live execution, verify
them directly with Apex. Sources are listed in `docs/compliance.md`.

### Martingale

The operator reviewed the rule conflict and the arithmetic and directed that
martingale / load-balance-to-max-drawdown be implemented **without hard caps**.
It is therefore built as specified. Mitigating context: because execution is
semi-automatic, an aggressive size is *proposed* but never *fires itself* — a
human confirms every entry.

The UI displays a non-dismissable warning wherever martingale sizing is active.

---

## Architecture

```
candlesticks/
├── server/
│   ├── index.js              Express app + route mounting
│   ├── db.js                 node:sqlite schema, migrations, helpers
│   ├── seed.js               God account + account book seeding
│   ├── routes/               HTTP layer, one file per surface
│   └── services/
│       ├── risk.js           Apex compliance engine — the gate everything passes
│       ├── sizing.js         Position sizing incl. martingale / load balance
│       ├── tradovate.js      Tradovate REST/WS client
│       ├── mailer.js         SMTP with console fallback
│       └── strategies/       Strategy definitions, one module each
├── public/                   Landing page, dashboard, assets
├── deploy/                   nginx, systemd, deploy script for the Vultr box
└── docs/                     Compliance notes, strategy research, runbook
```

**Stack:** Node 22+ (uses built-in `node:sqlite` — no native build deps),
Express, bcryptjs, express-session, nodemailer. Vanilla JS frontend, no build step.

---

## Infrastructure

| | |
|---|---|
| Domain | `candlesticks.ai` — GoDaddy, NS delegated to Vultr |
| Server | `137.220.56.129` — Vultr, Elk Grove Village, Illinois |
| Latency | ~25 miles from the CME matching engine in Aurora, IL |
| Repo | `git@github.com:jeff-cline/Candlesticks.git` |

DNS: an A record for `candlesticks.ai` → `137.220.56.129` must exist in the
Vultr DNS zone. As of 14 Aug 2026 the nameservers were delegated but **no zone
existed**, so the domain did not resolve. See `docs/runbook.md`.

---

## Setup

```bash
npm install
cp .env.example .env          # then edit
openssl rand -hex 32          # paste into SESSION_SECRET
npm run seed                  # creates the god account
npm start
```

Open http://localhost:3000

### First login

Email `jeff.cline@me.com`, temp password from `GOD_TEMP_PASSWORD`. The app
forces a password change before it will let you reach the dashboard.

---

## License

Private. All rights reserved.
