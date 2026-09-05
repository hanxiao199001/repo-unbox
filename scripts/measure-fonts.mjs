#!/usr/bin/env node
// Measures what a real browser actually downloads from a built course.
//
//   node scripts/measure-fonts.mjs <course-dir>
//
// The directory size is not the number that matters — the fonts are split into
// unicode-range subsets, so a browser fetches only the ones whose characters
// appear on the page. This serves the course over a throwaway HTTP server that
// records every byte it hands out, drives headless Chrome at it once, and
// prints the real figure.
//
// Requires Google Chrome installed (override with CHROME_PATH).

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const courseDir = path.resolve(process.argv[2] || '.');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
};

const served = [];

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(courseDir, rel);
  if (!file.startsWith(courseDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  const body = fs.readFileSync(file);
  served.push({ url: '/' + rel, bytes: body.length });
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(body);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'measure-fonts-'));
const shot = path.join(profile, 'page.png');

await new Promise((resolve) => {
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    '--virtual-time-budget=15000',
    '--window-size=1440,1000',
    `--screenshot=${shot}`,
    `http://127.0.0.1:${port}/index.html`,
  ], { stdio: 'ignore' });
  // Chrome sometimes lingers after writing the screenshot, so treat the
  // screenshot landing as the signal that the page finished loading.
  const timer = setInterval(() => {
    if (fs.existsSync(shot)) {
      clearInterval(timer);
      chrome.kill('SIGKILL');
      setTimeout(resolve, 300);
    }
  }, 250);
  chrome.on('exit', () => { clearInterval(timer); resolve(); });
  setTimeout(() => { clearInterval(timer); chrome.kill('SIGKILL'); resolve(); }, 60000);
});

server.close();
fs.rmSync(profile, { recursive: true, force: true });

const fonts = served.filter((r) => r.url.endsWith('.woff2'));
const other = served.filter((r) => !r.url.endsWith('.woff2'));
const sum = (rows) => rows.reduce((n, r) => n + r.bytes, 0);
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

console.log(`measure-fonts ${path.relative(process.cwd(), courseDir) || '.'}`);
console.log('');
console.log('  non-font requests');
for (const r of other) console.log(`    ${kb(r.bytes).padStart(10)}  ${r.url}`);
console.log('');
console.log(`  font subsets actually downloaded: ${fonts.length}`);
for (const r of [...fonts].sort((a, b) => b.bytes - a.bytes)) console.log(`    ${kb(r.bytes).padStart(10)}  ${r.url}`);
console.log('');

const onDisk = fs
  .readdirSync(path.join(courseDir, 'fonts'))
  .filter((f) => f.endsWith('.woff2'))
  .reduce((n, f) => n + fs.statSync(path.join(courseDir, 'fonts', f)).size, 0);

console.log(`  fonts on disk:       ${(onDisk / 1048576).toFixed(2)} MB`);
console.log(`  fonts downloaded:    ${kb(sum(fonts))}  (${((sum(fonts) / onDisk) * 100).toFixed(1)}% of what is shipped)`);
console.log(`  page total:          ${kb(sum(served))}`);
