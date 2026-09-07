#!/usr/bin/env node
// Builds a GitHub Pages copy of one course, with the fonts cut down to the
// glyphs that course actually uses.
//
//   cd tools && npm install
//   node tools/publish-pages.mjs <course-dir> <out-dir>
//
// Why this lives in tools/ and not scripts/: it needs a dependency
// (subset-font, which wraps harfbuzz as wasm), and scripts/ ships inside the
// installed skill, which stays zero-dependency. Nothing here runs at course
// build time — a course on disk is already complete and offline-ready. This is
// only for putting one on the web, where 9.4 MB of fonts is not acceptable.
//
// The fonts arrive already split into ~196 woff2 shards by unicode-range. This
// script keeps only the shards a course touches and subsets each of those down
// to the characters actually used, so nothing is fetched or re-encoded from
// anywhere — the licence texts travel along unchanged.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(path.join(process.cwd(), 'tools', 'noop.js'));
let subsetFont;
try {
  subsetFont = (await import(require.resolve('subset-font'))).default;
} catch (err) {
  console.error('publish-pages needs subset-font:\n  cd tools && npm install\n');
  process.exit(1);
}

const args = process.argv.slice(2);
const creditFlag = args.indexOf('--credit');
const credit = creditFlag === -1 ? null : args[creditFlag + 1];
const [courseDir, outDir] = args.filter((a, i) => !a.startsWith('--') && i !== creditFlag + 1);
if (!courseDir || !outDir) {
  console.error('usage: node tools/publish-pages.mjs <course-dir> <out-dir> [--credit "<html>"]');
  console.error('  --credit  a line appended to the colophon. Put the source codebase and its');
  console.error('            licence here — a published course quotes real code from somewhere.');
  process.exit(1);
}

const BUDGET = 800 * 1024;
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const gz = (buf) => zlib.gzipSync(buf, { level: 9 }).length;

/* ── every character the page can possibly render ─────────────── */
// Deliberately over-inclusive: the HTML (markup, attributes and text — tooltip
// definitions and quiz explanations live in attributes), plus every string
// baked into main.js and styles.css. A handful of extra glyphs costs bytes;
// a missing one shows up as a blank box in front of a learner.
const html = fs.readFileSync(path.join(courseDir, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(courseDir, 'main.js'), 'utf8');
const css = fs.readFileSync(path.join(courseDir, 'styles.css'), 'utf8');
const chars = [...new Set(html + js + css)].filter((c) => c.codePointAt(0) > 31);

/* ── which shard covers which character ───────────────────────── */
const fontsCss = fs.readFileSync(path.join(courseDir, 'fonts', 'fonts.css'), 'utf8');
const faces = [...fontsCss.matchAll(/@font-face\{([^}]*)\}/g)].map(([, body]) => ({
  body,
  file: (body.match(/url\('?\.\/([^')]+)'?\)/) || [])[1],
  range: (body.match(/unicode-range:([^;}]+)/) || [])[1],
}));

function covers(range, cp) {
  if (!range) return true;
  return range.split(',').some((part) => {
    const m = part.trim().match(/^U\+([0-9a-fA-F]+)(?:-([0-9a-fA-F]+))?$/);
    if (!m) return false;
    const lo = parseInt(m[1], 16);
    return cp >= lo && cp <= (m[2] ? parseInt(m[2], 16) : lo);
  });
}

/* ── subset the shards that are used, drop the rest ───────────── */
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'fonts'), { recursive: true });

const kept = [];
let before = 0;
for (const face of faces) {
  if (!face.file) continue;
  const need = chars.filter((c) => covers(face.range, c.codePointAt(0)));
  if (!need.length) continue;
  const src = fs.readFileSync(path.join(courseDir, 'fonts', face.file));
  before += src.length;
  const out = await subsetFont(src, need.join(''), { targetFormat: 'woff2' });
  fs.writeFileSync(path.join(outDir, 'fonts', face.file), out);
  kept.push({ file: face.file, glyphs: need.length, from: src.length, to: out.length, body: face.body });
}

// Same @font-face rules, minus the ones nothing needs.
fs.writeFileSync(
  path.join(outDir, 'fonts', 'fonts.css'),
  '/* Subset for this course by tools/publish-pages.mjs. Same fonts, same licences,\n' +
  '   only the glyphs this page uses. Full originals: references/fonts/. */\n' +
  kept.map((k) => `@font-face{${k.body}}`).join('\n') + '\n'
);

for (const licence of fs.readdirSync(path.join(courseDir, 'fonts')).filter((f) => f.startsWith('LICENSE'))) {
  fs.copyFileSync(path.join(courseDir, 'fonts', licence), path.join(outDir, 'fonts', licence));
}

for (const file of ['styles.css', 'main.js']) {
  fs.copyFileSync(path.join(courseDir, file), path.join(outDir, file));
}

// A course on disk is read by the person who asked for it. A published one is
// read by strangers, and it quotes someone else's code — so the source and its
// licence have to be on the page.
let page = html;
if (credit) {
  const at = page.indexOf('</footer>');
  if (at === -1) {
    console.error('--credit given but the page has no .kc-colophon footer to put it in');
    process.exit(1);
  }
  page = page.slice(0, at) + `<br>${credit}` + page.slice(at);
}
fs.writeFileSync(path.join(outDir, 'index.html'), page);

/* ── report ───────────────────────────────────────────────────── */
let raw = 0;
let gzipped = 0;
const rows = [];
const walk = (dir, base = '') => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full, path.join(base, entry.name)); continue; }
    const buf = fs.readFileSync(full);
    raw += buf.length;
    gzipped += /\.(woff2?|png|jpg)$/.test(entry.name) ? buf.length : gz(buf);
    rows.push([path.join(base, entry.name), buf.length]);
  }
};
walk(outDir);

const fontsRaw = rows.filter((r) => r[0].startsWith('fonts/') && r[0].endsWith('.woff2')).reduce((s, r) => s + r[1], 0);
console.log(`published ${path.relative(process.cwd(), outDir)}`);
console.log(`  fonts     ${kept.length} shards, ${kb(before)} → ${kb(fontsRaw)}  (${chars.filter((c) => c.codePointAt(0) > 0x2e80).length} CJK glyphs kept)`);
for (const [name, size] of rows.filter((r) => !r[0].includes('/')).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name.padEnd(12)} ${kb(size)}`);
}
console.log(`  ---`);
console.log(`  total on disk   ${kb(raw)}`);
console.log(`  over the wire   ${kb(gzipped)}  (text gzipped, woff2 already compressed)`);
const budgetHit = gzipped <= BUDGET;
console.log(`  budget 800 KB   ${budgetHit ? 'OK' : 'OVER'}`);
process.exit(budgetHit ? 0 : 1);
