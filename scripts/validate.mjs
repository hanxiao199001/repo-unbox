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
import { fileURLToPath } from 'node:url';
import { decodeHtml, extractCodeBlocks, findVerbatim, collectSources } from './lib/code-check.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Strip HTML comments before any check that counts real elements, so a
// commented-out example never inflates a count.
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

export function validate(courseDir, sourceDir) {
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

  /* ── 1. data-kc-steps JSON parses ─────────────────────────────── */
  const stepAttrs = [...html.matchAll(/data-kc-steps='([^']*)'/g)];
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
  check(`data-kc-steps JSON parses (${stepAttrs.length} found)`, badSteps.length === 0, badSteps.join('; '));

  /* ── 2. ids are unique ─────────────────────────────────────── */
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const seen = new Map();
  for (const id of ids) seen.set(id, (seen.get(id) || 0) + 1);
  const dupes = [...seen].filter(([, n]) => n > 1).map(([id, n]) => `${id} (${n}x)`);
  check(`ids unique (${ids.length} total)`, dupes.length === 0, dupes.join(', '));

  /* ── 3. nav dots and modules line up, both directions ──────── */
  const moduleTags = [...html.matchAll(/<section class="kc-module"([^>]*)>/g)].map((m) => m[1]);
  const moduleIds = moduleTags.map((a) => a.match(/\sid="([^"]+)"/)?.[1] || '');
  const dotTargets = [...html.matchAll(/class="kc-nav__dot"[^>]*data-kc-target="([^"]+)"/g)].map((m) => m[1]);

  // A module with no id cannot be reached by any dot, and the loops below would
  // silently pair the wrong things up.
  const namelessModules = moduleIds.filter((id) => !id).length;
  check('every module has an id', namelessModules === 0, namelessModules ? `${namelessModules} module(s) without one` : '');
  const missingDot = moduleIds.filter((id) => id && !dotTargets.includes(id));
  const danglingDot = dotTargets.filter((id) => !moduleIds.includes(id));
  check(
    `nav dots match modules (${moduleIds.length} modules, ${dotTargets.length} dots)`,
    missingDot.length === 0 && danglingDot.length === 0,
    [
      missingDot.length ? `modules without a dot: ${missingDot.join(', ')}` : '',
      danglingDot.length ? `dots pointing nowhere: ${danglingDot.join(', ')}` : '',
    ].filter(Boolean).join('; ')
  );

  /* ── 3b. adjacent modules alternate their background tone ──── */
  // spec/page-shell.md: alternating background is the ONLY signal the learner
  // has that a new module started. Two in a row with the same tone and the
  // boundary disappears, silently.
  const tones = moduleTags.map((a) => a.match(/data-kc-tone="([^"]*)"/)?.[1] || '');
  const badTone = [];
  tones.forEach((t, i) => {
    if (t !== 'a' && t !== 'b') badTone.push(`${moduleIds[i] || i + 1}: data-kc-tone="${t}"`);
    else if (i > 0 && t === tones[i - 1]) badTone.push(`${moduleIds[i] || i + 1} repeats tone "${t}"`);
  });
  check(`adjacent modules alternate data-kc-tone (${tones.length} modules)`, badTone.length === 0, badTone.join('; '));

  /* ── 3c. no template placeholder survived into the build ───── */
  const leftover = [...new Set((raw.match(/\{\{[A-Z_]+\}\}/g) || []))];
  check('no template placeholders left', leftover.length === 0, leftover.join(', '));

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
  const quizBlocks = [...html.matchAll(/<div class="kc-quiz__question"([\s\S]*?)>/g)];
  const noAnswer = quizBlocks.filter(([, attrs]) => !/data-kc-answer="/.test(attrs)).length;
  check(`every quiz question has data-kc-answer (${quizBlocks.length} questions)`, noAnswer === 0, `${noAnswer} without an answer`);

  // Both explanations are required. Without them the answer reveal says
  // "correct/incorrect" and teaches nothing, which is the one thing
  // content-philosophy forbids outright.
  const noWhy = quizBlocks.filter(([, a]) => !/data-kc-right="/.test(a) || !/data-kc-wrong="/.test(a)).length;
  check('every quiz question has both explanations', noWhy === 0, noWhy ? `${noWhy} missing data-kc-right or data-kc-wrong` : '');

  /* ── 8. every module has an output task ────────────────────── */
  // A multiple-choice quiz proves the learner can recognise an answer. Only an
  // output task proves they can produce the words — which is the whole point,
  // since instructing an AI needs vocabulary you can produce, not just recognise.
  const moduleBlocks = html.split(/<section class="kc-module"/).slice(1);
  const withoutTask = [];
  moduleBlocks.forEach((block, i) => {
    if (!block.includes('class="kc-output"')) withoutTask.push(moduleIds[i] || `module ${i + 1}`);
  });
  const taskCount = (html.match(/class="kc-output"/g) || []).length;
  check(
    `every module has an output task (${taskCount} tasks across ${moduleBlocks.length} modules)`,
    withoutTask.length === 0,
    withoutTask.length ? `no output task in: ${withoutTask.join(', ')}` : ''
  );

  // Whole-course totals hide a thin module. Sonnet's first six-module course had
  // a final module with no code block at all and every course-wide count still
  // passed, so these are per module.
  const moduleText = (block) => block
    .replace(/<pre[^>]*>[\s\S]*?<\/pre>/g, '')
    .replace(/<[^>]+>/g, '');

  const thinCode = [];
  const thinProse = [];
  moduleBlocks.forEach((block, i) => {
    const id = moduleIds[i] || `module ${i + 1}`;
    const codeBlocks = (block.match(/class="kc-code-pair"/g) || []).length;
    if (codeBlocks === 0) thinCode.push(id);
    const hanzi = (moduleText(block).match(/[\u4e00-\u9fa5]/g) || []).length;
    if (hanzi < 800) thinProse.push(`${id} (${hanzi})`);
  });
  check('every module has a code-pair block', thinCode.length === 0, thinCode.join(', '));
  check('every module has at least 800 Chinese characters', thinProse.length === 0, thinProse.join(', '));

  // The element that makes the learner point at a real mistake. Two is the floor
  // because one across a whole course reads as decoration.
  const bugChallenges = (html.match(/class="kc-bughunt"/g) || []).length;
  check(`at least 2 spot-the-bug challenges (${bugChallenges} found)`, bugChallenges >= 2);

  const TASK_TYPES = ['retell', 'instruct', 'explain'];
  const taskAttrs = [...html.matchAll(/<div class="kc-output"([^>]*)>/g)].map((m) => m[1]);
  const badType = taskAttrs.filter((a) => {
    const m = a.match(/data-kc-kind="([^"]*)"/);
    return !m || !TASK_TYPES.includes(m[1]);
  }).length;
  check(`output tasks have a valid data-kc-kind (${TASK_TYPES.join('/')})`, badType === 0, `${badType} without one`);

  // 60 is the floor: shorter than that and the learner types 就是那样 and moves on,
  // which defeats the only element that makes them produce anything.
  const mins = taskAttrs.map((a) => Number(a.match(/data-kc-min="(\d+)"/)?.[1] ?? NaN));
  const badMin = mins.filter((m) => !Number.isFinite(m) || m < 60);
  check(
    'output tasks have data-kc-min of at least 60',
    badMin.length === 0,
    badMin.length ? `${badMin.length} below 60 or missing: ${badMin.join(', ')}` : ''
  );

  const noId = taskAttrs.filter((a) => !/\sid="/.test(a)).length;
  check('output tasks have an id (localStorage key)', noId === 0, `${noId} without one`);

  const textareas = (html.match(/class="kc-output__input"/g) || []).length;
  const reveals = (html.match(/class="kc-output__reveal"/g) || []).length;
  const lists = (html.match(/class="kc-output__checklist"/g) || []).length;
  check(
    'output tasks are complete (input + reveal button + checklist)',
    textareas === taskCount && reveals === taskCount && lists === taskCount,
    `${taskCount} tasks but ${textareas} inputs, ${reveals} buttons, ${lists} checklists`
  );

  // 3-4 tick boxes: fewer and it is not a checklist, more and nobody reads it.
  // The tick boxes are created by main.js at runtime, so count the items the
  // author actually writes, not the inputs.
  const checklistBlocks = [...html.matchAll(/class="kc-output__checklist"[^>]*>([\s\S]*?)<\/ul>/g)];
  const wrongSize = checklistBlocks
    .map((m) => (m[1].match(/class="kc-output__item"/g) || []).length)
    .filter((n) => n < 3 || n > 4).length;
  check('every checklist has 3-4 items', wrongSize === 0, `${wrongSize} outside that range`);

  // A checklist of four vague statements gives the learner nothing to check
  // themselves against. At least one item must name something in English inside
  // <code lang="en">: a file or function for retell and instruct tasks, and for
  // an explain task the English word for the concept itself — that task asks the
  // learner to avoid jargon, so demanding a filename would fight its purpose.
  const vagueLists = checklistBlocks.filter((m) => !/[A-Za-z]{2,}/.test(m[1].replace(/<[^>]+>/g, ''))).length;
  check(
    'every checklist names a file, function or English term',
    vagueLists === 0,
    vagueLists ? `${vagueLists} checklist(s) with no English word in any item` : ''
  );

  /* ── 12b. one metaphor per module, never twice in a course ── */
  // content-philosophy bans reusing a metaphor; nothing could enforce it until
  // each module declared its own. The first real run carried three metaphors
  // straight over from an unrelated course, and no check noticed.
  const metaphors = moduleTags.map((a, i) => ({
    id: moduleIds[i] || '?',
    metaphor: a.match(/data-kc-metaphor="([^"]*)"/)?.[1]?.trim() || '',
  }));
  const missingMetaphor = metaphors.filter((m) => !m.metaphor).map((m) => m.id);
  check(
    `every module declares data-kc-metaphor (${metaphors.length} modules)`,
    missingMetaphor.length === 0,
    missingMetaphor.join(', ')
  );
  const metaphorCounts = new Map();
  for (const m of metaphors) {
    if (!m.metaphor) continue;
    metaphorCounts.set(m.metaphor, (metaphorCounts.get(m.metaphor) || 0) + 1);
  }
  const repeated = [...metaphorCounts].filter(([, n]) => n > 1).map(([k, n]) => `${k} (${n}x)`);
  check('no metaphor used twice in one course', repeated.length === 0, repeated.join(', '));

  /* ── 9. the course is actually in Chinese ──────────────────── */
  const bodyText = html
    .replace(/<pre[^>]*>[\s\S]*?<\/pre>/g, '')
    .replace(/<[^>]+>/g, '');
  const hanzi = (bodyText.match(/[\u4e00-\u9fa5]/g) || []).length;
  check(`Chinese prose present (${hanzi} characters)`, hanzi >= 3000, hanzi < 3000 ? 'under 3000 — this is meant to be a Chinese course' : '');

  /* ── 10. mainland punctuation ──────────────────────────────── */
  // 「」 is Taiwan/HK/Japanese convention. Code, error text and badge codes are
  // exempt: whatever punctuation the source uses is the source's business.
  let prose = raw
    .replace(/<pre[^>]*>[\s\S]*?<\/pre>/g, '')
    .replace(/<div class="kc-bughunt__code"[\s\S]*?<\/div>/g, '')
    .replace(/<code class="kc-deflist__key"[^>]*>[\s\S]*?<\/code>/g, '')
    .replace(/<code class="kc-tree__name"[^>]*>[\s\S]*?<\/code>/g, '')
    .replace(/<code class="kc-code"[^>]*>[\s\S]*?<\/code>/g, '');
  const brackets = (prose.match(/[「」『』]/g) || []).length;
  check('mainland quotation marks (no 「」)', brackets === 0, brackets ? `${brackets} corner brackets in prose — use “” and ‘’` : '');

  /* ── 11. code blocks are verbatim, continuous, correctly cited ── */
  // The one mechanical guarantee behind CLAUDE.md's "code is never edited".
  // Doctored code reads BETTER than the real thing, so review will not catch it.
  const blocks = extractCodeBlocks(raw);
  if (!sourceDir) {
    checks.push({ name: `code blocks verbatim (${blocks.length} blocks)`, ok: true, detail: '', skipped: true });
  } else {
    const sources = collectSources(sourceDir);
    const problems = [];
    for (const block of blocks) {
      if (!block.label) {
        problems.push(`a block near "${block.firstLine.slice(0, 40)}" has no file:line label`);
        continue;
      }
      const found = findVerbatim(block.lines, sources, sourceDir);
      if (!found) problems.push(`${block.label} does not match any continuous run in ${sourceDir} (first line: ${block.firstLine.slice(0, 50)})`);
      else if (found !== block.label) problems.push(`${block.label} is really at ${found}`);
    }
    check(
      `code blocks verbatim and correctly cited (${blocks.length} blocks)`,
      problems.length === 0,
      problems.join('; ')
    );
  }

  /* ── 12. numeral phrases, listed for a human ───────────────── */
  // A script cannot tell whether 六个文件 is true. It can make sure nobody has to
  // hunt for the sentences that make countable claims. Reported, never failed.
  const numerals = [...new Set(
    (bodyText.match(/[^。！？\n]{0,20}[一二三四五六七八九十两]+(?:个|行|条|份|站|道)[^。！？\n]{0,20}/g) || [])
      .map((x) => x.trim())
  )];
  checks.push({ name: `numeral claims to eyeball (${numerals.length})`, ok: true, detail: '', numerals });

  /* ── 13. interactive engines can find what they need ────────── */
  // main.js keys off ids and control-button classes; a missing one fails silently.
  // Elements whose drafts are kept apart by an id. Two of them on one page
  // without ids and they overwrite each other's saved state.
  for (const cls of ['kc-chat', 'kc-output', 'kc-quiz', 'kc-match']) {
    const tags = [...html.matchAll(new RegExp(`<div class="${cls}"([^>]*)>`, 'g'))];
    const noId = tags.filter(([, a]) => !/\sid="/.test(a)).length;
    check(`${cls} blocks have an id (${tags.length} found)`, noId === 0, `${noId} without one`);
  }

  // main.js keys off these class names; a missing button fails silently.
  for (const [cls, parts] of [
    ['kc-flow', ['kc-flow__actor', 'kc-flow__packet', 'kc-flow__caption', 'kc-flow__next', 'kc-flow__reset']],
    ['kc-chat', ['kc-chat__stream', 'kc-chat__typing', 'kc-chat__next', 'kc-chat__replay']],
    ['kc-quiz', ['kc-quiz__option', 'kc-quiz__feedback', 'kc-quiz__check', 'kc-quiz__reset']],
    ['kc-bughunt', ['kc-bughunt__code', 'kc-bughunt__line', 'kc-bughunt__feedback']],
    ['kc-match', ['kc-match__card', 'kc-match__slot', 'kc-match__drop', 'kc-match__check', 'kc-match__reset']],
    ['kc-layers', ['kc-layers__tab', 'kc-layers__panel', 'kc-layers__note']],
    ['kc-map', ['kc-map__node', 'kc-map__about']],
    ['kc-output', ['kc-output__label', 'kc-output__input', 'kc-output__meter', 'kc-output__reveal', 'kc-output__checklist']],
  ]) {
    const count = (html.match(new RegExp(`class="${cls}"`, 'g')) || []).length;
    const missing = parts.filter((b) => !html.includes(`class="${b}"`));
    check(`${cls} parts present (${count} found)`, count === 0 || missing.length === 0, missing.join(', '));
  }

  // Two feedback areas with the same id is exactly the bug the spec renamed
  // these elements to prevent.
  const idBearing = [
    ['kc-bughunt__feedback', /<div class="kc-bughunt__feedback"([^>]*)>/g],
    ['kc-map__about', /<p class="kc-map__about"([^>]*)>/g],
  ];
  for (const [cls, re] of idBearing) {
    const withId = [...html.matchAll(re)].filter(([, a]) => /\sid="/.test(a)).length;
    check(`${cls} carries no id`, withId === 0, withId ? `${withId} with an id — it must be located by its block` : '');
  }

  /* ── 14. the element examples must not ship fixed ids ────── */
  // Ids are global to the assembled course, so a literal id in an example is a
  // duplicate waiting to happen the moment two modules use that element. One
  // course hit exactly that: two spot-the-bug blocks, both id="bug-feedback".
  const elementsDir = path.join(SKILL_ROOT, 'references', 'elements');
  if (fs.existsSync(elementsDir)) {
    const literals = [];
    for (const file of fs.readdirSync(elementsDir).filter((f) => f.endsWith('.md'))) {
      const text = fs.readFileSync(path.join(elementsDir, file), 'utf8');
      for (const m of text.matchAll(/id="([^"]*)"/g)) {
        // A placeholder carries {...} or <...>; anything else is a fixed value.
        if (!/[{<]/.test(m[1])) literals.push(`${file}: id="${m[1]}"`);
      }
    }
    check(
      'element examples use placeholder ids only',
      literals.length === 0,
      literals.slice(0, 6).join('; ') + (literals.length > 6 ? ` … +${literals.length - 6}` : '')
    );
  }

  return { errors, checks };
}

export function report(courseDir, { errors, checks }) {
  console.log(`validate ${path.relative(process.cwd(), courseDir) || '.'}`);
  let numerals = null;
  for (const c of checks) {
    if (c.numerals) { numerals = c.numerals; console.log(`  LIST  ${c.name}`); continue; }
    if (c.skipped) {
      console.log(`  SKIP  ${c.name} — no --source given, so the strongest check in this file did not run`);
      continue;
    }
    console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok || !c.detail ? '' : ' — ' + c.detail}`);
  }
  if (numerals && numerals.length) {
    console.log('');
    console.log('  numeral claims — a script cannot check these, read them:');
    for (const n of numerals) console.log(`    · ${n}`);
  }
  console.log('');
  console.log(errors.length === 0 ? '  all checks passed' : `  ${errors.length} check(s) failed`);
  return errors.length === 0;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const sourceFlag = args.indexOf('--source');
  const sourceDir = sourceFlag === -1 ? null : path.resolve(args[sourceFlag + 1]);
  const skipIndex = sourceFlag === -1 ? -1 : sourceFlag + 1;
  const dir = path.resolve(args.find((a, i) => !a.startsWith('--') && i !== skipIndex) || '.');
  const ok = report(dir, validate(dir, sourceDir));
  process.exit(ok ? 0 : 1);
}
