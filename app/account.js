// "My account" page: profile, current plan, plan request and history.
import { BANK, VAT_RATE } from './config.js';
import { supabase, h, fmtDate, fmtAED, dubaiToday, daysBetween, friendlyError, setStatus, requireSession, signOut, WHATSAPP, phoneOnly, validPhone } from './auth.js';

const $ = (id) => document.getElementById(id);
const status = $('acct-status');
let session, profile, plans = [], subs = [];

const STATUS_LABEL = { pending: 'Waiting for confirmation', active: 'Live', expired: 'Expired', cancelled: 'Cancelled' };

async function load() {
  const [p, pl, s] = await Promise.all([
    supabase.from('profiles').select('id, email, full_name, phone, company, address, gender, is_admin, created_at').eq('id', session.user.id).single(),
    supabase.from('plans').select('id, name, price_aed').order('sort'),
    supabase.from('subscriptions').select('id, plan_id, status, note, requested_at, starts_on, ends_on, months, ref_no, pay_status, reject_reason, proof_submitted_at').eq('user_id', session.user.id).order('requested_at', { ascending: false }),
  ]);
  const err = p.error || pl.error || s.error;
  if (err) throw err;
  profile = p.data; plans = pl.data; subs = s.data;
}

const planName = (id) => (plans.find((p) => p.id === id) || {}).name || id;

function renderProfile() {
  $('acct-hello').textContent = profile.full_name ? `Hi, ${profile.full_name.split(' ')[0]}.` : 'Welcome.';
  $('acct-since').textContent = `Member since ${fmtDate(profile.created_at)}`;
  const f = $('form-profile');
  f.full_name.value = profile.full_name || '';
  f.email.value = profile.email;
  f.phone.value = profile.phone || '';
  f.company.value = profile.company || '';
  f.address.value = profile.address || '';
  f.gender.value = profile.gender || '';
  $('admin-link').hidden = !profile.is_admin;
}

function stat(label, value, big) {
  return h('div', { class: 'acct-stat' }, h('span', { class: 'acct-stat-l' }, label), h('span', { class: big ? 'acct-stat-v serif' : 'acct-stat-v' }, value));
}

