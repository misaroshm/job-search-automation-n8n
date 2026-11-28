#!/usr/bin/env node
// Builds the n8n workflow JSON files in ./workflows from the sources in ./src.
// Every Code node gets src/lib/common.js prepended, so logic lives in plain .js
// files that are reviewed and unit-tested outside n8n.
//
//   node scripts/build.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const COMMON = fs.readFileSync(path.join(ROOT, 'src/lib/common.js'), 'utf8');
// Personal search settings, injected as CONFIG into the Code nodes that use them
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/profile.json'), 'utf8'));
delete CONFIG._comment;
const configBlock = (body) => (/\bCONFIG\b/.test(body)
  ? '// From config/profile.json\nconst CONFIG = ' + JSON.stringify(CONFIG, null, 2) + ';\n\n' : '');

// Fixed ids so workflows can call each other and credentials attach on import
const WF = {
  errors: 'jtErrorHandler01',
  search: 'jtVacancySearch1',
  bot: 'jtTelegramBot001',
  digest: 'jtDailyDigest001',
  rejections: 'jtRejections0001',
};
const CRED = {
  telegram: { telegramApi: { id: 'jtTelegramCred01', name: 'Telegram bot' } },
  sheets: { googleApi: { id: 'jtSheetsSA000001', name: 'Google Sheets (service account)' } },
  gemini: { googlePalmApi: { id: 'jtGeminiCred0001', name: 'Google Gemini' } },
};

const uuid = (seed) => {
  const h = crypto.createHash('sha1').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

// ---------------------------------------------------------------- node makers

function node(wf, name, type, typeVersion, position, parameters, extra) {
  return Object.assign({ id: uuid(wf + '/' + name), name, type, typeVersion, position, parameters }, extra || {});
}

function code(wf, name, file, position, extra) {
  const body = fs.readFileSync(path.join(ROOT, 'src/code', file), 'utf8');
  const jsCode = `// Source: src/code/${file} (+ src/lib/common.js). Edit there and run scripts/build.js.\n\n` +
    configBlock(body) + COMMON + '\n// ---------------------------------------------------------------------------\n\n' + body;
  return node(wf, name, 'n8n-nodes-base.code', 2, position, { jsCode }, extra);
}

function schedule(wf, name, cron, position) {
  return node(wf, name, 'n8n-nodes-base.scheduleTrigger', 1.4, position, {
    rule: { interval: [{ field: 'cronExpression', expression: cron }] },
    misfirePolicy: 'coalesce', // laptop was asleep at 9:00? run once when n8n is back
  });
}

function execTrigger(wf, name, position) {
  return node(wf, name, 'n8n-nodes-base.executeWorkflowTrigger', 1.1, position, { inputSource: 'passthrough' });
}

function execWorkflow(wf, name, workflowId, position) {
  return node(wf, name, 'n8n-nodes-base.executeWorkflow', 1.2, position, {
    source: 'database',
    workflowId: { __rl: true, mode: 'id', value: workflowId },
    workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
    options: { waitForSubWorkflow: false },
  });
}

const sheetRef = (sheet) => ({
  authentication: 'serviceAccount',
  resource: 'sheet',
  documentId: { __rl: true, mode: 'id', value: '={{ $env.SHEET_ID }}' },
  sheetName: { __rl: true, mode: 'name', value: sheet },
});

function sheetsRead(wf, name, sheet, position) {
  return node(wf, name, 'n8n-nodes-base.googleSheets', 4.7, position, Object.assign(sheetRef(sheet), {
    operation: 'read',
    filtersUI: {},
    options: { outputFormatting: { values: { general: 'FORMATTED_VALUE', date: 'FORMATTED_STRING' } } },
  }), { credentials: CRED.sheets, executeOnce: true, alwaysOutputData: true, retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 });
}

function sheetsUpdate(wf, name, sheet, position, extraData) {
  return node(wf, name, 'n8n-nodes-base.googleSheets', 4.7, position, Object.assign(sheetRef(sheet), {
    operation: 'update',
    columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: ['row_number'], schema: [], attemptToConvertTypes: false, convertFieldsToString: false },
    options: { handlingExtraData: extraData || 'ignoreIt' },
  }), { credentials: CRED.sheets, retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 });
}

