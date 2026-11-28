// Vacancy links were sent to the bot: parse each downloaded page and add a row.
// DOU pages give company, title, cities and salary; other sites at least the title.

const requests = $('Логіка бота').all().map((i) => i.json).filter((j) => j.kind === 'fetchPage');
const pages = $input.all().map((i) => String(i.json.data || ''));
const SITES = { 'dou.ua': 'DOU', 'djinni.co': 'Djinni', 'linkedin.com': 'LinkedIn', 'work.ua': 'Work.ua', 'robota.ua': 'Robota.ua' };
const result = [];
requests.forEach((req, i) => result.push(...addPage(req, pages[i] || '')));
return result;

function decode(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function addPage(req, html) {
  const url = req.url;
  const host = url.replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./, '').toLowerCase();
  let source = 'Сайт компанії';
  for (const d of Object.keys(SITES)) if (host === d || host.endsWith('.' + d)) source = SITES[d];

  function meta(name) {
    const a = html.match(new RegExp('<meta[^>]*?(?:property|name)="' + name + '"[^>]*?content="([^"]*)"', 'i')) ||
              html.match(new RegExp('<meta[^>]*?content="([^"]*)"[^>]*?(?:property|name)="' + name + '"', 'i'));
    return a ? decode(a[1]).replace(/\s+/g, ' ').trim() : '';
  }
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const pageTitle = t ? decode(t[1]).replace(/\s+/g, ' ').trim() : '';
  const og = meta('og:title');

  const info = { position: og || pageTitle.split('|')[0].trim(), company: '', location: '', format: '', salary: '' };
  if (source === 'DOU' && pageTitle) {
    // "Position в Company, Київ, Львів, віддалено | DOU"
    let rest = pageTitle.replace(/\s*\|\s*DOU\s*$/i, '');
    if (og && rest.indexOf(og + ' в ') === 0) rest = rest.slice(og.length + 3);
    else { const i = rest.lastIndexOf(' в '); rest = i >= 0 ? rest.slice(i + 3) : ''; }
    const parts = rest.split(',').map((s) => s.trim()).filter(Boolean);
    info.company = parts.shift() || '';
    const remote = (p) => /віддалено|remote/i.test(p);
    info.location = parts.filter((p) => !remote(p)).join(', ');
    if (parts.some(remote)) info.format = 'Віддалено';
    const sal = html.match(/class="salary"[^>]*>([^<]+)</i);
    if (sal) info.salary = decode(sal[1]).trim();
  }

  // Djinni and many career sites: company from JSON-LD or "Position в Company"
  if (!info.company) info.company = companyFromPage(html);
  if (info.company && info.position.endsWith(' в ' + info.company)) {
    info.position = info.position.slice(0, -(info.company.length + 3)).trim();
  }

  const ok = Boolean(info.position);
  const row = {
    kind: 'updMain',
    row_number: req.row_number,
    [COL.COMPANY]: info.company || '(уточнити)',
    [COL.POSITION]: info.position || '(уточнити)',
    [COL.LINK]: url,
    [COL.SOURCE]: source,
    [COL.FORMAT]: info.format,
    [COL.LOCATION]: info.location,
    [COL.SALARY]: info.salary,
    [COL.STAGE]: 'Хочу відгукнутись',
    [COL.STAGE_DATE]: todayISO(),
    [COL.PRIORITY]: 'Середній',
    [COL.NOTES]: ok ? 'Додано з Telegram' : 'Сторінка не відкрилась, заповни вручну',
  };

  const extra = [info.location, info.format, info.salary].filter(Boolean).join(' · ');
  return [
    { json: row },
    { json: { kind: 'hist', 'Коли': nowStamp(), 'Компанія': row[COL.COMPANY], 'Позиція': row[COL.POSITION], 'Було': '', 'Стало': 'Хочу відгукнутись (посилання в Telegram)' } },
    sendText(`➕ Додано: <b>${esc(row[COL.COMPANY])}</b> — ${esc(row[COL.POSITION])}` +
      (extra ? '\n' + esc(extra) : '') +
      (ok && info.company ? '' : '\nЧастину полів не вдалось витягнути, доповни в таблиці.'),
      { reply_markup: { inline_keyboard: [[{ text: 'Змінити етап', callback_data: 'v:' + rowKey(row) }]] } }),
  ];
}
