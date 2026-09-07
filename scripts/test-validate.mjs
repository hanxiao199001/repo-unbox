#!/usr/bin/env node
// Negative tests for validate.mjs.
//
//   node scripts/test-validate.mjs
//
// Builds one minimal course that passes everything, then breaks it one rule at
// a time and insists the matching check goes red. A check that cannot fail is
// not a check — after the v0.2 rename every matcher had to be rewritten, and
// a regex that silently matches nothing would still report PASS forever.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from './validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REFS = path.join(ROOT, 'references');
const SOURCE = path.join(ROOT, 'examples', 'todo-api');

const PROSE = '这一屏讲一个概念，先从你亲手做过的那个动作说起，再一路跟着数据走下去，看它进了哪个文件、被谁改过、最后停在哪里。';
const filler = (n) => `<p>${PROSE.repeat(n)}</p>`;

// src/store.js:14-21, copied verbatim.
const CODE = `async function persist() {
  // Chain writes so two rapid requests can never interleave and corrupt the file.
  writeQueue = writeQueue.then(async () =&gt; {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(todos, null, 2), 'utf8');
  });
  return writeQueue;
}`;

const CLOSING = `
  <section class="kc-screen"><button class="kc-feedback" type="button"></button>
    <h3 class="kc-screen__title">让 AI 帮你跑起来时，你可以这样说</h3>
    <div class="kc-cards">
      <div class="kc-cards__item" data-kc-accent="1"><span class="kc-cards__icon">◆</span><p class="kc-cards__title">跑起来</p><p class="kc-cards__body">帮我把这个项目在本地跑起来。<br><span data-kc-lang="en">Help me get this Express project running locally and tell me which URL to open.</span></p></div>
      <div class="kc-cards__item" data-kc-accent="2"><span class="kc-cards__icon">◇</span><p class="kc-cards__title">加功能</p><p class="kc-cards__body">给待办加一个截止日期字段。<br><span data-kc-lang="en">Add a due date field to todos and validate it before saving to disk.</span></p></div>
      <div class="kc-cards__item" data-kc-accent="3"><span class="kc-cards__icon">○</span><p class="kc-cards__title">修报错</p><p class="kc-cards__body">端口被占了，帮我改成从环境变量读。<br><span data-kc-lang="en">Port 3000 is already in use — show me how to read the port from an environment variable.</span></p></div>
    </div>
    <h3 class="kc-screen__title">你最可能撞上的报错</h3>
    <div class="kc-deflist">
      <div class="kc-deflist__row"><code class="kc-deflist__key" data-kc-lang="en">Error: listen EADDRINUSE: address already in use :::3000</code><p class="kc-deflist__value">端口被占了，关掉上一个终端。</p></div>
      <div class="kc-deflist__row"><code class="kc-deflist__key" data-kc-lang="en">{"error":"title is required"}</code><p class="kc-deflist__value">标题是空的，校验关把它挡住了。</p></div>
      <div class="kc-deflist__row"><code class="kc-deflist__key" data-kc-lang="en">SyntaxError: Unexpected token } in JSON</code><p class="kc-deflist__value">数据文件被手动改坏了。</p></div>
    </div>
  </section>`;

