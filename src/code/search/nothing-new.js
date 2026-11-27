// Nothing new after de-duplication: send a short confirmation so it is clear the search ran.
const s = $input.first().json;
return [sendText(
  '🔎 Нових вакансій немає.\n' +
  `Переглянуто ${s.seen || 0} у ${s.feedsOk || 0} стрічках` +
  (s.alreadyKnown ? `, ${s.alreadyKnown} ти вже бачила` : '') +
  (s.feedsFailed ? `\n⚠️ Не відкрилось стрічок: ${s.feedsFailed}` : ''),
)];
