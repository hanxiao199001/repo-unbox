#!/usr/bin/env node
// Assembles a course directory into a single index.html.
//
//   node scripts/build.mjs <course-dir>
//
// Node only, no dependencies, works on Windows.
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

function die(message) {
  console.error(`build failed: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const sourceFlag = args.indexOf('--source');
const skipIndex = sourceFlag === -1 ? -1 : sourceFlag + 1;
const positional = args.filter((a, i) => !a.startsWith('--') && i !== skipIndex);
const courseDir = path.resolve(positional[0] || '.');

// --source is mandatory here on purpose. validate.mjs may be run standalone
// without it and will say so loudly, but Phase 4 of the skill goes through this
// script, and there must be no silent way to switch off the verbatim-code check.
if (sourceFlag === -1 || !args[sourceFlag + 1]) {
  die('missing --source <codebase-path>\n  usage: node scripts/build.mjs <course-dir> --source <codebase-path>\n  the codebase is what every code block is checked against, verbatim');
}
const sourceDir = path.resolve(args[sourceFlag + 1]);
if (!fs.existsSync(sourceDir)) die(`--source path does not exist: ${sourceDir}`);

/* ── What the agent must have written ────────────────────────── */
const basePath = path.join(courseDir, '_base.html');
const modulesDir = path.join(courseDir, 'modules');
if (!fs.existsSync(basePath)) die(`${path.relative(ROOT, basePath)} not found — copy references/_base.html there and fill in {{KC_COURSE_TITLE}} and {{KC_NAV_DOTS}} first`);
if (!fs.existsSync(modulesDir)) die(`${path.relative(ROOT, modulesDir)} not found — module HTML goes there`);

// Sorted explicitly rather than trusting the order the filesystem hands back:
// readdir order is not guaranteed, and module order is the course's narrative.
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

/* ── data-kc-lang="en" backstop ───────────────────────────────── */
// The page is lang="zh-CN". English-only content must say so, or Chinese
// line-breaking and font substitution get applied to code and error text.
// references/interactive-elements.md tells the agent to write the attribute;
// this is the safety net. The count is the point: non-zero means the module
// HTML was not written to the rule, which is a quality signal when comparing
// agents. Tagging happens on the assembled output only — the module files are
// left alone so the count stays honest on every rebuild.
//
// main.js mirrors data-kc-lang onto the real lang attribute at load time, so
// the data attribute is the single thing an author has to remember.
const EN_TARGETS = [
  ['.kc-bughunt__code', /<div class="kc-bughunt__code"(?![^>]*\sdata-kc-lang=)([^>]*)>/g, '<div class="kc-bughunt__code" data-kc-lang="en"'],
  ['.kc-deflist__key', /<code class="kc-deflist__key"(?![^>]*\sdata-kc-lang=)([^>]*)>/g, '<code class="kc-deflist__key" data-kc-lang="en"'],
  ['.kc-tree__name', /<code class="kc-tree__name"(?![^>]*\sdata-kc-lang=)([^>]*)>/g, '<code class="kc-tree__name" data-kc-lang="en"'],
  ['.kc-code', /<code class="kc-code"(?![^>]*\sdata-kc-lang=)([^>]*)>/g, '<code class="kc-code" data-kc-lang="en"'],
];

function tagEnglish(html) {
  const counts = { 'pre in .kc-code-pair__code': 0 };
  for (const [name] of EN_TARGETS) counts[name] = 0;

  for (const [name, re, open] of EN_TARGETS) {
    html = html.replace(re, (m, rest) => {
      counts[name] += 1;
      return `${open}${rest}>`;
    });
  }

  // Scoped scan: only the <pre> that opens inside a .kc-code-pair__code block.
  let out = '';
  let cursor = 0;
  const marker = /class="kc-code-pair__code"/g;
  let hit;
  while ((hit = marker.exec(html)) !== null) {
    const preIndex = html.indexOf('<pre', hit.index);
    if (preIndex === -1) break;
    const preEnd = html.indexOf('>', preIndex);
    const tag = html.slice(preIndex, preEnd + 1);
    out += html.slice(cursor, preIndex);
    if (/\sdata-kc-lang=/.test(tag)) {
      out += tag;
    } else {
      out += tag.replace(/^<pre/, '<pre data-kc-lang="en"');
      counts['pre in .kc-code-pair__code'] += 1;
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

const taskTypes = [...html.matchAll(/class="kc-output"[^>]*data-kc-kind="([^"]*)"/g)].map((m) => m[1]);
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
  console.log('  data-kc-lang="en" backstop: 0 added (module HTML already correct)');
} else {
  const detail = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${k} ×${n}`).join(', ');
  console.log(`  data-kc-lang="en" backstop: ${added} added — ${detail}`);
  console.log('    (non-zero means the module HTML did not follow references/interactive-elements.md)');
}

console.log('');
const ok = report(courseDir, validate(courseDir, sourceDir));
process.exit(ok ? 0 : 1);
