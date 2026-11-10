// Shared helpers for the login, account and admin pages.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});

export const WHATSAPP = 'https://wa.me/971503940721';

// Build DOM safely: text is always set with textContent, never parsed as HTML.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function fmtAED(n) {
  return 'AED ' + Number(n).toLocaleString('en-US');
}

// Today's date in Dubai as YYYY-MM-DD (plans run on Dubai calendar days).
export function dubaiToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
}

export function daysBetween(fromIso, toIso) {
  const a = Date.parse(fromIso + 'T00:00:00Z');
  const b = Date.parse(toIso + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

// Only allow redirects to paths on this site.
export function safeNext(value, fallback = '/account') {
  return typeof value === 'string' && /^\/(?!\/)[\w\-/?=&.%]*$/.test(value) ? value : fallback;
}

// Friendly text for Supabase errors; never show raw SQL or stack traces.
export function friendlyError(err) {
  const msg = (err && (err.message || err.error_description)) || '';
  if (/Invalid login credentials/i.test(msg)) return 'That email and password don’t match. Try again or reset your password.';
  if (/Email not confirmed/i.test(msg)) return 'Please confirm your email first. Check your inbox for the link we sent.';
  if (/User already registered/i.test(msg)) return 'An account with this email already exists. Log in instead.';
  if (/Password should be at least/i.test(msg)) return 'Your password needs at least 8 characters.';
  if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Please wait a minute and try again.';
  if (/subscriptions_one_open_per_user|duplicate key/i.test(msg)) return 'You already have a plan request or a live plan.';
  if (/Admins only/i.test(msg)) return 'You don’t have permission to do that.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Can’t reach the server. Check your connection and try again.';
  if (/not found|not pending|not extendable|already closed|another open plan|Months must be|Start date/i.test(msg)) return msg + '.';
  return 'Something went wrong. Please try again, or WhatsApp us on +971 50 394 0721.';
}

export function setStatus(el, text, kind = 'info') {
  el.textContent = text || '';
  el.dataset.kind = kind;
  el.hidden = !text;
}

export async function requireSession(next) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    location.replace('/login?next=' + encodeURIComponent(next || location.pathname));
    return null;
  }
  return data.session;
}

export async function signOut() {
  await supabase.auth.signOut();
  location.href = '/';
}

// Contact number fields: allow only digits, one leading +, spaces, brackets and dashes.
export function phoneOnly(input) {
  if (!input) return;
  input.setAttribute('inputmode', 'tel');
  input.setAttribute('pattern', '\\+?[0-9 ()\\-]{7,30}');
  const clean = () => {
    const v = input.value;
    let c = v.replace(/[^\d+\s()-]/g, '');
    c = c.charAt(0) + c.slice(1).replace(/\+/g, '');
    if (c !== v) {
      const pos = Math.max(0, (input.selectionStart || c.length) - (v.length - c.length));
      input.value = c;
      try { input.setSelectionRange(pos, pos); } catch {}
    }
  };
  input.addEventListener('input', clean);
  clean();
}
export function validPhone(v) {
  const t = (v || '').trim();
  const digits = t.replace(/\D/g, '').length;
  return /^\+?[\d\s()-]+$/.test(t) && digits >= 7 && digits <= 15;
}