function renderPlan() {
  const box = $('plan-box');
  box.replaceChildren();
  const open = subs.find((s) => s.status === 'pending' || s.status === 'active');
  const today = dubaiToday();

  if (open && open.status === 'active') {
    const left = daysBetween(today, open.ends_on); // 0 = last day today
    const total = daysBetween(open.starts_on, open.ends_on) + 1;
    const used = Math.min(total, Math.max(0, daysBetween(open.starts_on, today) + 1));
    const started = daysBetween(open.starts_on, today) >= 0;
    if (started && left <= 7) {
      box.append(h('div', { class: 'acct-banner', role: 'status' },
        h('strong', {}, left <= 0 ? 'Your plan ends today.' : `Your plan ends in ${left} day${left === 1 ? '' : 's'}.`),
        ' Renew now to keep your campaigns running without a break. ',
        h('a', { href: WHATSAPP + '?text=' + encodeURIComponent(`Hi Laveesho, I'd like to renew my ${planName(open.plan_id)} plan.`) }, 'Renew on WhatsApp')));
    }
    box.append(
      h('div', { class: 'acct-plan-head' },
        h('div', {}, h('p', { class: 'kick acct-kick' }, 'Your plan'), h('h3', { class: 'serif acct-plan-name' }, planName(open.plan_id))),
        h('span', { class: 'acct-pill', 'data-kind': started ? 'live' : 'soon' }, started ? 'Live' : 'Starts soon')),
      h('div', { class: 'acct-stats' },
        stat('Started', fmtDate(open.starts_on)),
        stat('Ends', fmtDate(open.ends_on)),
        // ends_on is the last day of service, so days left includes today.
        stat(started ? 'Days left' : 'Starts in', started ? String(Math.max(0, left + 1)) : `${daysBetween(today, open.starts_on)} days`, true)),
      h('div', { class: 'acct-bar', role: 'progressbar', 'aria-label': 'Plan time used', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(started ? used : 0) },
        h('span', { style: `width: ${started ? Math.round((used / total) * 100) : 0}%` })),
      h('p', { class: 'acct-fine' }, 'We’ll email you 7 days and 1 day before your plan ends.'));
    return;
  }

  if (open && open.status === 'pending') {
    box.append(paymentPanel(open));
    return;
  }

  // No open plan: let them choose one.
  const last = subs[0];
  if (last && last.status === 'expired') box.append(h('div', { class: 'acct-banner', role: 'status' }, h('strong', {}, `Your ${planName(last.plan_id)} plan ended on ${fmtDate(last.ends_on)}.`), ' Choose a plan below to start again.'));
  const fromUrl = new URLSearchParams(location.search).get('plan');
  const wanted = plans.some((p) => p.id === fromUrl) ? fromUrl : plans.some((p) => p.id === 'growth') ? 'growth' : (plans[0] || {}).id;
  const form = h('form', { class: 'acct-choose', onsubmit: requestPlan },
    h('fieldset', {}, h('legend', { class: 'kick acct-kick' }, 'Choose your plan'),
      h('div', { class: 'acct-options' }, plans.map((p, i) =>
        h('label', { class: 'acct-option' },
          h('input', { type: 'radio', name: 'plan', value: p.id, required: true, checked: p.id === wanted, onchange: () => updateTotal(form) }),
          h('span', { class: 'serif acct-option-name' }, p.name.replace('Laveesho ', '')),
          h('span', { class: 'acct-option-price' }, `${fmtAED(p.price_aed)} / month`),
          p.id === 'growth' ? h('span', { class: 'acct-option-tag' }, 'Most popular') : null)))),
    h('div', { class: 'field' }, h('label', { for: 'plan-months' }, 'How many months?'),
      h('select', { id: 'plan-months', name: 'months', onchange: () => updateTotal(form) }, [1, 3, 6, 12].map((m) => h('option', { value: String(m) }, m === 1 ? '1 month' : `${m} months`)))),
    h('div', { class: 'pay-sum', 'data-total': '' }),
    h('div', { class: 'field' }, h('label', { for: 'plan-note' }, 'Anything we should know? (optional)'),
      h('textarea', { id: 'plan-note', name: 'note', rows: '3', maxlength: '500', placeholder: 'Your goals, preferred start date, questions' })),
    h('button', { type: 'submit', class: 'btn', style: 'background: linear-gradient(100deg, #4A1FD1, #BF0D65); color: #fff; width: 100%' }, 'Continue to payment'),
    h('p', { class: 'acct-fine' }, 'Next you’ll see our bank details and your payment reference. Pay by bank transfer, then upload your receipt. ', h('a', { href: '/pricing' }, 'Compare what’s included')));
  box.append(form);
  updateTotal(form);
}

// ---------- bank transfer ----------
const price = (id) => (plans.find((p) => p.id === id) || {}).price_aed || 0;
function amounts(planId, months) {
  const subtotal = price(planId) * months;
  const vat = Math.round(subtotal * VAT_RATE * 100) / 100;
  return { subtotal, vat, total: subtotal + vat };
}
const money = (n) => 'AED ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const monthsLabel = (m) => (m === 1 ? '1 month' : `${m} months`);

function sumTable(planId, months) {
  const a = amounts(planId, months);
  return h('dl', { class: 'pay-lines' },
    h('div', {}, h('dt', {}, `${planName(planId).replace('Laveesho ', '')} × ${monthsLabel(months)}`), h('dd', {}, money(a.subtotal))),
    h('div', {}, h('dt', {}, 'VAT 5%'), h('dd', {}, money(a.vat))),
    h('div', { class: 'pay-total' }, h('dt', {}, 'Total to pay'), h('dd', {}, money(a.total))));
}

function updateTotal(form) {
  const slot = form.querySelector('[data-total]');
  const plan = form.querySelector('input[name=plan]:checked');
  if (!slot || !plan) return;
  slot.replaceChildren(sumTable(plan.value, Number(form.months.value) || 1));
}

function copyRow(label, value, big, copyValue = value) {
  const btn = h('button', { type: 'button', class: 'pay-copy', 'aria-label': `Copy ${label}` }, 'Copy');
  btn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(copyValue); btn.textContent = 'Copied ✓'; }
    catch { btn.textContent = 'Select & copy'; }
    setTimeout(() => (btn.textContent = 'Copy'), 2000);
  });
  return h('div', { class: 'pay-row' + (big ? ' pay-row-big' : '') }, h('span', { class: 'pay-l' }, label), h('span', { class: 'pay-v' }, value), btn);
}

