// ---------------------------------------------------------------------------
// Shared helpers. The build script prepends this file to every Code node,
// so each node stays self-contained inside n8n.
// ---------------------------------------------------------------------------

const TZ = 'Europe/Kyiv';

const SHEET = {
  MAIN: 'Вакансії',
  INBOX: 'Знайдені',
  HISTORY: 'Історія',
};

// Column names in the "Вакансії" sheet (must match the header row exactly)
const COL = {
  APPLIED: 'Дата відгуку',
  COMPANY: 'Компанія',
  POSITION: 'Позиція',
  LINK: 'Посилання',
  SOURCE: 'Джерело',
  FORMAT: 'Формат',
  LOCATION: 'Локація',
  SALARY: 'Зарплата',
  STAGE: 'Етап',
  STAGE_DATE: 'Етап змінено',
  NEXT: 'Наступний крок',
  NEXT_DATE: 'Дата наступного кроку',
  REASON: 'Причина відмови',
  CONTACT: 'Контакт',
  PRIORITY: 'Пріоритет',
  NOTES: 'Нотатки',
  AI_REASON: 'AI: причина',
  AI_GAPS: 'AI: чого бракувало',
  AI_ADVICE: 'AI: що підтягнути',
  AI_ACTION: 'AI: наступний крок',
};

// Column names in the "Знайдені" sheet
const IN = {
  FOUND: 'Знайдено',
  SCORE: 'Бал',
  COMPANY: 'Компанія',
  POSITION: 'Позиція',
  LOCATION: 'Локація',
  SALARY: 'Зарплата',
  SOURCE: 'Джерело',
  LINK: 'Посилання',
  STATUS: 'Статус',
  AI: 'AI-коментар',
};

const STAGES = [
  'Хочу відгукнутись', 'Відгукнулась', 'Контакт з рекрутером', "HR-інтерв'ю",
  'Тестове', "Технічне інтерв'ю", "Фінальне інтерв'ю", 'Офер',
  'Відмова', 'Відмовилась сама', 'Немає відповіді',
];
const CLOSED = ['Офер', 'Відмова', 'Відмовилась сама', 'Немає відповіді'];

const REASONS = [
  'Мало досвіду', 'Не пройшла тестове', 'Обрали іншого кандидата', 'Слабка англійська',
  'Не підійшла по софт-скілах', 'Вакансію закрили', 'Не зійшлись по зарплаті',
  'Без пояснень', 'Моє рішення', 'Інше',
];

// Short, stable id for a row or a link (used in Telegram button data)
function hash(s) {
  let h = 0;
  s = String(s);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Normalised link: no protocol, www, query, fragment or trailing slash
function urlKey(u) {
  return String(u || '').trim().split('#')[0].split('?')[0]
    .replace(/\/$/, '').replace(/^https?:\/\/(www\.)?/i, '').toLowerCase();
}

// Id of a vacancy row in the main sheet
function rowKey(r) {
  const k = urlKey(r[COL.LINK]);
  return hash(k || (String(r[COL.COMPANY] || '') + '|' + String(r[COL.POSITION] || '')));
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function short(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Date parts in Kyiv time
function kyivParts(d) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = {};
  for (const x of f.formatToParts(d || new Date())) p[x.type] = x.value;
  if (p.hour === '24') p.hour = '00';
  return p;
}

function todayISO(d) {
  const p = kyivParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

function nowStamp(d) {
  const p = kyivParts(d);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

function fmtDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || '');
}

// Sheet dates arrive as "23.11.2026", "2026-11-23" or a serial number.
// Returns "YYYY-MM-DD" or "".
function parseDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') {
    const ms = Math.round((v - 25569) * 86400000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return '';
}

// Whole days between two "YYYY-MM-DD" dates (b - a)
function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

function isClosed(stage) {
  return CLOSED.indexOf(stage) !== -1;
}

// One Telegram Bot API call, executed later by the "Telegram API" HTTP node
function tg(method, payload) {
  return { json: { kind: 'tg', method, payload } };
}

function chatId() {
  return String($env.TELEGRAM_CHAT_ID || '');
}

function sendText(text, extra) {
  return tg('sendMessage', Object.assign({
    chat_id: chatId(), text, parse_mode: 'HTML', disable_web_page_preview: true,
  }, extra || {}));
}

function rowsOf(nodeName) {
  try {
    return $(nodeName).all().map((i) => i.json).filter((r) => r && r.row_number);
  } catch (e) {
    return [];
  }
}
