// Public Supabase settings. The anon key is safe to ship to browsers: every table is protected
// by row-level security (see supabase/migrations). Never put the service-role key here.
export const SUPABASE_URL = 'https://gmqcrxeylvexxlobavfo.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_Epp3JeJzP42a1ORQAnLV_w_qZbEUX_M';

// Bank transfer details shown on the payment step (also in api/_payments.mjs for emails).
export const BANK = {
  holder: 'LAVEESHO LLC FZ',
  bank: 'Mashreq Bank',
  account: '019102240048',
  iban: 'AE260330000019102240048',
};
export const VAT_RATE = 0.05;
