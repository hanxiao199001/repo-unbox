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
  // 每一项都有编号，报错时把编号一起打出来 —— references/CHECKS.md 里
  // 一项一行人话，模型查那一页就够了，不必去读这四百行。
  const check = (id, name, ok, detail = '') => {
    checks.push({ id, name, ok, detail });
    if (!ok) errors.push(`${id} ${name}${detail ? ': ' + detail : ''}`);
  };
  // A warning is a thing worth a human's eye that must not fail the build:
  // there are real projects whose own subject matter cannot carry a metaphor.
  const warn = (id, name, ok, detail = '') => { checks.push({ id, name, ok, detail, warn: true }); };

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
  check('C01', `data-kc-steps JSON parses (${stepAttrs.length} found)`, badSteps.length === 0, badSteps.join('; '));

  /* ── 2. ids are unique ─────────────────────────────────────── */
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const seen = new Map();
  for (const id of ids) seen.set(id, (seen.get(id) || 0) + 1);
  const dupes = [...seen].filter(([, n]) => n > 1).map(([id, n]) => `${id} (${n}x)`);
  check('C02', `ids unique (${ids.length} total)`, dupes.length === 0, dupes.join(', '));

  /* ── 3. nav dots and modules line up, both directions ──────── */
  const moduleTags = [...html.matchAll(/<section class="kc-module"([^>]*)>/g)].map((m) => m[1]);
  const moduleIds = moduleTags.map((a) => a.match(/\sid="([^"]+)"/)?.[1] || '');
  const dotTargets = [...html.matchAll(/class="kc-nav__dot"[^>]*data-kc-target="([^"]+)"/g)].map((m) => m[1]);

  // A module with no id cannot be reached by any dot, and the loops below would
  // silently pair the wrong things up.
  const namelessModules = moduleIds.filter((id) => !id).length;
  check('C03', 'every module has an id', namelessModules === 0, namelessModules ? `${namelessModules} module(s) without one` : '');
  const missingDot = moduleIds.filter((id) => id && !dotTargets.includes(id));
  const danglingDot = dotTargets.filter((id) => !moduleIds.includes(id));
  check('C04', 
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
  check('C05', `adjacent modules alternate data-kc-tone (${tones.length} modules)`, badTone.length === 0, badTone.join('; '));

  /* ── 3c. no template placeholder survived into the build ───── */
  const leftover = [...new Set((raw.match(/\{\{[A-Z_]+\}\}/g) || []))];
  check('C06', 'no template placeholders left', leftover.length === 0, leftover.join(', '));

  /* ── 4. nothing loads from the network ─────────────────────── */
  // The whole point of self-hosting the fonts. One stray CDN link and the
  // course stops working offline, which is exactly what we cannot test for
  // from here.
  const external = [...raw.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  const externalCss = [...raw.matchAll(/url\((['"]?)(https?:\/\/[^'")]+)\1\)/g)].map((m) => m[2]);
  const allExternal = [...new Set([...external, ...externalCss])];
  check('C07', 'no external URLs', allExternal.length === 0, allExternal.join(', '));

  /* ── 5. fonts are present and actually referenced ──────────── */
  // The silent failure this round is most likely to produce: a wrong path
  // leaves the page perfectly openable, just rendered in the default font.
  const fontsCss = path.join(courseDir, 'fonts', 'fonts.css');
  const hasFontsCss = fs.existsSync(fontsCss);
  check('C08', 'fonts/fonts.css exists', hasFontsCss, hasFontsCss ? '' : fontsCss);

  const linked = /<link[^>]+href="fonts\/fonts\.css"/.test(raw);
  check('C09', 'index.html links fonts/fonts.css', linked);

  if (hasFontsCss) {
    const css = fs.readFileSync(fontsCss, 'utf8');
    const refs = [...css.matchAll(/url\((['"]?)\.\/([^'")]+)\1\)/g)].map((m) => m[2]);
    const missing = refs.filter((f) => !fs.existsSync(path.join(courseDir, 'fonts', f)));
    check('C36',
      `every @font-face file exists (${refs.length} referenced)`,
      missing.length === 0,
      missing.slice(0, 5).join(', ') + (missing.length > 5 ? ` … +${missing.length - 5}` : '')
    );
  }

  /* ── 6. local assets referenced by the page exist ──────────── */
  const localAssets = [...raw.matchAll(/(?:src|href)="(?!https?:|#)([^"]+)"/g)].map((m) => m[1]);
  const missingAssets = [...new Set(localAssets)].filter((f) => !fs.existsSync(path.join(courseDir, f)));
  check('C10', 'local assets exist', missingAssets.length === 0, missingAssets.join(', '));

  /* ── 7. quizzes are answerable ─────────────────────────────── */
  const quizBlocks = [...html.matchAll(/<div class="kc-quiz__question"([\s\S]*?)>/g)];
  const noAnswer = quizBlocks.filter(([, attrs]) => !/data-kc-answer="/.test(attrs)).length;
  check('C11', `every quiz question has data-kc-answer (${quizBlocks.length} questions)`, noAnswer === 0, `${noAnswer} without an answer`);

  // Both explanations are required. Without them the answer reveal says
  // "correct/incorrect" and teaches nothing, which is the one thing
  // content-philosophy forbids outright.
  const noWhy = quizBlocks.filter(([, a]) => !/data-kc-right="/.test(a) || !/data-kc-wrong="/.test(a)).length;
  check('C12', 'every quiz question has both explanations', noWhy === 0, noWhy ? `${noWhy} missing data-kc-right or data-kc-wrong` : '');

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
  check('C13', 
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

  // 固定五段：0 这是什么项目 / 1 拆架构 / 2..n 主线 / 末 做一个类似的
  const ARCH = 1;
  check('C14', `the course has 5-7 modules (${moduleBlocks.length} found)`,
    moduleBlocks.length >= 5 && moduleBlocks.length <= 7,
    moduleBlocks.length < 5 ? 'fixed structure needs 模块 0 + 拆架构 + 2-4 条主线 + 做一个类似的' : '中间的主线模块最多 4 个');

  // 模块 0 固定三屏：它是什么 / 先玩一玩 / 看代码之前的十个词
  const introScreens = (moduleBlocks[0] || '').split('<section class="kc-screen"').length - 1;
  check('C15', `模块 0「这是什么项目」has exactly 3 screens (${introScreens} found)`, introScreens === 3,
    introScreens === 3 ? '' : '三屏是固定的：它是什么 / 先玩一玩 / 看代码之前的十个词');

  // 模块 1 一行代码都不许有。学员刚认完十个词，还没有能力读代码 ——
  // 这一模块给的是地图，不是街道。
  const archCode = ((moduleBlocks[ARCH] || '').match(/class="kc-code-pair"/g) || []).length;
  check('C16', '模块 1「拆架构」has no code at all', archCode === 0,
    archCode ? `${archCode} code-pair block(s) — 先给地图，再进街道：这一模块不许出现代码` : '');
  const archMap = ((moduleBlocks[ARCH] || '').match(/class="kc-map"/g) || []).length;
  check('C17', '模块 1「拆架构」has an architecture map', archMap >= 1,
    archMap ? '' : 'needs one kc-map — the map is the whole point of this module');

  const thinCode = [];
  const thinProse = [];
  moduleBlocks.forEach((block, i) => {
    const id = moduleIds[i] || `module ${i + 1}`;
    const codeBlocks = (block.match(/class="kc-code-pair"/g) || []).length;
    if (codeBlocks === 0 && i !== ARCH) thinCode.push(id);
    const hanzi = (moduleText(block).match(/[\u4e00-\u9fa5]/g) || []).length;
    if (hanzi < 800) thinProse.push(`${id} (${hanzi})`);
  });
  check('C18', 'every module except 拆架构 has a code-pair block', thinCode.length === 0, thinCode.join(', '));

  // elements/quiz.md: one set per module, 3-5 questions. The +1 is for a
  // scenario-wrapped question, which is a single question by design.
  // A one-question module passed every whole-course count before this check.
  const thinQuiz = [];
  moduleBlocks.forEach((block, i) => {
    const n = (block.match(/class="kc-quiz__question"/g) || []).length;
    if (n < 3 || n > 6) thinQuiz.push(`${moduleIds[i] || `module ${i + 1}`} (${n})`);
  });
  check('C19', 'every module has 3-5 quiz questions', thinQuiz.length === 0,
    thinQuiz.length ? `${thinQuiz.join(', ')} — 3-5 per module, plus at most one scenario question` : '');
  check('C20', 'every module has at least 800 Chinese characters', thinProse.length === 0, thinProse.join(', '));

  // The element that makes the learner point at a real mistake. Two is the floor
  // because one across a whole course reads as decoration.
  const bugChallenges = (html.match(/class="kc-bughunt"/g) || []).length;
  check('C21', `at least 2 spot-the-bug challenges (${bugChallenges} found)`, bugChallenges >= 2);

  const TASK_TYPES = ['retell', 'instruct', 'explain'];
  const taskAttrs = [...html.matchAll(/<div class="kc-output"([^>]*)>/g)].map((m) => m[1]);
  const badType = taskAttrs.filter((a) => {
    const m = a.match(/data-kc-kind="([^"]*)"/);
    return !m || !TASK_TYPES.includes(m[1]);
  }).length;
  check('C22', `output tasks have a valid data-kc-kind (${TASK_TYPES.join('/')})`, badType === 0, `${badType} without one`);

  // 60 is the floor: shorter than that and the learner types 就是那样 and moves on,
  // which defeats the only element that makes them produce anything.
  const mins = taskAttrs.map((a) => Number(a.match(/data-kc-min="(\d+)"/)?.[1] ?? NaN));
  const badMin = mins.filter((m) => !Number.isFinite(m) || m < 60);
  check('C23', 
    'output tasks have data-kc-min of at least 60',
    badMin.length === 0,
    badMin.length ? `${badMin.length} below 60 or missing: ${badMin.join(', ')}` : ''
  );

  const noId = taskAttrs.filter((a) => !/\sid="/.test(a)).length;
  check('C24', 'output tasks have an id (localStorage key)', noId === 0, `${noId} without one`);

  const textareas = (html.match(/class="kc-output__input"/g) || []).length;
  const reveals = (html.match(/class="kc-output__reveal"/g) || []).length;
  const lists = (html.match(/class="kc-output__checklist"/g) || []).length;
  check('C25', 
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
  check('C26', 'every checklist has 3-4 items', wrongSize === 0, `${wrongSize} outside that range`);

  // A checklist of four vague statements gives the learner nothing to check
  // themselves against. At least one item must name something in English inside
  // <code lang="en">: a file or function for retell and instruct tasks, and for
  // an explain task the English word for the concept itself — that task asks the
  // learner to avoid jargon, so demanding a filename would fight its purpose.
  const vagueLists = checklistBlocks.filter((m) => !/[A-Za-z]{2,}/.test(m[1].replace(/<[^>]+>/g, ''))).length;
  check('C27', 
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
  check('C28', 
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
  check('C29', 'no metaphor used twice in one course', repeated.length === 0, repeated.join(', '));

  // Metaphors should grow out of the project's own subject matter. A metaphor
  // is counted as generic when it comes from references/metaphor-fallback.md
  // AND its wording appears nowhere in the codebase's own text — so a Chinese
  // repo, or one that reuses the same word, still counts as native.
  // WARN, never FAIL: some projects genuinely have no subject matter to borrow.
  const fallbackFile = path.join(SKILL_ROOT, 'references', 'metaphor-fallback.md');
  if (fs.existsSync(fallbackFile) && metaphors.length) {
    const table = fs.readFileSync(fallbackFile, 'utf8');
    const generic = [...table.matchAll(/\|\s*`([^`]+)`\s*\|/g)].map((m) => m[1].trim()).filter(Boolean);
    let repoText = '';
    if (sourceDir && fs.existsSync(sourceDir)) {
      for (const [, src] of collectSources(sourceDir)) repoText += src;
      for (const name of ['README.md', 'readme.md', 'README.markdown']) {
        const rp = path.join(sourceDir, name);
        if (fs.existsSync(rp)) repoText += fs.readFileSync(rp, 'utf8');
      }
    }
    const borrowed = metaphors.filter((m) => {
      const hit = generic.find((g) => m.metaphor.includes(g) || g.includes(m.metaphor));
      if (!hit) return false;
      return !repoText.includes(m.metaphor);
    });
    const native = metaphors.length - borrowed.length;
    warn('C53',
      `metaphors growing out of the codebase (${native}/${metaphors.length})`,
      native >= 3,
      native >= 3 ? '' : `${borrowed.map((m) => m.metaphor).join('、')} come straight from metaphor-fallback.md — fine when the project has no subject matter of its own, worth a look otherwise`
    );
  }

  /* ── 9. the course is actually in Chinese ──────────────────── */
  const bodyText = html
    .replace(/<pre[^>]*>[\s\S]*?<\/pre>/g, '')
    .replace(/<[^>]+>/g, '');
  const hanzi = (bodyText.match(/[\u4e00-\u9fa5]/g) || []).length;
  check('C30', `Chinese prose present (${hanzi} characters)`, hanzi >= 3000, hanzi < 3000 ? 'under 3000 — this is meant to be a Chinese course' : '');

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
  check('C31', 'mainland quotation marks (no 「」)', brackets === 0, brackets ? `${brackets} corner brackets in prose — use “” and ‘’` : '');

  // “” is the primary quote; ‘’ is only for a quote inside a quote. A course
  // that uses ‘’ throughout and “” nowhere has the nesting backwards — the
  // first end-to-end run did exactly this, 53 times, and nothing caught it.
  const singles = (prose.match(/[‘’]/g) || []).length;
  const doubles = (prose.match(/[“”]/g) || []).length;
  check('C32', '“” is the primary quote, ‘’ only nested inside it',
    !(singles > 0 && doubles === 0),
    singles > 0 && doubles === 0 ? `${singles} single quotes and no double quotes — ‘’ is only for a quote inside a quote` : '');

  /* ── 10b. the fixed closing block ────────────────────────────── */
  // content-philosophy requires the course to end with two things. The first
  // end-to-end run wrote the error list and silently skipped the instructions,
  // and every whole-course count still passed.
  const lastModule = moduleBlocks.length ? moduleBlocks[moduleBlocks.length - 1] : '';
  const errorRows = (lastModule.match(/class="kc-deflist__key"/g) || []).length;
  // English instruction sentences, excluding the deflist keys (those are the
  // error originals, which are the OTHER half of the closing block).
  const withoutKeys = lastModule
    .replace(/<pre[\s\S]*?<\/pre>/g, '')
    .replace(/<code class="kc-deflist__key"[^>]*>[\s\S]*?<\/code>/g, '');
  const instructions = [...withoutKeys.matchAll(/data-kc-lang="en"[^>]*>([\s\S]*?)</g)]
    .map((m) => decodeHtml(m[1]).trim())
    .filter((t) => t.length >= 25 && (t.match(/ /g) || []).length >= 4 && /^[A-Z]/.test(t));
  check('C33', 
    'course ends with the fixed block (bilingual AI instructions + real errors)',
    instructions.length >= 3 && errorRows >= 3,
    [
      instructions.length < 3 ? `only ${instructions.length} English instruction sentence(s) — need 3+ in <code class="kc-code" data-kc-lang="en">, covering run it / add a feature / fix an error` : '',
      errorRows < 3 ? `only ${errorRows} error row(s) — need 3+ real error originals in a kc-deflist` : '',
    ].filter(Boolean).join('; ')
  );

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
      // An unescaped < swallows the rest of the line when tags are stripped, so
      // the block silently stops matching. Say that, instead of letting it look
      // like the code was mistyped — the first end-to-end run lost 90 seconds here.
      const rawLt = (block.raw || '').match(/<(?!\/?[a-zA-Z])[^\n]{0,30}/g);
      if (rawLt) {
        problems.push(`${block.label} has an unescaped < — write &lt; instead (found: ${rawLt.slice(0, 2).map((x) => x.trim()).join(' , ')})`);
        continue;
      }
      const found = findVerbatim(block.lines, sources, sourceDir);
      if (!found) problems.push(`${block.label} does not match any continuous run in ${sourceDir} (first line: ${block.firstLine.slice(0, 50)})`);
      else if (found !== block.label) problems.push(`${block.label} is really at ${found}`);
    }
    check('C37',
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
  for (const [id, cls] of [['C39', 'kc-chat'], ['C40', 'kc-output'], ['C41', 'kc-quiz'], ['C42', 'kc-match']]) {
    const tags = [...html.matchAll(new RegExp(`<div class="${cls}"([^>]*)>`, 'g'))];
    const noId = tags.filter(([, a]) => !/\sid="/.test(a)).length;
    check(id, `${cls} blocks have an id (${tags.length} found)`, noId === 0, `${noId} without one`);
  }

  // main.js keys off these class names; a missing button fails silently.
  for (const [id, cls, parts] of [
    ['C43', 'kc-flow', ['kc-flow__actor', 'kc-flow__packet', 'kc-flow__caption', 'kc-flow__next', 'kc-flow__reset']],
    ['C44', 'kc-chat', ['kc-chat__stream', 'kc-chat__typing', 'kc-chat__next', 'kc-chat__replay']],
    ['C45', 'kc-quiz', ['kc-quiz__option', 'kc-quiz__feedback', 'kc-quiz__check', 'kc-quiz__reset']],
    ['C46', 'kc-bughunt', ['kc-bughunt__code', 'kc-bughunt__line', 'kc-bughunt__feedback']],
    ['C47', 'kc-match', ['kc-match__card', 'kc-match__slot', 'kc-match__drop', 'kc-match__check', 'kc-match__reset']],
    ['C48', 'kc-layers', ['kc-layers__tab', 'kc-layers__panel', 'kc-layers__note']],
    ['C49', 'kc-map', ['kc-map__node', 'kc-map__about']],
    ['C50', 'kc-output', ['kc-output__label', 'kc-output__input', 'kc-output__meter', 'kc-output__reveal', 'kc-output__checklist']],
  ]) {
    const count = (html.match(new RegExp(`class="${cls}"`, 'g')) || []).length;
    const missing = parts.filter((b) => !html.includes(`class="${b}"`));
    check(id, `${cls} parts present (${count} found)`, count === 0 || missing.length === 0, missing.join(', '));
  }

  // Two feedback areas with the same id is exactly the bug the spec renamed
  // these elements to prevent.
  const idBearing = [
    ['C51', 'kc-bughunt__feedback', /<div class="kc-bughunt__feedback"([^>]*)>/g],
    ['C52', 'kc-map__about', /<p class="kc-map__about"([^>]*)>/g],
  ];
  for (const [id, cls, re] of idBearing) {
    const withId = [...html.matchAll(re)].filter(([, a]) => /\sid="/.test(a)).length;
    check(id, `${cls} carries no id`, withId === 0, withId ? `${withId} with an id — it must be located by its block` : '');
  }

  /* ── 13b. every screen can be told "I did not get this" ───── */
  // The learner's only channel back. A screen without the button is a screen
  // whose confusion is invisible, and there is no other way to notice.
  const screens = html.split(/<section class="kc-screen"[^>]*>/).slice(1);
  const noButton = screens.filter((seg) => {
    const own = seg.split('<section class="kc-screen"')[0];
    return !/class="kc-feedback"/.test(own);
  }).length;
  check('C34', `every screen has a feedback button (${screens.length} screens)`, noButton === 0,
    noButton ? `${noButton} screen(s) without one — scripts/build.mjs injects them, so this means the file was assembled some other way` : '');

  const exportParts = ['kc-feedback-export', 'kc-feedback-export__count', 'kc-feedback-export__button', 'kc-feedback-export__clear', 'kc-feedback-export__fallback'];
  const missingExport = exportParts.filter((c) => !html.includes(`class="${c}"`));
  check('C35', 'course ends with the feedback export block', missingExport.length === 0, missingExport.join(', '));

  /* ── 13c. every picture goes through kc-figure ─────────────── */
  const imgs = [...html.matchAll(/<img([^>]*)>/g)].map((m) => m[1]);
  const styled = imgs.filter((a) => /\sstyle=/.test(a));
  check('C54', `no inline style on <img> (${imgs.length} images)`, styled.length === 0,
    styled.length ? `${styled.length} with one — 样式全在 styles.css，内联会让一门课里的图各长各的样` : '');

  const badImg = [];
  imgs.forEach((a) => {
    if (!/class="[^"]*kc-figure__image/.test(a)) badImg.push('不在 kc-figure 里');
    else if (!/\salt="[^"]+"/.test(a)) badImg.push('缺 alt');
  });
  const figures = (html.match(/class="kc-figure"/g) || []).length;
  const captions = (html.match(/class="kc-figure__caption"/g) || []).length;
  if (figures !== captions) badImg.push(`${figures} 张图但 ${captions} 行说明`);
  check('C55', `every picture is a kc-figure with alt and a caption (${figures} figures)`,
    badImg.length === 0, [...new Set(badImg)].join('; '));

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
    check('C38',
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
    const tag = c.id ? c.id + ' ' : '';
    if (c.warn) {
      console.log(`  ${c.ok ? 'PASS' : 'WARN'}  ${tag}${c.name}${c.ok || !c.detail ? '' : ' — ' + c.detail}`);
      continue;
    }
    console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${tag}${c.name}${c.ok || !c.detail ? '' : ' — ' + c.detail}`);
  }
  if (numerals && numerals.length) {
    console.log('');
    console.log('  numeral claims — a script cannot check these, read them:');
    for (const n of numerals) console.log(`    · ${n}`);
  }
  console.log('');
  console.log(errors.length === 0 ? '  all checks passed' : `  ${errors.length} check(s) failed`);
  if (errors.length) console.log('  每一项的说明见 references/CHECKS.md，按编号找。');
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