const QUIZ_BLOCK = (n) => `    <div class="kc-quiz" id="kc-quiz-m${n}">
      <div class="kc-quiz__question" data-kc-answer="b" data-kc-right="对。只有它碰硬盘。" data-kc-wrong="再看一眼写盘那一行是谁调的。">
        <p class="kc-quiz__prompt">刷新之后待办还在，是谁的功劳？</p>
        <button class="kc-quiz__option" data-kc-value="a"><span class="kc-quiz__marker"></span>app.js</button>
        <button class="kc-quiz__option" data-kc-value="b"><span class="kc-quiz__marker"></span>store.js</button>
        <div class="kc-quiz__feedback"></div>
      </div>
      <div class="kc-quiz__question" data-kc-answer="a" data-kc-right="对。写盘是排队进行的。" data-kc-wrong="再看一眼 persist 里那个队列。">
        <p class="kc-quiz__prompt">两个请求同时来，为什么文件不会被写坏？</p>
        <button class="kc-quiz__option" data-kc-value="a"><span class="kc-quiz__marker"></span>写盘被排成了一队</button>
        <button class="kc-quiz__option" data-kc-value="b"><span class="kc-quiz__marker"></span>操作系统会自己处理</button>
        <div class="kc-quiz__feedback"></div>
      </div>
      <div class="kc-quiz__question" data-kc-answer="b" data-kc-right="对。await 保证写完才往下走。" data-kc-wrong="想想少了 await 会发生什么。">
        <p class="kc-quiz__prompt">persist 前面那个 await 去掉会怎样？</p>
        <button class="kc-quiz__option" data-kc-value="a"><span class="kc-quiz__marker"></span>完全没有区别</button>
        <button class="kc-quiz__option" data-kc-value="b"><span class="kc-quiz__marker"></span>还没写完就回复了，断电时数据可能对不上</button>
        <div class="kc-quiz__feedback"></div>
      </div>
      <div class="kc-quiz__actions"><button class="kc-quiz__check">看看答案</button><button class="kc-quiz__reset">再来一次</button></div>`;

const moduleHtml = (n, tone, metaphor, closing = '') => `
<section class="kc-module" id="kc-m${n}" data-kc-tone="${tone}" data-kc-metaphor="${metaphor}">
  <p class="kc-module__number">0${n}</p>
  <h2 class="kc-module__title">第 ${n} 个模块</h2>
  <p class="kc-module__subtitle">这一模块带你把一条待办从按钮追到硬盘。</p>
  <section class="kc-screen"><button class="kc-feedback" type="button"></button>
    ${filler(18)}
    <div class="kc-code-pair">
      <div class="kc-code-pair__code">
        <p class="kc-code-pair__source">src/store.js:14-21</p>
        <pre data-kc-lang="en">${CODE}</pre>
      </div>
      <div class="kc-code-pair__lines">
        <p class="kc-code-pair__line">persist 的意思是“把它留住”，这一行给函数起了这个名字。</p>
        <p class="kc-code-pair__line">原作者的注释：把写盘排成一队，两个请求同时来也不会把文件写坏。</p>
      </div>
    </div>
    <div class="kc-bughunt">
      <p class="kc-bughunt__lead">这段代码被人悄悄改坏了，点一下你觉得有问题的那一行。</p>
      <div class="kc-bughunt__code" data-kc-lang="en">
        <button class="kc-bughunt__line" data-kc-hint="这一行只是起名字。"><span class="kc-bughunt__lineno">1</span>function create(title) {</button>
        <button class="kc-bughunt__line" data-kc-bug data-kc-explain="检查的是原始的 title，不是 trim 之后的。改成 title.trim() 就对了。"><span class="kc-bughunt__lineno">2</span>  if (!title) return null;</button>
      </div>
      <div class="kc-bughunt__feedback"></div>
    </div>
    <div class="kc-chat" id="kc-chat-m${n}">
      <div class="kc-chat__stream">
        <div class="kc-chat__message" data-kc-speaker="store.js"><span class="kc-chat__avatar">T</span><div class="kc-chat__bubble"><p class="kc-chat__speaker">store.js</p>我来写盘。</div></div>
      </div>
      <div class="kc-chat__typing"></div>
      <div class="kc-chat__actions"><button class="kc-chat__next">下一条</button><button class="kc-chat__all">全部播放</button><button class="kc-chat__replay">重放</button></div>
      <p class="kc-chat__progress"></p>
    </div>
    <div class="kc-flow" data-kc-steps='[{"actor":"kc-flow-m${n}-a","text":"你点了添加。"},{"actor":"kc-flow-m${n}-b","text":"请求发出去了。","from":"kc-flow-m${n}-a","to":"kc-flow-m${n}-b"}]'>
      <div class="kc-flow__actors">
        <div class="kc-flow__actor" id="kc-flow-m${n}-a"><span class="kc-flow__icon">▤</span><span class="kc-flow__name">app.js</span></div>
        <div class="kc-flow__actor" id="kc-flow-m${n}-b"><span class="kc-flow__icon">▦</span><span class="kc-flow__name">store.js</span></div>
      </div>
      <span class="kc-flow__packet"></span>
      <p class="kc-flow__caption">点“下一步”，跟着走一遍。</p>
      <div class="kc-flow__actions"><button class="kc-flow__next">下一步</button><button class="kc-flow__reset">重来</button></div>
      <p class="kc-flow__progress"></p>
    </div>
  </section>
  <section class="kc-screen"><button class="kc-feedback" type="button"></button>
    ${filler(12)}
${QUIZ_BLOCK(n)}
    </div>
    <div class="kc-output" id="kc-output-m${n}" data-kc-kind="retell" data-kc-min="80">
      <span class="kc-output__label"></span>
      <p class="kc-output__prompt">用你自己的话说一遍，这条待办经过了哪些文件？</p>
      <textarea class="kc-output__input"></textarea>
      <p class="kc-output__meter"></p>
      <button class="kc-output__reveal">我说完了，看对照清单</button>
      <ul class="kc-output__checklist">
        <li class="kc-output__item">说出了 store.js 这个文件名</li>
        <li class="kc-output__item">提到了 persist 这个函数</li>
        <li class="kc-output__item">说清楚了写盘是排队进行的</li>
      </ul>
    </div>
  </section>${closing}
</section>`;

