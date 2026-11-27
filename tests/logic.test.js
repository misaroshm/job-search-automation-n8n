const test = require('node:test');
const assert = require('node:assert');
const { runCode } = require('./harness');
const { DOU_RSS, DJINNI_RSS, MAIN, INBOX } = require('./fixtures');

// ------------------------------------------------------------- vacancy search

test('feeds: builds DOU and Djinni feed URLs', async () => {
  const out = await runCode('search/feeds.js');
  assert.ok(out.some((x) => x.url.startsWith('https://jobs.dou.ua/vacancies/feeds/?exp=0-1&search=trainee')));
  assert.ok(out.some((x) => x.url === 'https://djinni.co/jobs/rss/?exp_level=no_exp'));
  assert.ok(out.some((x) => x.url.includes('primary_keyword=Project%20Manager')));
});

test('parse-score: keeps relevant vacancies and drops experience / dev / support', async () => {
  const [res] = await runCode('search/parse-score.js', {
    input: [{ data: DOU_RSS }, { data: DOU_RSS }, { data: DJINNI_RSS }, { error: 'timeout' },
      { data: '<?xml version="1.0"?><rss version="2.0"><channel><title>DOU</title></channel></rss>' }, // empty search
      { data: '<html>502 Bad Gateway</html>' }],
    env: { MIN_SCORE: '15' }, // the fixtures score 19-20; the threshold itself is tested below
  });
  const titles = res.candidates.map((c) => c.title);
  assert.deepStrictEqual(res.feedsOk, 4, 'an empty feed still counts as opened');
  assert.deepStrictEqual(res.feedsFailed, 2, 'timeout and an HTML error page are failures');
  assert.ok(titles.includes('Trainee QA'), 'Nordlight trainee QA kept');
  assert.ok(titles.includes('Junior MarTech Automation Specialist'), '"6 months is a plus" is not an experience requirement');
  assert.ok(!titles.includes('Junior Business Analyst'), '1+ year required -> dropped');
  assert.ok(!titles.some((t) => /Software Engineer/.test(t)), 'development dropped');
  assert.ok(!titles.some((t) => /support/i.test(t)), 'support dropped');
  assert.strictEqual(new Set(res.candidates.map((c) => c.url)).size, res.candidates.length, 'no duplicates from repeated feeds');
  const nordlight = res.candidates.find((c) => c.title === 'Trainee QA');
  assert.strictEqual(nordlight.company, 'Nordlight');
  assert.strictEqual(nordlight.salary, '$200–400');
  assert.strictEqual(nordlight.url, 'https://jobs.dou.ua/companies/nordlight/vacancies/111/');
  const djinni = res.candidates.find((c) => c.source === 'Djinni');
  assert.strictEqual(djinni && djinni.company, 'Coinly');
  for (const c of res.candidates) assert.ok(c.score >= 15);
});

test('parse-score: default threshold is 20', async () => {
  const [res] = await runCode('search/parse-score.js', { input: [{ data: DOU_RSS }, { data: DJINNI_RSS }] });
  assert.ok(res.candidates.length > 0);
  for (const c of res.candidates) assert.ok(c.score >= 20, `${c.title} scored ${c.score}`);
  assert.ok(!res.candidates.some((c) => c.title === 'Trainee QA'), 'score 19 is below the default threshold');
});

