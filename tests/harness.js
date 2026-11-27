// Runs a Code-node source file the way n8n does, with fake $input, $() and $env.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const COMMON = fs.readFileSync(path.join(ROOT, 'src/lib/common.js'), 'utf8');
const CONFIG = fs.readFileSync(path.join(ROOT, 'config/profile.json'), 'utf8');

async function runCode(file, { input = [], nodes = {}, env = {} } = {}) {
  const body = fs.readFileSync(path.join(ROOT, 'src/code', file), 'utf8');
  const wrap = (arr) => arr.map((json) => ({ json }));
  const $input = { all: () => wrap(input), first: () => wrap(input)[0] };
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`Node "${name}" has not been executed`);
    const items = wrap(nodes[name]);
    return { all: () => items, first: () => items[0] };
  };
  const $env = Object.assign({ TELEGRAM_CHAT_ID: '42', SHEET_ID: 'sheet123' }, env);
  // eslint-disable-next-line no-new-func
  const fn = new Function('$input', '$', '$env', `return (async () => {\nconst CONFIG = ${CONFIG};\n${COMMON}\n${body}\n})();`);
  const out = await fn($input, $, $env);
  return out.map((i) => i.json);
}

module.exports = { runCode };
