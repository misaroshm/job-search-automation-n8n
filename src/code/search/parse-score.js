// Parses every RSS response, scores each vacancy with keyword rules and keeps
// the ones above the threshold. Always returns exactly one item:
// { candidates: [...], feedsOk, feedsFailed, seen }

const MIN_SCORE = Number($env.MIN_SCORE || 15);

// Keyword rules come from config/profile.json (CONFIG is injected by the build).
// Points: boosts count x2 in the title and x1 in the description; penalties apply to the title only.
const rule = (r) => [new RegExp(r.pattern, 'i'), Number(r.points)];
const GOOD = CONFIG.scoring.boost.map(rule);
const BAD = CONFIG.scoring.penalty.map(rule);
const [GOOD_PLACE, PLACE_POINTS] = rule(CONFIG.scoring.preferred_location);
// "1+ year", "від року", "2 years of experience" ... => not for a trainee.
// The `u` flag and explicit letter lookarounds are needed because JS `\b`
// does not treat Cyrillic as word characters.
// A bare "5 years" / "5 років" only counts next to an experience word, so
// "5 years on the market" or "працюємо 5 років" do not drop a vacancy.
const EXP_BAD = (() => {
  const B = '(?<![\\p{L}\\d])';
  const E = '(?![\\p{L}\\d])';
  const NUM = '(?:[1-9]\\d?|one|two|three|four|five|одного|двох|трьох|чотирьох|п\'яти)';
  const UNIT = '(?:years?|yrs?|рік|року|роки|років|год|года|лет)';
  const EXP = '(?:experience|досвід\\p{L}*|опыт\\p{L}*|стаж\\p{L}*)';
  const GAP = '[^.;!?\\n]{0,40}?';
  return new RegExp([
    // explicit plus: "1+ year", "2+ роки"
    `${B}${NUM}\\s*\\+\\s*${UNIT}${E}`,
    // "від року", "від 2 років", "at least 1 year", "не менше двох років"
    `${B}(?:від|от|from|at least|minimum|min\\.?|не менше|не менее|мінімум|минимум)\\s+(?:${NUM}\\s*)?${UNIT}${E}`,
    // "2 years of experience", "досвід роботи 2 роки"
    `${B}${NUM}\\s*${UNIT}${E}${GAP}${EXP}`,
    `${EXP}${GAP}${B}${NUM}\\s*${UNIT}${E}`,
  ].join('|'), 'iu');
})();

function decode(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function plain(html) {
  return decode(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function tag(block, name) {
  const m = block.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i'));
  if (!m) return '';
  const v = m[1].trim();
  const c = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return c ? c[1] : decode(v);
}

function parseRss(xml) {
  const items = [];
  const re = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(String(xml || '')))) {
    items.push({ title: tag(m[1], 'title'), link: tag(m[1], 'link'), html: tag(m[1], 'description') });
  }
  return items;
}

// "Trainee QA в Nordlight, Львів, віддалено, $200–400"
function fromDou(x) {
  const out = { source: 'DOU', url: x.link.split('?')[0], text: plain(x.html), company: '', location: '', salary: '' };
  const t = plain(x.title);
  const i = t.lastIndexOf(' в ');
  if (i === -1) { out.title = t; return out; }
  out.title = t.slice(0, i).trim();
  const parts = t.slice(i + 3).split(',').map((s) => s.trim()).filter(Boolean);
  out.company = parts.shift() || '';
  const money = parts.filter((p) => /[$€]|грн|uah/i.test(p));
  out.salary = money.join(', ');
  out.location = parts.filter((p) => money.indexOf(p) === -1).join(', ');
  return out;
}

// Djinni has no company field: it is usually in bold at the start of the description
function fromDjinni(x) {
  const out = { source: 'Djinni', url: x.link, title: plain(x.title), text: plain(x.html), company: '', location: '', salary: '' };
  const b = String(x.html).match(/<(?:b|strong)>([^<]{2,40})<\/(?:b|strong)>/i);
  if (b) out.company = decode(b[1]).trim().replace(/[:.]$/, '');
  const place = out.text.match(/віддалено|remote|львів|lviv|київ|kyiv/gi) || [];
  out.location = place.filter((p, i, a) => a.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i).slice(0, 3).join(', ');
  return out;
}

function score(v) {
  const title = v.title || '';
  const desc = v.text || '';
  if (EXP_BAD.test(title + ' ' + desc)) return -99;
  let s = 0;
  for (const [re, w] of GOOD) {
    if (re.test(title)) s += w * 2;
    if (re.test(desc)) s += w;
  }
  for (const [re, w] of BAD) if (re.test(title)) s += w;
  if (GOOD_PLACE.test(title + ' ' + v.location + ' ' + desc)) s += PLACE_POINTS;
  return s;
}

let feedsOk = 0, feedsFailed = 0, seen = 0;
const byKey = {};
for (const item of $input.all()) {
  const xml = item.json.data;
  if (typeof xml !== 'string' || xml.indexOf('<item') === -1) { feedsFailed++; continue; }
  feedsOk++;
  for (const x of parseRss(xml)) {
    if (!x.link) continue;
    seen++;
    const v = /djinni\.co/i.test(x.link) ? fromDjinni(x) : fromDou(x);
    const key = urlKey(v.url);
    if (byKey[key]) continue;
    v.score = score(v);
    if (v.score >= MIN_SCORE) byKey[key] = v;
  }
}

const candidates = Object.values(byKey).sort((a, b) => b.score - a.score);
return [{ json: { candidates, feedsOk, feedsFailed, seen } }];
