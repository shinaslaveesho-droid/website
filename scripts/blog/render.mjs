// Renders the Laveesho blog from blog/posts.json into static HTML, RSS, sitemap and llms.txt.
// usage: node scripts/blog/render.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
export const POSTS_FILE = path.join(ROOT, 'blog', 'posts.json');
const SITE = 'https://laveesho.com';
const OG_DEFAULT = `${SITE}/assets/og-blog.jpg`;
const AUTHOR = { name: 'Mohammad Aquib', title: 'Founder & CEO, Laveesho', url: `${SITE}/about` };
const STATIC_PAGES = [
  ['/', 'Home'], ['/services', 'Services'], ['/about', 'About'], ['/pricing', 'Pricing'], ['/blog', 'Blog'], ['/contact', 'Contact'], ['/privacy', 'Privacy']
];
const CAT_COLOURS = {
  'AI tools': ['#4A1FD1', '#F5EEDC'], 'SEO': ['#2F55F0', '#F5EEDC'], 'AEO & GEO': ['#BF0D65', '#F5EEDC'], 'Social media': ['#D94FC4', '#0A0B22'],
  'Paid ads': ['#F2C94C', '#0A0B22'], 'Branding': ['#0A0B22', '#F5EEDC'], 'Marketing trends': ['#2A0F8F', '#F5EEDC'], 'Dubai market': ['#F2C94C', '#0A0B22']
};

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 80);
const fmtDate = iso => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const rfc822 = iso => new Date(iso + 'T05:00:00Z').toUTCString();
const stripTags = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
export const wordCount = post => stripTags([post.quickAnswer, ...(post.keyTakeaways || []), ...post.sections.map(s => s.heading + ' ' + s.html), ...post.faq.map(f => f.question + ' ' + f.answer)].join(' ')).split(' ').filter(Boolean).length;

// Keep only the tags the format allows; drop event handlers and javascript: URLs.
export function sanitize(html) {
  return String(html)
    .replace(/<\s*(script|style|iframe|object|embed|img|svg|form|input|link|meta)[^>]*>[\s\S]*?(<\s*\/\s*\1\s*>|$)/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|img|svg|form|input|link|meta)[^>]*\/?>/gi, '')
    .replace(/\s(on\w+|style|class|id)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/href\s*=\s*(["']?)\s*javascript:[^"'>\s]*\1/gi, 'href="#"')
    .replace(/<a\s+href="(https?:\/\/(?!laveesho\.com)[^"]+)"/gi, '<a href="$1" rel="noopener" target="_blank"');
}

export function loadPosts() {
  if (!fs.existsSync(POSTS_FILE)) return [];
  const posts = JSON.parse(fs.readFileSync(POSTS_FILE, 'utf8'));
  return posts.sort((a, b) => (a.date < b.date ? 1 : -1));
}
export function savePosts(posts) {
  fs.mkdirSync(path.dirname(POSTS_FILE), { recursive: true });
  fs.writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2) + '\n');
}
export function uniqueSlug(base, posts) {
  let slug = slugify(base) || 'post';
  const taken = new Set(posts.map(p => p.slug));
  if (!taken.has(slug)) return slug;
  for (let i = 2; i < 100; i++) if (!taken.has(`${slug}-${i}`)) return `${slug}-${i}`;
  return `${slug}-${Date.now()}`;
}

// ---------- shared chrome ----------
function fontCss() {
  const about = fs.readFileSync(path.join(ROOT, 'about.html'), 'utf8');
  const m = about.match(/<style>(\/\* self-hosted fonts[\s\S]*?)<\/style>/);
  if (!m) throw new Error('font-face block not found in about.html');
  return m[1];
}