function paymentPanel(sub) {
  const a = amounts(sub.plan_id, sub.months);
  const head = (pill, kind) => h('div', { class: 'acct-plan-head' },
    h('div', {}, h('p', { class: 'kick acct-kick' }, `${monthsLabel(sub.months)} · Ref ${sub.ref_no}`), h('h3', { class: 'serif acct-plan-name' }, planName(sub.plan_id))),
    h('span', { class: 'acct-pill', 'data-kind': kind }, pill));

  if (sub.pay_status === 'submitted') {
    return h('div', { class: 'pay' },
      head('Checking payment', 'pending'),
      h('div', { class: 'pay-done', role: 'status' },
        h('strong', {}, 'Thanks! We’ve received your payment details.'),
        h('span', {}, `Our team is checking your transfer of ${money(a.total)} with the bank. This usually takes less than one working day. We’ll email you as soon as it’s confirmed.`)),
      sumTable(sub.plan_id, sub.months),
      h('div', { class: 'acct-actions' }, h('a', { class: 'btn', href: WHATSAPP, style: 'background: var(--ink); color: #fff' }, 'Questions? WhatsApp us')));
  }

  const file = h('input', { type: 'file', id: 'pay-file', name: 'file', accept: 'image/*,application/pdf', required: true });
  const form = h('form', { class: 'pay-upload', onsubmit: (e) => submitProof(e, sub) },
    h('div', { class: 'field' }, h('label', { for: 'pay-file' }, 'Upload your transfer receipt'), file,
      h('p', { class: 'auth-hint' }, 'A screenshot or PDF from your banking app. Max 5 MB.')),
    h('div', { class: 'field' }, h('label', { for: 'pay-note' }, 'Transaction number or note (optional)'),
      h('input', { id: 'pay-note', name: 'note', type: 'text', maxlength: '300', placeholder: 'e.g. bank transaction ID' })),
    h('button', { type: 'submit', class: 'btn', style: 'background: linear-gradient(100deg, #4A1FD1, #BF0D65); color: #fff; width: 100%' }, 'I’ve paid — send receipt'));

  return h('div', { class: 'pay' },
    head(sub.pay_status === 'rejected' ? 'Payment not found' : 'Waiting for payment', 'pending'),
    sub.pay_status === 'rejected' ? h('div', { class: 'acct-banner', role: 'alert' },
      h('strong', {}, 'We couldn’t find your payment yet. '),
      sub.reject_reason ? `Note from our team: ${sub.reject_reason}. ` : '',
      'Please check the transfer with your bank and upload the receipt again.') : null,
    h('p', { class: 'acct-text' }, h('strong', { style: 'color: var(--ink)' }, '1. '), 'Transfer the total below to our bank account. ',
      h('strong', { style: 'color: var(--ink)' }, `Write ${sub.ref_no} in the payment note`), ' so we can match it.'),
    sumTable(sub.plan_id, sub.months),
    h('div', { class: 'pay-bank' },
      copyRow('Amount', money(a.total), true, String(a.total)),
      copyRow('Reference', sub.ref_no, true),
      copyRow('Account name', BANK.holder),
      copyRow('Bank', BANK.bank),
      copyRow('Account number', BANK.account),
      copyRow('IBAN', BANK.iban)),
    h('p', { class: 'acct-text' }, h('strong', { style: 'color: var(--ink)' }, '2. '), 'After paying, upload the receipt here. We’ll confirm by email.'),
    form,
    h('div', { class: 'acct-actions' },
      h('a', { class: 'btn acct-ghost', href: WHATSAPP + '?text=' + encodeURIComponent(`Hi Laveesho, I have a question about payment ${sub.ref_no}.`) }, 'Need help? WhatsApp'),
      h('button', { type: 'button', class: 'btn acct-ghost', onclick: () => cancelRequest(sub.id) }, 'Cancel request')));
}

