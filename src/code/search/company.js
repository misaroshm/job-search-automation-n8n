// Djinni's RSS has no company field, so for every new vacancy the page is opened
// ("Сторінки вакансій") and the company is taken from it. If the page did not
// load, the guess from the RSS text is kept. Output: the "Лише нові" items with
// `company` and the AI text updated, in the same order.

const pages = $input.all().map((i) => String(i.json.data || ''));

return $('Лише нові').all().map((item, i) => {
  const v = Object.assign({}, item.json);
  const fromPage = /djinni\.co/i.test(v.url || '') ? companyFromPage(pages[i]) : '';
  if (fromPage) {
    v.company = fromPage;
    v.aiText = String(v.aiText || '').replace(/^Company: .*$/m, 'Company: ' + fromPage);
  }
  return { json: v };
});