const BASE_CSS = `
body{margin:0}a{color:inherit}
.lx{--ink:#0A0B22;--inkm:#3E4366;--ivory:#F5EEDC;--royal:#4A1FD1;--orchid:#BF0D65;--gold:#F2C94C;--silver:#F4F8FD;font-family:Montserrat,'Montserrat Fallback',system-ui,sans-serif;color:var(--ink);background:var(--silver)}
.lx *{box-sizing:border-box}
.serif{font-family:"Instrument Serif",'Instrument Serif Fallback',Georgia,serif;font-weight:400;text-transform:uppercase;letter-spacing:-.005em;line-height:.86}
.ttl{font-family:"Instrument Serif",'Instrument Serif Fallback',Georgia,serif;font-weight:400;letter-spacing:-.012em;line-height:.98}
.eyebrow{font-size:12px;font-weight:600;letter-spacing:.3em;text-transform:uppercase}
.wrap{max-width:1320px;margin:0 auto;padding-left:clamp(16px,4vw,48px);padding-right:clamp(16px,4vw,48px)}
.g-pp{background:linear-gradient(100deg,#4A1FD1 0%,#BF0D65 50%,#2F55F0 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.btn{display:inline-flex;align-items:center;gap:12px;min-height:52px;padding:0 28px;border-radius:999px;text-decoration:none;font-family:"Inter Tight",'Inter Tight Fallback',sans-serif;font-weight:700;font-size:15px;transition:transform .45s cubic-bezier(.2,.8,.2,1),box-shadow .45s}
.btn:hover{transform:translateY(-3px);box-shadow:0 20px 40px -14px rgba(74,31,209,.5)}
.nl{text-decoration:none;font-size:14px;font-weight:500;padding:12px 2px;position:relative}
.nl::after{content:"";position:absolute;left:0;right:0;bottom:6px;height:1.5px;background:linear-gradient(90deg,#4A1FD1,#D94FC4);transform:scaleX(0);transform-origin:right;transition:transform .45s cubic-bezier(.2,.8,.2,1)}
.nl:hover::after{transform:scaleX(1);transform-origin:left}
.in{opacity:0;animation:inUp 1.1s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes inUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:none}}
.blob{position:absolute;border-radius:50%;filter:blur(60px);animation:morph 18s ease-in-out infinite alternate;pointer-events:none}
@keyframes morph{0%{transform:translate(0,0) scale(1)}50%{transform:translate(8%,-6%) scale(1.15)}100%{transform:translate(-6%,8%) scale(.92)}}
.bar{position:fixed;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#4A1FD1,#D94FC4,#F2C94C);transform-origin:left;transform:scaleX(0);z-index:50}
@supports (animation-timeline: view()){.bar{animation:gx linear both;animation-timeline:scroll(root)}}
@keyframes gx{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.menu-btn{display:none;width:48px;height:48px;border-radius:50%;border:1.5px solid currentColor;background:transparent;color:inherit;cursor:pointer;align-items:center;justify-content:center;flex:none}
.menu-panel{position:fixed;inset:0;z-index:100;background:linear-gradient(160deg,#2A0F8F 0%,#4A1FD1 45%,#BF0D65 100%);color:#F5EEDC;display:flex;flex-direction:column;gap:8px;padding:22px clamp(16px,5vw,32px) 32px;overflow-y:auto;animation:menuIn .4s cubic-bezier(.2,.8,.2,1) both;will-change:transform,opacity}
@keyframes menuIn{from{opacity:0;transform:translateY(-14px) scale(.985)}to{opacity:1;transform:none}}
.menu-panel .ml{font-family:"Instrument Serif",'Instrument Serif Fallback',Georgia,serif;text-transform:uppercase;font-size:clamp(28px,7.5vw,36px);line-height:1;text-decoration:none;color:#F5EEDC;padding:14px 0;border-bottom:1px solid rgba(245,238,220,.2);opacity:0;animation:inUp .6s cubic-bezier(.2,.8,.2,1) forwards}
@media (max-width:860px){.nav-desk,.nav-cta{display:none!important}.menu-btn{display:inline-flex}}
.totop{position:fixed;right:clamp(16px,3vw,36px);bottom:clamp(18px,3vw,34px);z-index:60;width:56px;height:56px;border-radius:50%;color:#0A0B22;display:flex;align-items:center;justify-content:center;text-decoration:none;isolation:isolate;box-shadow:0 18px 36px -14px rgba(242,201,76,.75);opacity:0;transform:translateY(18px) scale(.85);pointer-events:none;transition:transform .5s cubic-bezier(.2,.8,.2,1),opacity .4s,box-shadow .5s}
.totop.show{opacity:1;transform:none;pointer-events:auto}
.totop:not(.show)::before{animation:none}
.totop::before{content:"";position:absolute;inset:-4px;border-radius:50%;background:conic-gradient(from 0deg,#4A1FD1,#D94FC4,#F2C94C,#2F55F0,#4A1FD1);z-index:-2;animation:spin 7s linear infinite}
.totop::after{content:"";position:absolute;inset:0;border-radius:50%;background:#F2C94C;z-index:-1}
.totop svg{width:22px;height:22px}
@keyframes spin{to{transform:rotate(360deg)}}
@media (max-width:860px){.totop{width:48px;height:48px}.totop svg{width:20px;height:20px}}
/* cards */
.pcard{position:relative;display:flex;flex-direction:column;gap:14px;padding:26px;border-radius:26px;background:#fff;text-decoration:none;box-shadow:0 16px 40px -28px rgba(10,11,34,.35);transition:translate .6s cubic-bezier(.2,.8,.2,1),box-shadow .6s;isolation:isolate}
.pcard::before{content:"";position:absolute;inset:0;border-radius:inherit;padding:1.6px;background:linear-gradient(120deg,#4A1FD1,#D94FC4,#F2C94C);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;opacity:0;transition:opacity .5s;pointer-events:none}
.pcard:hover{translate:0 -8px;box-shadow:0 40px 70px -34px rgba(74,31,209,.5)}
.pcard:hover::before{opacity:1}
.pcard h2,.pcard h3{margin:0;font-family:"Instrument Serif",'Instrument Serif Fallback',Georgia,serif;font-weight:400;letter-spacing:-.01em;line-height:1.02;font-size:30px}
.pcard p{margin:0;color:var(--inkm);font-size:15px;line-height:1.6}
.pcard .meta{margin-top:auto;font-size:12.5px;color:var(--inkm);display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.pill{display:inline-block;padding:6px 12px;border-radius:999px;font-family:"Inter Tight",'Inter Tight Fallback',sans-serif;font-weight:800;font-size:11px;letter-spacing:.12em;text-transform:uppercase;width:max-content}
.pcard.feat{padding:clamp(28px,4vw,48px);background:linear-gradient(135deg,#2A0F8F,#4A1FD1 50%,#BF0D65);color:#F5EEDC}
.pcard.feat p,.pcard.feat .meta{color:rgba(245,238,220,.82)}
.pcard.feat h2{font-size:clamp(34px,4.6vw,64px)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:22px}
@media (hover:none){.pcard:hover{translate:none}}
@media (prefers-reduced-motion:reduce){.lx *{animation:none!important;transition:none!important}.lx .in{opacity:1}}
@media (hover:none),(max-width:860px){.blob{display:none}}
`;

