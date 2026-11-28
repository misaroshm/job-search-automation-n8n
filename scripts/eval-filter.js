#!/usr/bin/env node
// Offline evaluation of the vacancy filter against my own decisions.
//
// Input: a JSON list of vacancies the search surfaced, each with
//   { url, title, company, location, score, label }   label: 1 = I added it, 0 = I skipped it
// (built from the "Знайдені" sheet; kept in private/, never committed).
//
// For every labelled vacancy it downloads the page, runs the same Gemini check
// as the n8n workflow (same prompt, schema, profile and temperature) and then
// compares "keywords only" with "keywords + AI".
// Pages and AI answers are cached, so the script can be stopped and re-run.
//
//   node scripts/eval-filter.js private/eval/vacancies.json
//
// Needs GEMINI_API_KEY (and optionally GEMINI_MODEL) from .env.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FIT_SCHEMA, FIT_PROMPT } = require('./prompts');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = JSON.parse(fs.readFileSync(process.env.PROFILE_FILE || path.join(ROOT, 'config/profile.json'), 'utf8'));
const input = process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(ROOT, 'private/eval/vacancies.json');
const cacheFile = path.join(path.dirname(input), 'cache.json');

loadEnv(path.join(ROOT, '.env'));
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'models/gemini-3.5-flash-lite';
const DELAY_MS = Number(process.env.EVAL_DELAY_MS || 4500);
const REPORT_ONLY = process.argv.includes('--report-only'); // no new Gemini calls, report on what is cached // stays inside the free-tier rate limit
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

// AI answers are cached per prompt + profile + model, so editing either re-asks Gemini
const AI_VERSION = crypto.createHash('sha1').update(FIT_PROMPT + JSON.stringify(CONFIG.candidate_profile) + MODEL).digest('hex').slice(0, 8);
const aiKey = (v) => AI_VERSION + '|' + v.url;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : { pages: {}, ai: {} };
const saveCache = () => fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 1));

main().catch((e) => { console.error(e); process.exit(1); });

async function main() {
  if (!KEY) throw new Error('GEMINI_API_KEY is not set (.env)');
  const all = JSON.parse(fs.readFileSync(input, 'utf8'));
  const items = all.filter((v) => v.label === 0 || v.label === 1);
  console.error(`${items.length} labelled vacancies (${items.filter((v) => v.label).length} added, ${items.filter((v) => !v.label).length} skipped)`);

  let n = 0;
  for (const v of items) {
    n++;
    if (!REPORT_ONLY && cache.pages[v.url] === undefined) {
      cache.pages[v.url] = await fetchDescription(v.url);
      saveCache();
      await sleep(800);
    }
    if (!REPORT_ONLY && cache.ai[aiKey(v)] === undefined) {
      cache.ai[aiKey(v)] = await askGemini(aiText(v, cache.pages[v.url]));
      saveCache();
      process.stderr.write(`\r${n}/${items.length}`);
      await sleep(DELAY_MS);
    }
  }
  process.stderr.write('\n');
  await rescore(items);
  report(items);
}

// Re-scores every vacancy with the CURRENT keyword rules by running the real
// "Розібрати й оцінити" node code on a feed built from the saved pages.
async function rescore(items) {
  const common = fs.readFileSync(path.join(ROOT, 'src/lib/common.js'), 'utf8');
  const body = fs.readFileSync(path.join(ROOT, 'src/code/search/parse-score.js'), 'utf8');
  const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const xml = '<rss><channel>' + items.map((v) => {
    const title = /djinni\.co/i.test(v.url) ? v.title : `${v.title} в ${v.company || '-'}${v.location ? ', ' + v.location : ''}`;
    return `<item><title>${esc(title)}</title><link>${esc(v.url)}</link><description>${esc(cache.pages[v.url] || '')}</description></item>`;
  }).join('') + '</channel></rss>';
  const wrap = [{ json: { data: xml } }];
  // eslint-disable-next-line no-new-func
  const fn = new Function('$input', '$env', `return (async () => {\nconst CONFIG = ${JSON.stringify(CONFIG)};\n${common}\n${body}\n})();`);
  const [out] = await fn({ all: () => wrap, first: () => wrap[0] }, { MIN_SCORE: '-1000' });
  const byUrl = {};
  for (const c of out.json.candidates) byUrl[c.url] = c.score;
  for (const v of items) v.newScore = byUrl[v.url] !== undefined ? byUrl[v.url] : byUrl[v.url.split('?')[0]];
}

// Same text the "Лише нові" node sends to the AI
function aiText(v, description) {
  return [
    'CANDIDATE PROFILE:', CONFIG.candidate_profile.join('\n'), '',
    'VACANCY:',
    'Title: ' + v.title,
    'Company: ' + (v.company || 'unknown'),
    'Location: ' + (v.location || 'not stated'),
    'Description: ' + String(description || '').slice(0, 3500),
  ].join('\n');
}

