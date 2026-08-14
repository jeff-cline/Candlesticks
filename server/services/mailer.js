// Candlesticks.ai — outbound mail
// Falls back to console + DB persistence when SMTP is unconfigured, so lead
// forms work in development without silently dropping submissions.

import nodemailer from 'nodemailer';

let transport = null;
let mode = 'console';

if (process.env.SMTP_HOST && process.env.SMTP_USER) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE) === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  mode = 'smtp';
}

export function mailerStatus() {
  return {
    mode,
    configured: mode === 'smtp',
    host: process.env.SMTP_HOST || null,
    notifyTo: process.env.LEAD_NOTIFY_TO || 'jeff.cline@me.com',
  };
}

export async function sendMail({ to, subject, text, html }) {
  const from = process.env.MAIL_FROM || 'Candlesticks.ai <noreply@candlesticks.ai>';
  if (!transport) {
    console.log('\n─── EMAIL (SMTP not configured — logged only) ───');
    console.log(`To:      ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(text || html);
    console.log('────────────────────────────────────────────────\n');
    return { delivered: false, mode: 'console' };
  }
  await transport.sendMail({ from, to, subject, text, html });
  return { delivered: true, mode: 'smtp' };
}

const FORM_LABELS = {
  join: 'Join request',
  investor: 'Investor Relations enquiry',
  press: 'Press & Media enquiry',
  advertise: 'Advertising enquiry',
  sponsor: 'Sponsorship enquiry',
  algos: 'Custom Algo build request',
};

export async function notifyLead(lead) {
  const to = process.env.LEAD_NOTIFY_TO || 'jeff.cline@me.com';
  const label = FORM_LABELS[lead.form] || lead.form;
  const rows = [
    ['Form', label],
    ['Name', lead.name],
    ['Company', lead.company],
    ['Email', lead.email],
    ['Phone', lead.phone],
    ['Message', lead.message],
    ['IP', lead.ip],
    ['Received', new Date().toISOString()],
  ].filter(([, v]) => v);

  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
  const html = `
    <h2 style="font-family:system-ui,sans-serif;margin:0 0 12px">${label}</h2>
    <table style="font-family:system-ui,sans-serif;border-collapse:collapse;font-size:14px">
      ${rows.map(([k, v]) =>
        `<tr><td style="padding:6px 14px 6px 0;color:#666;vertical-align:top">${k}</td>
             <td style="padding:6px 0"><strong>${escapeHtml(String(v))}</strong></td></tr>`
      ).join('')}
    </table>`;

  return sendMail({ to, subject: `[Candlesticks.ai] ${label} — ${lead.name || lead.email || 'unknown'}`, text, html });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export default { sendMail, notifyLead, mailerStatus };
