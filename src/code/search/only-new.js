// Drops vacancies that are already in "Знайдені" or "Вакансії" and prepares
// the text for the AI check. route 0 = new vacancies, route 1 = nothing new.

const MAX_AI_CHECKS = Number($env.MAX_AI_CHECKS || 20);

// Who the AI is matching vacancies against: config/profile.json
const PROFILE = CONFIG.candidate_profile.join('\n');

const res = $('Розібрати й оцінити').first().json;
const known = new Set();
for (const r of rowsOf('Знайдені: прочитати')) known.add(urlKey(r[IN.LINK]));
for (const r of rowsOf('Вакансії: прочитати')) known.add(urlKey(r[COL.LINK]));

const fresh = (res.candidates || []).filter((c) => !known.has(urlKey(c.url)));
const stats = { feedsOk: res.feedsOk, feedsFailed: res.feedsFailed, seen: res.seen, alreadyKnown: (res.candidates || []).length - fresh.length };

if (!fresh.length) return [{ json: Object.assign({ route: 1 }, stats) }];

return fresh.slice(0, MAX_AI_CHECKS).map((c) => ({
  json: Object.assign({ route: 0 }, c, {
    stats,
    aiText: [
      'CANDIDATE PROFILE:', PROFILE, '',
      'VACANCY:',
      'Title: ' + c.title,
      'Company: ' + (c.company || 'unknown'),
      'Location: ' + (c.location || 'not stated'),
      'Description: ' + String(c.text || '').slice(0, 3500),
    ].join('\n'),
  }),
}));
