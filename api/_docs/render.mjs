// Builds the filled-in Tax Invoice and Payment Receipt (Laveesho templates) and prints them to PDF.
// The HTML mirrors invoice.html / payment-receipt.html from ~/Desktop/Laveesho/invoices, with the blank
// lines replaced by real values. Fonts and logo are embedded so the PDF looks the same everywhere.

import { readFileSync } from 'node:fs';
import { BANK } from '../_payments.mjs';

const here = (f) => new URL(f, import.meta.url);
const b64 = (f) => readFileSync(here(f)).toString('base64');
let ASSETS;
function assets() {
  if (ASSETS) return ASSETS;
  const font = (f) => `url(data:font/woff2;base64,${b64('fonts/' + f)}) format('woff2')`;
  let css = readFileSync(here('doc.css'), 'utf8')
    .replace("url(assets/fonts/instrument-serif.woff2) format('woff2')", font('instrument-serif.woff2'))
    .replace("url(assets/fonts/instrument-serif-italic.woff2) format('woff2')", font('instrument-serif-italic.woff2'))
    .replace("url(assets/fonts/inter-tight.woff2) format('woff2')", font('inter-tight.woff2'))
    .replace("url(assets/fonts/montserrat.woff2) format('woff2')", font('montserrat.woff2'));
  ASSETS = { css, receiptCss: readFileSync(here('receipt.css'), 'utf8'), logo: `data:image/webp;base64,${b64('logo-dark-600.webp')}` };
  return ASSETS;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n2 = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtDate = (iso) => new Date(String(iso).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const plusMonths = (iso, m) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + m); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

// "Nine Thousand Four Hundred Fifty Dirhams Only" (fils included when present)
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function words(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  for (const [v, name] of [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand'], [100, 'Hundred']]) {
    if (n >= v) { parts.push(words(Math.floor(n / v)) + ' ' + name); n %= v; }
  }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '')); }
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(' ');
}
export function amountInWords(aed) {
  const dir = Math.floor(aed + 1e-9);
  const fils = Math.round((aed - dir) * 100);
  return `UAE Dirhams ${words(dir)}${fils ? ` and ${words(fils)} Fils` : ''} Only`;
}