const POST_CSS = `
.post-hero{position:relative;background:linear-gradient(180deg,#F7FAFE 0%,#DCE8F7 100%);overflow-x:clip}
.post-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:40px;padding-top:40px;padding-bottom:80px}
@media (min-width:1040px){.post-grid{grid-template-columns:250px minmax(0,740px);justify-content:center;gap:64px}}
.toc{font-size:14px;line-height:1.5}
.toc ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.toc a{text-decoration:none;color:var(--inkm);display:block;padding:6px 0 6px 14px;border-left:2px solid rgba(74,31,209,.18)}
.toc a:hover{color:var(--royal);border-color:var(--royal)}
@media (min-width:1040px){.toc{position:sticky;top:28px;align-self:start}.toc summary{display:none}.toc details>ol{display:flex!important}}
.toc details summary{cursor:pointer;font-weight:600;padding:12px 16px;border-radius:14px;background:#fff;list-style:none}
.toc details summary::-webkit-details-marker{display:none}
.toc details[open] summary{margin-bottom:10px}
.article{font-size:17.5px;line-height:1.72;color:var(--ink)}
.article p{margin:0 0 1.25em}
.article h2{font-family:"Instrument Serif",'Instrument Serif Fallback',Georgia,serif;font-weight:400;letter-spacing:-.012em;line-height:1.02;font-size:clamp(32px,3.6vw,46px);margin:1.6em 0 .55em;scroll-margin-top:28px}
.article h3{font-family:"Inter Tight",'Inter Tight Fallback',sans-serif;font-weight:700;font-size:21px;letter-spacing:-.01em;margin:1.5em 0 .5em}
.article ul,.article ol{margin:0 0 1.3em;padding-left:1.35em}
.article li{margin:0 0 .5em}
.article li::marker{color:var(--royal);font-weight:700}
.article a{color:var(--royal);text-decoration:underline;text-decoration-thickness:1.5px;text-underline-offset:3px;text-decoration-color:rgba(74,31,209,.4)}
.article a:hover{text-decoration-color:var(--royal)}
.article blockquote{margin:1.6em 0;padding:4px 0 4px 22px;border-left:4px solid var(--gold);font-family:"Instrument Serif",'Instrument Serif Fallback',Georgia,serif;font-size:1.35em;line-height:1.25;color:var(--ink)}
.article table{width:100%;border-collapse:collapse;font-size:15px;margin:0 0 1.5em;display:block;overflow-x:auto}
.article th,.article td{text-align:left;padding:10px 12px;border-bottom:1px solid rgba(10,11,34,.12);vertical-align:top}
.article th{font-family:"Inter Tight",'Inter Tight Fallback',sans-serif;font-weight:800;font-size:12px;letter-spacing:.1em;text-transform:uppercase}
.qa{position:relative;margin:0 0 36px;padding:26px 28px;border-radius:24px;background:linear-gradient(#fff,#fff) padding-box,linear-gradient(110deg,#4A1FD1,#D94FC4 55%,#F2C94C) border-box;border:2px solid transparent}
.qa .lbl{display:flex;align-items:center;gap:8px;margin:0 0 10px;font-family:"Inter Tight",'Inter Tight Fallback',sans-serif;font-weight:800;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--royal)}
.qa .lbl::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--gold);box-shadow:0 0 10px var(--gold)}
.qa p{margin:0;font-size:18px;line-height:1.6}
.kt{margin:0 0 40px;padding:26px 28px;border-radius:24px;background:#0A0B22;color:#F5EEDC}
.kt h2{margin:0 0 14px;font-family:"Inter Tight",'Inter Tight Fallback',sans-serif;font-weight:800;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--gold)}
.kt ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px}
.kt li{position:relative;padding-left:24px;font-size:16px;line-height:1.55}
.kt li::before{content:"";position:absolute;left:0;top:.5em;width:12px;height:12px;border-radius:50%;background:linear-gradient(135deg,#F2C94C,#D94FC4)}
.faq{margin-top:56px}
.faq h3{font-family:"Inter Tight",'Inter Tight Fallback',sans-serif;font-weight:700;font-size:19px;margin:0 0 8px}
.faq .qi{padding:20px 0;border-top:1px solid rgba(10,11,34,.12)}
.faq .qi p{margin:0;color:var(--inkm)}
.src{margin-top:48px;font-size:14px;color:var(--inkm)}
.src ol{padding-left:1.2em;margin:8px 0 0}
.src li{margin:0 0 6px}
.src a{color:var(--royal);word-break:break-word}
.author{display:flex;gap:18px;align-items:center;margin-top:48px;padding:22px 24px;border-radius:22px;background:#fff}
.author img{width:64px;height:64px;border-radius:50%;object-fit:cover;flex:none}
.author b{display:block;font-family:"Inter Tight",'Inter Tight Fallback',sans-serif;font-weight:800;font-size:16px}
.author p{margin:4px 0 0;font-size:14px;line-height:1.55;color:var(--inkm)}
.cta{margin-top:40px;padding:clamp(26px,4vw,40px);border-radius:28px;background:linear-gradient(120deg,#2A0F8F,#4A1FD1 50%,#BF0D65);color:#F5EEDC;display:flex;flex-wrap:wrap;gap:20px;align-items:center;justify-content:space-between}
.cta h2{margin:0;font-family:"Instrument Serif",'Instrument Serif Fallback',Georgia,serif;font-weight:400;font-size:clamp(28px,3.4vw,42px);line-height:1;letter-spacing:-.01em}
.cta p{margin:8px 0 0;color:rgba(245,238,220,.85);font-size:15px;max-width:520px}
.byline{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;font-size:14px;color:var(--inkm)}
.byline img{width:40px;height:40px;border-radius:50%}
.byline b{color:var(--ink);font-weight:600}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:36px}
.tags span{padding:7px 12px;border-radius:999px;background:#fff;font-size:12.5px;color:var(--inkm)}
.share{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}
.share a{display:inline-flex;align-items:center;gap:8px;min-height:40px;padding:0 16px;border-radius:999px;border:1.5px solid rgba(10,11,34,.18);text-decoration:none;font-size:13px;font-weight:600}
.share a:hover{border-color:var(--royal);color:var(--royal)}
`;

