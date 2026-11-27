// Telegram bot brain. Reads the incoming update plus both sheets and returns
// a list of "effects" for the nodes after it. Each output item has a `kind`:
//   updMain   - write cells of a row in "Вакансії" (row_number + columns)
//   updInbox  - write cells of a row in "Знайдені"
//   hist      - append a row to "Історія"
//   fetchPage - open a vacancy link and add it (handled by the next branch)
//   runSearch / runDigest / runInsights - start another workflow
//   tg        - Telegram Bot API call

const BTN = { NEW: '🔎 Шукати нові', INBOX: '📬 Нерозібрані', LIST: '📋 Активні', TODAY: '🗓 Сьогодні', STATS: '📊 Статистика', INSIGHTS: '🧠 Аналіз відмов' };
const MAX_CARDS = Number($env.MAX_CARDS || 15);

const HELP = [
  'Що я вмію:',
  '/new — пошукати нові вакансії на DOU і Djinni',
  '/inbox — знайдені, які ти ще не розібрала',
  '/list — активні вакансії, натисни, щоб змінити етап',
  '/all — усі вакансії',
  '/today — що на сьогодні, що прострочено і що зависло',
  '/stats — статистика відгуків',
  '/insights — AI-аналіз текстів відмов',
  'Або просто надішли посилання на вакансію, і я додам її в таблицю.',
].join('\n');

const updates = $('Розібрати оновлення').first().json.updates || [];
const main = rowsOf('Вакансії: прочитати');
const inbox = rowsOf('Знайдені: прочитати');
const owner = chatId();
const today = todayISO();
const out = [];
let reservedRows = 0; // new rows created in this run, so two additions never share a row
let msg, cb, from;

const findMain = (key) => main.find((r) => rowKey(r) === key);
const findInbox = (h) => inbox.find((r) => hash(urlKey(r[IN.LINK])) === h);
const title = (r) => `<b>${esc(r[COL.COMPANY])}</b> — ${esc(r[COL.POSITION])}`;

for (const upd of updates) {
  msg = upd.message;
  cb = upd.callback_query;
  from = String(msg ? msg.chat.id : (cb ? cb.message.chat.id : ''));
  if (!from) continue;
  if (!owner || from !== owner) {
    // Helps with the first setup: tells you which id to put in .env
    if (msg && /^\/start/.test(msg.text || '')) {
      out.push(tg('sendMessage', { chat_id: from, text: `Твій chat id: ${from}\nВпиши його в .env як TELEGRAM_CHAT_ID і перезапусти n8n.` }));
    }
    continue;
  }
  if (cb) {
    out.push(tg('answerCallbackQuery', { callback_query_id: cb.id }));
    handleCallback(String(cb.data || ''));
  } else if (msg) {
    handleMessage(String(msg.text || '').trim());
  }
}
return out;

// ---------------------------------------------------------------------------

