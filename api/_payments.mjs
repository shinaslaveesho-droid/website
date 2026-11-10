// Shared by /api/payment-event and the daily job: bank details, amounts and payment emails.
// Files starting with "_" are not exposed as endpoints by Vercel.

export const BANK = {
  holder: 'LAVEESHO LLC FZ',
  bank: 'Mashreq Bank',
  account: '019102240048',
  iban: 'AE260330000019102240048',
};
export const VAT_RATE = 0.05;

export function amounts(priceAed, months) {
  const subtotal = priceAed * months;
  const vat = Math.round(subtotal * VAT_RATE * 100) / 100;
  return { subtotal, vat, total: subtotal + vat };
}

export const aed = (n) => 'AED ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const firstName = (n) => (n || '').trim().split(/\s+/)[0] || 'there';
const len = (m) => (m === 1 ? '1 month' : `${m} months`);

// One branded layout for every payment email.
function layout({ heading, paragraphs, button, rows, footerNote }) {
  const table = rows && rows.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border:1px solid #E6E9F5;border-radius:14px">${rows.map(([k, v], i) =>
      `<tr><td style="padding:12px 16px;font-size:14px;color:#6B7094;${i ? 'border-top:1px solid #E6E9F5;' : ''}">${esc(k)}</td><td style="padding:12px 16px;font-size:15px;font-weight:bold;text-align:right;${i ? 'border-top:1px solid #E6E9F5;' : ''}">${esc(v)}</td></tr>`).join('')}</table>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#F4F8FD;font-family:Arial,Helvetica,sans-serif;color:#0A0B22">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden">
<tr><td style="background:linear-gradient(120deg,#4A1FD1,#BF0D65);background-color:#4A1FD1;padding:28px 32px;color:#F5EEDC;font-size:13px;letter-spacing:2px;font-weight:bold">LAVEESHO</td></tr>
<tr><td style="padding:32px">
<p style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:bold">${esc(heading)}</p>
${paragraphs.map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#454A6E">${esc(p)}</p>`).join('')}
${table}
${button ? `<a href="${esc(button.href)}" style="display:inline-block;background:#0A0B22;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 26px;border-radius:999px">${esc(button.label)}</a>` : ''}
${footerNote ? `<p style="margin:24px 0 0;font-size:13px;color:#6B7094">${esc(footerNote)}</p>` : ''}
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #E6E9F5;font-size:12px;color:#6B7094">Laveesho · The Citadel Tower, Business Bay, Dubai · +971 50 394 0721</td></tr>
</table></td></tr></table></body></html>`;
}

function asText({ heading, paragraphs, rows, button, footerNote }) {
  return [heading, '', ...paragraphs, '', ...(rows || []).map(([k, v]) => `${k}: ${v}`), '', button ? `${button.label}: ${button.href}` : '', footerNote || '',
    '', 'Laveesho · The Citadel Tower, Business Bay, Dubai · +971 50 394 0721'].join('\n');
}

function build(subject, parts) {
  return { subject, html: layout(parts), text: asText(parts) };
}

const summaryRows = (r) => {
  const a = amounts(r.price_aed, r.months);
  return [['Reference', r.ref_no], ['Plan', `${r.plan_name} · ${len(r.months)}`], ['Amount paid', aed(a.total) + ' (incl. 5% VAT)']];
};

// To the customer, right after they upload a receipt.
export function receivedDetailsEmail(r, site) {
  return build(`We received your payment details (${r.ref_no})`, {
    heading: `Thanks, ${firstName(r.full_name)}. We've received your payment details.`,
    paragraphs: ['Our team is checking your transfer with the bank now. This usually takes less than one working day.',
      'We will email you again as soon as your payment is confirmed.'],
    rows: summaryRows(r),
    button: { label: 'See your plan', href: `${site}/account` },
  });
}

// To the customer, when an admin clicks "Payment received".
export function paymentConfirmedEmail(r, site) {
  return build(`Payment received ✅ Welcome to ${r.plan_name}`, {
    heading: `Payment received. Thank you, ${firstName(r.full_name)}!`,
    paragraphs: [`Your ${r.plan_name} plan is now confirmed${r.starts_on ? `, starting ${fmtDate(r.starts_on)}` : ''}.`,
      'Our team will contact you within 24 hours to plan your first steps together.'],
    rows: summaryRows(r),
    button: { label: 'See your plan', href: `${site}/account` },
    footerNote: 'Questions? Reply to this email or WhatsApp us on +971 50 394 0721.',
  });
}

// To the customer, when an admin clicks "Not received".
export function paymentNotFoundEmail(r, site) {
  return build(`We couldn't find your payment yet (${r.ref_no})`, {
    heading: `We couldn't match your payment yet, ${firstName(r.full_name)}.`,
    paragraphs: [r.reject_reason ? `Note from our team: ${r.reject_reason}` : 'We could not find this transfer in our bank account yet.',
      `Please check the transfer with your bank, make sure the reference ${r.ref_no} is in the payment note, and upload the receipt again from your account.`],
    rows: summaryRows(r),
    button: { label: 'Upload receipt again', href: `${site}/account` },
    footerNote: 'Need help? WhatsApp us on +971 50 394 0721.',
  });
}

// To the customer, 2 days after choosing a plan without paying.
export function payReminderEmail(r, site) {
  const a = amounts(r.price_aed, r.months);
  return build(`Complete your ${r.plan_name} payment (${r.ref_no})`, {
    heading: `Your ${r.plan_name} plan is waiting, ${firstName(r.full_name)}.`,
    paragraphs: ['Transfer the amount below to start. Please write the reference in the payment note, then upload your receipt from your account.'],
    rows: [['Amount', aed(a.total) + ' (incl. 5% VAT)'], ['Reference', r.ref_no], ['Account name', BANK.holder], ['Bank', BANK.bank],
      ['Account number', BANK.account], ['IBAN', BANK.iban]],
    button: { label: 'Upload your receipt', href: `${site}/account` },
    footerNote: 'Changed your mind? You can cancel the request from your account.',
  });
}

// To the team, when a receipt arrives.
export function adminAlertEmail(r, site, receiptUrl) {
  const a = amounts(r.price_aed, r.months);
  return build(`New payment to check: ${r.ref_no} · ${aed(a.total)}`, {
    heading: `New payment to check: ${r.ref_no}`,
    paragraphs: [`${r.full_name || r.email} says they paid for ${r.plan_name} (${len(r.months)}).`,
      `Find ${r.ref_no} in the Mashreq statement, then click "Payment received" or "Not received" on the admin dashboard.`,
      ...(r.proof_note ? [`Customer note: ${r.proof_note}`] : [])],
    rows: [['Customer', `${r.full_name || ''} <${r.email}>`], ['Phone', r.phone || '—'], ['Amount', aed(a.total) + ' incl. VAT'], ['Reference', r.ref_no]],
    button: { label: 'Open admin dashboard', href: `${site}/admin#requests` },
    footerNote: receiptUrl ? `Receipt (link works for 7 days): ${receiptUrl}` : 'The receipt is on the admin dashboard.',
  });
}

function fmtDate(iso) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