// 模块 0：固定三屏 —— 它是什么 / 先玩一玩 / 看代码之前的十个词
const introModule = () => `
<section class="kc-module" id="kc-m1" data-kc-tone="a" data-kc-metaphor="台站日志本">
  <p class="kc-module__number">00</p>
  <h2 class="kc-module__title">这是什么项目</h2>
  <p class="kc-module__subtitle">先弄清它是干嘛的，再谈代码。</p>
  <section class="kc-screen"><button class="kc-feedback" type="button"></button>
    <h3 class="kc-screen__title">它是什么</h3>${filler(9)}
  </section>
  <section class="kc-screen"><button class="kc-feedback" type="button"></button>
    <h3 class="kc-screen__title">先玩一玩</h3>${filler(9)}
  </section>
  <section class="kc-screen"><button class="kc-feedback" type="button"></button>
    <h3 class="kc-screen__title">看代码之前的十个词</h3>${filler(8)}
    <div class="kc-code-pair">
      <div class="kc-code-pair__code">
        <p class="kc-code-pair__source">src/store.js:14-21</p>
        <pre data-kc-lang="en">${CODE}</pre>
      </div>
      <div class="kc-code-pair__lines">
        <p class="kc-code-pair__line">persist 的意思是“把它留住”。</p>
        <p class="kc-code-pair__line">原作者的注释：把写盘排成一队。</p>
      </div>
    </div>
${QUIZ_BLOCK(1)}
    <div class="kc-output" id="kc-output-m1" data-kc-kind="explain" data-kc-min="70">
      <span class="kc-output__label"></span>
      <p class="kc-output__prompt">用一句话说这是个什么项目。</p>
      <textarea class="kc-output__input"></textarea>
      <p class="kc-output__meter"></p>
      <button class="kc-output__reveal">我说完了，看对照清单</button>
      <ul class="kc-output__checklist">
        <li class="kc-output__item">说出了它属于哪一类项目</li>
        <li class="kc-output__item">举了一个 store.js 之外你自己见过的同类东西</li>
        <li class="kc-output__item">没有用“增删改查”这种词</li>
      </ul>
    </div>
  </section>
</section>`;