function sheetsAppend(wf, name, sheet, position, extraData) {
  return node(wf, name, 'n8n-nodes-base.googleSheets', 4.7, position, Object.assign(sheetRef(sheet), {
    operation: 'append',
    columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: false },
    options: { handlingExtraData: extraData || 'ignoreIt' },
  }), { credentials: CRED.sheets, retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 });
}

// Routes items to output N, where N is computed from the item
function switchBy(wf, name, expression, outputs, position) {
  return node(wf, name, 'n8n-nodes-base.switch', 3.5, position, { mode: 'expression', numberOutputs: outputs, output: expression });
}

function telegramApi(wf, position) {
  return node(wf, 'Telegram API', 'n8n-nodes-base.httpRequest', 4.5, position, {
    method: 'POST',
    url: '=https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/{{ $json.method }}',
    sendBody: true,
    contentType: 'json',
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.payload) }}',
    options: {
      batching: { batch: { batchSize: 1, batchInterval: 60 } }, // keeps messages in order
      response: { response: { neverError: true } },             // "message is not modified" is not a failure
      timeout: 15000,
    },
  }, { retryOnFail: true, maxTries: 5, waitBetweenTries: 5000 });
}

// One Telegram call whose body is built from the item; failures never stop the run
function tgCall(wf, name, position, jsonBody, method) {
  return node(wf, name, 'n8n-nodes-base.httpRequest', 4.5, position, {
    method: 'POST',
    url: `=https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/${method || '{{ $json.method }}'}`,
    sendBody: true,
    contentType: 'json',
    specifyBody: 'json',
    jsonBody,
    options: { response: { response: { neverError: true } }, timeout: 10000 },
  }, { onError: 'continueRegularOutput', executeOnce: true, alwaysOutputData: true });
}

function gemini(wf, name, position) {
  return node(wf, name, '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', 1.2, position, {
    modelName: '={{ $env.GEMINI_MODEL || "models/gemini-3.5-flash-lite" }}',
    options: { temperature: 0.2, maxOutputTokens: 2048 },
  }, { credentials: CRED.gemini });
}

function extractor(wf, name, position, schema, systemPrompt, batching) {
  return node(wf, name, '@n8n/n8n-nodes-langchain.informationExtractor', 1.2, position, {
    text: '={{ $json.aiText }}',
    schemaType: 'manual',
    inputSchema: JSON.stringify(schema, null, 2),
    options: Object.assign({ systemPromptTemplate: systemPrompt }, batching ? { batching } : {}),
  }, { onError: 'continueRegularOutput', retryOnFail: true, maxTries: 2, waitBetweenTries: 5000 });
}

// ---------------------------------------------------------------- wiring

function wire(list) {
  const c = {};
  for (const [from, to, outIndex = 0, type = 'main', inIndex = 0] of list) {
    c[from] = c[from] || {};
    c[from][type] = c[from][type] || [];
    while (c[from][type].length <= outIndex) c[from][type].push([]);
    c[from][type][outIndex].push({ node: to, type, index: inIndex });
  }
  return c;
}

function workflow(id, name, nodes, connections, opts) {
  const extraSettings = (opts && opts.settings) || {};
  return {
    id,
    name,
    active: !(opts && opts.inactive),
    nodes,
    connections: wire(connections),
    settings: Object.assign({
      executionOrder: 'v1',
      timezone: 'Europe/Kyiv',
      saveManualExecutions: true,
      callerPolicy: 'workflowsFromSameOwner',
    }, id === WF.errors ? {} : { errorWorkflow: WF.errors }, extraSettings),
    pinData: {},
    meta: { templateCredsSetupCompleted: true },
    tags: [],
  };
}

// ---------------------------------------------------------------- AI schemas

const { FIT_SCHEMA, FIT_PROMPT } = require('./prompts');

