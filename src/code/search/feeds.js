// Builds the list of RSS feeds to check. One output item = one HTTP request.

// Search terms and categories come from config/profile.json
const DOU_SEARCHES = CONFIG.feeds.dou_searches;
// Djinni: "no experience" feed, plus a few categories ('' = all categories)
const DJINNI_CATEGORIES = CONFIG.feeds.djinni_categories;

const out = [];
for (const q of DOU_SEARCHES) {
  out.push({ json: {
    source: 'DOU',
    url: 'https://jobs.dou.ua/vacancies/feeds/?exp=0-1&search=' + encodeURIComponent(q),
  } });
}
for (const c of DJINNI_CATEGORIES) {
  out.push({ json: {
    source: 'Djinni',
    url: 'https://djinni.co/jobs/rss/?exp_level=no_exp' + (c ? '&primary_keyword=' + encodeURIComponent(c) : ''),
  } });
}
return out;
