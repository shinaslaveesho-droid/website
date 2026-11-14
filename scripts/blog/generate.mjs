// Researches one trending topic with web search, writes a post in Laveesho's voice, checks it for machine tells,
// stores it in blog/posts.json and rebuilds the blog. Runs in GitHub Actions (see .github/workflows/blog.yml).
// usage: ANTHROPIC_API_KEY=... node scripts/blog/generate.mjs   (env: TOPIC="optional angle", FORCE=1 to skip the 3-day gate)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { CATEGORIES, BANNED, researchPrompt, writeSystem, writeUser, revisePrompt } from './prompts.mjs';
import { loadPosts, savePosts, uniqueSlug, buildAll, wordCount } from './render.mjs';

const MODEL = 'claude-opus-5-5';
const MIN_GAP_DAYS = 2.75; // daily cron + this gate = one post every 3 days
const here = path.dirname(fileURLToPath(import.meta.url));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const PostSchema = z.object({
  title: z.string(),
  slug: z.string(),
  metaDescription: z.string(),
  excerpt: z.string(),
  category: z.enum(CATEGORIES),
  tags: z.array(z.string()),
  focusKeyword: z.string(),
  quickAnswer: z.string(),
  keyTakeaways: z.array(z.string()),
  sections: z.array(z.object({ heading: z.string(), html: z.string() })),
  faq: z.array(z.object({ question: z.string(), answer: z.string() })),
  sources: z.array(z.object({ title: z.string(), url: z.string(), publisher: z.string(), date: z.string().nullable() }))
});

function dubaiToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' }); // YYYY-MM-DD
}

function postText(p) {
  const strip = h => String(h).replace(/<[^>]+>/g, ' ');
  return [p.title, p.excerpt, p.quickAnswer, ...p.keyTakeaways, ...p.sections.flatMap(s => [s.heading, strip(s.html)]), ...p.faq.flatMap(f => [f.question, f.answer])]
    .join('\n\n').replace(/[ \t]+/g, ' ');
}

function findIssues(p) {
  const text = postText(p);
  const lower = text.toLowerCase();
  const issues = [];
  const hits = BANNED.filter(w => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i').test(lower));
  if (hits.length) issues.push(`Banned words/phrases used: ${hits.join(', ')}. Replace each with a plain alternative.`);
  const dashes = (text.match(/—|–/g) || []).length;
  if (dashes > 0) issues.push(`${dashes} em/en dash(es) found. Replace each with a full stop or comma.`);
  const words = wordCount(p);
  if (words < 1200) issues.push(`Only ${words} words. Expand the thinnest two sections with specifics from the research (target 1,300 to 1,800).`);
  if (words > 2000) issues.push(`${words} words. Cut repetition to land under 1,900.`);
  if (p.title.length > 62) issues.push(`Title is ${p.title.length} characters; cut to 60 or fewer.`);
  if (p.metaDescription.length > 158 || p.metaDescription.length < 120) issues.push(`Meta description is ${p.metaDescription.length} characters; make it 140 to 155.`);
  if (p.sections.length < 5 || p.sections.length > 8) issues.push(`${p.sections.length} sections; the format asks for 5 to 8.`);
  if (p.faq.length < 4) issues.push(`Only ${p.faq.length} FAQ items; write at least 4.`);
  if (p.sources.length < 3) issues.push('Fewer than 3 sources; list every URL the facts came from.');
  const internal = (text.match(/href="\/(services|pricing|contact|about|blog)/g) || []).length + (p.sections.map(s => s.html).join('').match(/href="\/(services|pricing|contact|about|blog)/g) || []).length;
  if (internal === 0) issues.push('No internal links. Add two natural links to /services, /pricing or /contact inside sentences.');
  const inConclusion = /in conclusion|to sum up|in summary|wrapping up/i.test(lower);
  if (inConclusion) issues.push('Summary-style ending detected. End on a useful line instead.');
  return issues;
}

function humanityScore(p) {
  try {
    const tmp = path.join(os.tmpdir(), `lv-post-${Date.now()}.txt`);
    fs.writeFileSync(tmp, postText(p));
    const out = execFileSync('python3', [path.join(here, 'humanizer_scorer.py'), tmp, '--json'], { encoding: 'utf8' });
    fs.unlinkSync(tmp);
    const m = out.match(/\{[\s\S]*\}\s*$/);
    const j = m ? JSON.parse(m[0]) : null;
    if (!j) return null;
    const notes = [];
    for (const [k, v] of Object.entries(j.sections || {})) {
      if (v.flagged_terms?.length) notes.push(`${k}: ${v.flagged_terms.join(', ')}`);
      if (v.flagged_phrases?.length) notes.push(`${k}: ${v.flagged_phrases.join(', ')}`);
      if (k === 'sentence_variance' && v.score < 10) notes.push(`sentence rhythm is too even (std dev ${v.std_dev}); mix long and short sentences`);
      if (k === 'passive_voice' && v.score < 12) notes.push(`too much passive voice (${v.passive_pct}); rewrite in active voice`);
    }
    return { score: j.humanity_score, label: j.label, notes };
  } catch (e) {
    log('scorer unavailable:', e.message.split('\n')[0]);
    return null;
  }
}

function extractJson(text) {
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(raw);
}

async function research(client, { today, recentPosts, topicHint }) {
  const tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 12, user_location: { type: 'approximate', city: 'Dubai', country: 'AE', timezone: 'Asia/Dubai' } }];
  const user = { role: 'user', content: researchPrompt({ today, recentPosts, topicHint }) };
  let messages = [user];
  let response;
  for (let i = 0; i < 6; i++) {
    response = await client.messages.create({ model: MODEL, max_tokens: 16000, output_config: { effort: 'high' }, tools, messages });
    if (response.stop_reason === 'refusal') throw new Error(`research refused: ${response.stop_details?.explanation || ''}`);
    if (response.stop_reason !== 'pause_turn') break;
    messages = [user, { role: 'assistant', content: response.content }]; // server resumes the search loop
  }
  const searches = response.content.filter(b => b.type === 'server_tool_use').length;
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  log(`research done: ${searches} search call(s) in the final turn, ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`);
  return extractJson(text);
}