const REJECTION_SCHEMA = {
  type: 'object',
  properties: {
    reason_category: { type: 'string', enum: ['Мало досвіду', 'Не пройшла тестове', 'Обрали іншого кандидата', 'Слабка англійська', 'Не підійшла по софт-скілах', 'Вакансію закрили', 'Не зійшлись по зарплаті', 'Без пояснень', 'Моє рішення', 'Інше'] },
    gaps: { type: 'array', items: { type: 'string' }, description: 'Concrete things the company said were missing (Ukrainian). Empty if the letter is a template.' },
    advice: { type: 'array', items: { type: 'string' }, description: '1-3 concrete things to improve before the next interview (Ukrainian)' },
    next_action: { type: 'string', description: 'One concrete follow-up step with this company, in Ukrainian' },
    door_open: { type: 'boolean', description: 'Did the company explicitly offer to stay in touch, refer, or consider for other roles?' },
  },
  required: ['reason_category', 'gaps', 'advice', 'next_action', 'door_open'],
};
const REJECTION_PROMPT = `You analyse rejection letters received by an entry-level job candidate in Ukrainian IT.
Separate polite template phrases from real signals. Only list a gap if the letter actually says or clearly implies it;
if the letter is a pure template, say so instead of inventing reasons.
"next_action" must be specific to this letter (e.g. reply and accept the offered referral, ask for detailed feedback, fill in the feedback form).
Answer in Ukrainian. Only extract the requested fields.`;

const INSIGHTS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Two sentences in Ukrainian: the overall picture' },
    patterns: { type: 'array', items: { type: 'string' }, description: 'Problems that repeat across several rejections (Ukrainian)' },
    strengths: { type: 'array', items: { type: 'string' }, description: 'What companies noted positively (Ukrainian)' },
    focus_next: { type: 'array', items: { type: 'string' }, description: '2-3 concrete priorities for the next two weeks (Ukrainian)' },
  },
  required: ['summary', 'patterns', 'strengths', 'focus_next'],
};
const INSIGHTS_PROMPT = `You review a list of analysed job rejections of one entry-level candidate and find patterns.
Be honest and concrete, no generic career advice. A pattern needs at least two rejections behind it.
Answer in Ukrainian. Only extract the requested fields.`;

// ---------------------------------------------------------------- workflows

function errorsWorkflow() {
  const w = WF.errors;
  return workflow(w, '0 · Сповіщення про помилки', [
    node(w, 'Помилка у workflow', 'n8n-nodes-base.errorTrigger', 1, [0, 0], {}),
    code(w, 'Текст помилки', 'errors/format.js', [240, 0]),
    telegramApi(w, [480, 0]),
  ], [
    ['Помилка у workflow', 'Текст помилки'],
    ['Текст помилки', 'Telegram API'],
  ]);
}

