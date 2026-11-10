// Admin dashboard: business overview (KPIs + charts), plan requests, live plans and customers.
// Every action is also checked inside the database (assert_admin), so hiding the page is not the security.
import { supabase, h, fmtDate, fmtAED, dubaiToday, daysBetween, friendlyError, setStatus, requireSession, signOut } from './auth.js';

const $ = (id) => document.getElementById(id);
const status = $('admin-status');
const tip = $('tip');
const SVG = 'http://www.w3.org/2000/svg';
const S = { s1: '#5B3BE8', s2: '#E0559F', s3: '#E8A317', s4: '#A9A6BA' };
let plans = [], people = [], subs = [], stats = null, query = '';

const MONTHS = [1, 3, 6, 12];
const num = (v) => Number(v || 0).toLocaleString('en-US');
const aedShort = (v) => { v = Number(v || 0); return v >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(v)); };
const dayShort = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const planName = (id) => (plans.find((p) => p.id === id) || {}).name?.replace('Laveesho ', '') || id;
const GENDER = { female: 'Female', male: 'Male', prefer_not_to_say: 'Gender not given' };
const person = (id) => people.find((p) => p.id === id) || { full_name: '', email: '' };
const matches = (p) => !query || `${p.full_name} ${p.email} ${p.company || ''} ${p.phone || ''} ${p.address || ''}`.toLowerCase().includes(query);

function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