function edit(text, keyboard) {
  const p = { chat_id: from, message_id: cb.message.message_id, text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (keyboard) p.reply_markup = { inline_keyboard: keyboard };
  out.push(tg('editMessageText', p));
}

function say(text, keyboard) {
  out.push(sendText(text, keyboard ? { reply_markup: { inline_keyboard: keyboard } } : undefined));
}

function hist(company, position, was, now) {
  out.push({ json: { kind: 'hist', 'Коли': nowStamp(), 'Компанія': company || '', 'Позиція': position || '', 'Було': was || '', 'Стало': now } });
}

function nextFreeRow() {
  let last = 1;
  for (const r of main) {
    if (r[COL.COMPANY] || r[COL.POSITION] || r[COL.LINK]) last = Math.max(last, r.row_number);
  }
  reservedRows += 1;
  return last + reservedRows;
}

function handleMessage(text) {
  const t = text.toLowerCase();
  const url = text.match(/https?:\/\/\S+/);

  if (/^\/(start|help)/.test(t)) {
    out.push(tg('setMyCommands', { commands: [
      { command: 'new', description: 'Пошукати нові вакансії' },
      { command: 'inbox', description: 'Знайдені, але ще не розібрані' },
      { command: 'list', description: 'Активні вакансії, змінити етап' },
      { command: 'all', description: 'Усі вакансії' },
      { command: 'today', description: 'Що на сьогодні' },
      { command: 'stats', description: 'Статистика відгуків' },
      { command: 'insights', description: 'AI-аналіз відмов' },
      { command: 'help', description: 'Що вміє бот' },
    ] }));
    out.push(sendText(HELP, { reply_markup: {
      keyboard: [[{ text: BTN.NEW }, { text: BTN.INBOX }], [{ text: BTN.LIST }, { text: BTN.TODAY }], [{ text: BTN.STATS }, { text: BTN.INSIGHTS }]],
      resize_keyboard: true, is_persistent: true,
    } }));
    return;
  }
  if (/^\/list/.test(t) || text === BTN.LIST) return sendList(false);
  if (/^\/all/.test(t)) return sendList(true);
  if (/^\/inbox/.test(t) || text === BTN.INBOX) return sendInbox();
  if (/^\/stats/.test(t) || text === BTN.STATS) return sendStats();
  if (/^\/today/.test(t) || text === BTN.TODAY) { out.push({ json: { kind: 'runDigest' } }); return; }
  if (/^\/new/.test(t) || text === BTN.NEW) {
    out.push({ json: { kind: 'runSearch' } });
    say('🔎 Шукаю на DOU і Djinni і перевіряю через AI, це хвилина-дві…');
    return;
  }
  if (/^\/insights/.test(t) || text === BTN.INSIGHTS) {
    out.push({ json: { kind: 'runInsights' } });
    say('🧠 Аналізую тексти відмов, це до хвилини…');
    return;
  }
  if (url) return addLink(url[0]);
  say('Не зрозумів 🙃\n\n' + HELP);
}

function sendList(all) {
  const rows = main.filter((r) => r[COL.COMPANY] && (all || !isClosed(r[COL.STAGE])));
  if (!rows.length) return say(all ? 'Таблиця порожня.' : 'Активних вакансій немає. /all покаже всі.');
  say((all ? 'Усі вакансії.' : 'Активні вакансії.') + ' Натисни, щоб змінити етап:',
    rows.slice(0, 90).map((r) => [{
      text: short(`${r[COL.COMPANY]} · ${r[COL.POSITION]}`, 38) + ' | ' + (r[COL.STAGE] || '—'),
      callback_data: 'v:' + rowKey(r),
    }]));
}

function sendInbox() {
  const rows = inbox.filter((r) => r[IN.STATUS] === 'Нова')
    .sort((a, b) => Number(b[IN.SCORE] || 0) - Number(a[IN.SCORE] || 0));
  if (!rows.length) return say('Нерозібраних вакансій немає. /new, щоб пошукати нові.');
  say(`📬 Нерозібраних: ${rows.length}` + (rows.length > MAX_CARDS ? `, показую ${MAX_CARDS}` : ''));
  for (const r of rows.slice(0, MAX_CARDS)) {
    const meta = [r[IN.LOCATION], r[IN.SALARY]].filter(Boolean).join(' · ');
    const h = hash(urlKey(r[IN.LINK]));
    say(`🆕 <b>${esc(r[IN.COMPANY])}</b> — ${esc(r[IN.POSITION])}` +
      (meta ? `\n📍 ${esc(meta)}` : '') +
      `\n⭐ бал ${esc(r[IN.SCORE])} · ${esc(r[IN.SOURCE])}` +
      (r[IN.AI] ? `\n🤖 ${esc(r[IN.AI])}` : ''),
    [
      [{ text: '➕ Додати', callback_data: 'a:' + h }, { text: '✖ Пропустити', callback_data: 'x:' + h }],
      [{ text: 'Відкрити вакансію', url: String(r[IN.LINK]) }],
    ]);
  }
}

function sendStats() {
  const rows = main.filter((r) => r[COL.COMPANY]);
  const count = {};
  for (const r of rows) count[r[COL.STAGE] || '—'] = (count[r[COL.STAGE] || '—'] || 0) + 1;
  const applied = rows.filter((r) => r[COL.STAGE] && r[COL.STAGE] !== 'Хочу відгукнутись').length;
  const silent = (count['Відгукнулась'] || 0) + (count['Немає відповіді'] || 0);
  const answered = applied - silent;
  const reasons = {};
  for (const r of rows) {
    const k = r[COL.AI_REASON] || r[COL.REASON];
    if (r[COL.STAGE] === 'Відмова' && k) reasons[k] = (reasons[k] || 0) + 1;
  }
  const top = Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 3);
  say([
    '📊 <b>Статистика</b>',
    `Усього вакансій: ${rows.length}`,
    `Відгукнулась: ${applied}`,
    `Відповіли: ${answered} (${applied ? Math.round(answered / applied * 100) : 0}%)`,
    `Співбесіди і тестові: ${(count["HR-інтерв'ю"] || 0) + (count['Тестове'] || 0) + (count["Технічне інтерв'ю"] || 0) + (count["Фінальне інтерв'ю"] || 0)} зараз у процесі`,
    `Відмов: ${count['Відмова'] || 0} · Без відповіді: ${count['Немає відповіді'] || 0} · Оферів: ${count['Офер'] || 0}`,
    top.length ? '\nЧасті причини відмов:\n' + top.map(([k, n]) => `• ${esc(k)}: ${n}`).join('\n') : '',
  ].filter(Boolean).join('\n'));
}

