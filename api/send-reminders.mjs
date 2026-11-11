// Daily job (Vercel Cron, 05:00 UTC = 09:00 Dubai):
//  1. mark finished plans as expired
//  2. email customers 7 days and 1 day before their plan ends (each reminder is sent once)
//  3. remind customers who chose a plan 2+ days ago but have not paid
//  4. email the admin a digest of plan requests from the last 24 hours
// Safe to run more than once a day: reminders are flagged in the database after sending, and each
// email carries an idempotency key so a retry after a crash does not send a duplicate.

import { payReminderEmail } from './_payments.mjs';

const env = (k, fallback) => process.env[k] ?? fallback;
const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const RESEND_KEY = env('RESEND_API_KEY');
const FROM = env('EMAIL_FROM', 'Laveesho <hello@laveesho.com>');
const ADMIN_EMAIL = env('ADMIN_EMAIL', 'business@laveesho.com');
const SITE = env('SITE_URL', 'https://laveesho.com');
const DRY_RUN = env('DRY_RUN') === '1';

async function call(url, init, label) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`${label} failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}

const rpc = (fn, body = {}) => call(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
  method: 'POST',
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}, `rpc ${fn}`);

async function sendEmail({ to, subject, html, text, key }) {
  if (DRY_RUN || !RESEND_KEY) return { dryRun: true };
  return call('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text, reply_to: ADMIN_EMAIL }),
  }, 'send email');
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function reminderEmail(r) {
  if (/sprint/i.test(r.plan_name || '')) return sprintEndingEmail(r);
  const first = (r.full_name || '').trim().split(/\s+/)[0] || 'there';
  const when = r.days_left <= 0 ? 'today' : r.days_left === 1 ? 'tomorrow' : `in ${r.days_left} days`;
  const subject = r.kind === '1d'
    ? `Your ${r.plan_name} plan ends ${when}`
    : `${r.days_left} days left on your ${r.plan_name} plan`;
  const renew = `https://wa.me/971503940721?text=${encodeURIComponent(`Hi Laveesho, I'd like to renew my ${r.plan_name} plan.`)}`;
  const text = [
    `Hi ${first},`,
    '',
    `Your ${r.plan_name} plan ends ${when}, on ${fmt(r.ends_on)}.`,
    'Renew now to keep your content and campaigns running without a break.',
    '',
    `Renew on WhatsApp: ${renew}`,
    `See your plan: ${SITE}/account`,
    '',
    'Laveesho · The Citadel Tower, Business Bay, Dubai · +971 50 394 0721',
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#F4F8FD;font-family:Arial,Helvetica,sans-serif;color:#0A0B22">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden">
<tr><td style="background:linear-gradient(120deg,#4A1FD1,#BF0D65);background-color:#4A1FD1;padding:28px 32px;color:#F5EEDC;font-size:13px;letter-spacing:2px;font-weight:bold">LAVEESHO</td></tr>
<tr><td style="padding:32px">
<p style="margin:0 0 16px;font-size:16px">Hi ${esc(first)},</p>
<p style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:bold">Your ${esc(r.plan_name)} plan ends ${esc(when)}, on ${esc(fmt(r.ends_on))}.</p>
<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#454A6E">Renew now to keep your content and campaigns running without a break.</p>
<a href="${esc(renew)}" style="display:inline-block;background:#0A0B22;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 26px;border-radius:999px">Renew on WhatsApp</a>
<p style="margin:24px 0 0;font-size:14px"><a href="${esc(SITE)}/account" style="color:#4A1FD1">See your plan</a></p>
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #E6E9F5;font-size:12px;color:#6B7094">Laveesho · The Citadel Tower, Business Bay, Dubai · +971 50 394 0721</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

function sprintEndingEmail(r) {
  const first = (r.full_name || '').trim().split(/\s+/)[0] || 'there';
  const when = r.days_left <= 0 ? 'today' : 'tomorrow';
  const subject = `Your free Growth Sprint ends ${when}`;
  const plans = `${SITE}/pricing`;
  const text = [`Hi ${first},`, '', `Your free 7-Day Growth Sprint ends ${when}.`, 'We hope you enjoyed working with us. Choose a plan to keep the momentum going.', '', `See plans: ${plans}`, '', 'Laveesho · The Citadel Tower, Business Bay, Dubai · +971 50 394 0721'].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#F4F8FD;font-family:Arial,Helvetica,sans-serif;color:#0A0B22">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden">
<tr><td style="background:linear-gradient(120deg,#4A1FD1,#BF0D65);background-color:#4A1FD1;padding:28px 32px;color:#F5EEDC;font-size:13px;letter-spacing:2px;font-weight:bold">LAVEESHO</td></tr>
<tr><td style="padding:32px">
<p style="margin:0 0 16px;font-size:16px">Hi ${esc(first)},</p>
<p style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:bold">Your free 7-Day Growth Sprint ends ${esc(when)}.</p>
<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#454A6E">We hope you enjoyed working with us. Choose a plan to keep the momentum going.</p>
<a href="${esc(plans)}" style="display:inline-block;background:#0A0B22;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 26px;border-radius:999px">Choose a plan</a>
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #E6E9F5;font-size:12px;color:#6B7094">Laveesho · The Citadel Tower, Business Bay, Dubai · +971 50 394 0721</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

export function digestEmail(rows) {
  const lines = rows.map((r) => `• ${r.full_name || '(no name)'} <${r.email}> requested ${r.plan_name}`);
  const text = [`${rows.length} new plan request${rows.length === 1 ? '' : 's'} in the last 24 hours:`, '', ...lines, '', `Confirm them at ${SITE}/admin`].join('\n');
  const html = `<p>${rows.length} new plan request${rows.length === 1 ? '' : 's'} in the last 24 hours:</p><ul>${rows.map((r) => `<li><strong>${esc(r.full_name || '(no name)')}</strong> &lt;${esc(r.email)}&gt; requested ${esc(r.plan_name)}</li>`).join('')}</ul><p><a href="${esc(SITE)}/admin">Confirm them on the admin page</a></p>`;
  return { subject: `${rows.length} new plan request${rows.length === 1 ? '' : 's'}`, text, html };
}

export async function run() {
  const summary = { expired: 0, reminders: [], failed: [], digest: 0, dryRun: DRY_RUN || !RESEND_KEY };
  summary.expired = await rpc('expire_finished_subscriptions');

  const due = (await rpc('due_reminders')) || [];
  for (const r of due) {
    try {
      const mail = reminderEmail(r);
      await sendEmail({ to: r.email, ...mail, key: `reminder-${r.subscription_id}-${r.kind}-${r.ends_on}` });
      if (!summary.dryRun) await rpc('mark_reminder_sent', { p_subscription: r.subscription_id, p_kind: r.kind });
      summary.reminders.push({ id: r.subscription_id, kind: r.kind });
    } catch (err) {
      summary.failed.push({ id: r.subscription_id, kind: r.kind, error: String(err.message).slice(0, 160) });
    }
  }

  summary.payReminders = 0;
  const unpaid = (await rpc('due_payment_reminders')) || [];
  for (const r of unpaid) {
    try {
      await sendEmail({ to: r.email, ...payReminderEmail(r, SITE), key: `pay-reminder-${r.subscription_id}` });
      if (!summary.dryRun) await rpc('mark_payment_reminder_sent', { p_subscription: r.subscription_id });
      summary.payReminders++;
    } catch (err) {
      summary.failed.push({ id: r.subscription_id, kind: 'payment', error: String(err.message).slice(0, 160) });
    }
  }

  const recent = (await rpc('recent_requests')) || [];
  if (recent.length) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
    try {
      await sendEmail({ to: ADMIN_EMAIL, ...digestEmail(recent), key: `digest-${today}` });
      summary.digest = recent.length;
    } catch (err) {
      summary.failed.push({ digest: true, error: String(err.message).slice(0, 160) });
    }
  }
  return summary;
}

export default async function handler(req, res) {
  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>". Reject anything else.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    res.status(500).json({ error: 'server not configured' });
    return;
  }
  try {
    const summary = await run();
    console.log(JSON.stringify({ job: 'send-reminders', ...summary, reminders: summary.reminders.length }));
    res.status(summary.failed.length ? 207 : 200).json(summary);
  } catch (err) {
    console.error(JSON.stringify({ job: 'send-reminders', error: String(err.message).slice(0, 300) }));
    res.status(500).json({ error: 'job failed' });
  }
}
