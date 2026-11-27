// Morning summary: overdue next steps, steps due today/tomorrow, applications
// that have not moved for a while. Applications with no answer for GHOST_DAYS
// are moved to "Немає відповіді" automatically.
// Output kinds: updMain, hist, tg.

const STALE_DAYS = Number($env.STALE_DAYS || 7);
const GHOST_DAYS = Number($env.GHOST_DAYS || 21);

const rows = rowsOf('Вакансії: прочитати').filter((r) => r[COL.COMPANY]);
const today = todayISO();
const overdue = [], due = [], stale = [], ghosted = [], out = [];
const counts = {};

for (const r of rows) {
  const stage = r[COL.STAGE] || '';
  counts[stage] = (counts[stage] || 0) + 1;
  if (isClosed(stage)) continue;
  const label = `${r[COL.COMPANY]} — ${r[COL.POSITION]}`;
  const idle = daysBetween(parseDate(r[COL.STAGE_DATE]), today);

  if (GHOST_DAYS > 0 && stage === 'Відгукнулась' && idle !== null && idle >= GHOST_DAYS) {
    out.push({ json: { kind: 'updMain', row_number: r.row_number, [COL.STAGE]: 'Немає відповіді', [COL.STAGE_DATE]: today } });
    out.push({ json: { kind: 'hist', 'Коли': nowStamp(), 'Компанія': r[COL.COMPANY], 'Позиція': r[COL.POSITION], 'Було': stage, 'Стало': 'Немає відповіді (авто)' } });
    ghosted.push(label);
    continue;
  }

  const next = parseDate(r[COL.NEXT_DATE]);
  const step = r[COL.NEXT] || 'наступний крок';
  if (next) {
    const d = daysBetween(today, next);
    if (d < 0) overdue.push(`${label}: ${step} (було ${fmtDate(next)})`);
    else if (d <= 1) due.push(`${label}: ${step} — ${d === 0 ? 'сьогодні' : 'завтра'}`);
  }
  if (idle !== null && idle >= STALE_DAYS) stale.push(`${label} (${stage || 'без етапу'}, ${idle} дн.)`);
}

const block = (t, items) => (items.length ? `\n<b>${t}</b>\n` + items.map((x) => '• ' + esc(x)).join('\n') + '\n' : '');
let text = block('🔴 Прострочено', overdue) + block('🟡 На сьогодні і завтра', due) +
  block('⏳ Давно без руху', stale) + block('👻 Перевела в "Немає відповіді"', ghosted);
if (!text) text = '\nНічого термінового, все під контролем.\n';

const active = rows.filter((r) => !isClosed(r[COL.STAGE]) && r[COL.STAGE] !== 'Хочу відгукнутись').length;
const wish = counts['Хочу відгукнутись'] || 0;
text += `\nУ процесі: ${active}` + (wish ? ` · чекають відгуку: ${wish}` : '');

const sheetUrl = `https://docs.google.com/spreadsheets/d/${$env.SHEET_ID}/edit`;
out.push(sendText(`🗓 <b>Вакансії на ${fmtDate(today)}</b>\n${text}\n\n<a href="${sheetUrl}">Відкрити таблицю</a>`));
return out;
