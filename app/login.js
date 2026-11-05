// Login / sign-up / forgot-password page.
import { supabase, friendlyError, setStatus, safeNext } from './auth.js';

const params = new URLSearchParams(location.search);
const next = safeNext(params.get('next'));
const $ = (id) => document.getElementById(id);
const status = $('auth-status');
const views = { login: $('view-login'), signup: $('view-signup'), forgot: $('view-forgot'), reset: $('view-reset'), sent: $('view-sent') };
let recovering = params.get('mode') === 'reset';

function show(name) {
  for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
  document.querySelectorAll('[data-tab]').forEach((t) => {
    const on = t.dataset.tab === name;
    t.setAttribute('aria-selected', on ? 'true' : 'false');
    t.tabIndex = on ? 0 : -1;
  });
  $('auth-tabs').hidden = !(name === 'login' || name === 'signup');
  setStatus(status, '');
  const first = views[name].querySelector('input');
  if (first && document.activeElement !== document.body) first.focus();
}

function busy(form, on) {
  form.querySelectorAll('button, input').forEach((el) => (el.disabled = on));
  form.setAttribute('aria-busy', on ? 'true' : 'false');
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') { recovering = true; show('reset'); return; }
  if (session && !recovering && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) location.replace(next);
});

document.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => show(t.dataset.tab)));
document.querySelectorAll('[data-go]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); show(a.dataset.go); }));

$('google-btn').addEventListener('click', async () => {
  setStatus(status, 'Opening Google…');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + '/login?next=' + encodeURIComponent(next) },
  });
  if (error) setStatus(status, friendlyError(error), 'error');
});

$('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  busy(f, true);
  const { error } = await supabase.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
  busy(f, false);
  if (error) setStatus(status, friendlyError(error), 'error');
});

$('form-signup').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  if (f.password.value.length < 8) return setStatus(status, 'Your password needs at least 8 characters.', 'error');
  busy(f, true);
  const { data, error } = await supabase.auth.signUp({
    email: f.email.value.trim(),
    password: f.password.value,
    options: { data: { full_name: f.full_name.value.trim() }, emailRedirectTo: location.origin + '/login?next=' + encodeURIComponent(next) },
  });
  busy(f, false);
  if (error) return setStatus(status, friendlyError(error), 'error');
  if (!data.session) { $('sent-text').textContent = `We sent a confirmation link to ${f.email.value.trim()}. Open it to finish creating your account.`; show('sent'); }
});

$('form-forgot').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  busy(f, true);
  const { error } = await supabase.auth.resetPasswordForEmail(f.email.value.trim(), { redirectTo: location.origin + '/login?mode=reset' });
  busy(f, false);
  if (error) return setStatus(status, friendlyError(error), 'error');
  $('sent-text').textContent = `If an account exists for ${f.email.value.trim()}, we've sent a link to reset your password.`;
  show('sent');
});

$('form-reset').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  if (f.password.value.length < 8) return setStatus(status, 'Your password needs at least 8 characters.', 'error');
  if (f.password.value !== f.confirm.value) return setStatus(status, 'The two passwords don’t match.', 'error');
  busy(f, true);
  const { error } = await supabase.auth.updateUser({ password: f.password.value });
  busy(f, false);
  if (error) return setStatus(status, friendlyError(error), 'error');
  recovering = false;
  location.replace('/account');
});

// Errors returned in the URL by Supabase (expired links, cancelled Google sign-in).
const urlErr = params.get('error_description') || new URLSearchParams(location.hash.slice(1)).get('error_description');
show(recovering ? 'reset' : params.get('mode') === 'signup' ? 'signup' : 'login');
if (urlErr) setStatus(status, /expired|invalid/i.test(urlErr) ? 'That link has expired. Please request a new one.' : 'Sign-in was cancelled or failed. Please try again.', 'error');