function pill(cat) {
  const [bg, fg] = CAT_COLOURS[cat] || ['#4A1FD1', '#F5EEDC'];
  return `<span class="pill" style="background:${bg};color:${fg}">${esc(cat)}</span>`;
}

function head({ title, description, url, image = OG_DEFAULT, jsonld, published, modified, extraCss = '', type = 'website' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta name="theme-color" content="#4A1FD1">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="Laveesho">
<meta property="og:locale" content="en_AE">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
${published ? `<meta property="article:published_time" content="${published}T05:00:00+04:00">\n<meta property="article:modified_time" content="${modified || published}T05:00:00+04:00">\n<meta property="article:author" content="${AUTHOR.url}">\n<meta name="author" content="${AUTHOR.name}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<link rel="alternate" type="application/rss+xml" title="Laveesho Insights" href="${SITE}/blog/feed.xml">
<link rel="icon" type="image/png" sizes="48x48" href="/assets/favicon-48.png">
<link rel="icon" type="image/png" sizes="512x512" href="/assets/favicon-512.png">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="preload" href="/assets/fonts/instrument-serif.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/inter-tight.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/montserrat.woff2" as="font" type="font/woff2" crossorigin>
<style>${fontCss()}</style>
<style>${BASE_CSS}${extraCss}</style>
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
</head>`;
}

function header() {
  return `<header class="wrap in" style="position: relative; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px 28px; padding-top: 22px; padding-bottom: 22px">
<a href="/" aria-label="Laveesho home" style="display: flex"><img width="600" height="161" fetchpriority="high" src="/assets/logo-dark-600.webp" alt="Laveesho — Building Digital Future" style="height: 46px; width: auto; display: block"></a>
<nav aria-label="Primary" class="nav-desk" style="display: flex; flex-wrap: wrap; gap: 4px 30px">
<a class="nl" href="/">Home</a><a class="nl" href="/services">Services</a><a class="nl" href="/about">About</a><a class="nl" href="/pricing">Pricing</a><a class="nl" href="/blog" aria-current="page" style="color: var(--royal)">Blog</a><a class="nl" href="/contact">Contact</a><a class="nl" href="/login" data-auth-link>Log in</a>
</nav>
<a class="btn nav-cta" href="/contact" style="background: var(--ink); color: #fff; min-height: 48px; padding: 0 22px">Start a project</a>
<button type="button" class="menu-btn" aria-label="Open menu" aria-expanded="false" data-on-click="toggleMenu"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 8h16M4 16h16"></path></svg></button>
</header>`;
}

function footer() {
  return `<footer style="background: #070F3D; color: #C9CCE8">
<div class="wrap" style="padding-top: 40px; padding-bottom: 32px; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 20px; font-size: 13px">
<img width="660" height="175" loading="lazy" decoding="async" src="/assets/logo-light-660.webp" alt="Laveesho" style="height: 44px; width: auto">
<span>The Citadel Tower, Business Bay, Dubai · business@laveesho.com · +971 50 394 0721</span>
<span>© ${new Date().getFullYear()} Laveesho · <a href="/privacy" style="color: inherit">Privacy</a> · <a href="/blog/feed.xml" style="color: inherit">RSS</a></span>
</div>
</footer>
</div>
<div data-if="menuOpen" style="display: none;">
<div class="menu-panel" role="dialog" aria-modal="true" aria-label="Menu">
<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px">
<img width="660" height="175" loading="lazy" decoding="async" src="/assets/logo-light-660.webp" alt="Laveesho" style="height: clamp(56px, 15vw, 84px); width: auto; max-width: 100%">
<button type="button" aria-label="Close menu" style="width: 48px; height: 48px; border-radius: 50%; border: 1.5px solid rgba(245,238,220,.6); background: transparent; color: #F5EEDC; cursor: pointer; display: flex; align-items: center; justify-content: center" data-on-click="toggleMenu"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button>
</div>
<nav aria-label="Mobile" style="display: flex; flex-direction: column">
<a class="ml" href="/" style="animation-delay: 0.12s" data-on-click="closeMenu">Home</a>
<a class="ml" href="/services" style="animation-delay: 0.19s" data-on-click="closeMenu">Services</a>
<a class="ml" href="/about" style="animation-delay: 0.26s" data-on-click="closeMenu">About</a>
<a class="ml" href="/pricing" style="animation-delay: 0.33s" data-on-click="closeMenu">Pricing</a>
<a class="ml" href="/blog" style="animation-delay: 0.37s; color: #F2C94C" data-on-click="closeMenu">Blog</a>
<a class="ml" href="/contact" style="animation-delay: 0.40s" data-on-click="closeMenu">Contact</a>
<a class="ml" href="/login" style="animation-delay: 0.47s" data-auth-link data-on-click="closeMenu">Log in</a>
</nav>
</div>
</div>
<script>(function(){var d=document.querySelector('.toc details');if(d&&matchMedia('(min-width:1040px)').matches)d.open=true;})();</script>
<a class="totop" href="#" aria-label="Back to top" data-on-click="toTop"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"></path><path d="M5 12l7-7 7 7"></path></svg></a>
<script src="/site.js" defer></script>
</body>
</html>`;
}

function card(p, feat = false) {
  return `<a class="pcard${feat ? ' feat' : ''}" href="/blog/${esc(p.slug)}">
${pill(p.category)}
${feat ? `<h2>${esc(p.title)}</h2>` : `<h3>${esc(p.title)}</h3>`}
<p>${esc(p.excerpt)}</p>
<span class="meta"><time datetime="${p.date}">${fmtDate(p.date)}</time> · ${p.readingMinutes} min read</span>
</a>`;
}

function sectionId(heading, i) { return slugify(heading).slice(0, 48) || `section-${i + 1}`; }

export function renderPost(post, posts) {
  const url = `${SITE}/blog/${post.slug}`;
  const image = post.image ? `${SITE}${post.image}` : OG_DEFAULT;
  const ids = post.sections.map((s, i) => sectionId(s.heading, i));
  const related = posts.filter(p => p.slug !== post.slug).sort((a, b) => (b.category === post.category) - (a.category === post.category)).slice(0, 3);
  const words = post.wordCount || wordCount(post);
  const jsonld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BlogPosting', '@id': `${url}#article`, headline: post.title, description: post.metaDescription, inLanguage: 'en',
        datePublished: `${post.date}T05:00:00+04:00`, dateModified: `${post.updated || post.date}T05:00:00+04:00`,
        author: { '@type': 'Person', '@id': `${SITE}/about#founder`, name: AUTHOR.name, jobTitle: 'Founder & CEO', url: AUTHOR.url, worksFor: { '@id': `${SITE}/#business` } },
        publisher: { '@type': 'Organization', '@id': `${SITE}/#business`, name: 'Laveesho', url: SITE, logo: { '@type': 'ImageObject', url: `${SITE}/assets/logo-dark.webp` } },
        mainEntityOfPage: { '@type': 'WebPage', '@id': url }, image: [image], keywords: (post.tags || []).join(', '), articleSection: post.category, wordCount: words,
        isPartOf: { '@id': `${SITE}/blog#blog` }, about: post.focusKeyword,
        citation: (post.sources || []).map(s => ({ '@type': 'CreativeWork', name: s.title, url: s.url, publisher: s.publisher })),
        speakable: { '@type': 'SpeakableSpecification', cssSelector: ['.qa p', '.kt li'] }
      },
      { '@type': 'FAQPage', '@id': `${url}#faq`, mainEntity: post.faq.map(f => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })) },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}/blog` },
        { '@type': 'ListItem', position: 3, name: post.title, item: url }
      ] }
    ]
  };
  const shareText = encodeURIComponent(post.title);
  const body = `