// ---------- tooltip ----------
function showTip(e, title, lines) {
  tip.replaceChildren(h('b', {}, title), ...lines.map(([color, text]) => h('div', {}, color ? h('i', { style: `background:${color}` }) : null, text)));
  tip.hidden = false;
  const x = Math.min(window.innerWidth - tip.offsetWidth - 12, e.clientX + 14);
  const y = Math.max(8, e.clientY - tip.offsetHeight - 12);
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
const hideTip = () => { tip.hidden = true; };

// ---------- chart helpers ----------
function niceMax(v) {
  if (v <= 20) return Math.max(4, Math.ceil(v / 4) * 4);
  const p = 10 ** Math.floor(Math.log10(v)); const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

function frame(el, data, max, fmtY) {
  const W = el.clientWidth || 600, H = el.clientHeight || 240;
  const pad = { l: 44, r: 8, t: 16, b: 26 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + ih - (ih * i) / 4;
    svg.append(s('line', { class: i ? 'grid-l' : 'base-l', x1: pad.l, x2: W - pad.r, y1: y, y2: y }));
    svg.append(s('text', { class: 'ax', x: pad.l - 8, y: y + 4, 'text-anchor': 'end' }, fmtY((max * i) / 4)));
  }
  const step = iw / data.length;
  const every = W < 420 ? 3 : 2;
  data.forEach((d, i) => {
    if ((data.length - 1 - i) % every === 0) svg.append(s('text', { class: 'ax', x: pad.l + step * i + step / 2, y: H - 6, 'text-anchor': 'middle' }, dayShort(d.day)));
  });
  return { svg, W, H, pad, iw, ih, step, y: (v) => pad.t + ih - (ih * v) / max };
}

function lineChart(el, data, key, color, label, fmt) {
  const max = niceMax(Math.max(...data.map((d) => d[key])));
  const f = frame(el, data, max, (v) => num(Math.round(v)));
  const pts = data.map((d, i) => [f.pad.l + f.step * i + f.step / 2, f.y(d[key])]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const gid = 'g' + el.id;
  f.svg.append(s('defs', {}, s('linearGradient', { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 }, s('stop', { offset: 0, 'stop-color': color, 'stop-opacity': 0.22 }), s('stop', { offset: 1, 'stop-color': color, 'stop-opacity': 0 }))));
  f.svg.append(s('path', { d: `${line} L ${pts.at(-1)[0]} ${f.pad.t + f.ih} L ${pts[0][0]} ${f.pad.t + f.ih} Z`, fill: `url(#${gid})` }));
  f.svg.append(s('path', { d: line, fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  const last = pts.at(-1);
  f.svg.append(s('circle', { cx: last[0], cy: last[1], r: 4.5, fill: color, stroke: '#fff', 'stroke-width': 2 }));
  f.svg.append(s('text', { class: 'val', x: last[0] - 4, y: last[1] - 10, 'text-anchor': 'end' }, `Today ${fmt(data.at(-1)[key])}`));
  const xh = s('line', { class: 'xhair', y1: f.pad.t, y2: f.pad.t + f.ih, visibility: 'hidden' });
  const dot = s('circle', { r: 5, fill: color, stroke: '#fff', 'stroke-width': 2, visibility: 'hidden' });
  f.svg.append(xh, dot);
  data.forEach((d, i) => {
    const r = s('rect', { class: 'hit', x: f.pad.l + f.step * i, y: f.pad.t, width: f.step, height: f.ih });
    r.addEventListener('pointermove', (e) => {
      xh.setAttribute('x1', pts[i][0]); xh.setAttribute('x2', pts[i][0]); xh.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', pts[i][0]); dot.setAttribute('cy', pts[i][1]); dot.setAttribute('visibility', 'visible');
      showTip(e, fmtDate(d.day), [[color, `${label}: ${fmt(d[key])}`]]);
    });
    r.addEventListener('pointerleave', () => { hideTip(); xh.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); });
    f.svg.append(r);
  });
  el.replaceChildren(f.svg);
}

function barChart(el, data, key, color, label, fmt, fmtAxis, emptyText) {
  const top = Math.max(...data.map((d) => d[key]));
  if (!top) { el.replaceChildren(h('div', { class: 'empty-c' }, emptyText)); return; }
  const max = niceMax(top);
  const f = frame(el, data, max, fmtAxis);
  const bw = Math.max(4, Math.min(28, f.step - 6));
  const peak = data.findIndex((d) => d[key] === top);
  data.forEach((d, i) => {
    const x = f.pad.l + f.step * i + (f.step - bw) / 2, y = f.y(d[key]), hgt = f.pad.t + f.ih - y;
    if (hgt > 0) {
      const r = Math.min(4, hgt, bw / 2);
      f.svg.append(s('path', { d: `M${x} ${y + hgt} V${y + r} Q${x} ${y} ${x + r} ${y} H${x + bw - r} Q${x + bw} ${y} ${x + bw} ${y + r} V${y + hgt} Z`, fill: color }));
    }
    if (i === peak) f.svg.append(s('text', { class: 'val', x: x + bw / 2, y: y - 6, 'text-anchor': 'middle' }, fmt(d[key])));
    const hit = s('rect', { class: 'hit', x: f.pad.l + f.step * i, y: f.pad.t, width: f.step, height: f.ih });
    hit.addEventListener('pointermove', (e) => showTip(e, fmtDate(d.day), [[color, `${label}: ${fmt(d[key])}`]]));
    hit.addEventListener('pointerleave', hideTip);
    f.svg.append(hit);
  });
  el.replaceChildren(f.svg);
}

function arc(c, R, r, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (rad, a) => `${(c + rad * Math.cos(a)).toFixed(2)} ${(c + rad * Math.sin(a)).toFixed(2)}`;
  return `M${p(R, a0)} A${R} ${R} 0 ${large} 1 ${p(R, a1)} L${p(r, a1)} A${r} ${r} 0 ${large} 0 ${p(r, a0)} Z`;
}

function donut(el, items, centerTop, centerSub, fmt, emptyText) {
  const total = items.reduce((a, b) => a + b.value, 0);
  const R = 80, r = 54, C = 90;
  const svg = s('svg', { viewBox: '0 0 180 180', role: 'img', 'aria-label': items.map((i) => `${i.label} ${fmt(i.value)}`).join(', ') });
  const live = items.filter((i) => i.value > 0);
  if (!total) {
    svg.append(s('circle', { cx: C, cy: C, r: (R + r) / 2, fill: 'none', stroke: '#EDEBF4', 'stroke-width': R - r }));
  } else if (live.length === 1) {
    const it = live[0];
    const ring = s('circle', { cx: C, cy: C, r: (R + r) / 2, fill: 'none', stroke: it.color, 'stroke-width': R - r, class: 'slice' });
    ring.addEventListener('pointermove', (e) => showTip(e, it.label, [[it.color, `${fmt(it.value)} · 100%`]]));
    ring.addEventListener('pointerleave', hideTip);
    it.el = ring; svg.append(ring);
  } else {
    let a = -Math.PI / 2;
    for (const it of live) {
      const sweep = (it.value / total) * Math.PI * 2;
      const p = s('path', { d: arc(C, R, r, a, a + sweep), fill: it.color, stroke: '#fff', 'stroke-width': 2, class: 'slice' });
      p.addEventListener('pointermove', (e) => { el.classList.add('dim'); p.classList.add('hot'); showTip(e, it.label, [[it.color, `${fmt(it.value)} · ${Math.round((it.value / total) * 100)}%`]]); });
      p.addEventListener('pointerleave', () => { el.classList.remove('dim'); p.classList.remove('hot'); hideTip(); });
      it.el = p; svg.append(p); a += sweep;
    }
  }
  svg.append(s('text', { class: 'donut-c1', x: C, y: C + 4, 'text-anchor': 'middle' }, centerTop(total)));
  svg.append(s('text', { class: 'donut-c2', x: C, y: C + 22, 'text-anchor': 'middle' }, centerSub));
  const legend = h('ul', { class: 'legend' }, items.map((it) => {
    const li = h('li', {}, h('i', { style: `background:${it.color}` }), h('span', {}, it.label, h('small', {}, total ? `${Math.round((it.value / total) * 100)}% of total` : 'none yet')), h('b', {}, fmt(it.value)));
    li.addEventListener('pointerenter', () => { if (it.el && live.length > 1) { el.classList.add('dim'); it.el.classList.add('hot'); } });
    li.addEventListener('pointerleave', () => { el.classList.remove('dim'); it.el?.classList.remove('hot'); });
    return li;
  }));
  el.replaceChildren(svg, total ? legend : h('div', {}, h('p', { style: 'margin:0 0 10px;color:var(--ink2);font-size:14px' }, emptyText), legend));
}

function spark(values, color) {
  const max = Math.max(1, ...values), W = 92, H = 30;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${(H - 2 - (v / max) * (H - 4)).toFixed(1)}`).join(' ');
  return s('svg', { class: 'spark', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' }, s('polyline', { points: pts, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
}

// ---------- KPI tiles ----------
const ICON = {
  live: 'M2 12h4l3-8 4 16 3-8h6', eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-4 4-6 8-6s7 2 8 6', cart: 'M3 4h2l2.4 11h11L21 7H6.2M9 20h.01M18 20h.01',
  coin: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 9.5c0-1.4 1.3-2 3-2s3 .7 3 2-1.3 1.8-3 2.5-3 1.1-3 2.5 1.3 2 3 2 3-.6 3-2M12 6v1.5M12 16.5V18',
  cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4', chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2', box: 'M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10',
};
const svgIcon = (d) => s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, s('path', { d }));
function delta(today, yday, fmt = num) {
  if (today === yday) return h('span', { class: 'delta flat' }, 'Same as yesterday');
  const up = today > yday;
  return h('span', {}, h('span', { class: 'delta ' + (up ? 'up' : 'down') }, (up ? '▲ ' : '▼ ') + fmt(Math.abs(today - yday))), ' vs yesterday');
}
function kpi(label, icon, value, sub, opts = {}) {
  return h('article', { class: 'card kpi' + (opts.hero ? ' hero' : '') },
    h('span', { class: 'kpi-l' }, h('span', { class: 'kpi-i' }, svgIcon(ICON[icon])), label),
    h('span', { class: 'kpi-v' }, value),
    h('span', { class: 'kpi-s' }, sub),
    opts.spark || null);
}

// ---------- render overview ----------
function renderOverview() {
  if (!stats) return;
  const st = stats, d = st.daily, t = d.at(-1), y = d.at(-2) || { visitors: 0, signups: 0, revenue: 0 };
  $('kpis').replaceChildren(
    kpi('Live on website now', 'live', num(st.live_visitors), st.live_visitors === 1 ? 'person browsing right now' : 'people browsing right now', { hero: true }),
    kpi('Visitors today', 'eye', num(st.visitors_today), delta(t.visitors, y.visitors), { spark: spark(d.map((x) => x.visitors), S.s1) }),
    kpi('Sign-ups today', 'user', num(st.signups_today), delta(t.signups, y.signups), { spark: spark(d.map((x) => x.signups), S.s2) }),
    kpi("Today's customers", 'cart', num(st.customers_today), 'Plans made live today'),
    kpi('Revenue today', 'coin', fmtAED(st.revenue_today), delta(t.revenue, y.revenue, fmtAED)),
    kpi('Revenue this month', 'cal', fmtAED(st.revenue_month), new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Asia/Dubai' })),
    kpi('Overall revenue', 'chart', fmtAED(st.revenue_all), 'All time · excl. 5% VAT'),
    kpi('Packages sold', 'box', num(st.packages_sold), `${num(st.renewals)} renewals · ${num(st.plans_live)} live now`));

  const sum = (k) => d.reduce((a, x) => a + x[k], 0);
  $('vis-total').textContent = `${num(sum('visitors'))} in 14 days`;
  $('reg-total').textContent = `${num(sum('signups'))} in 14 days`;
  $('rev-total').textContent = fmtAED(sum('revenue'));
  const byPlan = (key) => st.by_plan.map((p, i) => ({ label: p.plan.replace('Laveesho ', ''), value: p[key], color: [S.s1, S.s2, S.s3][i] }));
  donut($('ch-packages'), byPlan('sold'), (n) => num(n), 'packages sold', num, 'No packages sold yet.');
  donut($('ch-revplan'), byPlan('revenue'), (n) => aedShort(n), 'AED total', fmtAED, 'No revenue yet.');

  const count = (k) => subs.filter((x) => x.status === k).length;
  donut($('ch-status'), [
    { label: 'Live', value: count('active'), color: S.s1 },
    { label: 'Waiting for you', value: count('pending'), color: S.s2 },
    { label: 'Ended', value: count('expired'), color: S.s3 },
    { label: 'Cancelled / declined', value: count('cancelled'), color: S.s4 },
  ], (n) => num(n), 'plan requests', num, 'No plan requests yet.');

  lineChart($('ch-visitors'), d, 'visitors', S.s1, 'Visitors', num);
  barChart($('ch-signups'), d, 'signups', S.s2, 'Sign-ups', num, (v) => num(Math.round(v)), 'No sign-ups in the last 14 days yet.');
  barChart($('ch-revenue'), d, 'revenue', S.s1, 'Revenue', fmtAED, aedShort, 'No sales in the last 14 days yet. Revenue appears when you confirm a plan.');

  $('live-chip').textContent = `${num(st.live_visitors)} live`;
  const pages = st.live_pages, top = Math.max(1, ...pages.map((p) => p.n));
  $('ch-pages').replaceChildren(...(pages.length ? pages.map((p) => h('div', { class: 'hbar' },
    h('span', {}, p.path === '/' ? 'Home' : p.path), h('b', {}, `${num(p.n)} ${p.n === 1 ? 'person' : 'people'}`),
    h('span', { class: 'hbar-t' }, h('span', { style: `width:${(p.n / top) * 100}%` })))) : [h('div', { class: 'empty-c', style: 'height:180px' }, 'Nobody is on the website right now.')]));

  $('dash-updated').textContent = 'Live · updated ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ---------- lists (requests, live plans, customers) ----------
function monthSelect(name) {
  return h('select', { name, 'aria-label': 'Length' }, MONTHS.map((m) => h('option', { value: String(m) }, m === 1 ? '1 month' : `${m} months`)));
}
function who(p) {
  return h('div', { class: 'who' }, h('strong', {}, p.full_name || '(no name)'), h('a', { href: 'mailto:' + p.email }, p.email),
    p.phone ? h('a', { href: 'https://wa.me/' + p.phone.replace(/[^\d]/g, '') }, p.phone) : null, p.company ? h('span', {}, p.company) : null,
    p.gender ? h('span', {}, GENDER[p.gender] || '') : null, p.address ? h('span', {}, p.address) : null);
}
async function act(fn, args, done) {
  setStatus(status, 'Saving…');
  const { error } = await supabase.rpc(fn, args);
  if (error) return setStatus(status, friendlyError(error), 'error');
  setStatus(status, done, 'ok');
  await refreshAll();
}
const PAY_LABEL = { awaiting: 'Not paid yet', submitted: 'Receipt to check', rejected: 'Asked to re-check', verified: 'Paid' };
const PAY_KIND = { awaiting: 'soon', submitted: 'check', rejected: 'ended', verified: 'live' };
const withVat = (n) => Math.round(n * 105) / 100;
const money = (n) => 'AED ' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

async function openReceipt(path, btn) {
  btn.disabled = true;
  const { data, error } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 600);
  btn.disabled = false;
  if (error) return setStatus(status, 'Could not open the receipt. Please try again.', 'error');
  window.open(data.signedUrl, '_blank', 'noopener');
}

async function emailCustomer(event, id) {
  try {
    const { data } = await supabase.auth.getSession();
    const r = await fetch('/api/payment-event', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ event, subscription_id: id }) });
    return r.ok;
  } catch { return false; }
}

async function decide(fn, args, event, id, done) {
  setStatus(status, 'Saving…');
  const { error } = await supabase.rpc(fn, args);
  if (error) return setStatus(status, friendlyError(error), 'error');
  const sent = await emailCustomer(event, id);
  setStatus(status, done + (sent ? ' The customer has been emailed.' : ' (The email could not be sent — please message the customer.)'), sent ? 'ok' : 'error');
  await refreshAll();
}

function renderPending() {
  const order = { submitted: 0, rejected: 1, awaiting: 2, verified: 3 };
  const all = subs.filter((x) => x.status === 'pending').sort((a, b) => (order[a.pay_status] ?? 9) - (order[b.pay_status] ?? 9));
  const rows = all.filter((x) => matches(person(x.user_id)) || (query && (x.ref_no || '').toLowerCase().includes(query)));
  const toCheck = all.filter((x) => x.pay_status === 'submitted').length;
  $('pending-count').textContent = String(all.length);
  const badge = $('nav-pending'); badge.textContent = String(toCheck || all.length); badge.toggleAttribute('data-zero', !all.length);
  $('pending-list').replaceChildren(...(rows.length ? rows.map((x) => {
    const p = person(x.user_id);
    const price = (plans.find((pl) => pl.id === x.plan_id) || {}).price_aed || 0;
    const months = x.months || 1;
    const total = withVat(price * months);
    const who2 = p.full_name || p.email;
    const startInput = h('input', { type: 'date', name: 'start', required: true, value: dubaiToday() });
    const acts = h('form', { class: 'acts', onsubmit: (e) => {
      e.preventDefault();
      if (!confirm(`Confirm you received ${money(total)} for ${x.ref_no} in the bank?`)) return;
      decide('verify_payment', { p_subscription: x.id, p_starts_on: startInput.value }, 'verified', x.id, `Payment received. ${planName(x.plan_id)} is now live for ${who2}. Sale recorded.`);
    } },
      h('label', {}, 'Start', startInput),
      h('button', { type: 'submit', class: 'b' }, 'Payment received ✓'),
      x.pay_status === 'submitted' ? h('button', { type: 'button', class: 'b b-ghost', onclick: () => {
        const reason = prompt(`Payment ${x.ref_no} not found. Optional note for the customer (e.g. "No transfer with this reference yet"):`, '');
        if (reason === null) return;
        decide('reject_payment', { p_subscription: x.id, p_reason: reason }, 'rejected', x.id, `Marked as not received. ${who2} was asked to check the transfer.`);
      } }, 'Not received') : null,
      h('button', { type: 'button', class: 'b b-danger', onclick: () => confirm('Decline this request?') && act('cancel_subscription', { p_subscription: x.id }, 'Request declined.') }, 'Decline'));
    return h('li', { class: 'row' + (x.pay_status === 'submitted' ? ' row-hot' : '') }, who(p),
      h('div', { class: 'plan' },
        h('span', { class: 'plan-n' }, `${planName(x.plan_id)} · ${months === 1 ? '1 month' : months + ' months'}`),
        h('span', {}, h('strong', {}, money(total)), ` incl. VAT · Ref `, h('strong', {}, x.ref_no || '—')),
        h('span', { class: 'pill', 'data-kind': PAY_KIND[x.pay_status] || 'soon' }, PAY_LABEL[x.pay_status] || x.pay_status),
        x.proof_path ? h('button', { type: 'button', class: 'b b-ghost b-sm', onclick: (e) => openReceipt(x.proof_path, e.currentTarget) }, 'View receipt') : null,
        x.proof_note ? h('q', {}, x.proof_note) : null,
        x.note ? h('q', {}, x.note) : null,
        h('span', { class: 'muted' }, `Requested ${fmtDate(x.requested_at)}${x.proof_submitted_at ? ' · receipt ' + fmtDate(x.proof_submitted_at) : ''}`)),
      acts);
  }) : [h('li', { class: 'empty' }, query ? 'No requests match your search.' : 'No plan requests or payments waiting. You are all caught up.')]));
}
function renderActive() {
  const today = dubaiToday();
  const all = subs.filter((x) => x.status === 'active');
  const rows = all.filter((x) => matches(person(x.user_id))).sort((a, b) => a.ends_on.localeCompare(b.ends_on));
  $('active-count').textContent = String(all.length);
  $('active-list').replaceChildren(...(rows.length ? rows.map((x) => {
    const p = person(x.user_id);
    const left = daysBetween(today, x.ends_on) + 1;
    const form = h('form', { class: 'acts', onsubmit: (e) => {
      e.preventDefault(); const m = Number(e.currentTarget.months.value);
      act('extend_subscription', { p_subscription: x.id, p_months: m }, `Extended by ${m} month${m === 1 ? '' : 's'}. Renewal recorded.`);
    } },
      h('label', {}, 'Extend by', monthSelect('months')),
      h('button', { type: 'submit', class: 'b' }, 'Extend'),
      h('button', { type: 'button', class: 'b b-danger', onclick: () => confirm(`Cancel ${p.full_name || p.email}'s plan now?`) && act('cancel_subscription', { p_subscription: x.id }, 'Plan cancelled.') }, 'Cancel plan'));
    return h('li', { class: 'row' }, who(p),
      h('div', { class: 'plan' }, h('span', { class: 'plan-n' }, planName(x.plan_id)),
        h('span', {}, `${fmtDate(x.starts_on)} – ${fmtDate(x.ends_on)}`),
        h('span', { class: 'pill', 'data-kind': left <= 0 ? 'ended' : left <= 7 ? 'soon' : 'live' }, left <= 0 ? 'Ended' : `${left} day${left === 1 ? '' : 's'} left`)),
      form);
  }) : [h('li', { class: 'empty' }, query ? 'No live plans match your search.' : 'No live plans yet.')]));
}
function renderCustomers() {
  const rows = people.filter(matches);
  $('customer-count').textContent = String(people.length);
  $('customer-list').replaceChildren(...(rows.length ? rows.map((p) => {
    const mine = subs.filter((x) => x.user_id === p.id);
    const open = mine.find((x) => x.status === 'active' || x.status === 'pending');
    const last = mine[0];
    let label = 'No plan yet';
    if (open) label = `${planName(open.plan_id)} · ${open.status === 'active' ? 'live until ' + fmtDate(open.ends_on) : (PAY_LABEL[open.pay_status] || 'waiting').toLowerCase()}`;
    else if (last) label = `${planName(last.plan_id)} · ${last.status}`;
    return h('li', { class: 'row row-sm' }, who(p), h('span', {}, `Joined ${fmtDate(p.created_at)}`), h('span', {}, label));
  }) : [h('li', { class: 'empty' }, 'No customers match your search.')]));
}
function renderLists() { renderPending(); renderActive(); renderCustomers(); }

// ---------- data ----------
async function loadLists() {
  const [pl, pr, sb] = await Promise.all([
    supabase.from('plans').select('id, name, price_aed').order('sort'),
    supabase.from('profiles').select('id, email, full_name, phone, company, address, gender, created_at').order('created_at', { ascending: false }).limit(1000),
    supabase.from('subscriptions').select('id, user_id, plan_id, status, note, requested_at, starts_on, ends_on, months, ref_no, pay_status, proof_path, proof_note, proof_submitted_at, reject_reason').order('requested_at', { ascending: false }).limit(2000),
  ]);
  const err = pl.error || pr.error || sb.error;
  if (err) throw err;
  plans = pl.data; people = pr.data; subs = sb.data;
}
async function loadStats() {
  const { data, error } = await supabase.rpc('admin_stats');
  if (error) { $('dash-updated').textContent = 'Stats unavailable: ' + friendlyError(error); return; }
  stats = data;
}
async function refreshAll() {
  try { await Promise.all([loadLists(), loadStats()]); renderLists(); renderOverview(); }
  catch (err) { setStatus(status, friendlyError(err), 'error'); }
}
async function refreshStats() { await loadStats(); renderOverview(); }

// ---------- wiring ----------
$('admin-search').addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); renderLists(); });
$('logout').addEventListener('click', signOut);
$('refresh').addEventListener('click', refreshAll);
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(renderOverview, 150); });

const links = [...document.querySelectorAll('.side-nav a')];
const io = new IntersectionObserver((es) => es.forEach((en) => {
  if (en.isIntersecting) links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + en.target.id));
}), { rootMargin: '-30% 0px -60% 0px' });
['overview', 'requests', 'live', 'customers'].forEach((id) => $(id) && io.observe($(id)));

// Test hook: lets the local preview render with sample numbers (never used on the live site).
if (window.__ADMIN_PREVIEW__) {
  ({ plans, people, subs, stats } = window.__ADMIN_PREVIEW__);
  $('admin-app').hidden = false; renderLists(); renderOverview();
} else {
  const session = await requireSession('/admin');
  if (session) {
    $('side-user').textContent = session.user.email || '';
    const { data: isAdmin, error } = await supabase.rpc('is_admin');
    if (error || !isAdmin) {
      $('admin-denied').hidden = false;
      $('dash-updated').textContent = 'No access';
    } else {
      $('admin-app').hidden = false;
      await refreshAll();
      setInterval(() => { if (!document.hidden) refreshStats(); }, 15000);
      setInterval(() => { if (!document.hidden) loadLists().then(() => { renderLists(); renderOverview(); }).catch(() => {}); }, 60000);
    }
  }
}
