// Admin page: confirm plan requests, extend or cancel live plans, see every customer.
// Every action here is also checked inside the database (assert_admin), so hiding the page is not the security.
import { supabase, h, fmtDate, dubaiToday, daysBetween, friendlyError, setStatus, requireSession, signOut } from './auth.js';

const $ = (id) => document.getElementById(id);
const status = $('admin-status');
let plans = [], people = [], subs = [], query = '';

const MONTHS = [1, 3, 6, 12];
const planName = (id) => (plans.find((p) => p.id === id) || {}).name?.replace('Laveesho ', '') || id;
const person = (id) => people.find((p) => p.id === id) || { full_name: '', email: '' };
const matches = (p) => !query || `${p.full_name} ${p.email} ${p.company || ''}`.toLowerCase().includes(query);

async function load() {
  const [pl, pr, s] = await Promise.all([
    supabase.from('plans').select('id, name, price_aed').order('sort'),
    supabase.from('profiles').select('id, email, full_name, phone, company, created_at').order('created_at', { ascending: false }).limit(1000),
    supabase.from('subscriptions').select('id, user_id, plan_id, status, note, requested_at, starts_on, ends_on').order('requested_at', { ascending: false }).limit(2000),
  ]);
  const err = pl.error || pr.error || s.error;
  if (err) throw err;
  plans = pl.data; people = pr.data; subs = s.data;
}

function monthSelect(name) {
  return h('select', { name, 'aria-label': 'Length' }, MONTHS.map((m) => h('option', { value: String(m) }, m === 1 ? '1 month' : `${m} months`)));
}

function who(p) {
  return h('div', { class: 'adm-who' }, h('strong', {}, p.full_name || '(no name)'), h('a', { href: 'mailto:' + p.email }, p.email),
    p.phone ? h('a', { href: 'https://wa.me/' + p.phone.replace(/[^\d]/g, '') }, p.phone) : null, p.company ? h('span', {}, p.company) : null);
}

async function act(fn, args, done) {
  setStatus(status, 'Saving…');
  const { error } = await supabase.rpc(fn, args);
  if (error) return setStatus(status, friendlyError(error), 'error');
  setStatus(status, done, 'ok');
  refresh();
}

function renderPending() {
  const rows = subs.filter((s) => s.status === 'pending' && matches(person(s.user_id)));
  $('pending-count').textContent = String(subs.filter((s) => s.status === 'pending').length);
  $('pending-list').replaceChildren(...(rows.length ? rows.map((s) => {
    const p = person(s.user_id);
    const form = h('form', { class: 'adm-actions', onsubmit: (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      act('confirm_subscription', { p_subscription: s.id, p_starts_on: f.start.value, p_months: Number(f.months.value) }, `${planName(s.plan_id)} is now live for ${p.full_name || p.email}.`);
    } },
      h('label', {}, 'Start', h('input', { type: 'date', name: 'start', required: true, value: dubaiToday() })),
      h('label', {}, 'Length', monthSelect('months')),
      h('button', { type: 'submit', class: 'btn adm-btn', style: 'background: var(--royal); color: #fff' }, 'Confirm & go live'),
      h('button', { type: 'button', class: 'btn adm-btn acct-ghost', onclick: () => confirm('Decline this request?') && act('cancel_subscription', { p_subscription: s.id }, 'Request declined.') }, 'Decline'));
    return h('li', { class: 'adm-row' }, who(p),
      h('div', { class: 'adm-plan' }, h('span', { class: 'serif adm-plan-name' }, planName(s.plan_id)), h('span', {}, `Requested ${fmtDate(s.requested_at)}`), s.note ? h('q', { class: 'adm-note' }, s.note) : null),
      form);
  }) : [h('li', { class: 'adm-empty' }, query ? 'No pending requests match your search.' : 'No pending requests.')]));
}

function renderActive() {
  const today = dubaiToday();
  const rows = subs.filter((s) => s.status === 'active' && matches(person(s.user_id))).sort((a, b) => a.ends_on.localeCompare(b.ends_on));
  $('active-count').textContent = String(subs.filter((s) => s.status === 'active').length);
  $('active-list').replaceChildren(...(rows.length ? rows.map((s) => {
    const p = person(s.user_id);
    const left = daysBetween(today, s.ends_on) + 1;
    const form = h('form', { class: 'adm-actions', onsubmit: (e) => {
      e.preventDefault();
      const m = Number(e.currentTarget.months.value);
      act('extend_subscription', { p_subscription: s.id, p_months: m }, `Extended by ${m} month${m === 1 ? '' : 's'}.`);
    } },
      h('label', {}, 'Extend by', monthSelect('months')),
      h('button', { type: 'submit', class: 'btn adm-btn', style: 'background: var(--royal); color: #fff' }, 'Extend'),
      h('button', { type: 'button', class: 'btn adm-btn acct-ghost', onclick: () => confirm(`Cancel ${p.full_name || p.email}'s plan now?`) && act('cancel_subscription', { p_subscription: s.id }, 'Plan cancelled.') }, 'Cancel plan'));
    return h('li', { class: 'adm-row' }, who(p),
      h('div', { class: 'adm-plan' }, h('span', { class: 'serif adm-plan-name' }, planName(s.plan_id)),
        h('span', {}, `${fmtDate(s.starts_on)} – ${fmtDate(s.ends_on)}`),
        h('span', { class: 'acct-pill', 'data-kind': left <= 7 ? 'soon' : 'live' }, left <= 0 ? 'Ended' : `${left} day${left === 1 ? '' : 's'} left`)),
      form);
  }) : [h('li', { class: 'adm-empty' }, query ? 'No live plans match your search.' : 'No live plans yet.')]));
}

function renderCustomers() {
  const rows = people.filter(matches);
  $('customer-count').textContent = String(people.length);
  $('customer-list').replaceChildren(...(rows.length ? rows.map((p) => {
    const mine = subs.filter((s) => s.user_id === p.id);
    const open = mine.find((s) => s.status === 'active' || s.status === 'pending');
    const last = mine[0];
    let label = 'No plan';
    if (open) label = `${planName(open.plan_id)} · ${open.status === 'active' ? 'live until ' + fmtDate(open.ends_on) : 'pending'}`;
    else if (last) label = `${planName(last.plan_id)} · ${last.status}`;
    return h('li', { class: 'adm-row adm-row-sm' }, who(p), h('span', {}, `Joined ${fmtDate(p.created_at)}`), h('span', {}, label));
  }) : [h('li', { class: 'adm-empty' }, 'No customers match your search.')]));
}

function render() { renderPending(); renderActive(); renderCustomers(); }

async function refresh() {
  try { await load(); render(); } catch (err) { setStatus(status, friendlyError(err), 'error'); }
}

$('admin-search').addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); render(); });
$('logout').addEventListener('click', signOut);

const session = await requireSession('/admin');
if (session) {
  const { data: isAdmin, error } = await supabase.rpc('is_admin');
  if (error || !isAdmin) {
    $('admin-app').hidden = true;
    $('admin-denied').hidden = false;
  } else {
    $('admin-app').hidden = false;
    await refresh();
  }
  document.body.classList.add('acct-ready');
}
