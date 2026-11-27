// Picks rejections that have a letter pasted into "Нотатки" but no AI analysis yet.
// route 0 = rows to analyse, route 1 = nothing new to analyse.

const MIN_LETTER = 80;
const MAX_PER_RUN = 10;

const rows = rowsOf('Вакансії: прочитати');
const todo = rows.filter((r) =>
  r[COL.STAGE] === 'Відмова' &&
  String(r[COL.NOTES] || '').trim().length >= MIN_LETTER &&
  !r[COL.AI_REASON]);

if (!todo.length) return [{ json: { route: 1 } }];

return todo.slice(0, MAX_PER_RUN).map((r) => ({ json: {
  route: 0,
  row_number: r.row_number,
  company: r[COL.COMPANY],
  position: r[COL.POSITION],
  aiText: [
    `Company: ${r[COL.COMPANY]}`,
    `Position: ${r[COL.POSITION]}`,
    `Hiring stage reached: ${r[COL.REASON] ? 'rejected, recorded reason: ' + r[COL.REASON] : 'rejected'}`,
    '',
    'Rejection letter:',
    String(r[COL.NOTES]).slice(0, 4000),
  ].join('\n'),
} }));