test('parse-score: experience requirement detection in Ukrainian, Russian and English', async () => {
  // Each phrase goes into the description of an otherwise high-scoring trainee vacancy
  const cases = [
    ['Досвід від 1 року обовʼязковий.', true],
    ['Потрібен досвід від року.', true],
    ['Від двох років досвіду в QA.', true],
    ['Досвід роботи 2 роки.', true],
    ['Маєш 3 роки досвіду тестування.', true],
    ['Опыт от 1 года.', true],
    ['Не менше двох років комерційного досвіду.', true],
    ['2+ роки в аналітиці.', true],
    ['1+ year of experience.', true],
    ['At least 2 years in a similar role.', true],
    ['2 years of commercial experience.', true],
    ['Experience: 3 years in QA.', true],
    ['Зарплата від 1 000 грн, навчання.', false],
    ['Компанія працює вже 5 років на ринку.', false],
    ['A company with 5 years on the market.', false],
    ['Працюємо з 2015 року, офіс у Львові.', false],
    ['6 months of experience is a plus.', false],
  ];
  const items = cases.map(([text], i) =>
    `<item><title>Trainee QA Analyst в Co${i}, Львів</title>` +
    `<link>https://jobs.dou.ua/companies/co${i}/vacancies/${i}/</link>` +
    `<description>&lt;p&gt;Стажування для trainee, SQL, Postman. ${text}&lt;/p&gt;</description></item>`).join('\n');
  const xml = `<?xml version="1.0"?><rss><channel>${items}</channel></rss>`;
  const [res] = await runCode('search/parse-score.js', { input: [{ data: xml }] });
  const kept = new Set(res.candidates.map((c) => c.company));
  for (const [i, [text, dropped]] of cases.entries()) {
    assert.strictEqual(!kept.has(`Co${i}`), dropped, `${dropped ? 'should drop' : 'should keep'}: "${text}"`);
  }
});

test('only-new: skips vacancies already in the sheets and prepares AI text', async () => {
  const [res] = await runCode('search/parse-score.js', { input: [{ data: DOU_RSS }, { data: DJINNI_RSS }] });
  const out = await runCode('search/only-new.js', {
    nodes: { 'Розібрати й оцінити': [res], 'Знайдені: прочитати': INBOX, 'Вакансії: прочитати': MAIN },
  });
  assert.ok(out.every((x) => x.route === 0));
  assert.ok(!out.some((x) => x.title === 'Project Manager Assistant'), 'Pixelforge is already in the main sheet');
  assert.ok(out[0].aiText.includes('CANDIDATE PROFILE'));
});

test('only-new: returns route 1 when nothing is new, even with empty sheets', async () => {
  const out = await runCode('search/only-new.js', {
    nodes: { 'Розібрати й оцінити': [{ candidates: [], feedsOk: 3, feedsFailed: 0, seen: 40 }], 'Знайдені: прочитати': [{}], 'Вакансії: прочитати': [{}] },
  });
  assert.deepStrictEqual(out.map((x) => x.route), [1]);
  const msg = await runCode('search/nothing-new.js', { input: out });
  assert.strictEqual(msg[0].method, 'sendMessage');
  assert.match(msg[0].payload.text, /Переглянуто 40 у 3/);
});

test('cards: AI verdict decides status; every checked vacancy is saved', async () => {
  const src = [
    { route: 0, title: 'Trainee QA', company: 'Nordlight', url: 'https://jobs.dou.ua/companies/nordlight/vacancies/111/', source: 'DOU', score: 20, stats: { seen: 10, feedsOk: 2 } },
    { route: 0, title: 'Junior BA', company: 'Acme', url: 'https://x.com/2', source: 'DOU', score: 18 },
    { route: 0, title: 'Intern PM', company: 'Foo', url: 'https://x.com/3', source: 'Djinni', score: 16 },
  ];
  const ai = [
    { output: { fit: true, requires_experience: false, why: 'QA без досвіду' } },
    { output: { fit: true, requires_experience: true, why: 'Просять 2 роки' } },
    { error: 'quota' },
  ];
  const out = await runCode('search/cards.js', { input: ai, nodes: { 'Лише нові': src } });
  const rows = out.filter((x) => x.kind === 'inbox');
  const msgs = out.filter((x) => x.kind === 'tg');
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual(rows.map((r) => r['Статус']), ['Нова', 'AI: не підходить', 'Нова']);
  assert.match(rows[2]['AI-коментар'], /AI недоступний/);
  assert.match(msgs[0].payload.text, /Нових вакансій: 2/);
  assert.strictEqual(msgs.length, 3, 'header + 2 cards');
  const buttons = msgs[1].payload.reply_markup.inline_keyboard[0];
  assert.match(buttons[0].callback_data, /^a:[0-9a-z]+$/);
});

// ------------------------------------------------------------- telegram bot

