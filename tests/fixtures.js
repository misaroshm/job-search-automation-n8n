// Test data shaped like real Google Sheets reads and RSS feeds.

const DOU_RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>DOU</title>
<item><title>Trainee QA в Nordlight, віддалено, $200–400</title>
<link>https://jobs.dou.ua/companies/nordlight/vacancies/111/?utm_source=jobsrss</link>
<description>&lt;p&gt;Шукаємо стажера. SQL, Postman, Jira — буде плюсом.&lt;/p&gt;</description></item>
<item><title>Junior Business Analyst в Acme, Львів</title>
<link>https://jobs.dou.ua/companies/acme/vacancies/222/?utm_source=jobsrss</link>
<description>&lt;p&gt;Experience 1+ year as Business Analyst is required.&lt;/p&gt;</description></item>
<item><title>Trainee Software Engineer (Node.js/React) в Beehive Soft, Львів, Рівне</title>
<link>https://jobs.dou.ua/companies/beehive/vacancies/333/?utm_source=jobsrss</link>
<description>&lt;p&gt;Foundational knowledge of the stack.&lt;/p&gt;</description></item>
<item><title>Junior MarTech Automation Specialist в Brightpath Inc, Київ, Львів, віддалено</title>
<link>https://jobs.dou.ua/companies/brightpath-inc/vacancies/376084/?utm_source=jobsrss</link>
<description><![CDATA[<p>n8n, Make, APIs. 6 months of experience is a plus.</p>]]></description></item>
<item><title>Project Manager Assistant в Pixelforge, віддалено</title>
<link>https://jobs.dou.ua/companies/pixelforge/vacancies/444/?utm_source=jobsrss</link>
<description>&lt;p&gt;Trainee-level, Jira, coordination.&lt;/p&gt;</description></item>
</channel></rss>`;

const DJINNI_RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Junior Project Coordinator</title><link>https://djinni.co/jobs/900001-junior-project-coordinator/</link>
<description>&lt;p&gt;&lt;b&gt;Coinly&lt;/b&gt; шукає координатора. Remote. Jira, комунікація з клієнтами.&lt;/p&gt;</description></item>
<item><title>Customer support manager (USA, night shift)</title><link>https://djinni.co/jobs/900002-support/</link>
<description>&lt;p&gt;Support role&lt;/p&gt;</description></item>
</channel></rss>`;

// "Вакансії" as the Sheets node returns it (FORMATTED_VALUE)
const MAIN = [
  { row_number: 2, 'Дата відгуку': '08.10.2026', 'Компанія': 'Paystream', 'Позиція': 'Junior Technical Analyst', 'Посилання': 'https://jobs.dou.ua/companies/paystream/vacancies/259752/', 'Етап': 'Відмова', 'Етап змінено': '27.10.2026', 'Причина відмови': 'Обрали іншого кандидата', 'Нотатки': 'Привіт! Дякуємо за час, який ти приділила співбесіді. Ми обговорили твою кандидатуру з командою і вирішили поки продовжити процес з іншими кандидатами. Бажаємо успіхів у пошуку!' },
  { row_number: 3, 'Дата відгуку': '27.10.2026', 'Компанія': 'Gearbox Labs', 'Позиція': 'Business Analyst Trainee', 'Посилання': '', 'Етап': 'Відмова', 'Етап змінено': '27.10.2026', 'Причина відмови': 'Слабка англійська', 'Нотатки': '' },
  { row_number: 4, 'Дата відгуку': '30.10.2026', 'Компанія': 'Byte Ensemble', 'Позиція': 'Trainee Lead Generation Specialist / SDR', 'Посилання': 'https://jobs.dou.ua/companies/byte-ensemble/vacancies/555/', 'Етап': 'Відгукнулась', 'Етап змінено': '30.10.2026', 'Наступний крок': 'Чекаю відповідь', 'Дата наступного кроку': '20.11.2026', 'Нотатки': '' },
  { row_number: 5, 'Дата відгуку': '', 'Компанія': 'Pixelforge', 'Позиція': 'Project Manager Assistant', 'Посилання': 'https://jobs.dou.ua/companies/pixelforge/vacancies/444/', 'Етап': 'Хочу відгукнутись', 'Етап змінено': '06.11.2026', 'Нотатки': '' },
  { row_number: 6, 'Компанія': 'Oldschool Games', 'Позиція': 'Project Manager (contest)', 'Посилання': 'https://jobs.dou.ua/companies/oldschool-games/vacancies/379831/', 'Етап': 'Тестове', 'Етап змінено': '20.11.2026', 'Наступний крок': 'Здати кейс', 'Дата наступного кроку': '24.11.2026' },
];

const INBOX = [
  { row_number: 2, 'Знайдено': '20.11.2026 09:00', 'Бал': 22, 'Компанія': 'Summit Software', 'Позиція': 'Junior QA Engineer', 'Локація': 'Львів', 'Зарплата': '$700–850', 'Джерело': 'DOU', 'Посилання': 'https://jobs.dou.ua/companies/summit-software/vacancies/380404/', 'Статус': 'Нова', 'AI-коментар': 'QA без вимог до досвіду, Львів' },
  { row_number: 3, 'Знайдено': '20.11.2026 09:00', 'Бал': 16, 'Компанія': 'Foo', 'Позиція': 'Intern PM', 'Локація': 'віддалено', 'Джерело': 'DOU', 'Посилання': 'https://jobs.dou.ua/companies/foo/vacancies/1/', 'Статус': 'Пропущено' },
];

module.exports = { DOU_RSS, DJINNI_RSS, MAIN, INBOX };