function searchWorkflow() {
  const w = WF.search;
  return workflow(w, '1 · Пошук вакансій (DOU + Djinni + AI)', [
    schedule(w, 'Щодня о 9:00 і 19:00', '0 9,19 * * *', [0, 0]),
    execTrigger(w, 'Виклик з бота', [0, 200]),
    code(w, 'Стрічки', 'search/feeds.js', [240, 100]),
    node(w, 'Завантажити RSS', 'n8n-nodes-base.httpRequest', 4.5, [480, 100], {
      url: '={{ $json.url }}',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'User-Agent', value: 'Mozilla/5.0 (compatible; job-tracker/1.0)' }] },
      options: {
        batching: { batch: { batchSize: 6, batchInterval: 300 } },
        response: { response: { responseFormat: 'text', outputPropertyName: 'data', neverError: true } },
        timeout: 20000,
      },
    }, { onError: 'continueRegularOutput' }),
    code(w, 'Розібрати й оцінити', 'search/parse-score.js', [720, 100]),
    sheetsRead(w, 'Знайдені: прочитати', 'Знайдені', [960, 100]),
    sheetsRead(w, 'Вакансії: прочитати', 'Вакансії', [1200, 100]),
    code(w, 'Лише нові', 'search/only-new.js', [1440, 100]),
    switchBy(w, 'Є нові?', '={{ $json.route }}', 2, [1680, 100]),
    node(w, 'Сторінки вакансій', 'n8n-nodes-base.httpRequest', 4.5, [1920, 0], {
      url: '={{ $json.url }}',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'User-Agent', value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' }] },
      options: {
        batching: { batch: { batchSize: 2, batchInterval: 500 } },
        response: { response: { responseFormat: 'text', outputPropertyName: 'data', neverError: true } },
        timeout: 20000,
      },
    }, { onError: 'continueRegularOutput', alwaysOutputData: true }),
    code(w, 'Компанія зі сторінки', 'search/company.js', [2160, 0]),
    extractor(w, 'AI: чи підходить', [2400, 0], FIT_SCHEMA, FIT_PROMPT, { batchSize: 2, delayBetweenBatches: 13000 }),
    gemini(w, 'Gemini', [2400, 220]),
    code(w, 'Готові картки', 'search/cards.js', [2680, 0]),
    switchBy(w, 'Рядки чи повідомлення', '={{ $json.kind === "tg" ? 1 : 0 }}', 2, [2920, 0]),
    code(w, 'Без службових полів', 'search/strip-kind.js', [3160, -100]),
    sheetsAppend(w, 'Знайдені: додати', 'Знайдені', [3400, -100], 'insertInNewColumn'),
    code(w, 'Нічого нового', 'search/nothing-new.js', [1920, 400]),
    telegramApi(w, [3400, 200]),
  ], [
    ['Щодня о 9:00 і 19:00', 'Стрічки'],
    ['Виклик з бота', 'Стрічки'],
    ['Стрічки', 'Завантажити RSS'],
    ['Завантажити RSS', 'Розібрати й оцінити'],
    ['Розібрати й оцінити', 'Знайдені: прочитати'],
    ['Знайдені: прочитати', 'Вакансії: прочитати'],
    ['Вакансії: прочитати', 'Лише нові'],
    ['Лише нові', 'Є нові?'],
    ['Є нові?', 'Сторінки вакансій', 0],
    ['Сторінки вакансій', 'Компанія зі сторінки'],
    ['Компанія зі сторінки', 'AI: чи підходить'],
    ['Є нові?', 'Нічого нового', 1],
    ['Gemini', 'AI: чи підходить', 0, 'ai_languageModel'],
    ['AI: чи підходить', 'Готові картки'],
    ['Готові картки', 'Рядки чи повідомлення'],
    ['Рядки чи повідомлення', 'Без службових полів', 0],
    ['Рядки чи повідомлення', 'Telegram API', 1],
    ['Без службових полів', 'Знайдені: додати'],
    ['Нічого нового', 'Telegram API'],
  ]);
}

