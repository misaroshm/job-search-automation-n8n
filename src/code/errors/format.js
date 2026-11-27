// Any workflow failed: send the details to Telegram.
const e = $input.first().json;
const wf = (e.workflow && e.workflow.name) || 'невідомий workflow';
const ex = e.execution || {};
const err = ex.error || e.trigger && e.trigger.error || {};
const node = ex.lastNodeExecuted || (err.node && err.node.name) || '?';
return [sendText(
  `⚠️ <b>Помилка в "${esc(wf)}"</b>\n` +
  `Вузол: ${esc(node)}\n` +
  `${esc(short(err.message || 'без опису', 500))}` +
  (ex.url ? `\n\n<a href="${esc(ex.url)}">Відкрити виконання в n8n</a>` : ''),
)];