// 模块 1：拆架构 —— 一行代码都不许有，必须有一张 kc-map
const archModule = () => `
<section class="kc-module" id="kc-m2" data-kc-tone="b" data-kc-metaphor="地铁进站">
  <p class="kc-module__number">01</p>
  <h2 class="kc-module__title">拆架构</h2>
  <p class="kc-module__subtitle">分几块，每块管什么。</p>
  <section class="kc-screen"><button class="kc-feedback" type="button"></button>
    <h3 class="kc-screen__title">分成几块</h3>${filler(11)}
    <div class="kc-map">
      <div class="kc-map__zone"><p class="kc-map__zone-name">浏览器</p>
        <button class="kc-map__node" data-kc-about="它画页面，也收你敲的字。"><span class="kc-map__icon">▤</span><span class="kc-map__name">app.js</span></button>
      </div>
      <div class="kc-map__zone"><p class="kc-map__zone-name">服务器</p>
        <button class="kc-map__node" data-kc-about="只有它碰硬盘。"><span class="kc-map__icon">▦</span><span class="kc-map__name">store.js</span></button>
      </div>
      <p class="kc-map__about">点任意一个方块，看它负责什么</p>
    </div>
  </section>
  <section class="kc-screen"><button class="kc-feedback" type="button"></button>
    <h3 class="kc-screen__title">块之间怎么传东西</h3>${filler(9)}
    <div class="kc-chain">
      <div class="kc-chain__step"><span class="kc-chain__num">1</span>你点了按钮</div>
      <span class="kc-chain__arrow">→</span>
      <div class="kc-chain__step"><span class="kc-chain__num">2</span>请求发出去</div>
      <span class="kc-chain__arrow">→</span>
      <div class="kc-chain__step"><span class="kc-chain__num">3</span>页面重新画</div>
    </div>
${QUIZ_BLOCK(2)}
    <div class="kc-output" id="kc-output-m2" data-kc-kind="retell" data-kc-min="80">
      <span class="kc-output__label"></span>
      <p class="kc-output__prompt">用你自己的话说一遍，这个项目分成几块，每块管什么。</p>
      <textarea class="kc-output__input"></textarea>
      <p class="kc-output__meter"></p>
      <button class="kc-output__reveal">我说完了，看对照清单</button>
      <ul class="kc-output__checklist">
        <li class="kc-output__item">说出了 app.js 管画面这一块</li>
        <li class="kc-output__item">说出了 store.js 是唯一碰硬盘的那一块</li>
        <li class="kc-output__item">说清楚了两块之间是怎么传东西的</li>
      </ul>
    </div>
  </section>
</section>`;

function buildCourse (dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(REFS, 'styles.css'), path.join(dir, 'styles.css'));
  fs.copyFileSync(path.join(REFS, 'main.js'), path.join(dir, 'main.js'));

  // A two-file fonts/ directory is enough for every font check and avoids
  // copying nine megabytes for a test.
  const fontsDir = path.join(dir, 'fonts');
  fs.mkdirSync(fontsDir, { recursive: true });
  const woff = 'jetbrains-mono-latin-400-normal.woff2';
  fs.copyFileSync(path.join(REFS, 'fonts', woff), path.join(fontsDir, woff));
  fs.writeFileSync(path.join(fontsDir, 'fonts.css'),
    `@font-face{font-family:'JetBrains Mono';src:url('./${woff}') format('woff2');}`);

  const dots = [1, 2, 3, 4, 5].map((n) => `<button class="kc-nav__dot" type="button" data-kc-target="kc-m${n}" data-kc-label="第 ${n} 个模块"></button>`).join('');
  const base = fs.readFileSync(path.join(REFS, '_base.html'), 'utf8')
    .replace(/\{\{KC_COURSE_TITLE\}\}/g, '待办 API 是怎么跑起来的')
    .replace(/\{\{KC_NAV_DOTS\}\}/g, dots);
  const footer = fs.readFileSync(path.join(REFS, '_footer.html'), 'utf8');
  const html = base
    + introModule()
    + archModule()
    + moduleHtml(3, 'a', '快递驿站')
    + moduleHtml(4, 'b', '外卖骑手接单')
    + moduleHtml(5, 'a', '白板与档案柜', CLOSING)
    + footer;
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  return path.join(dir, 'index.html');
}