<body class="lx">
<div class="bar" aria-hidden="true"></div>
<div class="lx">
<section class="post-hero">
<div aria-hidden="true" style="position: absolute; inset: 0; overflow: hidden">
<div class="blob" style="width: 44vw; height: 44vw; right: -12vw; top: -14vw; background: radial-gradient(circle, #D8C6FF, rgba(216,198,255,0) 70%)"></div>
<div class="blob" style="width: 34vw; height: 34vw; left: -10vw; top: 10vw; background: radial-gradient(circle, #F7C9EC, rgba(247,201,236,0) 70%); animation-delay: -7s"></div>
</div>
${header()}
<div class="wrap" style="position: relative; z-index: 2; padding-top: clamp(28px, 5vw, 64px); padding-bottom: clamp(44px, 6vw, 80px); max-width: 980px">
<nav aria-label="Breadcrumb" class="in" style="font-size: 13px; color: var(--inkm); margin-bottom: 22px"><a href="/" style="text-decoration: none">Home</a> <span aria-hidden="true">›</span> <a href="/blog" style="text-decoration: none">Blog</a> <span aria-hidden="true">›</span> <span>${esc(post.category)}</span></nav>
<div class="in" style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 20px">${pill(post.category)}<span style="font-size: 13px; color: var(--inkm)">${post.readingMinutes} min read</span></div>
<h1 class="ttl in" style="margin: 0; font-size: clamp(38px, 6.2vw, 78px); animation-delay: .08s">${esc(post.title)}</h1>
<p class="in" style="margin: 22px 0 0; max-width: 720px; font-size: 18px; line-height: 1.6; color: var(--inkm); animation-delay: .18s">${esc(post.excerpt)}</p>
<div class="byline in" style="margin-top: 26px; animation-delay: .28s">
<img src="/assets/seal-3d-120.webp" width="120" height="120" alt="" loading="lazy" decoding="async">
<span>By <b><a href="/about" style="text-decoration: none">${AUTHOR.name}</a></b>, ${esc(AUTHOR.title)}</span>
<span>Published <time datetime="${post.date}">${fmtDate(post.date)}</time>${post.updated && post.updated !== post.date ? ` · Updated <time datetime="${post.updated}">${fmtDate(post.updated)}</time>` : ''}</span>
</div>
</div>
</section>