async function fetchDescription(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    if (!res.ok) return '';
    const html = await res.text();
    // DOU: <div class="b-typo vacancy-section">, Djinni: <div class="... job-post__description">
    const m = html.match(/class="[^"]*(?:vacancy-section|job-post__description)[^"]*"[^>]*>([\s\S]{0,20000})/i);
    const body = m ? m[1] : (html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"/i) || [])[1] || '';
    return plain(body).slice(0, 4000);
  } catch (e) {
    return '';
  }
}

function plain(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

// Gemini's responseSchema uses upper-case type names
function geminiSchema(s) {
  const out = { type: String(s.type).toUpperCase() };
  if (s.description) out.description = s.description;
  if (s.properties) {
    out.properties = {};
    for (const [k, v] of Object.entries(s.properties)) out.properties[k] = geminiSchema(v);
  }
  if (s.required) out.required = s.required;
  return out;
}

async function askGemini(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/${MODEL}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: FIT_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048, responseMimeType: 'application/json', responseSchema: geminiSchema(FIT_SCHEMA) },
  };
  for (let attempt = 1; attempt <= 6; attempt++) {
    let res;
    try {
      // a hung request must not stall the whole run
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    } catch (e) {
      process.stderr.write(` [timeout, retry ${attempt}]`);
      continue;
    }
    if (res.status === 429) {
      const t = await res.text();
      // The free tier has a daily request cap: waiting minutes will not help, so stop and keep the cache
      if (/PerDay/i.test(t)) { console.error('\nGemini daily quota is used up. Answers so far are cached; run again after the quota resets.'); process.exit(2); }
    }
    if (res.status === 429 || res.status >= 500) { process.stderr.write(` [${res.status}, waiting]`); await sleep(15000 * attempt); continue; }
    const j = await res.json();
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${JSON.stringify(j.error || j).slice(0, 300)}`);
    try {
      return JSON.parse(j.candidates[0].content.parts.map((p) => p.text).join(''));
    } catch (e) {
      return null;
    }
  }
  return null;
}

// ------------------------------------------------------------------ metrics

function stats(items, predict) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const v of items) {
    const p = predict(v);
    if (p && v.label) tp++; else if (p && !v.label) fp++; else if (!p && v.label) fn++; else tn++;
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
  return { shown: tp + fp, tp, fp, fn, tn, precision: pct(tp, tp + fp), recall: pct(tp, tp + fn) };
}

function report(items) {
  const MIN = Number(process.env.MIN_SCORE || 20);
  const answered = items.filter((v) => cache.ai[aiKey(v)]);
  const noPage = items.filter((v) => !cache.pages[v.url]).length;
  const aiPass = (v) => { const a = cache.ai[aiKey(v)]; return a.fit !== false && a.requires_experience !== true; };
  const rows = [
    ['Keywords only (everything the search surfaced)', stats(answered, () => true)],
    ['Keywords, score ≥ 20', stats(answered, (v) => Number(v.score) >= 20)],
    ['Keywords, score ≥ 25', stats(answered, (v) => Number(v.score) >= 25)],
    ['Keywords + AI check', stats(answered, aiPass)],
    ['Keywords, score ≥ 20 + AI check', stats(answered, (v) => Number(v.score) >= 20 && aiPass(v))],
    [`Current keyword rules, score ≥ ${MIN} (re-scored)`, stats(answered, (v) => v.newScore >= MIN)],
    [`Current keyword rules, score ≥ ${MIN} + AI check (current setup)`, stats(answered, (v) => v.newScore >= MIN && aiPass(v))],
  ];
  console.log(`Evaluated ${answered.length} of ${items.length} labelled vacancies (${items.length - answered.length} without an AI answer, ${noPage} pages not available). Model: ${MODEL}, prompt version ${AI_VERSION}\n`);
  console.log('| Filter | Cards shown | Of them I added (precision) | My additions it kept (recall) |');
  console.log('|---|---|---|---|');
  for (const [name, s] of rows) console.log(`| ${name} | ${s.shown} | ${s.tp} (${s.precision}) | ${s.tp} of ${s.tp + s.fn} (${s.recall}) |`);
  const reasons = {};
  for (const v of answered) {
    const a = cache.ai[aiKey(v)];
    const k = a.requires_experience ? 'asks for experience' : a.fit === false ? 'not my profile' : 'passed';
    reasons[k] = (reasons[k] || 0) + 1;
  }
  console.log('\nAI verdicts:', JSON.stringify(reasons));
  const missed = answered.filter((v) => v.label && !aiPass(v));
  if (missed.length) {
    console.log('\nVacancies I added but the AI would have dropped:');
    for (const v of missed) console.log(`- ${v.title} (${cache.ai[aiKey(v)].why})`);
  }
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