async function write(client, { system, user }) {
  const res = await client.messages.parse({
    model: MODEL, max_tokens: 24000, output_config: { effort: 'high', format: zodOutputFormat(PostSchema) },
    system, messages: [{ role: 'user', content: user }]
  });
  if (res.stop_reason === 'refusal') throw new Error(`writing refused: ${res.stop_details?.explanation || ''}`);
  if (!res.parsed_output) throw new Error(`no structured output (stop_reason ${res.stop_reason})`);
  log(`draft written: ${res.usage.input_tokens} in / ${res.usage.output_tokens} out`);
  return res.parsed_output;
}

async function main() {
  const posts = loadPosts();
  const today = dubaiToday();
  const topicHint = (process.env.TOPIC || '').trim();
  const force = process.env.FORCE === '1' || !!topicHint;
  if (!force && posts[0]) {
    const days = (Date.now() - new Date(posts[0].date + 'T05:00:00Z').getTime()) / 864e5;
    if (days < MIN_GAP_DAYS) { log(`last post ${posts[0].date} is ${days.toFixed(1)} days old; next one after ${MIN_GAP_DAYS} days. Nothing to do.`); return; }
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const client = new Anthropic();
  const recentPosts = posts.slice(0, 40);

  log('researching…');
  const found = await research(client, { today, recentPosts, topicHint });
  log(`topic: ${found.topic}`);

  log('writing…');
  const system = writeSystem();
  let draft = await write(client, { system, user: writeUser({ research: found, today, recentPosts }) });
  let issues = findIssues(draft);
  let score = humanityScore(draft);
  log(`draft check: ${issues.length} issue(s)${score ? `, humanity ${score.score}/100 (${score.label})` : ''}`);

  const needsRevision = issues.length > 0 || (score && score.score < 70);
  if (needsRevision) {
    const all = [...issues, ...(score?.notes || [])];
    log('revising:', all.join(' | '));
    const revised = await write(client, { system, user: revisePrompt({ draft, issues: all }) });
    const rIssues = findIssues(revised);
    const rScore = humanityScore(revised);
    const better = rIssues.length <= issues.length && (!rScore || !score || rScore.score >= score.score - 3);
    log(`revision check: ${rIssues.length} issue(s)${rScore ? `, humanity ${rScore.score}/100` : ''} → ${better ? 'using revision' : 'keeping first draft'}`);
    if (better) { draft = revised; issues = rIssues; score = rScore; }
  }
  if (issues.length) log('remaining issues (published anyway, review by hand):', issues.join(' | '));

  const post = {
    id: `${today}-${Date.now().toString(36)}`,
    ...draft,
    slug: uniqueSlug(draft.slug || draft.title, posts),
    tags: draft.tags.slice(0, 6),
    sources: draft.sources.slice(0, 6),
    date: today,
    updated: today,
    readingMinutes: Math.max(3, Math.round(wordCount(draft) / 200)),
    wordCount: wordCount(draft),
    humanityScore: score?.score ?? null,
    model: MODEL
  };
  posts.unshift(post);
  savePosts(posts);
  buildAll(posts);
  log(`published /blog/${post.slug} (${post.wordCount} words)`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `title=${post.title.replace(/\n/g, ' ')}\nslug=${post.slug}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