<section style="background: var(--silver)">
<div class="wrap post-grid">
<aside class="toc" aria-label="On this page">
<details>
<summary>On this page</summary>
<ol>
${post.sections.map((s, i) => `<li><a href="#${ids[i]}">${esc(s.heading)}</a></li>`).join('\n')}
<li><a href="#faq">Questions people ask</a></li>
</ol>
</details>
</aside>
<article class="article">
<div class="qa"><p class="lbl">Quick answer</p><p>${esc(post.quickAnswer)}</p></div>
<div class="kt"><h2>Key takeaways</h2><ul>${post.keyTakeaways.map(k => `<li>${esc(k)}</li>`).join('')}</ul></div>
${post.sections.map((s, i) => `<h2 id="${ids[i]}">${esc(s.heading)}</h2>\n${sanitize(s.html)}`).join('\n')}
<section class="faq" id="faq" aria-labelledby="faq-h">
<h2 id="faq-h">Questions people ask</h2>
${post.faq.map(f => `<div class="qi"><h3>${esc(f.question)}</h3><p>${esc(f.answer)}</p></div>`).join('\n')}
</section>
<div class="src"><strong>Sources</strong><ol>${(post.sources || []).map(s => `<li><a href="${esc(s.url)}" rel="noopener nofollow" target="_blank">${esc(s.title)}</a>${s.publisher ? ` · ${esc(s.publisher)}` : ''}${s.date ? ` · ${esc(s.date)}` : ''}</li>`).join('')}</ol></div>
<div class="tags">${(post.tags || []).map(t => `<span>#${esc(t)}</span>`).join('')}</div>
<div class="share">
<a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}" rel="noopener" target="_blank">Share on LinkedIn</a>
<a href="https://wa.me/?text=${shareText}%20${encodeURIComponent(url)}" rel="noopener" target="_blank">Share on WhatsApp</a>
<a href="https://x.com/intent/tweet?text=${shareText}&url=${encodeURIComponent(url)}" rel="noopener" target="_blank">Share on X</a>
</div>
<div class="author">
<img src="/assets/seal-3d-120.webp" width="120" height="120" alt="" loading="lazy" decoding="async">
<div><b>${AUTHOR.name}</b><p>Founder & CEO of Laveesho, a creative branding and digital marketing agency in Business Bay, Dubai. He leads strategy, video and brand work for clients across the UAE and GCC and writes here about what is changing in marketing, AI and search. <a href="/about">More about Laveesho</a> · <a href="/contact">Talk to him</a>.</p></div>
</div>
<div class="cta">
<div><h2>Want this done for your brand?</h2><p>Try Laveesho free for 7 days. We audit your search and AI visibility, fix the quick wins and show you the plan.</p></div>
<a class="btn" href="/pricing#sprint" style="background: #F2C94C; color: #0A0B22">Start the free 7-day sprint</a>
</div>
</article>
</div>
</section>