async function submitProof(e, sub) {
  e.preventDefault();
  const f = e.currentTarget;
  const file = f.file.files[0];
  if (!file) return setStatus(status, 'Please choose your receipt file first.', 'error');
  if (file.size > 5 * 1024 * 1024) return setStatus(status, 'That file is over 5 MB. Please upload a smaller screenshot or PDF.', 'error');
  if (!/^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/.test(file.type)) return setStatus(status, 'Please upload a JPG, PNG, HEIC, WebP image or a PDF.', 'error');
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Sending…';
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
  const path = `${session.user.id}/${sub.ref_no}-${Date.now()}.${ext}`;
  const up = await supabase.storage.from('payment-proofs').upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) { btn.disabled = false; btn.textContent = 'I’ve paid — send receipt'; return setStatus(status, 'The upload failed. Please try again, or send the receipt on WhatsApp.', 'error'); }
  const { error } = await supabase.rpc('submit_payment_proof', { p_subscription: sub.id, p_path: path, p_note: f.note.value.trim() || null });
  if (error) { btn.disabled = false; btn.textContent = 'I’ve paid — send receipt'; return setStatus(status, friendlyError(error), 'error'); }
  notify('submitted', sub.id);
  setStatus(status, 'Thank you! We’ve received your payment details and will confirm by email.', 'ok');
  refresh();
}

// Ask the server to send the emails. Data is already saved, so a failure here is not shown as an error.
async function notify(event, id) {
  try {
    const { data } = await supabase.auth.getSession();
    await fetch('/api/payment-event', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ event, subscription_id: id }) });
  } catch { /* emails are best effort */ }
}

function renderHistory() {
  const past = subs.filter((s) => s.status === 'expired' || s.status === 'cancelled');
  $('history').hidden = past.length === 0;
  $('history-list').replaceChildren(...past.map((s) =>
    h('li', { class: 'acct-hist' },
      h('span', { class: 'acct-hist-name' }, planName(s.plan_id)),
      h('span', {}, s.starts_on ? `${fmtDate(s.starts_on)} – ${fmtDate(s.ends_on)}` : `Requested ${fmtDate(s.requested_at)}`),
      h('span', { class: 'acct-pill', 'data-kind': s.status }, STATUS_LABEL[s.status]))));
}

function render() { renderProfile(); renderPlan(); renderHistory(); }

async function refresh() {
  try { await load(); render(); } catch (err) { setStatus(status, friendlyError(err), 'error'); }
}

async function requestPlan(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  const { error } = await supabase.from('subscriptions').insert({ user_id: session.user.id, plan_id: f.plan.value, months: Number(f.months.value) || 1, note: f.note.value.trim() || null });
  btn.disabled = false;
  if (error) return setStatus(status, friendlyError(error), 'error');
  setStatus(status, 'Almost done. Please pay by bank transfer using the details below.', 'ok');
  if (new URLSearchParams(location.search).has('plan')) history.replaceState(null, '', '/account');
  await refresh();
  $('plan-box').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function cancelRequest(id) {
  if (!confirm('Cancel your plan request?')) return;
  const { error } = await supabase.rpc('cancel_my_request', { p_subscription: id });
  if (error) return setStatus(status, friendlyError(error), 'error');
  setStatus(status, 'Your request was cancelled.', 'ok');
  refresh();
}

$('form-profile').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  if (f.phone.value.trim() && !validPhone(f.phone.value)) { f.phone.focus(); return setStatus(status, 'Please enter a valid contact number, for example +971 50 123 4567.', 'error'); }
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  const { error } = await supabase.from('profiles').update({
    full_name: f.full_name.value.trim().slice(0, 120),
    phone: f.phone.value.trim().slice(0, 30) || null,
    company: f.company.value.trim().slice(0, 120) || null,
    address: f.address.value.trim().slice(0, 300) || null,
    gender: f.gender.value || null,
  }).eq('id', session.user.id);
  btn.disabled = false;
  if (error) return setStatus(status, friendlyError(error), 'error');
  setStatus(status, 'Profile saved.', 'ok');
  refresh();
});

$('logout').addEventListener('click', signOut);
phoneOnly($('p-phone'));

session = await requireSession(location.pathname + location.search);
if (session) {
  await refresh();
  document.body.classList.add('acct-ready');
}
