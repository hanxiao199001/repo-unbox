#!/usr/bin/env node
// Structural checks on a built course directory.
//
//   node scripts/validate.mjs <course-dir>
//
// Also imported by build.mjs, which runs it automatically and refuses to
// declare success when anything here fails. Every check exists because the
// failure it catches is silent — the page still opens, it is just wrong.

import fs from 'node:fs';
import path from 'node:path';

// HTML comments hold template examples (the nav-dot sample in _base.html), so
// strip them before any check that counts real elements.
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

export function validate(courseDir) {
  const errors = [];
  const checks = [];
  const check = (name, ok, detail = '') => {
    checks.push({ name, ok, detail });
    if (!ok) errors.push(`${name}${detail ? ': ' + detail : ''}`);
  };

  const indexPath = path.join(courseDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    return { errors: [`index.html missing in ${courseDir}`], checks };
  }
  const raw = fs.readFileSync(indexPath, 'utf8');
  const html = stripComments(raw);

  /* ── 1. data-steps JSON parses ─────────────────────────────── */
  const stepAttrs = [...html.matchAll(/data-steps='([^']*)'/g)];
  const badSteps = [];
  for (const [, json] of stepAttrs) {
    try {
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed) || parsed.length === 0) badSteps.push('empty or not an array');
    } catch (err) {
      // Almost always an apostrophe inside a label closing the attribute early.
      badSteps.push(err.message);
    }
  }
  check(`data-steps JSON parses (${stepAttrs.length} found)`, badSteps.length === 0, badSteps.join('; '));

  /* ── 2. ids are unique ─────────────────────────────────────── */
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const seen = new Map();
  for (const id of ids) seen.set(id, (seen.get(id) || 0) + 1);
  const dupes = [...seen].filter(([, n]) => n > 1).map(([id, n]) => `${id} (${n}x)`);
  check(`ids unique (${ids.length} total)`, dupes.length === 0, dupes.join(', '));

  /* ── 3. nav dots and modules line up, both directions ──────── */
  const moduleIds = [...html.matchAll(/class="module"[^>]*id="([^"]+)"/g)].map((m) => m[1]);
  const dotTargets = [...html.matchAll(/class="nav-dot"[^>]*data-target="([^"]+)"/g)].map((m) => m[1]);
  const missingDot = moduleIds.filter((id) => !dotTargets.includes(id));
  const danglingDot = dotTargets.filter((id) => !moduleIds.includes(id));
  check(
    `nav dots match modules (${moduleIds.length} modules, ${dotTargets.length} dots)`,
    missingDot.length === 0 && danglingDot.length === 0,
    [
      missingDot.length ? `modules without a dot: ${missingDot.join(', ')}` : '',
      danglingDot.length ? `dots pointing nowhere: ${danglingDot.join(', ')}` : '',
    ].filter(Boolean).join('; ')
  );

  /* ── 4. nothing loads from the network ─────────────────────── */
  // The whole point of self-hosting the fonts. One stray CDN link and the
  // course stops working offline, which is exactly what we cannot test for
  // from here.
  const external = [...raw.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  const externalCss = [...raw.matchAll(/url\((['"]?)(https?:\/\/[^'")]+)\1\)/g)].map((m) => m[2]);
  const allExternal = [...new Set([...external, ...externalCss])];
  check('no external URLs', allExternal.length === 0, allExternal.join(', '));

  /* ── 5. fonts are present and actually referenced ──────────── */
  // The silent failure this round is most likely to produce: a wrong path
  // leaves the page perfectly openable, just rendered in the default font.
  const fontsCss = path.join(courseDir, 'fonts', 'fonts.css');
  const hasFontsCss = fs.existsSync(fontsCss);
  check('fonts/fonts.css exists', hasFontsCss, hasFontsCss ? '' : fontsCss);

  const linked = /<link[^>]+href="fonts\/fonts\.css"/.test(raw);
  check('index.html links fonts/fonts.css', linked);

  if (hasFontsCss) {
    const css = fs.readFileSync(fontsCss, 'utf8');
    const refs = [...css.matchAll(/url\((['"]?)\.\/([^'")]+)\1\)/g)].map((m) => m[2]);
    const missing = refs.filter((f) => !fs.existsSync(path.join(courseDir, 'fonts', f)));
    check(
      `every @font-face file exists (${refs.length} referenced)`,
      missing.length === 0,
      missing.slice(0, 5).join(', ') + (missing.length > 5 ? ` … +${missing.length - 5}` : '')
    );
  }

  /* ── 6. local assets referenced by the page exist ──────────── */
  const localAssets = [...raw.matchAll(/(?:src|href)="(?!https?:|#)([^"]+)"/g)].map((m) => m[1]);
  const missingAssets = [...new Set(localAssets)].filter((f) => !fs.existsSync(path.join(courseDir, f)));
  check('local assets exist', missingAssets.length === 0, missingAssets.join(', '));

  /* ── 7. quizzes are answerable ─────────────────────────────── */
  const quizBlocks = [...html.matchAll(/<div class="quiz-question-block"([\s\S]*?)>/g)];
  const noAnswer = quizBlocks.filter(([, attrs]) => !/data-correct="/.test(attrs)).length;
  check(`every quiz question has data-correct (${quizBlocks.length} questions)`, noAnswer === 0, `${noAnswer} without an answer`);

  /* ── 8. interactive engines can find what they need ────────── */
  // main.js keys off ids and control-button classes; a missing one fails silently.
  const chatWindows = [...html.matchAll(/<div class="chat-window"([^>]*)>/g)];
  const chatNoId = chatWindows.filter(([, a]) => !/\sid="/.test(a)).length;
  check(`chat windows have an id (${chatWindows.length} found)`, chatNoId === 0, `${chatNoId} without one`);

  for (const [cls, buttons] of [
    ['flow-animation', ['flow-next-btn', 'flow-reset-btn']],
    ['chat-window', ['chat-next-btn', 'chat-reset-btn']],
  ]) {
    const count = (html.match(new RegExp(`class="${cls}"`, 'g')) || []).length;
    const missing = buttons.filter((b) => !html.includes(b));
    check(`${cls} controls present (${count} found)`, count === 0 || missing.length === 0, missing.join(', '));
  }

  return { errors, checks };
}

export function report(courseDir, { errors, checks }) {
  console.log(`validate ${path.relative(process.cwd(), courseDir) || '.'}`);
  for (const c of checks) {
    console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok || !c.detail ? '' : ' — ' + c.detail}`);
  }
  console.log(errors.length === 0 ? '  all checks passed' : `  ${errors.length} check(s) failed`);
  return errors.length === 0;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = path.resolve(process.argv[2] || '.');
  const ok = report(dir, validate(dir));
  process.exit(ok ? 0 : 1);
}
