#!/usr/bin/env node
// Creates n8n credentials from .env and the Google service-account key file,
// so nothing has to be clicked together by hand. Runs inside the n8n container:
//   node /setup/make-credentials.js /tmp/credentials.json

const fs = require('fs');

const out = process.argv[2] || '/tmp/credentials.json';
const need = (name) => {
  const v = (process.env[name] || '').trim();
  if (!v) { console.error(`✖ ${name} is empty in .env`); process.exit(1); }
  return v;
};

const keyPath = process.env.GOOGLE_KEY_FILE || '/setup/google-service-account.json';
if (!fs.existsSync(keyPath)) {
  console.error(`✖ Google service account key not found: ${keyPath}`);
  console.error('  Put the downloaded JSON key into setup/google-service-account.json');
  process.exit(1);
}
const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));

const credentials = [
  {
    id: 'jtTelegramCred01',
    name: 'Telegram bot',
    type: 'telegramApi',
    data: { accessToken: need('TELEGRAM_BOT_TOKEN'), baseUrl: 'https://api.telegram.org' },
  },
  {
    id: 'jtSheetsSA000001',
    name: 'Google Sheets (service account)',
    type: 'googleApi',
    data: { email: key.client_email, privateKey: key.private_key, region: 'eu-central-1' },
  },
  {
    id: 'jtGeminiCred0001',
    name: 'Google Gemini',
    type: 'googlePalmApi',
    data: { host: 'https://generativelanguage.googleapis.com', apiKey: need('GEMINI_API_KEY') },
  },
];

fs.writeFileSync(out, JSON.stringify(credentials, null, 2));
console.log(`✔ Credentials prepared (service account: ${key.client_email})`);