function botWorkflow() {
  const w = WF.bot;
  const KINDS = ['updMain', 'updInbox', 'hist', 'fetchPage', 'runSearch', 'runDigest', 'runInsights', 'tg'];
  const kindExpr = `={{ ${JSON.stringify(KINDS)}.indexOf($json.kind) }}`;
  return workflow(w, '2 · Telegram-бот', [
    // Polling, not a webhook: the laptop sleeps, so nothing on the internet should have to reach it
    node(w, 'Кожні 5 секунд', 'n8n-nodes-base.scheduleTrigger', 1.4, [-720, 200], {
      rule: { interval: [{ field: 'seconds', secondsInterval: 5 }] },
    }),
    tgCall(w, 'Нові повідомлення', [-480, 200], "={{ JSON.stringify({ timeout: 0, limit: 20, allowed_updates: ['message', 'callback_query'] }) }}", 'getUpdates'),
    code(w, 'Розібрати оновлення', 'bot/poll.js', [-240, 200]),
    tgCall(w, 'Підтвердити отримання', [0, 200], '={{ JSON.stringify($json.body) }}'),
    sheetsRead(w, 'Вакансії: прочитати', 'Вакансії', [240, 200]),
    sheetsRead(w, 'Знайдені: прочитати', 'Знайдені', [480, 200]),
    code(w, 'Логіка бота', 'bot/bot.js', [720, 200]),
    switchBy(w, 'Дії', kindExpr, KINDS.length, [960, 200]),
    sheetsUpdate(w, 'Вакансії: оновити', 'Вакансії', [1280, -200]),
    sheetsUpdate(w, 'Знайдені: оновити', 'Знайдені', [1280, -40]),
    sheetsAppend(w, 'Історія: додати', 'Історія', [1280, 120]),
    node(w, 'Відкрити сторінку', 'n8n-nodes-base.httpRequest', 4.5, [1280, 280], {
      url: '={{ $json.url }}',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'User-Agent', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' }] },
      options: { response: { response: { responseFormat: 'text', outputPropertyName: 'data', neverError: true } }, timeout: 20000 },
    }, { onError: 'continueRegularOutput' }),
    code(w, 'Розібрати сторінку', 'bot/page.js', [1520, 280]),
    switchBy(w, 'Дії з посиланням', kindExpr, KINDS.length, [1760, 280]),
    execWorkflow(w, 'Запустити пошук', WF.search, [1280, 440]),
    execWorkflow(w, 'Запустити зведення', WF.digest, [1280, 600]),
    execWorkflow(w, 'Запустити аналіз відмов', WF.rejections, [1280, 760]),
    telegramApi(w, [2040, 480]),
  ], [
    ['Кожні 5 секунд', 'Нові повідомлення'],
    ['Нові повідомлення', 'Розібрати оновлення'],
    ['Розібрати оновлення', 'Підтвердити отримання'],
    ['Підтвердити отримання', 'Вакансії: прочитати'],
    ['Вакансії: прочитати', 'Знайдені: прочитати'],
    ['Знайдені: прочитати', 'Логіка бота'],
    ['Логіка бота', 'Дії'],
    ['Дії', 'Вакансії: оновити', 0],
    ['Дії', 'Знайдені: оновити', 1],
    ['Дії', 'Історія: додати', 2],
    ['Дії', 'Відкрити сторінку', 3],
    ['Дії', 'Запустити пошук', 4],
    ['Дії', 'Запустити зведення', 5],
    ['Дії', 'Запустити аналіз відмов', 6],
    ['Дії', 'Telegram API', 7],
    ['Відкрити сторінку', 'Розібрати сторінку'],
    ['Розібрати сторінку', 'Дії з посиланням'],
    ['Дії з посиланням', 'Вакансії: оновити', 0],
    ['Дії з посиланням', 'Історія: додати', 2],
    ['Дії з посиланням', 'Telegram API', 7],
  ], { settings: { saveDataSuccessExecution: 'none' } }); // a poll every 5 s: keep only failed runs
}

function digestWorkflow() {
  const w = WF.digest;
  const KINDS = ['updMain', 'hist', 'tg'];
  return workflow(w, '3 · Ранкове зведення', [
    schedule(w, 'Щодня о 9:05', '5 9 * * *', [0, 0]),
    execTrigger(w, 'Виклик з бота', [0, 200]),
    sheetsRead(w, 'Вакансії: прочитати', 'Вакансії', [240, 100]),
    code(w, 'Зведення', 'digest/digest.js', [480, 100]),
    switchBy(w, 'Дії', `={{ ${JSON.stringify(KINDS)}.indexOf($json.kind) }}`, KINDS.length, [720, 100]),
    sheetsUpdate(w, 'Вакансії: оновити', 'Вакансії', [960, -60]),
    sheetsAppend(w, 'Історія: додати', 'Історія', [960, 100]),
    telegramApi(w, [960, 260]),
  ], [
    ['Щодня о 9:05', 'Вакансії: прочитати'],
    ['Виклик з бота', 'Вакансії: прочитати'],
    ['Вакансії: прочитати', 'Зведення'],
    ['Зведення', 'Дії'],
    ['Дії', 'Вакансії: оновити', 0],
    ['Дії', 'Історія: додати', 1],
    ['Дії', 'Telegram API', 2],
  ]);
}