function addLink(url) {
  const existing = main.find((r) => urlKey(r[COL.LINK]) === urlKey(url));
  if (existing) {
    return say(`Ця вакансія вже є: ${title(existing)} (${esc(existing[COL.STAGE] || '—')})`,
      [[{ text: 'Змінити етап', callback_data: 'v:' + rowKey(existing) }]]);
  }
  out.push({ json: { kind: 'fetchPage', url, row_number: nextFreeRow() } });
}

function handleCallback(data) {
  const [type, key, idxStr] = data.split(':');
  const idx = Number(idxStr);

  if (type === 'a' || type === 'x') {
    const r = findInbox(key);
    if (!r) return edit('Не знайшла цю вакансію на аркуші "Знайдені". Спробуй /inbox.');
    const t = `<b>${esc(r[IN.COMPANY])}</b> — ${esc(r[IN.POSITION])}`;
    if (r[IN.STATUS] !== 'Нова') return edit(`${t}\nУже: ${esc(r[IN.STATUS])}`);
    if (type === 'x') {
      out.push({ json: { kind: 'updInbox', row_number: r.row_number, [IN.STATUS]: 'Пропущено' } });
      return edit('✖ Пропущено: ' + t);
    }
    const loc = String(r[IN.LOCATION] || '');
    const remote = /віддалено|remote/i.test(loc);
    const row = {
      kind: 'updMain',
      row_number: nextFreeRow(),
      [COL.COMPANY]: r[IN.COMPANY] || '(уточнити)',
      [COL.POSITION]: r[IN.POSITION] || '',
      [COL.LINK]: r[IN.LINK],
      [COL.SOURCE]: r[IN.SOURCE] || '',
      [COL.FORMAT]: remote ? 'Віддалено' : '',
      [COL.LOCATION]: loc.split(',').map((s) => s.trim()).filter((s) => s && !/віддалено|remote/i.test(s)).join(', '),
      [COL.SALARY]: r[IN.SALARY] || '',
      [COL.STAGE]: 'Хочу відгукнутись',
      [COL.STAGE_DATE]: today,
      [COL.PRIORITY]: Number(r[IN.SCORE]) >= 25 ? 'Високий' : 'Середній',
      [COL.NOTES]: `Знайдено автопошуком, бал ${r[IN.SCORE]}` + (r[IN.AI] ? `. AI: ${r[IN.AI]}` : ''),
    };
    out.push({ json: row });
    out.push({ json: { kind: 'updInbox', row_number: r.row_number, [IN.STATUS]: 'Додано' } });
    hist(row[COL.COMPANY], row[COL.POSITION], '', 'Хочу відгукнутись (з Telegram)');
    return edit('✅ Додано в таблицю: ' + t + (row[COL.COMPANY] === '(уточнити)' ? '\nКомпанію впиши в таблиці вручну.' : ''),
      [[{ text: 'Змінити етап', callback_data: 'v:' + rowKey(row) }]]);
  }

  const r = findMain(key);
  if (!r) return edit('Таблиця змінилась, поки ти тут була. Натисни /list ще раз.');
  const current = r[COL.STAGE] || '—';

  if (type === 'v') {
    const kb = [];
    for (let i = 0; i < STAGES.length; i += 2) {
      kb.push([i, i + 1].filter((j) => j < STAGES.length).map((j) => ({
        text: (STAGES[j] === current ? '• ' : '') + STAGES[j],
        callback_data: `s:${key}:${j}`,
      })));
    }
    return say(`${title(r)}\nЗараз: ${esc(current)}\n\nОбери новий етап:`, kb);
  }

  if (type === 's') {
    const stage = STAGES[idx];
    if (!stage) return;
    const upd = { kind: 'updMain', row_number: r.row_number, [COL.STAGE]: stage, [COL.STAGE_DATE]: today };
    if (!r[COL.APPLIED] && stage !== 'Хочу відгукнутись') upd[COL.APPLIED] = today;
    if (!r[COL.PRIORITY]) upd[COL.PRIORITY] = 'Середній';
    out.push({ json: upd });
    hist(r[COL.COMPANY], r[COL.POSITION], current, stage + ' (з Telegram)');
    if (stage === 'Відмова') {
      return edit(`${title(r)}\n${esc(current)} → <b>Відмова</b>\n\nЯка причина?`,
        REASONS.map((x, j) => [{ text: x, callback_data: `r:${key}:${j}` }]));
    }
    return edit(`✅ ${title(r)}\n${esc(current)} → <b>${esc(stage)}</b>`);
  }

  if (type === 'r') {
    const reason = REASONS[idx];
    if (!reason) return;
    out.push({ json: { kind: 'updMain', row_number: r.row_number, [COL.REASON]: reason } });
    return edit(`✅ ${title(r)}\n<b>Відмова</b>, причина: ${esc(reason)}\n\nЯкщо є текст відмови, встав його в "Нотатки", і AI його розбере.`);
  }
}