const botNodes = (update) => ({ 'Розібрати оновлення': [{ updates: [].concat(update) }], 'Вакансії: прочитати': MAIN, 'Знайдені: прочитати': INBOX });
const message = (text, chat = 42) => ({ update_id: 1, message: { message_id: 10, chat: { id: chat }, text } });
const callback = (data) => ({ update_id: 2, callback_query: { id: 'cb1', data, message: { message_id: 11, chat: { id: 42 } } } });

test('poll: no updates stops the run, updates are confirmed right away', async () => {
  assert.deepStrictEqual(await runCode('bot/poll.js', { input: [{ ok: true, result: [] }] }), []);
  assert.deepStrictEqual(await runCode('bot/poll.js', { input: [{}] }), [], 'network error: just wait for the next tick');
  const [r] = await runCode('bot/poll.js', { input: [{ ok: true, result: [{ update_id: 7 }, { update_id: 9 }] }] });
  assert.deepStrictEqual(r.body, { offset: 10, limit: 1, timeout: 0 });
  assert.strictEqual(r.updates.length, 2);
  const [fix] = await runCode('bot/poll.js', { input: [{ ok: false, error_code: 409, description: 'Conflict: can\'t use getUpdates method while webhook is active' }] });
  assert.strictEqual(fix.method, 'deleteWebhook');
});

test('bot: several updates in one poll, two additions get different rows', async () => {
  const out = await runCode('bot/bot.js', { nodes: botNodes([
    message('https://jobs.dou.ua/companies/a/vacancies/1/'),
    message('https://jobs.dou.ua/companies/b/vacancies/2/'),
  ]) });
  assert.deepStrictEqual(out.map((x) => x.row_number), [7, 8]);
});

test('bot: ignores strangers but tells them their chat id on /start', async () => {
  assert.deepStrictEqual(await runCode('bot/bot.js', { nodes: botNodes(message('/list', 7)) }), []);
  const out = await runCode('bot/bot.js', { nodes: botNodes(message('/start', 7)) });
  assert.match(out[0].payload.text, /chat id: 7/);
});

test('bot: /start sets commands and the reply keyboard', async () => {
  const out = await runCode('bot/bot.js', { nodes: botNodes(message('/start')) });
  assert.deepStrictEqual(out.map((x) => x.method), ['setMyCommands', 'sendMessage']);
  assert.ok(out[1].payload.reply_markup.keyboard.length >= 3);
});

test('bot: /list shows only active vacancies with stage buttons', async () => {
  const [m] = await runCode('bot/bot.js', { nodes: botNodes(message('📋 Активні')) });
  const labels = m.payload.reply_markup.inline_keyboard.map((r) => r[0].text);
  assert.ok(labels.some((l) => l.startsWith('Byte Ensemble')));
  assert.ok(!labels.some((l) => l.startsWith('Paystream')), 'closed ones hidden');
});

test('bot: changing a stage writes the sheet, history and edits the message', async () => {
  const [m] = await runCode('bot/bot.js', { nodes: botNodes(message('/list')) });
  const webby = m.payload.reply_markup.inline_keyboard.find((r) => r[0].text.startsWith('Pixelforge'))[0];
  const menu = await runCode('bot/bot.js', { nodes: botNodes(callback(webby.callback_data)) });
  const stageBtn = menu[1].payload.reply_markup.inline_keyboard.flat().find((b) => b.text === 'Відгукнулась');
  const out = await runCode('bot/bot.js', { nodes: botNodes(callback(stageBtn.callback_data)) });
  const upd = out.find((x) => x.kind === 'updMain');
  assert.strictEqual(upd.row_number, 5);
  assert.strictEqual(upd['Етап'], 'Відгукнулась');
  assert.match(upd['Дата відгуку'], /^\d{4}-\d{2}-\d{2}$/, 'application date filled when empty');
  assert.ok(out.find((x) => x.kind === 'hist'));
  assert.strictEqual(out.find((x) => x.kind === 'tg' && x.method === 'editMessageText').payload.message_id, 11);
});

