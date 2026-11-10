// POST /api/payment-event  { event: 'submitted' | 'verified' | 'rejected', subscription_id }
// Called by the browser right after a customer uploads a receipt, or an admin marks a payment.
// It sends emails only. It never changes data: it reads the request with the service key and only
// sends the email that matches the request's current state, so it cannot be used to fake a payment.
// Each email has an idempotency key, so pressing twice does not send twice.

import { invoiceHtml, receiptHtml, toPdfs } from './_docs/render.mjs';
import { receivedDetailsEmail, paymentConfirmedEmail, paymentNotFoundEmail, adminAlertEmail } from './_payments.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM || 'Laveesho <hello@laveesho.com>';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'business@laveesho.com';
const SITE = process.env.SITE_URL || 'https://laveesho.com';

async function call(url, init, label) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`${label}: HTTP ${res.status} ${text.slice(0, 160)}`);
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}

const svc = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
const rest = (path) => call(`${SUPABASE_URL}/rest/v1/${path}`, { headers: svc }, 'read');

const rpc = (fn, body) => call(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, `rpc ${fn}`);

async function upload(path, buf) {
  await call(`${SUPABASE_URL}/storage/v1/object/documents/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST', headers: { ...svc, 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: buf,
  }, 'upload');
}

// Number the invoice + receipt, print both PDFs and store them. Returns email attachments ([] if PDF fails).
async function makeDocuments(r, profile) {
  const doc = await rpc('issue_documents', { p_subscription: r.id });
  const d = {
    invoice_no: doc.invoice_no, receipt_no: doc.receipt_no, issued_on: doc.issued_on, paid_on: doc.issued_on,
    ref_no: r.ref_no, plan_name: r.plan_name, months: doc.months, rate: Number(doc.rate_aed),
    subtotal: Number(doc.subtotal_aed), vat: Number(doc.vat_aed), total: Number(doc.total_aed),
    full_name: profile.full_name, company: profile.company, address: profile.address, phone: profile.phone, email: profile.email,
    starts_on: r.starts_on, proof_note: r.proof_note,
  };
  const [inv, rct] = await toPdfs([invoiceHtml(d), receiptHtml(d)]);
  const invPath = `${r.user_id}/${doc.invoice_no}.pdf`;
  const rctPath = `${r.user_id}/${doc.receipt_no}.pdf`;
  await upload(invPath, inv);
  await upload(rctPath, rct);
  await rpc('set_document_files', { p_subscription: r.id, p_invoice: invPath, p_receipt: rctPath, p_emailed: false });
  return { doc, attachments: [
    { filename: `Laveesho-Tax-Invoice-${doc.invoice_no}.pdf`, content: inv.toString('base64') },
    { filename: `Laveesho-Payment-Receipt-${doc.receipt_no}.pdf`, content: rct.toString('base64') },
  ] };
}

async function sendEmail(to, mail, key, attachments) {
  if (!RESEND_KEY) return;
  await call('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ from: FROM, to: Array.isArray(to) ? to : [to], subject: mail.subject, html: mail.html, text: mail.text, reply_to: ADMIN_EMAIL, ...(attachments && attachments.length ? { attachments } : {}) }),
  }, 'send email');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'server not configured' });

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { event, subscription_id: id } = body;
  if (!token || !['submitted', 'verified', 'rejected'].includes(event) || !/^[0-9a-f-]{36}$/.test(id || '')) {
    return res.status(400).json({ error: 'bad request' });
  }

  try {
    // Who is calling? (verifies the login token with Supabase)
    const user = await call(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } }, 'auth').catch(() => null);
    if (!user || !user.id) return res.status(401).json({ error: 'not signed in' });

    const [sub] = await rest(`subscriptions?id=eq.${id}&select=id,user_id,plan_id,status,months,ref_no,pay_status,proof_path,proof_note,proof_submitted_at,reject_reason,starts_on,profiles!subscriptions_user_id_fkey(email,full_name,phone,company,address),plans(name,price_aed)`);
    if (!sub) return res.status(404).json({ error: 'not found' });
    const r = { ...sub, email: sub.profiles.email, full_name: sub.profiles.full_name, phone: sub.profiles.phone, plan_name: sub.plans.name, price_aed: sub.plans.price_aed };

    if (event === 'submitted') {
      if (sub.user_id !== user.id || sub.pay_status !== 'submitted') return res.status(409).json({ error: 'state mismatch' });
      const stamp = sub.proof_submitted_at;
      const admins = (await rest('profiles?is_admin=eq.true&select=email')).map((a) => a.email).filter(Boolean);
      const team = [...new Set([...admins, ADMIN_EMAIL])];
      let receiptUrl = '';
      try {
        const signed = await call(`${SUPABASE_URL}/storage/v1/object/sign/payment-proofs/${sub.proof_path.split('/').map(encodeURIComponent).join('/')}`, {
          method: 'POST', headers: { ...svc, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 7 * 24 * 3600 }),
        }, 'sign');
        if (signed && signed.signedURL) receiptUrl = `${SUPABASE_URL}/storage/v1${signed.signedURL}`;
      } catch { /* the receipt is still on the admin dashboard */ }
      await sendEmail(r.email, receivedDetailsEmail(r, SITE), `pay-submitted-${id}-${stamp}`);
      await sendEmail(team, adminAlertEmail(r, SITE, receiptUrl), `pay-alert-${id}-${stamp}`);
    } else {
      const [me] = await rest(`profiles?id=eq.${user.id}&select=is_admin`);
      if (!me || !me.is_admin) return res.status(403).json({ error: 'admins only' });
      if (event === 'verified') {
        if (sub.pay_status !== 'verified') return res.status(409).json({ error: 'state mismatch' });
        let docs = { attachments: [] };
        try { docs = await makeDocuments(r, sub.profiles); }
        catch (err) { console.error(JSON.stringify({ fn: 'payment-event', step: 'documents', error: String(err.message).slice(0, 300) })); }
        const mail = paymentConfirmedEmail(r, SITE, docs.doc);
        await sendEmail(r.email, mail, `pay-verified-${id}`, docs.attachments);
        if (docs.doc) {
          await rpc('set_document_files', { p_subscription: r.id, p_invoice: null, p_receipt: null, p_emailed: true });
          // A copy for the accounts inbox.
          await sendEmail(ADMIN_EMAIL, { ...mail, subject: `Copy: ${docs.doc.invoice_no} / ${docs.doc.receipt_no} sent to ${r.full_name || r.email}` }, `pay-docs-copy-${id}`, docs.attachments);
          return res.status(200).json({ ok: true, invoice_no: docs.doc.invoice_no, receipt_no: docs.doc.receipt_no });
        }
        return res.status(200).json({ ok: true, documents: false });
      } else {
        if (sub.pay_status !== 'rejected') return res.status(409).json({ error: 'state mismatch' });
        await sendEmail(r.email, paymentNotFoundEmail(r, SITE), `pay-rejected-${id}-${sub.proof_submitted_at}`);
      }
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(JSON.stringify({ fn: 'payment-event', event, error: String(err.message).slice(0, 300) }));
    return res.status(500).json({ error: 'email failed' });
  }
}
