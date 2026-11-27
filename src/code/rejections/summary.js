// Sends a short card for every newly analysed rejection and, for the weekly run
// or the /insights command, prepares one request to the AI that looks for
// patterns across all analysed rejections.
// Output: kind 'tg' items and, optionally, one kind 'ai' item.

function getMode() {
  for (const n of ['Режим: щодня', 'Режим: щотижня', 'Режим: з бота']) {
    try { return $(n).first().json.mode; } catch (e) { /* that trigger did not fire */ }
  }
  return 'daily';
}

const mode = getMode();
const rows = rowsOf('Вакансії: прочитати');
let fresh = [];
try { fresh = $('Записати розбір').all().map((i) => i.json); } catch (e) { fresh = []; }

const merged = rows.map((r) => Object.assign({}, r, fresh.find((f) => f.row_number === r.row_number) || {}));
const analysed = merged.filter((r) => r[COL.STAGE] === 'Відмова' && r[COL.AI_REASON]);
const out = [];

for (const f of fresh) {
  const r = merged.find((x) => x.row_number === f.row_number);
  if (!r) continue;
  out.push(sendText([
    `🧠 <b>Розбір відмови: ${esc(r[COL.COMPANY])}</b> — ${esc(r[COL.POSITION])}`,
    `Причина: ${esc(r[COL.AI_REASON])}`,
    r[COL.AI_GAPS] ? `Чого бракувало: ${esc(r[COL.AI_GAPS])}` : '',
    r[COL.AI_ADVICE] ? `Що підтягнути: ${esc(r[COL.AI_ADVICE])}` : '',
    r[COL.AI_ACTION] ? `👉 ${esc(r[COL.AI_ACTION])}` : '',
  ].filter(Boolean).join('\n')));
}

const wantsSummary = mode === 'weekly' || mode === 'insights';
if (wantsSummary && analysed.length >= 2) {
  out.push({ json: {
    kind: 'ai',
    count: analysed.length,
    aiText: analysed.map((r, i) => [
      `#${i + 1} ${r[COL.COMPANY]} — ${r[COL.POSITION]}`,
      `Reason: ${r[COL.AI_REASON]}`,
      `Gaps: ${r[COL.AI_GAPS] || '-'}`,
      `Advice: ${r[COL.AI_ADVICE] || '-'}`,
    ].join('\n')).join('\n\n'),
  } });
} else if (mode === 'insights' && !fresh.length) {
  out.push(sendText(analysed.length
    ? 'Поки розібрана лише одна відмова, для висновків потрібно хоча б дві.'
    : 'Поки немає розібраних відмов. Встав текст відмови в колонку "Нотатки" і постав етап "Відмова".'));
}
return out;