test('bot: rejection asks for a reason and stores it', async () => {
  const [m] = await runCode('bot/bot.js', { nodes: botNodes(message('/list')) });
  const bits = m.payload.reply_markup.inline_keyboard.find((r) => r[0].text.startsWith('Byte'))[0];
  const key = bits.callback_data.split(':')[1];
  const out = await runCode('bot/bot.js', { nodes: botNodes(callback(`s:${key}:8`)) });
  const edit = out.find((x) => x.method === 'editMessageText');
  assert.match(edit.payload.text, /Яка причина/);
  const r = await runCode('bot/bot.js', { nodes: botNodes(callback(`r:${key}:0`)) });
  assert.strictEqual(r.find((x) => x.kind === 'updMain')['Причина відмови'], 'Мало досвіду');
});

test('bot: adding from the inbox writes a new row below the last one', async () => {
  const [hdr, card] = await runCode('bot/bot.js', { nodes: botNodes(message('/inbox')) });
  assert.match(hdr.payload.text, /Нерозібраних: 1/);
  const add = card.payload.reply_markup.inline_keyboard[0][0].callback_data;
  const out = await runCode('bot/bot.js', { nodes: botNodes(callback(add)) });
  const row = out.find((x) => x.kind === 'updMain');
  assert.strictEqual(row.row_number, 7);
  assert.strictEqual(row['Компанія'], 'Summit Software');
  assert.strictEqual(row['Етап'], 'Хочу відгукнутись');
  assert.strictEqual(out.find((x) => x.kind === 'updInbox')['Статус'], 'Додано');
  const skip = await runCode('bot/bot.js', { nodes: botNodes(callback(add.replace('a:', 'x:'))) });
  assert.strictEqual(skip.find((x) => x.kind === 'updInbox')['Статус'], 'Пропущено');
});

test('bot: a stale button does not touch the wrong row', async () => {
  const out = await runCode('bot/bot.js', { nodes: botNodes(callback('s:zzzz:1')) });
  assert.ok(!out.some((x) => x.kind === 'updMain'));
  assert.match(out.find((x) => x.method === 'editMessageText').payload.text, /Таблиця змінилась/);
});

test('bot: links, commands that start other workflows, stats', async () => {
  const known = await runCode('bot/bot.js', { nodes: botNodes(message('https://jobs.dou.ua/companies/pixelforge/vacancies/444/?from=list')) });
  assert.match(known[0].payload.text, /вже є/);
  const fresh = await runCode('bot/bot.js', { nodes: botNodes(message('https://jobs.dou.ua/companies/new/vacancies/9/')) });
  assert.deepStrictEqual(fresh, [{ kind: 'fetchPage', url: 'https://jobs.dou.ua/companies/new/vacancies/9/', row_number: 7 }]);
  const search = await runCode('bot/bot.js', { nodes: botNodes(message('🔎 Шукати нові')) });
  assert.deepStrictEqual(search.map((x) => x.kind), ['runSearch', 'tg']);
  const stats = await runCode('bot/bot.js', { nodes: botNodes(message('/stats')) });
  assert.match(stats[0].payload.text, /Відмов: 2/);
});

test('page: parses a DOU vacancy page into a row', async () => {
  const html = '<html><head><title>Trainee QA в Nordlight, Львів, віддалено | DOU</title><meta property="og:title" content="Trainee QA"></head><body><span class="salary">$300–500</span></body></html>';
  const out = await runCode('bot/page.js', {
    input: [{ data: html }],
    nodes: { 'Логіка бота': [{ kind: 'fetchPage', url: 'https://jobs.dou.ua/companies/nordlight/vacancies/5/', row_number: 9 }] },
  });
  const row = out[0];
  assert.deepStrictEqual([row.row_number, row['Компанія'], row['Позиція'], row['Локація'], row['Формат'], row['Зарплата'], row['Джерело']],
    [9, 'Nordlight', 'Trainee QA', 'Львів', 'Віддалено', '$300–500', 'DOU']);
  assert.strictEqual(out[2].kind, 'tg');
});

// ------------------------------------------------------------- digest