// name → how to break it. `edit` rewrites index.html; `fs` touches the directory.
const MUTATIONS = [
  ['data-kc-steps JSON parses', (h) => h.replace('你点了添加。', "it's broken")],
  ['ids unique', (h) => h.replace('id="kc-m2"', 'id="kc-m1"')],
  ['every module has an id', (h) => h.replace(' id="kc-m2"', '')],
  ['nav dots match modules', (h) => h.replace('data-kc-target="kc-m2"', 'data-kc-target="kc-nowhere"')],
  ['adjacent modules alternate data-kc-tone', (h) => h.replace('data-kc-tone="b"', 'data-kc-tone="a"')],
  ['no template placeholders left', (h) => h.replace('<main class="kc-course"', '<p>{{KC_LEFTOVER}}</p><main class="kc-course"')],
  ['no external URLs', (h) => h.replace('<link rel="stylesheet" href="styles.css">', '<link rel="stylesheet" href="https://cdn.example.com/x.css">')],
  ['index.html links fonts/fonts.css', (h) => h.replace('<link rel="stylesheet" href="fonts/fonts.css">', '')],
  ['local assets exist', (h) => h.replace('src="main.js"', 'src="nope.js"')],
  ['every quiz question has data-kc-answer', (h) => h.replace(' data-kc-answer="b"', '')],
  ['every quiz question has both explanations', (h) => h.replace(/ data-kc-wrong="[^"]*"/, '')],
  ['every module has an output task', (h) => h.replace('class="kc-output"', 'class="kc-output-x"')],
  ['every module except 拆架构 has a code-pair block', (h) => h.replace(/class="kc-code-pair"/g, 'class="kc-code-pair-x"')],
  ['every module has at least 800 Chinese characters', (h) => h.replace(new RegExp(PROSE, 'g'), '短。')],
  ['at least 2 spot-the-bug challenges', (h) => h.replace(/class="kc-bughunt"/g, 'class="kc-bughunt-x"')],
  ['output tasks have a valid data-kc-kind', (h) => h.replace('data-kc-kind="retell"', 'data-kc-kind="freeform"')],
  ['output tasks have data-kc-min of at least 60', (h) => h.replace(/data-kc-min="80"/g, 'data-kc-min="10"')],
  ['output tasks are complete', (h) => h.replace('class="kc-output__reveal"', 'class="kc-output__reveal-x"')],
  ['every checklist has 3-4 items', (h) => h.replace('<li class="kc-output__item">说清楚了写盘是排队进行的</li>', '')],
  ['every checklist names a file, function or English term', (h) => h
    .replace('说出了 store.js 这个文件名', '说清楚了顺序')
    .replace('提到了 persist 这个函数', '讲明白了原理')],
  ['every module declares data-kc-metaphor', (h) => h.replace(/ data-kc-metaphor="快递驿站"/, '')],
  ['no metaphor used twice in one course', (h) => h.replace('白板与档案柜', '快递驿站')],
  ['every screen has a feedback button', (h) => h.replace('<button class="kc-feedback" type="button"></button>', '')],
  // 固定五段结构
  ['the course has 5-7 modules', (h) => h.replace(/<section class="kc-module" id="kc-m5"[\s\S]*?(?=<section class="kc-feedback-export")/, '')],
  ['模块 0「这是什么项目」has exactly 3 screens', (h) => {
    // 把模块 0 的第三屏整个删掉 —— 只剩两屏
    const i = h.indexOf('看代码之前的十个词');
    const start = h.lastIndexOf('<section class="kc-screen"', i);
    const end = h.indexOf('</section>\n</section>', start);
    return h.slice(0, start) + h.slice(end + '</section>'.length);
  }],
  ['模块 1「拆架构」has no code at all', (h) => h.replace('<div class="kc-map">',
    '<div class="kc-code-pair"><div class="kc-code-pair__code"><p class="kc-code-pair__source">src/store.js:14-21</p>' +
    '<pre data-kc-lang="en">async function persist() {</pre></div>' +
    '<div class="kc-code-pair__lines"><p class="kc-code-pair__line">不该出现在这里。</p></div></div><div class="kc-map">')],
  ['模块 1「拆架构」has an architecture map', (h) => h.replace('<div class="kc-map">', '<div class="kc-map-x">')],
  ['course ends with the feedback export block', (h) => h.replace('class="kc-feedback-export__button"', 'class="kc-feedback-export__button-x"')],
  ['every module has 3-5 quiz questions', (h) => {
    // 每组只留第一道，其余删掉 —— 正好复现 e2e 那次每模块 1 道题的情况
    let i = 0;
    return h.replace(/<div class="kc-quiz__question"[\s\S]*?<div class="kc-quiz__feedback"><\/div>\s*<\/div>\s*/g,
      (m) => (i++ % 3 === 0 ? m : ''));
  }],
  ['“” is the primary quote, ‘’ only nested inside it', (h) => h.replace(/[“”]/g, '‘')],
  ['course ends with the fixed block (bilingual AI instructions + real errors)',
    (h) => h.replace(/<span data-kc-lang="en">[^<]*<\/span>/g, '')],
  ['Chinese prose present', (h) => h.replace(new RegExp(PROSE, 'g'), 'x')],
  ['mainland quotation marks', (h) => h.replace('点“下一步”', '点「下一步」')],
  ['code blocks verbatim and correctly cited', (h) => h.replace('return writeQueue;\n}', 'return writeQueue\n}')],
  // 未转义的 < ：剥标签时会把半行吃掉，报错必须直接点名，而不是说"对不上"
  ['code blocks verbatim and correctly cited', (h) => h.replace('async () =&gt; {', 'async () => {\n    if (a < b) return;')],
  ['kc-chat blocks have an id', (h) => h.replace(/ id="kc-chat-m3"/, '')],
  ['kc-flow parts present', (h) => h.replace(/class="kc-flow__packet"/g, 'class="kc-flow__packet-x"')],
  ['kc-bughunt__feedback carries no id', (h) => h.replace('<div class="kc-bughunt__feedback">', '<div class="kc-bughunt__feedback" id="bug-feedback">')],
  ['kc-map__about carries no id', (h) => h.replace('<main class="kc-course"', '<p class="kc-map__about" id="about">x</p><main class="kc-course"')],
];

const FS_MUTATIONS = [
  ['fonts/fonts.css exists', (dir) => fs.rmSync(path.join(dir, 'fonts', 'fonts.css'))],
  ['every @font-face file exists', (dir) => fs.rmSync(path.join(dir, 'fonts', 'jetbrains-mono-latin-400-normal.woff2'))],
];

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-validate-'));
let pass = 0;
let fail = 0;

function run (dir) { return validate(dir, SOURCE); }
function line (ok, msg) {
  console.log(`${ok ? 'ok  ' : 'NOT '}${msg}`);
  if (ok) pass += 1; else fail += 1;
}

// ── 1. the clean course passes everything ────────────────────
const baseDir = path.join(work, 'clean');
buildCourse(baseDir);
const clean = run(baseDir);
line(clean.errors.length === 0, `干净的课程全部通过（${clean.checks.length} 项）` +
  (clean.errors.length ? ' — ' + clean.errors.join(' | ') : ''));
const cleanHtml = fs.readFileSync(path.join(baseDir, 'index.html'), 'utf8');

// ── 2. each rule, broken on purpose ──────────────────────────
for (const [name, mutate] of MUTATIONS) {
  const dir = path.join(work, 'm' + (pass + fail));
  buildCourse(dir);
  const before = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const after = mutate(before);
  if (after === before) { line(false, `${name} — 变异没有改动任何内容，这条测了等于没测`); continue; }
  fs.writeFileSync(path.join(dir, 'index.html'), after);
  const { errors } = run(dir);
  line(errors.some((e) => e.startsWith(name)), `${name} —— 破坏之后被抓到` +
    (errors.some((e) => e.startsWith(name)) ? '' : `（实际报的是：${errors.join(' | ') || '什么都没报'}）`));
}

for (const [name, mutate] of FS_MUTATIONS) {
  const dir = path.join(work, 'f' + (pass + fail));
  buildCourse(dir);
  mutate(dir);
  const { errors } = run(dir);
  line(errors.some((e) => e.startsWith(name)), `${name} —— 破坏之后被抓到` +
    (errors.some((e) => e.startsWith(name)) ? '' : `（实际报的是：${errors.join(' | ') || '什么都没报'}）`));
}

fs.rmSync(work, { recursive: true, force: true });
console.log('');
console.log(`# ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
