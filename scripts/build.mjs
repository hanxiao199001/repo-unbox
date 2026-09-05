#!/usr/bin/env node
// Assembles a course directory into a single index.html.
//
//   node scripts/build.mjs <course-dir>
//
// Replaces the original build.sh. Node only, no dependencies, works on Windows.
//
// The writing agent is responsible for exactly two things: _base.html and
// modules/*.html. Everything else — styles.css, main.js, _footer.html, the
// fonts — is copied here, so there is nothing mechanical left to get wrong.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, report } from './validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REFS = path.join(ROOT, 'references');

const courseDir = path.resolve(process.argv[2] || '.');

function die(message) {
  console.error(`build failed: ${message}`);
  process.exit(1);
}

/* ── What the agent must have written ────────────────────────── */
const basePath = path.join(courseDir, '_base.html');
const modulesDir = path.join(courseDir, 'modules');
if (!fs.existsSync(basePath)) die(`${path.relative(ROOT, basePath)} not found — write it from references/_base.html first`);
if (!fs.existsSync(modulesDir)) die(`${path.relative(ROOT, modulesDir)} not found — module HTML goes there`);

// Sorted explicitly rather than trusting the order the filesystem hands back.
// build.sh relied on shell glob order, which is not guaranteed across shells.
const moduleFiles = fs
  .readdirSync(modulesDir)
  .filter((f) => f.endsWith('.html'))
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

if (moduleFiles.length === 0) die(`no .html files in ${path.relative(ROOT, modulesDir)}`);

/* ── Copy everything the agent should not be hand-copying ────── */
for (const file of ['styles.css', 'main.js', '_footer.html']) {
  fs.copyFileSync(path.join(REFS, file), path.join(courseDir, file));
}

const fontsSrc = path.join(REFS, 'fonts');
const fontsDest = path.join(courseDir, 'fonts');
fs.mkdirSync(fontsDest, { recursive: true });
let fontFiles = 0;
let fontBytes = 0;
for (const file of fs.readdirSync(fontsSrc)) {
  const from = path.join(fontsSrc, file);
  if (!fs.statSync(from).isFile()) continue;
  fs.copyFileSync(from, path.join(fontsDest, file));
  fontFiles += 1;
  fontBytes += fs.statSync(from).size;
}

/* ── lang="en" backstop ──────────────────────────────────────── */
// The page is lang="zh-CN". English-only content must say so, or the browser
// applies Chinese line-breaking and font substitution to code and error text.
// references/interactive-elements.md tells the agent to write these attributes;
// this is the safety net. The count is the point: a non-zero number means the
// module HTML was not written to the rule, which is a quality signal when
// comparing agents. Tagging happens on the assembled output only — the module
// files are left alone so the count stays honest on every rebuild.
function tagEnglish(html) {
  const counts = { 'pre in .translation-code': 0, '.bug-code': 0, '.badge-code': 0 };

  html = html.replace(/<div class="bug-code"(?![^>]*\slang=)([^>]*)>/g, (m, rest) => {
    counts['.bug-code'] += 1;
    return `<div class="bug-code" lang="en"${rest}>`;
  });

  html = html.replace(/<code class="badge-code"(?![^>]*\slang=)([^>]*)>/g, (m, rest) => {
    counts['.badge-code'] += 1;
    return `<code class="badge-code" lang="en"${rest}>`;
  });

  // Scoped scan: only the <pre> that opens inside a .translation-code block.
  let out = '';
  let cursor = 0;
  const marker = /class="translation-code"/g;
  let hit;
  while ((hit = marker.exec(html)) !== null) {
    const preIndex = html.indexOf('<pre', hit.index);
    if (preIndex === -1) break;
    const preEnd = html.indexOf('>', preIndex);
    const tag = html.slice(preIndex, preEnd + 1);
    out += html.slice(cursor, preIndex);
    if (/\slang=/.test(tag)) {
      out += tag;
    } else {
      out += tag.replace(/^<pre/, '<pre lang="en"');
      counts['pre in .translation-code'] += 1;
    }
    cursor = preEnd + 1;
    marker.lastIndex = cursor;
  }
  out += html.slice(cursor);

  return { html: out, counts };
}

/* ── Assemble ────────────────────────────────────────────────── */
const parts = [
  fs.readFileSync(basePath, 'utf8'),
  ...moduleFiles.map((f) => fs.readFileSync(path.join(modulesDir, f), 'utf8')),
  fs.readFileSync(path.join(courseDir, '_footer.html'), 'utf8'),
];

const { html, counts } = tagEnglish(parts.join('\n'));
const indexPath = path.join(courseDir, 'index.html');
fs.writeFileSync(indexPath, html);

/* ── Report ──────────────────────────────────────────────────── */
const rel = (p) => path.relative(process.cwd(), p) || '.';
console.log(`built ${rel(indexPath)} from ${moduleFiles.length} modules`);
console.log(`  order: ${moduleFiles.join(', ')}`);
console.log(`  copied styles.css, main.js, _footer.html and fonts/ (${fontFiles} files, ${(fontBytes / 1048576).toFixed(2)} MB — woff2 subsets plus fonts.css and licences)`);
console.log(`  index.html: ${(fs.statSync(indexPath).size / 1024).toFixed(1)} KB`);

const taskTypes = [...html.matchAll(/class="output-task"[^>]*data-type="([^"]*)"/g)].map((m) => m[1]);
const moduleCount = moduleFiles.length;
if (taskTypes.length === 0) {
  console.log(`  output tasks: none — every module needs at least one`);
} else {
  const byType = taskTypes.reduce((acc, t) => ({ ...acc, [t]: (acc[t] || 0) + 1 }), {});
  const breakdown = Object.entries(byType).map(([t, n]) => `${t} ×${n}`).join(', ');
  console.log(`  output tasks: ${taskTypes.length} across ${moduleCount} modules — ${breakdown}`);
}

const added = Object.values(counts).reduce((a, b) => a + b, 0);
if (added === 0) {
  console.log('  lang="en" backstop: 0 added (module HTML already correct)');
} else {
  const detail = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${k} ×${n}`).join(', ');
  console.log(`  lang="en" backstop: ${added} added — ${detail}`);
  console.log('    (non-zero means the module HTML did not follow references/interactive-elements.md)');
}

console.log('');
const ok = report(courseDir, validate(courseDir));
process.exit(ok ? 0 : 1);