function shell(title, body, extraCss = '') {
  const a = assets();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${a.css}
html,body{background:#fff}
.v-strong{font-family:var(--tight);font-weight:700}
td .item{font-size:9.4pt}
${extraCss}</style></head><body>${body}</body></html>`;
}

function header(a, kind, no) {
  const isInv = kind === 'invoice';
  return `<div class="ribbon"></div>
  <div class="head">
    <div>
      <img class="logo" src="${a.logo}" alt="Laveesho">
      <div class="from"><b>Laveesho L.L.C-FZ</b>Office A2, The Citadel Tower, Marasi Drive<br>Business Bay, Dubai, U.A.E</div>
    </div>
    <div class="title">
      <div class="eyebrow">${isInv ? 'Tax invoice' : 'Payment receipt'}</div>
      <h1>${isInv ? 'In<em>voice</em>' : 'Re<em>ceipt</em>'}</h1>
      <div class="docno"># ${esc(no)}</div>
      <div class="status paid">Paid</div>
    </div>
  </div>`;
}

function partyLines(d) {
  return [d.company, d.address, [d.phone, d.email].filter(Boolean).join(' · ')].filter(Boolean).map(esc).join('<br>');
}

// d: { invoice_no, receipt_no, issued_on, paid_on, ref_no, plan_name, months, rate, subtotal, vat, total,
//      full_name, company, address, phone, email, starts_on, proof_note }
export function invoiceHtml(d) {
  const a = assets();
  const period = d.starts_on ? `${fmtDate(d.starts_on)} – ${fmtDate(plusMonths(d.starts_on, d.months))}` : '';
  const desc = `Monthly digital marketing retainer${period ? ` · Service period ${period}` : ''}`;
  const body = `<div class="page">
  ${header(a, 'invoice', d.invoice_no)}
  <div class="band">
    <div class="party">
      <div class="k">Bill to</div>
      <b>${esc(d.full_name || d.email)}</b>
      <p>${partyLines(d)}</p>
    </div>
    <div class="facts">
      <div><div class="k">Invoice date</div><div class="v">${esc(fmtDate(d.issued_on))}</div></div>
      <div><div class="k">Due date</div><div class="v">${esc(fmtDate(d.issued_on))}</div></div>
      <div><div class="k">Terms</div><div class="v">Paid in advance</div></div>
      <div><div class="k">Currency</div><div class="v">AED</div></div>
    </div>
  </div>
  <div class="subject"><b>Subject:</b> ${esc(`${d.plan_name} plan · ${d.months === 1 ? '1 month' : d.months + ' months'} · Payment ref ${d.ref_no}`)}</div>
  <table>
    <thead><tr><th>#</th><th class="l">Item &amp; description</th><th>Qty</th><th>Rate</th><th>Taxable</th><th>VAT</th><th>Amount</th></tr></thead>
    <tbody>
      <tr><td>1</td><td class="l"><span class="item">${esc(d.plan_name)}</span><span class="desc">${esc(desc)}</span></td>
        <td>${d.months}<span class="rate">month${d.months === 1 ? '' : 's'}</span></td><td>${n2(d.rate)}</td><td>${n2(d.subtotal)}</td>
        <td>${n2(d.vat)}<span class="rate">5%</span></td><td class="v-strong">${n2(d.total)}</td></tr>
    </tbody>
  </table>
  <div class="sum">
    <div class="words">
      <div class="k">Amount in words</div>
      <b>${esc(amountInWords(d.total))}</b>
      <div class="taxsum">
        <div class="k">Tax summary</div>
        <table>
          <thead><tr><th class="l" style="width:auto">Tax details</th><th>Taxable (AED)</th><th>VAT (AED)</th></tr></thead>
          <tbody><tr><td>Standard rate (5%)</td><td>${n2(d.subtotal)}</td><td>${n2(d.vat)}</td></tr><tr><td>Zero rate (0%)</td><td>0.00</td><td>0.00</td></tr></tbody>
          <tfoot><tr><td>Total</td><td>${n2(d.subtotal)}</td><td>${n2(d.vat)}</td></tr></tfoot>
        </table>
      </div>
    </div>
    <div class="totals">
      <div><span>Sub total</span><span>${n2(d.subtotal)}</span></div>
      <div><span>VAT 5%</span><span>${n2(d.vat)}</span></div>
      <div class="grand"><span>Total</span><span>AED ${n2(d.total)}</span></div>
      <div><span>Payment made</span><span>(−) ${n2(d.total)}</span></div>
      <div class="balance"><span class="k">Balance due</span><b><small>AED</small>0.00</b></div>
    </div>
  </div>
  <div class="info">
    <div class="card">
      <h4>Bank <em>details</em></h4>
      <dl>
        <dt>Beneficiary</dt><dd>${esc(BANK.holder)}</dd>
        <dt>Bank</dt><dd>${esc(BANK.bank)}</dd>
        <dt>Account no.</dt><dd>${esc(BANK.account)}</dd>
        <dt>IBAN</dt><dd>${esc(BANK.iban)}</dd>
      </dl>
    </div>
    <div class="card">
      <h4>Terms &amp; <em>notes</em></h4>
      <p>Paid in full by bank transfer on ${esc(fmtDate(d.paid_on))} (ref ${esc(d.ref_no)}). Receipt ${esc(d.receipt_no)} is attached.</p>
      <p>All cheques should be made payable to Laveesho L.L.C-FZ. Work for the next period starts once the next invoice is settled.</p>
    </div>
  </div>
  <div class="thanks">
    <div class="big">Thank you for <em>growing</em> with us.</div>
    <div class="sig"><div class="line">Authorised signature</div></div>
  </div>
  <div class="foot"><span>business@laveesho.com</span><span>+971 50 394 0721</span><span>laveesho.com</span></div>
</div>`;
  return shell(`Tax Invoice ${d.invoice_no}`, body);
}

export function receiptHtml(d) {
  const a = assets();
  const body = `<div class="page">
  ${header(a, 'receipt', d.receipt_no)}
  <div class="received">
    <div class="rows">
      <div><span class="k">Payment date</span><span class="v">${esc(fmtDate(d.paid_on))}</span></div>
      <div><span class="k">Payment mode</span><span class="v">Bank transfer · ${esc(BANK.bank)}</span></div>
      <div><span class="k">Reference no.</span><span class="v">${esc(d.ref_no)}${d.proof_note ? ` · ${esc(d.proof_note).slice(0, 40)}` : ''}</span></div>
      <div><span class="k">Against invoice</span><span class="v">${esc(d.invoice_no)}</span></div>
    </div>
    <div class="amount">
      <div class="k">Amount received</div>
      <div><small>AED</small><b>${n2(d.total)}</b></div>
      <div class="w">Amount in words<br><b style="font-family:var(--tight);font-size:8pt;font-weight:700;margin:0;display:block;line-height:1.4">${esc(amountInWords(d.total))}</b></div>
    </div>
  </div>
  <div class="from-box">
    <div class="party">
      <div class="k">Received from</div>
      <b>${esc(d.full_name || d.email)}</b>
      <p>${partyLines(d)}</p>
    </div>
    <div class="party">
      <div class="k">Received by</div>
      <b>Laveesho L.L.C-FZ</b>
      <p>Accounts team<br>business@laveesho.com</p>
    </div>
  </div>
  <div class="stamp"><b>PAID</b><span>Laveesho</span></div>
  <h3 class="sec">Payment <em>for</em></h3>
  <table>
    <thead><tr><th>#</th><th class="l">Invoice number</th><th class="l">Invoice date</th><th>Invoice amount</th><th>Payment amount</th></tr></thead>
    <tbody><tr><td>1</td><td class="l"><span class="item">${esc(d.invoice_no)}</span><span class="desc">${esc(d.plan_name)} · ${d.months === 1 ? '1 month' : d.months + ' months'}</span></td>
      <td class="l">${esc(fmtDate(d.issued_on))}</td><td>${n2(d.total)}</td><td class="v-strong">${n2(d.total)}</td></tr></tbody>
  </table>
  <div class="sum">
    <div class="words">
      <div class="k">Note</div>
      This receipt confirms payment against the invoice above. Please keep it for your records.
    </div>
    <div class="totals">
      <div><span>Invoice total</span><span>${n2(d.total)}</span></div>
      <div><span>Amount received</span><span>${n2(d.total)}</span></div>
      <div class="grand"><span>Balance due</span><span>AED 0.00</span></div>
    </div>
  </div>
  <div class="thanks">
    <div class="big">Payment received, <em>thank you.</em></div>
    <div class="sig"><div class="line">Authorised signature</div></div>
  </div>
  <div class="foot"><span>business@laveesho.com</span><span>+971 50 394 0721</span><span>laveesho.com</span></div>
</div>`;
  return shell(`Payment Receipt ${d.receipt_no}`, body, a.receiptCss);
}

// Print HTML pages to PDF with headless Chromium (Vercel: @sparticuz/chromium; locally: CHROME_PATH).
export async function toPdfs(htmls) {
  const puppeteer = (await import('puppeteer-core')).default;
  let executablePath = process.env.CHROME_PATH;
  let args = ['--no-sandbox', '--font-render-hinting=none'];
  if (!executablePath) {
    const chromium = (await import('@sparticuz/chromium')).default;
    executablePath = await chromium.executablePath();
    args = chromium.args;
  }
  const browser = await puppeteer.launch({ executablePath, args, headless: true });
  try {
    const out = [];
    for (const html of htmls) {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
      await page.evaluate(() => document.fonts.ready);
      out.push(Buffer.from(await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true })));
      await page.close();
    }
    return out;
  } finally {
    await browser.close();
  }
}
