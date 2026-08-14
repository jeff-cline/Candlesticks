// Candlesticks.ai — integrations catalog
//
// Declarative catalog of every external system the platform can connect to.
// The Integrations tab renders directly from this. `status` is resolved at
// request time from env vars + the `integrations` table.

export const CURRENT_HOST = {
  ip: '137.220.56.129',
  provider: 'Vultr (The Constant Company)',
  location: 'Elk Grove Village, Illinois',
  milesToCme: 25,
  note:
    'CME Group\'s matching engine is in Aurora, Illinois. Elk Grove Village is ~25 miles away — ' +
    'roughly 0.3–0.5 ms of fiber each way. For semi-automatic execution where a human clicks the ' +
    'entry, this is already well beyond what the strategy needs; human reaction time is ~200 ms, ' +
    'about 400x the network latency. Latency only becomes the binding constraint for HFT, which ' +
    'Apex prohibits outright.',
};

export const CATEGORIES = [
  {
    key: 'execution',
    label: 'Execution & Brokerage',
    blurb: 'Where orders are routed. Required for anything beyond paper trading.',
    items: [
      {
        key: 'tradovate',
        name: 'Tradovate API',
        vendor: 'Tradovate / NinjaTrader Group',
        priority: 'required',
        docs: 'https://api.tradovate.com/',
        summary:
          'REST + WebSocket API for account state, positions, orders and market data. The route your Apex accounts already run on.',
        why: 'Reads all 18 accounts\' balances and drawdown continuously, and submits bracket orders when you fire a staged batch.',
        envKeys: ['TRADOVATE_USERNAME', 'TRADOVATE_PASSWORD', 'TRADOVATE_CID', 'TRADOVATE_SEC'],
        caveat:
          'Apex prohibits fully automated entry+exit on PA accounts. This integration is used for reading state and for submitting orders you have confirmed — not for unattended trading.',
        cost: 'Included with the Tradovate platform fee',
      },
      {
        key: 'rithmic',
        name: 'Rithmic R|API+',
        vendor: 'Rithmic',
        priority: 'alternative',
        docs: 'https://www.rithmic.com/apis',
        summary: 'Lower-latency alternative execution route also supported by Apex.',
        why: 'Fallback if Tradovate has an outage or if you want a second route. Apex supports both.',
        envKeys: ['RITHMIC_USER', 'RITHMIC_PASSWORD', 'RITHMIC_SYSTEM'],
        cost: 'Platform-dependent',
      },
    ],
  },
  {
    key: 'hosting',
    label: 'Hosting & Colocation',
    blurb: 'Where the system runs, and how far that is from the exchange.',
    items: [
      {
        key: 'vultr_chicago',
        name: 'Vultr Chicago (current)',
        vendor: 'Vultr',
        priority: 'active',
        summary: `${CURRENT_HOST.ip} — ${CURRENT_HOST.location}, ~${CURRENT_HOST.milesToCme} miles from CME Aurora.`,
        why: CURRENT_HOST.note,
        cost: 'From ~$6/mo',
        status_hint: 'active',
      },
      {
        key: 'cme_colo',
        name: 'CME Aurora Colocation',
        vendor: 'CME Group / Cyxtera',
        priority: 'upgrade_path',
        docs: 'https://www.cmegroup.com/colocation.html',
        summary: 'Cabinet space inside the CME data center in Aurora, IL. Single-digit microsecond latency.',
        why:
          'The move to make ONLY if latency is ever demonstrated to be the binding constraint. For semi-automatic ' +
          'discretionary entry it will never be — but the option is documented so the decision is informed rather than assumed.',
        caveat: 'Costs thousands per month. Almost certainly unnecessary for this use case.',
        cost: '$1,000s/mo',
      },
      {
        key: 'trading_vps',
        name: 'Purpose-built trading VPS',
        vendor: 'QuantVPS / Speedy Trading Servers',
        priority: 'alternative',
        summary: 'Chicago-area VPS tuned for futures platforms, typically 1–3 ms to CME.',
        why: 'Middle option if you outgrow the Vultr box and want a managed environment without colocation cost.',
        cost: '$50–200/mo',
      },
    ],
  },
  {
    key: 'marketdata',
    label: 'Market Data',
    blurb: 'Price history for backtesting and live data for signal generation.',
    items: [
      {
        key: 'databento',
        name: 'Databento',
        vendor: 'Databento',
        priority: 'recommended',
        docs: 'https://databento.com/docs',
        summary: 'CME MBO/MBP historical and live data, tick-level, pay-as-you-go.',
        why:
          'The strategy library needs real tick history to backtest. Databento sells CME data without an ' +
          'annual license minimum, which is the usual blocker for individuals.',
        envKeys: ['DATABENTO_API_KEY'],
        cost: 'Usage-based, ~$0.10–2 per GB',
      },
      {
        key: 'polygon',
        name: 'Polygon.io',
        vendor: 'Polygon',
        priority: 'optional',
        docs: 'https://polygon.io/docs',
        summary: 'Broad market data incl. equities and indices.',
        why: 'Useful for cross-asset context — NQ moves with breadth and rates, neither of which Tradovate gives you.',
        envKeys: ['POLYGON_API_KEY'],
        cost: 'From $29/mo',
      },
      {
        key: 'cme_datamine',
        name: 'CME DataMine',
        vendor: 'CME Group',
        priority: 'optional',
        summary: 'Official CME historical data, including full order book.',
        why: 'Authoritative source if a backtest result ever needs to be defended.',
        cost: 'Per-dataset',
      },
    ],
  },
  {
    key: 'news',
    label: 'News & Event Feeds',
    blurb:
      'Apex restricts trading around major economic events. These feeds are what let the system BLOCK ' +
      'signals during those windows rather than trade into them.',
    items: [
      {
        key: 'tradingeconomics',
        name: 'Trading Economics Calendar',
        vendor: 'Trading Economics',
        priority: 'required',
        docs: 'https://docs.tradingeconomics.com/',
        summary: 'Structured economic calendar with importance ratings and release timestamps.',
        why:
          'Drives the event-blackout gate. When a high-importance release is inside the blackout window, ' +
          'signal generation is suppressed across every enabled strategy.',
        envKeys: ['TRADINGECONOMICS_API_KEY'],
        cost: 'Free tier available',
      },
      {
        key: 'benzinga',
        name: 'Benzinga Pro News',
        vendor: 'Benzinga',
        priority: 'recommended',
        docs: 'https://docs.benzinga.io/',
        summary: 'Low-latency headline feed with structured tickers and sentiment.',
        why: 'Headline risk detection — flags when an unscheduled event is moving the tape.',
        envKeys: ['BENZINGA_API_KEY'],
        cost: 'From $99/mo',
      },
      {
        key: 'finnhub',
        name: 'Finnhub',
        vendor: 'Finnhub',
        priority: 'optional',
        docs: 'https://finnhub.io/docs/api',
        summary: 'News, sentiment and alternative data with a usable free tier.',
        why: 'Cheaper starting point than Benzinga for headline coverage.',
        envKeys: ['FINNHUB_API_KEY'],
        cost: 'Free tier available',
      },
    ],
  },
  {
    key: 'alerting',
    label: 'Alerting',
    blurb: 'Getting told when something needs your attention — the supervision Apex requires.',
    items: [
      {
        key: 'twilio',
        name: 'Twilio SMS',
        vendor: 'Twilio',
        priority: 'recommended',
        summary: 'SMS alerts for drawdown proximity, breach warnings, and flatten-window reminders.',
        why:
          'The single highest-value alert in this system is "account X is within $Y of its threshold." ' +
          'Account …0026 breached today with no warning.',
        envKeys: ['TWILIO_SID', 'TWILIO_TOKEN', 'TWILIO_FROM', 'ALERT_PHONE'],
        cost: '~$0.008/SMS',
      },
      {
        key: 'pushover',
        name: 'Pushover',
        vendor: 'Pushover',
        priority: 'optional',
        summary: 'Push notifications to phone/desktop, one-time $5 licence.',
        why: 'Cheapest reliable push channel; good for non-urgent alerts.',
        envKeys: ['PUSHOVER_TOKEN', 'PUSHOVER_USER'],
        cost: '$5 one-time',
      },
      {
        key: 'discord',
        name: 'Discord / Slack Webhook',
        vendor: 'Discord / Slack',
        priority: 'optional',
        summary: 'Post fills, signals and daily summaries to a channel.',
        why: 'Free audit trail you can scroll on a phone.',
        envKeys: ['WEBHOOK_URL'],
        cost: 'Free',
      },
    ],
  },
  {
    key: 'platform',
    label: 'Platform Services',
    blurb: 'Email delivery and supporting infrastructure for the site itself.',
    items: [
      {
        key: 'smtp',
        name: 'Transactional Email',
        vendor: 'Postmark / SendGrid / Resend',
        priority: 'required',
        summary: 'Delivers the Join and footer-form notifications to your inbox.',
        why: 'Without this, lead forms persist to the database but never reach you.',
        envKeys: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'LEAD_NOTIFY_TO'],
        cost: 'Free tier typically covers this volume',
      },
      {
        key: 'letsencrypt',
        name: 'Let\'s Encrypt TLS',
        vendor: 'ISRG',
        priority: 'required',
        summary: 'Free automated TLS certificates via certbot.',
        why: 'A login page over plain HTTP is not acceptable. Provisioned in deploy/setup.sh.',
        cost: 'Free',
      },
    ],
  },
];

export function allItems() {
  return CATEGORIES.flatMap((c) => c.items.map((i) => ({ ...i, category: c.key, categoryLabel: c.label })));
}

/** Resolve configured/unconfigured from env for each item. */
export function resolveStatus() {
  return CATEGORIES.map((cat) => ({
    ...cat,
    items: cat.items.map((item) => {
      if (item.status_hint === 'active') return { ...item, status: 'active' };
      if (!item.envKeys || item.envKeys.length === 0) return { ...item, status: 'informational' };
      const present = item.envKeys.filter((k) => !!process.env[k]);
      let status = 'not_configured';
      if (present.length === item.envKeys.length) status = 'configured';
      else if (present.length > 0) status = 'partial';
      return { ...item, status, envPresent: present.length, envTotal: item.envKeys.length };
    }),
  }));
}

export default { CATEGORIES, CURRENT_HOST, resolveStatus, allItems };