test('digest: overdue steps, due tomorrow, stale and ghosted applications', async () => {
  const day = (offset) => {
    const d = new Date(Date.now() + offset * 86400000);
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d).replace(/\//g, '.');
  };
  const rows = [
    { row_number: 2, 'Компанія': 'Ghost Co', 'Позиція': 'Intern', 'Етап': 'Відгукнулась', 'Етап змінено': day(-25) },
    { row_number: 3, 'Компанія': 'Late Co', 'Позиція': 'Trainee', 'Етап': "HR-інтерв'ю", 'Етап змінено': day(-2), 'Наступний крок': 'Надіслати портфоліо', 'Дата наступного кроку': day(-1) },
    { row_number: 4, 'Компанія': 'Soon Co', 'Позиція': 'PM', 'Етап': 'Тестове', 'Етап змінено': day(-1), 'Наступний крок': 'Здати кейс', 'Дата наступного кроку': day(1) },
    { row_number: 5, 'Компанія': 'Slow Co', 'Позиція': 'QA', 'Етап': 'Контакт з рекрутером', 'Етап змінено': day(-9) },
    { row_number: 6, 'Компанія': 'Done Co', 'Позиція': 'BA', 'Етап': 'Відмова', 'Етап змінено': day(-40) },
  ];
  const out = await runCode('digest/digest.js', { nodes: { 'Вакансії: прочитати': rows } });
  const msg = out.find((x) => x.kind === 'tg').payload.text;
  assert.match(msg, /Прострочено<\/b>\n• Late Co — Trainee: Надіслати портфоліо/);
  assert.match(msg, /Soon Co — PM: Здати кейс — завтра/);
  assert.match(msg, /Давно без руху<\/b>\n• Slow Co — QA \(Контакт з рекрутером, 9 дн\.\)/);
  assert.ok(!/Done Co/.test(msg), 'closed applications are ignored');
  const ghost = out.find((x) => x.kind === 'updMain');
  assert.deepStrictEqual([ghost.row_number, ghost['Етап']], [2, 'Немає відповіді']);
});

// ------------------------------------------------------------- rejections

test('rejections: picks letters without analysis, writes AI columns', async () => {
  const picked = await runCode('rejections/pick.js', { nodes: { 'Вакансії: прочитати': MAIN } });
  assert.deepStrictEqual(picked.map((x) => x.company), ['Paystream'], 'Gearbox Labs has no letter');
  const written = await runCode('rejections/write.js', {
    input: [{ output: { reason_category: 'Обрали іншого кандидата', gaps: [], advice: ['Більше практики'], next_action: 'Подякувати', door_open: true } }],
    nodes: { 'Нові відмови': picked },
  });
  assert.deepStrictEqual(written[0], {
    row_number: 2, 'AI: причина': 'Обрали іншого кандидата', 'AI: чого бракувало': '', 'AI: що підтягнути': 'Більше практики', 'AI: наступний крок': 'Подякувати (двері відчинені)',
  });
});

test('rejections: weekly summary asks AI for patterns; insights formats them', async () => {
  const analysed = MAIN.map((r) => (r['Етап'] === 'Відмова' ? Object.assign({}, r, { 'AI: причина': 'Мало досвіду' }) : r));
  const out = await runCode('rejections/summary.js', { nodes: { 'Режим: щотижня': [{ mode: 'weekly' }], 'Вакансії: прочитати': analysed } });
  const ai = out.find((x) => x.kind === 'ai');
  assert.strictEqual(ai.count, 2);
  const msg = await runCode('rejections/insights.js', {
    input: [{ output: { summary: 'Коротко.', patterns: ['Брак досвіду'], strengths: ['Мотивація'], focus_next: ['Портфоліо'] } }],
    nodes: { 'Підсумок': out },
  });
  assert.match(msg[0].payload.text, /Що повторюється/);
});

test('strip-kind: removes the routing field before writing to the sheet', async () => {
  const [r] = await runCode('search/strip-kind.js', { input: [{ kind: 'inbox', a: 1 }] });
  assert.deepStrictEqual(r, { a: 1 });
});
