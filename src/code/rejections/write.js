// Turns the AI analysis into cells for the "Вакансії" sheet.
// Only column values + row_number are returned, so the Sheets node can create
// the AI columns automatically the first time.

const src = $('Нові відмови').all().map((i) => i.json);
const join = (v) => (Array.isArray(v) ? v.filter(Boolean).join('; ') : String(v || ''));

const out = [];
$input.all().forEach((item, i) => {
  const a = item.json.output;
  const s = src[i];
  if (!a || !s) return; // AI step failed for this one: it will be retried next run
  out.push({ json: {
    row_number: s.row_number,
    [COL.AI_REASON]: REASONS.indexOf(a.reason_category) !== -1 ? a.reason_category : 'Інше',
    [COL.AI_GAPS]: join(a.gaps),
    [COL.AI_ADVICE]: join(a.advice),
    [COL.AI_ACTION]: String(a.next_action || '') + (a.door_open ? ' (двері відчинені)' : ''),
  } });
});
return out;