${related.length ? `<section style="background: #DCE8F7"><div class="wrap" style="padding-top: 56px; padding-bottom: 80px">
<p class="eyebrow" style="margin: 0 0 18px; color: var(--royal)">Keep reading</p>
<div class="grid">${related.map(p => card(p)).join('\n')}</div>
</div></section>` : ''}
${footer()}`;
  return head({ title: `${post.title} | Laveesho`, description: post.metaDescription, url, image, jsonld, published: post.date, modified: post.updated || post.date, extraCss: POST_CSS, type: 'article' }) + body;
}

export function renderIndex(posts) {
  const url = `${SITE}/blog`;
  const shown = posts.slice(0, 60);
  const [first, ...rest] = shown;
  const jsonld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Blog', '@id': `${url}#blog`, name: 'Laveesho Insights', url, description: 'Marketing, AI, SEO and social media news explained for Dubai and UAE businesses, from the Laveesho team.', inLanguage: 'en',
        publisher: { '@id': `${SITE}/#business` },
        blogPost: shown.map(p => ({ '@type': 'BlogPosting', headline: p.title, url: `${SITE}/blog/${p.slug}`, datePublished: `${p.date}T05:00:00+04:00`, author: { '@type': 'Person', name: AUTHOR.name } })) },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: url } ] }
    ]
  };
  const body = `
<body class="lx">
<div class="lx">
<section class="post-hero" style="position: relative; background: linear-gradient(180deg, #F7FAFE 0%, #DCE8F7 100%); overflow-x: clip">
<div aria-hidden="true" style="position: absolute; inset: 0; overflow: hidden">
<div class="blob" style="width: 50vw; height: 50vw; right: -14vw; top: -12vw; background: radial-gradient(circle, #D8C6FF, rgba(216,198,255,0) 70%)"></div>
<div class="blob" style="width: 40vw; height: 40vw; left: -10vw; top: 18vw; background: radial-gradient(circle, #F7C9EC, rgba(247,201,236,0) 70%); animation-delay: -7s"></div>
</div>
${header()}
<div class="wrap" style="position: relative; z-index: 2; padding-top: clamp(36px, 6vw, 90px); padding-bottom: clamp(50px, 7vw, 100px)">
<p class="eyebrow in" style="margin: 0 0 22px; color: var(--royal)">Laveesho Insights</p>
<h1 class="serif in" style="margin: 0; font-size: clamp(56px, 10vw, 150px); animation-delay: .08s">What's <span class="g-pp" style="font-style: italic">moving</span><br>in marketing.</h1>
<p class="in" style="margin: 28px 0 0; max-width: 620px; font-size: 18px; line-height: 1.65; color: var(--inkm); animation-delay: .22s">AI tools, Google and social platform changes, and what they mean for businesses in Dubai and the UAE. New post every few days, written by the Laveesho team, not a content farm.</p>
</div>
</section>
<section style="background: var(--silver)">
<div class="wrap" style="padding-top: 48px; padding-bottom: 96px; display: flex; flex-direction: column; gap: 22px">
${first ? card(first, true) : '<p>First post coming soon.</p>'}
${rest.length ? `<div class="grid">${rest.map(p => card(p)).join('\n')}</div>` : ''}
</div>
</section>
${footer()}`;
  return head({ title: 'Marketing, AI & SEO Insights for Dubai Businesses | Laveesho Blog', description: 'Fresh marketing, AI tool, SEO and social media news explained for Dubai and UAE businesses. Practical takes from the Laveesho team, updated every few days.', url, jsonld, extraCss: POST_CSS }) + body;
}

