#!/usr/bin/env node
// Functional test for the output-task engine in references/main.js.
//
//   node scripts/test-output-task.mjs
//
// Builds a throwaway one-module course, loads it in headless Chrome, types into
// the textarea like a learner would, and asserts what they would actually see.
// Structure is validate.mjs's job; this covers the behaviour it cannot see.
//
// Requires Google Chrome (override with CHROME_PATH).

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'output-task-test-'));

/* ── Fixture: the smallest course that contains one output task ── */
const base = fs
  .readFileSync(path.join(ROOT, 'references', '_base.html'), 'utf8')
  .replace(/COURSE_TITLE/g, 'output-task test')
  .replace('ACCENT_COLOR', '#D94F30').replace('ACCENT_HOVER', '#C4432A')
  .replace('ACCENT_LIGHT', '#FDEEE9').replace('ACCENT_MUTED', '#E8836C')
  .replace('        NAV_DOTS', '        <button class="nav-dot" data-target="module-1" data-tooltip="m1" role="tab" aria-label="Module 1"></button>');

fs.mkdirSync(path.join(work, 'modules'), { recursive: true });
fs.writeFileSync(path.join(work, '_base.html'), base);
fs.writeFileSync(path.join(work, 'modules', '01.html'), `<section class="module" id="module-1" style="background: var(--color-bg)">
  <div class="module-content">
    <header class="module-header"><span class="module-number">01</span><h1 class="module-title">测试</h1></header>
    <div class="output-task" id="task-test" data-type="retell" data-min="10">
      <span class="output-task-label"></span>
      <h3 class="quiz-question">用你自己的话说一遍。</h3>
      <textarea class="output-task-input" rows="4" placeholder="写点什么"></textarea>
      <div class="output-task-meter"></div>
      <button class="quiz-check-btn output-task-reveal-btn" disabled>我说完了，看对照清单</button>
      <div class="output-task-checklist" hidden>
        <label><input type="checkbox"> 说出了 <code lang="en">store.js</code></label>
        <label><input type="checkbox"> 提到了中间件（middleware）</label>
        <label><input type="checkbox"> 说清楚了顺序</label>
      </div>
    </div>
  </div>
</section>`);

// The fixture has no code blocks, so any real directory satisfies --source.
// build.mjs assembles index.html and THEN validates; this fixture is a
// one-module test harness, not a publishable course, so it legitimately fails
// content checks like the 3000-character Chinese minimum. What matters here is
// that the page was assembled — the engine test runs against that.
const build = spawnSync(
  process.execPath,
  [path.join(ROOT, 'scripts', 'build.mjs'), work, '--source', path.join(ROOT, 'examples', 'todo-api')],
  { encoding: 'utf8' }
);
if (!fs.existsSync(path.join(work, 'index.html'))) {
  console.error('fixture failed to assemble:\n' + build.stdout + build.stderr);
  process.exit(1);
}

/* ── Driver: runs inside the page, reports through document.title ── */
const driver = `
(function(){
  const t = document.querySelector('.output-task');
  const input = t.querySelector('.output-task-input');
  const btn = t.querySelector('.output-task-reveal-btn');
  const list = t.querySelector('.output-task-checklist');
  const meter = t.querySelector('.output-task-meter');
  const r = [];
  r.push(['label is written from data-type', t.querySelector('.output-task-label').textContent === '输出题 · 复述路径']);
  r.push(['checklist starts hidden', list.hidden === true]);
  r.push(['reveal button starts disabled', btn.disabled === true]);
  r.push(['meter counts down to data-min', /还差 \\d+ 字/.test(meter.textContent)]);
  input.value = '这句话先经过 express.json 拆包，再到 validate，最后 store.js 写进文件';
  input.dispatchEvent(new Event('input'));
  r.push(['button unlocks once data-min is met', btn.disabled === false]);
  r.push(['meter switches to ready', meter.textContent.includes('可以看对照清单')]);
  btn.click();
  r.push(['checklist appears on click', list.hidden === false]);
  r.push(['button stays disabled after reveal', btn.disabled === true]);
  const box = list.querySelector('input[type=checkbox]');
  box.checked = true; box.dispatchEvent(new Event('change'));
  r.push(['tally counts ticks without scoring', /你勾了 1 \\/ 3 项/.test(t.querySelector('.output-task-tally').textContent)]);
  let saved = null; try { saved = localStorage.getItem('codebase-course:output-task:task-test'); } catch(e){}
  r.push(['draft survives in localStorage', typeof saved === 'string' && saved.includes('store.js')]);
  document.title = JSON.stringify(r);
})();
`;
fs.writeFileSync(path.join(work, '__driver.js'), driver);
fs.writeFileSync(
  path.join(work, '__test.html'),
  fs.readFileSync(path.join(work, 'index.html'), 'utf8').replace('</body>', '<script src="__driver.js" defer></script></body>')
);

/* ── Serve and drive ─────────────────────────────────────────── */
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(work, rel);
  if (!file.startsWith(work) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();

const domFile = path.join(work, 'dom.html');
await new Promise((resolve) => {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--user-data-dir=${path.join(work, 'profile')}`,
    '--virtual-time-budget=8000', '--dump-dom',
    `http://127.0.0.1:${port}/__test.html`,
  ], { stdio: ['ignore', fs.openSync(domFile, 'w'), 'ignore'] });
  chrome.on('exit', resolve);
  setTimeout(() => { chrome.kill('SIGKILL'); resolve(); }, 45000);
});
server.close();

const match = fs.readFileSync(domFile, 'utf8').match(/<title>(.*?)<\/title>/s);
if (!match) {
  console.error('the driver never ran — main.js may have thrown before initialising');
  process.exit(1);
}
const results = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
let failed = 0;
console.log('output-task engine');
for (const [name, ok] of results) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed += 1;
}
console.log(failed === 0 ? '  all behaviours correct' : `  ${failed} behaviour(s) wrong`);
fs.rmSync(work, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
