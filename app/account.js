// "My account" page: profile, current plan, plan request and history.
import { supabase, h, fmtDate, fmtAED, dubaiToday, daysBetween, friendlyError, setStatus, requireSession, signOut, WHATSAPP } from './auth.js';

const $ = (id) => document.getElementById(id);
const status = $('acct-status');
let session, profile, plans = [], subs = [];

const STATUS_LABEL = { pending: 'Waiting for confirmation', active: 'Live', expired: 'Expired', cancelled: 'Cancelled' };

async function load() {
  const [p, pl, s] = await Promise.all([
    supabase.from('profiles').select('id, email, full_name, phone, company, is_admin, created_at').eq('id', session.user.id).single(),
    supabase.from('plans').select('id, name, price_aed').order('sort'),
    supabase.from('subscriptions').select('id, plan_id, status, note, requested_at, starts_on, ends_on').eq('user_id', session.user.id).order('requested_at', { ascending: false }),
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
    box.append(
      h('div', { class: 'acct-plan-head' },
        h('div', {}, h('p', { class: 'kick acct-kick' }, 'Requested plan'), h('h3', { class: 'serif acct-plan-name' }, planName(open.plan_id))),
        h('span', { class: 'acct-pill', 'data-kind': 'pending' }, 'Pending')),
      h('p', { class: 'acct-text' }, `You requested this plan on ${fmtDate(open.requested_at)}. Our team will confirm your start date with you, then it goes live here.`),
      h('div', { class: 'acct-actions' },
        h('a', { class: 'btn', href: WHATSAPP, style: 'background: var(--ink); color: #fff' }, 'Talk to us on WhatsApp'),
        h('button', { type: 'button', class: 'btn acct-ghost', onclick: () => cancelRequest(open.id) }, 'Cancel request')));
    return;
  }

  // No open plan: let them choose one.
  const last = subs[0];
  if (last && last.status === 'expired') box.append(h('div', { class: 'acct-banner', role: 'status' }, h('strong', {}, `Your ${planName(last.plan_id)} plan ended on ${fmtDate(last.ends_on)}.`), ' Choose a plan below to start again.'));
  const form = h('form', { class: 'acct-choose', onsubmit: requestPlan },
    h('fieldset', {}, h('legend', { class: 'kick acct-kick' }, 'Choose your plan'),
      h('div', { class: 'acct-options' }, plans.map((p, i) =>
        h('label', { class: 'acct-option' },
          h('input', { type: 'radio', name: 'plan', value: p.id, required: true, checked: p.id === 'growth' || (i === 0 && !plans.some((x) => x.id === 'growth')) }),
          h('span', { class: 'serif acct-option-name' }, p.name.replace('Laveesho ', '')),
          h('span', { class: 'acct-option-price' }, `${fmtAED(p.price_aed)} / month`),
          p.id === 'growth' ? h('span', { class: 'acct-option-tag' }, 'Most popular') : null)))),
    h('div', { class: 'field' }, h('label', { for: 'plan-note' }, 'Anything we should know? (optional)'),
      h('textarea', { id: 'plan-note', name: 'note', rows: '3', maxlength: '500', placeholder: 'Your goals, preferred start date, questions' })),
    h('button', { type: 'submit', class: 'btn', style: 'background: linear-gradient(100deg, #4A1FD1, #BF0D65); color: #fff; width: 100%' }, 'Request this plan'),
    h('p', { class: 'acct-fine' }, 'No payment now. We’ll confirm the scope and start date with you, then your plan goes live. ', h('a', { href: '/pricing' }, 'Compare what’s included')));
  box.append(form);
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
  const { error } = await supabase.from('subscriptions').insert({ user_id: session.user.id, plan_id: f.plan.value, note: f.note.value.trim() || null });
  btn.disabled = false;
  if (error) return setStatus(status, friendlyError(error), 'error');
  setStatus(status, 'Request sent. We’ll be in touch to confirm your start date.', 'ok');
  refresh();
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
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  const { error } = await supabase.from('profiles').update({
    full_name: f.full_name.value.trim().slice(0, 120),
    phone: f.phone.value.trim().slice(0, 30) || null,
    company: f.company.value.trim().slice(0, 120) || null,
  }).eq('id', session.user.id);
  btn.disabled = false;
  if (error) return setStatus(status, friendlyError(error), 'error');
  setStatus(status, 'Profile saved.', 'ok');
  refresh();
});

$('logout').addEventListener('click', signOut);

session = await requireSession('/account');
if (session) {
  await refresh();
  document.body.classList.add('acct-ready');
}
