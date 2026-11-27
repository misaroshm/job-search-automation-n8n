// Formats the AI's cross-rejection insights for Telegram.
const a = $input.first().json.output;
const n = $('Підсумок').all().map((i) => i.json).find((j) => j.kind === 'ai').count;
if (!a) return [sendText('⚠️ AI не зміг зробити висновки, спробуй /insights пізніше.')];
const list = (t, xs) => (xs && xs.length ? `\n<b>${t}</b>\n` + xs.map((x) => '• ' + esc(x)).join('\n') : '');
return [sendText(
  `🧠 <b>Що кажуть відмови</b> (розібрано ${n})\n` +
  (a.summary ? '\n' + esc(a.summary) + '\n' : '') +
  list('Що повторюється', a.patterns) +
  list('Що вже працює', a.strengths) +
  list('На чому зосередитись', a.focus_next),
)];
