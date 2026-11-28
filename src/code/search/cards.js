// Combines the keyword score with the AI verdict.
// Every checked vacancy is saved to "Знайдені" (so it is never checked twice);
// the ones that fit are also sent to Telegram as cards with Add / Skip buttons.
// Output items: kind 'inbox' (row to append) or kind 'tg' (Telegram call).

const MAX_CARDS = Number($env.MAX_CARDS || 15);

const src = $('Компанія зі сторінки').all().map((i) => i.json);
const ai = $input.all().map((i) => i.json);
const stamp = nowStamp();

const rows = [];
const good = [];
let rejectedByAi = 0;

src.forEach((v, i) => {
  const r = ai[i] || {};
  const out = r.output || null;           // null = AI step failed, keep the keyword verdict
  const fits = !out || (out.fit !== false && out.requires_experience !== true);
  const comment = out ? String(out.why || '').trim() : 'AI недоступний, відібрано за ключовими словами';
  if (!fits) rejectedByAi++;
  rows.push({ json: {
    kind: 'inbox',
    [IN.FOUND]: stamp,
    [IN.SCORE]: v.score,
    [IN.COMPANY]: v.company || '(уточнити)',
    [IN.POSITION]: v.title,
    [IN.LOCATION]: v.location || '',
    [IN.SALARY]: v.salary || '',
    [IN.SOURCE]: v.source,
    [IN.LINK]: v.url,
    [IN.STATUS]: fits ? 'Нова' : 'AI: не підходить',
    [IN.AI]: comment,
  } });
  if (fits) good.push(Object.assign({}, v, { comment }));
});

const stats = (src[0] && src[0].stats) || {};
const msgs = [];
if (!good.length) {
  msgs.push(sendText('🔎 Нових вакансій немає.\n' +
    `Переглянуто ${stats.seen || 0} у ${stats.feedsOk || 0} стрічках, AI відсіяв ${rejectedByAi}.`));
} else {
  msgs.push(sendText(`🔎 <b>Нових вакансій: ${good.length}</b>` +
    (rejectedByAi ? `\nAI відсіяв ще ${rejectedByAi} (просять досвід або не твій профіль)` : '') +
    (good.length > MAX_CARDS ? `\nПоказую ${MAX_CARDS} найкращих, решта в /inbox` : '')));
  for (const v of good.slice(0, MAX_CARDS)) msgs.push(inboxCard(v));
}

return rows.concat(msgs);

function inboxCard(v) {
  const meta = [v.location, v.salary].filter(Boolean).join(' · ');
  const h = hash(urlKey(v.url));
  return sendText(
    `🆕 <b>${esc(v.company || '(уточнити)')}</b> — ${esc(v.title)}` +
    (meta ? `\n📍 ${esc(meta)}` : '') +
    `\n⭐ бал ${v.score} · ${esc(v.source)}` +
    (v.comment ? `\n🤖 ${esc(v.comment)}` : ''),
    { reply_markup: { inline_keyboard: [
      [{ text: '➕ Додати', callback_data: 'a:' + h }, { text: '✖ Пропустити', callback_data: 'x:' + h }],
      [{ text: 'Відкрити вакансію', url: v.url }],
    ] } },
  );
}
