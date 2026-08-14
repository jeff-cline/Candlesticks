# Runbook

## 1. DNS — required before anything is reachable

As of 14 Aug 2026 `candlesticks.ai` was delegated to Vultr nameservers
(`ns1.vultr.com`, `ns2.vultr.com`) but **no DNS zone existed**, so the
nameservers answered `REFUSED` and the domain did not resolve at all.

In the Vultr control panel → **Products → Network → DNS → Add Domain**:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `@` | `137.220.56.129` | 300 |
| A | `www` | `137.220.56.129` | 300 |

Verify:

```bash
dig +short candlesticks.ai            # expect 137.220.56.129
dig @ns1.vultr.com candlesticks.ai    # expect an answer, not REFUSED
```

Propagation is usually minutes. TLS cannot be issued until this resolves.

---

## 2. Provision the server

```bash
ssh root@137.220.56.129
curl -fsSL https://raw.githubusercontent.com/jeff-cline/Candlesticks/main/deploy/setup.sh | bash
```

Installs Node 22, clones the repo to `/opt/candlesticks`, seeds the database,
installs the systemd unit and nginx config, opens the firewall, and requests a
Let's Encrypt certificate once DNS resolves.

If DNS wasn't ready when you ran it, issue TLS afterwards:

```bash
certbot --nginx -d candlesticks.ai -d www.candlesticks.ai
```

---

## 3. Configure

Edit `/opt/candlesticks/.env`:

```bash
# Email — until this is set, lead forms persist to the DB but nothing is sent
SMTP_HOST=smtp.postmarkapp.com
SMTP_USER=...
SMTP_PASS=...
LEAD_NOTIFY_TO=jeff.cline@me.com

# Tradovate — leave TRADING_ENABLED=false until the Apex rules are confirmed
TRADOVATE_USERNAME=...
TRADOVATE_PASSWORD=...
TRADOVATE_CID=...
TRADOVATE_SEC=...
TRADING_ENABLED=false
```

Then `systemctl restart candlesticks`.

---

## 4. First login

Go to `https://candlesticks.ai/login`.

- Email: `jeff.cline@me.com`
- Password: the value of `GOD_TEMP_PASSWORD`

The app forces a password change before the dashboard is reachable. If you ever
need to reset it:

```bash
cd /opt/candlesticks && npm run reset-god
```

---

## 5. Operations

```bash
systemctl status candlesticks          # health
journalctl -u candlesticks -f          # live logs
bash /opt/candlesticks/deploy/update.sh # pull main and restart
```

**Backups** — the database is a single file at `/opt/candlesticks/data/candlesticks.db`.

```bash
sqlite3 /opt/candlesticks/data/candlesticks.db ".backup '/root/csai-$(date +%F).db'"
```

Worth a cron entry once real trade history accumulates.

---

## Local development

```bash
npm install
cp .env.example .env
openssl rand -hex 32          # paste into SESSION_SECRET
npm run seed
npm run dev                   # http://localhost:3000
```

---

## Known gaps

- **Tradovate sync is not wired to a schedule.** `services/tradovate.js` has the
  client; nothing calls `syncAccounts()` periodically yet. Account data is
  currently whatever `seed.js` loaded.
- **Strategies are declarative only.** The library defines parameters, rationale
  and rule standing; no signal-generation engine evaluates them against live
  data yet.
- **Backtesting is not built.** Needs a market data integration first
  (Databento is the recommended one).
- **The pre-close flatten is a gate, not an action.** `risk.js` blocks new
  entries inside the flatten window; nothing yet liquidates open positions
  automatically — that would be unsupervised automation.
- **Consistency-rule tracking** is not implemented. See `compliance.md`.