function rejectionsWorkflow() {
  const w = WF.rejections;
  const mode = (m) => `return [{ json: { mode: '${m}' } }];`;
  const modeNode = (name, m, pos) => node(w, name, 'n8n-nodes-base.code', 2, pos, { jsCode: mode(m) });
  return workflow(w, '4 · AI-аналіз відмов', [
    schedule(w, 'Щодня о 20:00', '0 20 * * *', [0, -100]),
    schedule(w, 'Щопонеділка о 10:00', '0 10 * * 1', [0, 100]),
    execTrigger(w, 'Виклик з бота', [0, 300]),
    modeNode('Режим: щодня', 'daily', [240, -100]),
    modeNode('Режим: щотижня', 'weekly', [240, 100]),
    modeNode('Режим: з бота', 'insights', [240, 300]),
    sheetsRead(w, 'Вакансії: прочитати', 'Вакансії', [480, 100]),
    code(w, 'Нові відмови', 'rejections/pick.js', [720, 100]),
    switchBy(w, 'Є що розібрати?', '={{ $json.route }}', 2, [960, 100]),
    extractor(w, 'AI: розбір відмови', [1200, 0], REJECTION_SCHEMA, REJECTION_PROMPT, { batchSize: 2, delayBetweenBatches: 13000 }),
    gemini(w, 'Gemini', [1200, 220]),
    code(w, 'Записати розбір', 'rejections/write.js', [1440, 0]),
    sheetsUpdate(w, 'Вакансії: записати AI', 'Вакансії', [1680, 0], 'insertInNewColumn'),
    code(w, 'Підсумок', 'rejections/summary.js', [1920, 200]),
    switchBy(w, 'Куди', '={{ $json.kind === "ai" ? 1 : 0 }}', 2, [2160, 200]), // cards first, then the AI summary
    // n8n runs parallel branches top to bottom by canvas position:
    // Telegram API sits above the AI branch so rejection cards go out before the summary
    extractor(w, 'AI: спільні патерни', [2400, 360], INSIGHTS_SCHEMA, INSIGHTS_PROMPT),
    gemini(w, 'Gemini (висновки)', [2400, 580]),
    code(w, 'Висновки', 'rejections/insights.js', [2640, 360]),
    telegramApi(w, [2880, 100]),
  ], [
    ['Щодня о 20:00', 'Режим: щодня'],
    ['Щопонеділка о 10:00', 'Режим: щотижня'],
    ['Виклик з бота', 'Режим: з бота'],
    ['Режим: щодня', 'Вакансії: прочитати'],
    ['Режим: щотижня', 'Вакансії: прочитати'],
    ['Режим: з бота', 'Вакансії: прочитати'],
    ['Вакансії: прочитати', 'Нові відмови'],
    ['Нові відмови', 'Є що розібрати?'],
    ['Є що розібрати?', 'AI: розбір відмови', 0],
    ['Є що розібрати?', 'Підсумок', 1],
    ['Gemini', 'AI: розбір відмови', 0, 'ai_languageModel'],
    ['AI: розбір відмови', 'Записати розбір'],
    ['Записати розбір', 'Вакансії: записати AI'],
    ['Вакансії: записати AI', 'Підсумок'],
    ['Підсумок', 'Куди'],
    ['Куди', 'Telegram API', 0],
    ['Куди', 'AI: спільні патерни', 1],
    ['Gemini (висновки)', 'AI: спільні патерни', 0, 'ai_languageModel'],
    ['AI: спільні патерни', 'Висновки'],
    ['Висновки', 'Telegram API'],
  ]);
}

// ---------------------------------------------------------------- write files

const outDir = path.join(ROOT, 'workflows');
fs.mkdirSync(outDir, { recursive: true });
const all = [
  ['0-errors.json', errorsWorkflow()],
  ['1-vacancy-search.json', searchWorkflow()],
  ['2-telegram-bot.json', botWorkflow()],
  ['3-daily-digest.json', digestWorkflow()],
  ['4-rejection-analysis.json', rejectionsWorkflow()],
];
for (const [file, wf] of all) {
  fs.writeFileSync(path.join(outDir, file), JSON.stringify(wf, null, 2) + '\n');
  console.log(`${file}: ${wf.nodes.length} nodes`);
}

module.exports = { WF, CRED };