export function renderFeed(posts) {
  const items = posts.slice(0, 30).map(p => `<item>
<title>${esc(p.title)}</title>
<link>${SITE}/blog/${esc(p.slug)}</link>
<guid isPermaLink="true">${SITE}/blog/${esc(p.slug)}</guid>
<pubDate>${rfc822(p.date)}</pubDate>
<category>${esc(p.category)}</category>
<description>${esc(p.excerpt)}</description>
</item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>Laveesho Insights</title>
<link>${SITE}/blog</link>
<atom:link href="${SITE}/blog/feed.xml" rel="self" type="application/rss+xml"/>
<description>Marketing, AI, SEO and social media news explained for Dubai and UAE businesses.</description>
<language>en</language>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>
`;
}

export function renderSitemap(posts) {
  const file = path.join(ROOT, 'sitemap.xml');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const keep = [...existing.matchAll(/<url>[\s\S]*?<\/url>/g)].map(m => m[0]).filter(u => !/laveesho\.com\/blog/.test(u));
  const today = new Date().toISOString().slice(0, 10);
  const blog = [`  <url><loc>${SITE}/blog</loc><lastmod>${posts[0]?.updated || posts[0]?.date || today}</lastmod><changefreq>daily</changefreq></url>`,
    ...posts.map(p => `  <url><loc>${SITE}/blog/${esc(p.slug)}</loc><lastmod>${p.updated || p.date}</lastmod></url>`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${keep.map(u => '  ' + u.trim()).join('\n')}
${blog.join('\n')}
</urlset>
`;
}

export function renderLlms(posts) {
  return `# Laveesho

> Laveesho is a creative branding and digital marketing agency in The Citadel Tower, Business Bay, Dubai. Services: brand identity, social media, SEO and AI-search readiness, paid ads, websites and apps, video and motion. Monthly packages with a free 7-day Growth Sprint trial. Contact: business@laveesho.com, +971 50 394 0721.

## Pages
${STATIC_PAGES.map(([p, n]) => `- [${n}](${SITE}${p})`).join('\n')}

## Blog posts (newest first)
${posts.map(p => `- [${p.title}](${SITE}/blog/${p.slug}): ${p.excerpt} (${p.date})`).join('\n')}
`;
}

export function buildAll(posts = loadPosts()) {
  const dir = path.join(ROOT, 'blog');
  fs.mkdirSync(dir, { recursive: true });
  for (const p of posts) fs.writeFileSync(path.join(dir, `${p.slug}.html`), renderPost(p, posts));
  fs.writeFileSync(path.join(dir, 'index.html'), renderIndex(posts));
  fs.writeFileSync(path.join(dir, 'feed.xml'), renderFeed(posts));
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), renderSitemap(posts));
  fs.writeFileSync(path.join(ROOT, 'llms.txt'), renderLlms(posts));
  return posts.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const n = buildAll();
  console.log(`built blog: ${n} post(s)`);
}
