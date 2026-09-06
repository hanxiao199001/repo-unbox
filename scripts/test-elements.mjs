#!/usr/bin/env node
// 行为测试：用真实的 headless Chrome 跑 spec/ 里每一种交互元素。
// 零第三方依赖：Chrome 用 CDP 驱动，WebSocket 与 fetch 都用 Node 内置全局（Node >= 22）。
//
//   node scripts/test-elements.mjs              跑全部
//   node scripts/test-elements.mjs quiz flow    只跑名字里带这些词的组
//   KC_CHROME=/path/to/chrome node scripts/...  指定浏览器
//
// 退出码 0 = 全过，1 = 有失败。

import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir, platform, homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REF = resolve(HERE, '..', 'references')
const STYLES = join(REF, 'styles.css')
const MAIN = join(REF, 'main.js')
const FONTS = join(REF, 'fonts', 'fonts.css')

// ---------------------------------------------------------------- 找浏览器

function candidates () {
  const out = []
  if (process.env.KC_CHROME) out.push(process.env.KC_CHROME)
  const cache = join(homedir(), '.cache', 'puppeteer')
  for (const kind of ['chrome-headless-shell', 'chrome']) {
    const root = join(cache, kind)
    if (!existsSync(root)) continue
    for (const ver of readdirSync(root)) {
      const d = join(root, ver)
      if (!existsSync(d)) continue
      for (const inner of readdirSync(d)) {
        const base = join(d, inner)
        out.push(
          join(base, 'chrome-headless-shell'),
          join(base, 'chrome'),
          join(base, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')
        )
      }
    }
  }
  if (platform() === 'darwin') {
    out.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    out.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')
  } else if (platform() === 'win32') {
    for (const base of [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env['LOCALAPPDATA']]) {
      if (!base) continue
      out.push(join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'))
      out.push(join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
    }
  } else {
    out.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge')
  }
  return out
}

function findChrome () {
  for (const c of candidates()) if (c && existsSync(c)) return c
  throw new Error(
    '找不到 Chrome / Edge。装一个，或用 KC_CHROME=<可执行文件路径> 指定。\n试过：\n  ' +
    candidates().join('\n  ')
  )
}

// ---------------------------------------------------------------- CDP 客户端

class Cdp {
  constructor (ws) {
    this.ws = ws
    this.next = 1
    this.pending = new Map()
    this.handlers = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id != null) {
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error.message + ' (' + p.method + ')'))
        else p.resolve(msg.result)
        return
      }
      const list = this.handlers.get(msg.method)
      if (list) for (const fn of list.slice()) fn(msg.params, msg.sessionId)
    })
  }

  send (method, params = {}, sessionId) {
    const id = this.next++
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    this.ws.send(JSON.stringify(payload))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error('CDP 超时：' + method))
        }
      }, 20000)
    })
  }

  on (method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, [])
    this.handlers.get(method).push(fn)
    return () => {
      const l = this.handlers.get(method)
      const i = l.indexOf(fn)
      if (i >= 0) l.splice(i, 1)
    }
  }
}

async function launch () {
  const bin = findChrome()
  const profile = mkdtempSync(join(tmpdir(), 'kc-profile-'))
  const args = [
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    '--force-device-scale-factor=1',
    'about:blank'
  ]
  if (!/headless-shell/.test(bin)) args.unshift('--headless=new')
  const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })

  const wsUrl = await new Promise((resolveUrl, reject) => {
    let buf = ''
    const timer = setTimeout(() => reject(new Error('Chrome 没有在 15 秒内报出 DevTools 端口\n' + buf)), 15000)
    proc.stderr.on('data', (d) => {
      buf += d
      const m = buf.match(/ws:\/\/[^\s]+/)
      if (m) { clearTimeout(timer); resolveUrl(m[0]) }
    })
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error('Chrome 退出，code=' + code + '\n' + buf)) })
  })

  const ws = new WebSocket(wsUrl)
  await new Promise((ok, bad) => {
    ws.addEventListener('open', ok, { once: true })
    ws.addEventListener('error', () => bad(new Error('连不上 CDP：' + wsUrl)), { once: true })
  })
  const cdp = new Cdp(ws)
  return {
    cdp,
    async close () {
      try { ws.close() } catch {}
      proc.kill()
      try { rmSync(profile, { recursive: true, force: true }) } catch {}
    }
  }
}

// ---------------------------------------------------------------- 一个标签页

const KEYS = {
  Enter: [13, 'Enter', '\r'],
  ' ': [32, 'Space', ' '],
  Tab: [9, 'Tab', null],
  Escape: [27, 'Escape', null],
  ArrowUp: [38, 'ArrowUp', null],
  ArrowDown: [40, 'ArrowDown', null],
  ArrowLeft: [37, 'ArrowLeft', null],
  ArrowRight: [39, 'ArrowRight', null],
  PageUp: [33, 'PageUp', null],
  PageDown: [34, 'PageDown', null],
  Home: [36, 'Home', null],
  End: [35, 'End', null]
}

class Tab {
  constructor (cdp, sessionId) {
    this.cdp = cdp
    this.sid = sessionId
    this.requests = []
    this.errors = []
  }

  send (m, p) { return this.cdp.send(m, p, this.sid) }

  async init () {
    await this.send('Page.enable')
    await this.send('Runtime.enable')
    await this.send('Network.enable')
    this.cdp.on('Network.requestWillBeSent', (p, sid) => {
      if (sid === this.sid) this.requests.push(p.request.url)
    })
    this.cdp.on('Runtime.exceptionThrown', (p, sid) => {
      if (sid === this.sid) this.errors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text)
    })
  }

  async goto (url) {
    this.requests.length = 0
    this.errors.length = 0
    const done = new Promise((ok) => {
      const off = this.cdp.on('Page.loadEventFired', (p, sid) => {
        if (sid === this.sid) { off(); ok() }
      })
    })
    await this.send('Page.navigate', { url })
    await done
    await this.eval('return document.fonts.ready.then(function(){return true})')
    await this.raf(2)
  }

  async eval (expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: '(function(){' + expr + '})()',
      returnByValue: true,
      awaitPromise: true
    })
    if (r.exceptionDetails) {
      throw new Error('页内脚本抛错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    }
    return r.result.value
  }

  raf (n = 1) {
    return this.eval(
      'return new Promise(function(r){var i=' + n + ';(function s(){ if(i--<=0) return r(true); requestAnimationFrame(s); })();});'
    )
  }

  wait (ms) { return this.eval('return new Promise(function(r){setTimeout(function(){r(true)},' + ms + ')});') }

  async box (sel, i = 0) {
    const b = await this.eval(
      'var e=document.querySelectorAll(' + JSON.stringify(sel) + ')[' + i + '];' +
      'if(!e) return null;' +
      'e.scrollIntoView({block:"center",inline:"center"});' +
      'var r=e.getBoundingClientRect();' +
      'return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height};'
    )
    if (!b) throw new Error('找不到元素：' + sel + ' [' + i + ']')
    if (b.w === 0 && b.h === 0) throw new Error('元素不可见（宽高为 0）：' + sel + ' [' + i + ']')
    return b
  }

  async click (sel, i = 0) {
    const b = await this.box(sel, i)
    const base = { x: Math.round(b.x), y: Math.round(b.y), button: 'left', clickCount: 1, buttons: 1 }
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base, buttons: 0 })
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, buttons: 0 })
    await this.raf(2)
  }

  async hover (sel, i = 0) {
    const b = await this.box(sel, i)
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(b.x), y: Math.round(b.y), buttons: 0 })
    await this.raf(2)
  }

  async key (name) {
    const k = KEYS[name]
    if (!k) throw new Error('未知按键：' + name)
    const [vk, code, text] = k
    const common = { windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, key: name, code }
    await this.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...common, ...(text ? { text } : {}) })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common })
    await this.raf(2)
  }

  async typeText (t) {
    await this.send('Input.insertText', { text: t })
    await this.raf(2)
  }

  async focus (sel, i = 0) {
    await this.eval('document.querySelectorAll(' + JSON.stringify(sel) + ')[' + i + '].focus(); return true;')
  }

  async viewport (w, h) {
    await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
    await this.raf(2)
  }

  async scrollTo (y) {
    await this.eval('window.scrollTo(0,' + y + '); return true;')
    await this.raf(3)
  }
}

// ---------------------------------------------------------------- 夹具

let fixtureDir = null
function fixture (name, body, opts = {}) {
  if (!fixtureDir) fixtureDir = mkdtempSync(join(tmpdir(), 'kc-fixture-'))
  const nojs = opts.nojs === true
  const html =
'<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'<title>' + name + '</title>\n' +
'<link rel="stylesheet" href="' + pathToFileURL(FONTS).href + '">\n' +
'<link rel="stylesheet" href="' + pathToFileURL(STYLES).href + '">\n' +
'</head>\n<body>\n' + body + '\n' +
(nojs ? '' : '<script src="' + pathToFileURL(MAIN).href + '"></script>\n') +
'</body>\n</html>\n'
  const f = join(fixtureDir, name.replace(/[^a-z0-9_.-]/gi, '_') + '.html')
  writeFileSync(f, html, 'utf8')
  return pathToFileURL(f).href
}

// ---------------------------------------------------------------- 跑测试

const filters = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const groups = []
function describe (name, fn) { groups.push({ name, fn }) }

let n = 0
let failed = 0
let currentGroup = ''
const failures = []

async function it (name, fn) {
  n++
  try {
    await fn()
    console.log('ok ' + n + ' - ' + currentGroup + ': ' + name)
  } catch (e) {
    failed++
    console.log('not ok ' + n + ' - ' + currentGroup + ': ' + name)
    const msg = String(e && e.stack ? e.stack : e).split('\n').slice(0, 5)
    for (const line of msg) console.log('  # ' + line)
    failures.push(currentGroup + ': ' + name)
  }
}

function assert (cond, msg) { if (!cond) throw new Error(msg || '断言失败') }
function eq (a, b, msg) {
  if (a !== b) throw new Error((msg ? msg + ' \u2014 ' : '') + '期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a))
}
function near (a, b, tol, msg) {
  if (Math.abs(a - b) > tol) throw new Error((msg ? msg + ' \u2014 ' : '') + '期望 ' + b + ' \u00b1' + tol + '，实际 ' + a)
}

// ================================================================ 测试组
// 每一组对应 spec/ 里的一份规格。新增元素时在 KC_GROUPS_END 之前追加。

// ---------------------------------------------------------------- 公用夹具

const NAV = (mods) => `
<a class="kc-skip" href="#kc-course">跳到课程正文</a>
<header class="kc-nav">
<div class="kc-nav__progress" role="progressbar" aria-label="课程阅读进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="kc-nav__progress-fill"></span></div>
<div class="kc-nav__row">
<span class="kc-nav__title">待办 API 是怎么跑起来的</span>
<div class="kc-nav__dots" role="tablist" aria-label="模块导航">${mods.map((m) => `<button class="kc-nav__dot" type="button" data-kc-target="${m.id}" data-kc-label="${m.title}"></button>`).join('')}</div>
</div>
</header>`

const MODULE = (m) => `
<section class="kc-module" id="${m.id}" data-kc-tone="${m.tone}" data-kc-metaphor="${m.metaphor}">
  <p class="kc-module__number">${m.num}</p>
  <h2 class="kc-module__title">${m.title}</h2>
  <p class="kc-module__subtitle">${m.sub}</p>
  ${m.body || '<section class="kc-screen"><h3 class="kc-screen__title">一节</h3><p>这一屏讲一个概念，正文是中文。</p></section>'}
</section>`

const COURSE = (mods) => NAV(mods) + '<main class="kc-course" id="kc-course">' + mods.map(MODULE).join('\n') + '</main>'

const THREE = [
  { id: 'kc-m1', num: '01', tone: 'a', metaphor: '快递驿站', title: '请求从哪里来', sub: '你点的那一下，接下来去了哪。' },
  { id: 'kc-m2', num: '02', tone: 'b', metaphor: '地铁安检', title: '中间那一层', sub: '每一关都能把请求拦下来。' },
  { id: 'kc-m3', num: '03', tone: 'a', metaphor: '白板与档案柜', title: '数据存在哪', sub: '停电之后还在不在。' }
]

// 量一个元素里每一行的首尾字符
const LINE_PROBE = `
  window.__kcLines = function (el) {
    var t = el.firstChild;
    if (!t || t.nodeType !== 3) return [];
    var r = document.createRange(); var out = []; var cur = ''; var prev = null;
    for (var i = 0; i < t.length; i++) {
      r.setStart(t, i); r.setEnd(t, i + 1);
      var top = r.getBoundingClientRect().top;
      if (prev === null || Math.abs(top - prev) < 0.5) cur += t.data[i];
      else { out.push(cur); cur = t.data[i]; }
      prev = top;
    }
    if (cur) out.push(cur);
    return out;
  };`

// ---------------------------------------------------------------- 中文排版

describe('中文排版 typography-zh', async (tab) => {
  const url = fixture('typography', `
${COURSE(THREE)}
<div style="position:absolute;top:0;left:0">
  <p id="t-body">这是一段中文正文，用来量行高、字距和段间距。写得长一点，好让它至少折成两行来看真实的排版效果。</p>
  <p id="t-body2">第二段，用来量段间距。</p>
  <h2 id="t-title" class="kc-screen__title">这是一个标题</h2>
  <p id="t-mix">把title取出来，返回404，然后交给middleware处理。</p>
  <p id="t-mix2">把 title 取出来，返回 404。</p>
  <p id="t-paren">这里是（middleware）紧贴括号的写法。</p>
  <p id="t-pun">他说：“对。”（这里是补充）《规范》，就这样。</p>
  <p id="t-inline">中文里夹一个 <code class="kc-code" data-kc-lang="en">await</code> 行内代码。</p>
  <pre id="t-pre" data-kc-lang="en" style="font-family:var(--kc-font-mono);line-height:var(--kc-lh-code)">const a = 1;
// 中文注释，200 个，（不要动它）
const b = 2;</pre>
  <div id="t-narrow" style="width:10em">一二三四五六七八九十。继续写下去的文字还有很多很多很多很多。</div>
  <div id="t-narrow2" style="width:10em">一二三四五六七八九（十）一二三四五六七八九“十”一二三四</div>
  <div id="t-narrow3" style="width:10em">一二三四五六七八九十％一二三四五六七八九十℃一二三四五六</div>
  <p id="t-measure" style="max-width:var(--kc-measure)">${'中文正文测试'.repeat(40)}</p>
</div>`)
  await tab.goto(url)
  await tab.eval(LINE_PROBE + ' return true;')

  await it('正文行高为字号的 1.8 倍', async () => {
    const r = await tab.eval(`var e=document.getElementById('t-body');var s=getComputedStyle(e);
      return {lh:parseFloat(s.lineHeight), fs:parseFloat(s.fontSize)};`)
    near(r.lh / r.fs, 1.8, 0.01, '正文行高比')
  })

  await it('标题行高与正文分开设定，落在 1.25–1.35', async () => {
    const r = await tab.eval(`var e=document.getElementById('t-title');var s=getComputedStyle(e);
      var b=getComputedStyle(document.getElementById('t-body'));
      return {ratio:parseFloat(s.lineHeight)/parseFloat(s.fontSize), bodyRatio:parseFloat(b.lineHeight)/parseFloat(b.fontSize)};`)
    assert(r.ratio >= 1.25 && r.ratio <= 1.35, '标题行高比应在 1.25–1.35，实际 ' + r.ratio)
    assert(Math.abs(r.ratio - r.bodyRatio) > 0.1, '标题与正文行高必须分开设定')
  })

  await it('代码块行高为 1.7', async () => {
    const r = await tab.eval(`var e=document.getElementById('t-pre');var s=getComputedStyle(e);
      return parseFloat(s.lineHeight)/parseFloat(s.fontSize);`)
    near(r, 1.7, 0.02, '代码块行高比')
  })

  await it('中文正文不加字距', async () => {
    const ls = await tab.eval(`return getComputedStyle(document.getElementById('t-body')).letterSpacing;`)
    assert(ls === 'normal' || parseFloat(ls) === 0, 'letter-spacing 应为 normal 或 0，实际 ' + ls)
  })

  await it('段间距等于一个行高', async () => {
    const r = await tab.eval(`var s=getComputedStyle(document.getElementById('t-body'));
      return {mb:parseFloat(s.marginBottom), lh:parseFloat(s.lineHeight)};`)
    near(r.mb, r.lh, 1.5, '段下间距应等于一个行高')
  })

  await it('中文与拉丁之间有视觉间距，且复制出来不含多余空格', async () => {
    const r = await tab.eval(`var p=document.getElementById('t-mix');
      var lat=p.querySelectorAll('.kc-lat');
      var ms=[].map.call(lat,function(n){var s=getComputedStyle(n);return [n.textContent,parseFloat(s.marginInlineStart),parseFloat(s.marginInlineEnd)];});
      return {count:lat.length, ms:ms, text:p.textContent};`)
    assert(r.count >= 3, '应至少包住 title / 404 / middleware 三处，实际 ' + r.count)
    // title / middleware 两侧都是汉字 → 两侧都要有间距；
    // 404 右边紧跟全角逗号 → 按规格右侧不许加间距。
    const byText = Object.fromEntries(r.ms.map((m) => [m[0], m]))
    assert(byText.title[1] > 0 && byText.title[2] > 0, 'title 两侧都应有间距：' + JSON.stringify(byText.title))
    assert(byText.middleware[1] > 0 && byText.middleware[2] > 0, 'middleware 两侧都应有间距：' + JSON.stringify(byText.middleware))
    assert(byText['404'][1] > 0, '404 左侧是汉字，应有间距：' + JSON.stringify(byText['404']))
    eq(byText['404'][2], 0, '404 右侧紧跟全角逗号，不许加间距')
    eq(r.text, '把title取出来，返回404，然后交给middleware处理。', '文字本身不许被改动，一个空格都不许插入')
  })

  await it('作者已经手打空格时不再重复加间距', async () => {
    const r = await tab.eval(`var p=document.getElementById('t-mix2');
      var lat=p.querySelectorAll('.kc-lat');
      return {count:lat.length, text:p.textContent};`)
    eq(r.count, 0, '两侧已是空格，不该再包 kc-lat')
    eq(r.text, '把 title 取出来，返回 404。', '作者写的空格必须原样保留')
  })

  await it('紧贴全角标点时不加间距', async () => {
    const r = await tab.eval(`var p=document.getElementById('t-paren');
      var n=p.querySelector('.kc-lat');
      if(!n) return {none:true, text:p.textContent};
      var s=getComputedStyle(n);
      return {ms:parseFloat(s.marginInlineStart), me:parseFloat(s.marginInlineEnd), text:p.textContent};`)
    eq(r.text, '这里是（middleware）紧贴括号的写法。', '文字不许被改动')
    if (!r.none) {
      eq(r.ms, 0, '左边紧贴（，不加间距')
      eq(r.me, 0, '右边紧贴），不加间距')
    }
  })

  await it('连续全角标点被压缩', async () => {
    const r = await tab.eval(`var p=document.getElementById('t-pun');
      var pun=p.querySelectorAll('.kc-pun');
      var info=[].map.call(pun,function(n){return [n.textContent, parseFloat(getComputedStyle(n).marginInlineStart)];});
      return {count:pun.length, info:info, text:p.textContent};`)
    assert(r.count >= 2, '“。”（' + '、《 前后应有压缩，实际压缩 ' + r.count + ' 处：' + JSON.stringify(r.info))
    assert(r.info.every((x) => x[1] < 0), '压缩量必须是负外边距：' + JSON.stringify(r.info))
    eq(r.text, '他说：“对。”（这里是补充）《规范》，就这样。', '文字不许被改动')
  })

  await it('全角标点不悬挂（没有任何字符伸出版心右边）', async () => {
    // Chrome 不实现 hanging-punctuation 属性（返回 undefined），默认就不悬挂；
    // 所以这里不查属性值，直接量几何：任何字符的右边缘都不许越过容器内容框。
    const r = await tab.eval(`var d=document.getElementById('t-narrow');
      var prop=getComputedStyle(d).hangingPunctuation;
      var box=d.getBoundingClientRect();
      var cs=getComputedStyle(d);
      var right=box.right-parseFloat(cs.paddingRight)-parseFloat(cs.borderRightWidth);
      var t=d.firstChild, r1=document.createRange(), over=[];
      for(var i=0;i<t.length;i++){ r1.setStart(t,i); r1.setEnd(t,i+1);
        var rr=r1.getBoundingClientRect(); if(rr.right>right+0.5) over.push(t.data[i]); }
      return {prop:prop===undefined?'(浏览器不支持该属性)':prop, over:over};`)
    assert(r.prop === 'none' || r.prop === '(浏览器不支持该属性)', 'hanging-punctuation 不许开启，实际 ' + r.prop)
    eq(r.over.length, 0, '这些字符悬挂到了版心之外：' + JSON.stringify(r.over))
  })

  await it('行首不出现收尾类标点', async () => {
    const bad = '，。、；：？！）』」》%‰℃”’％'
    const lines = await tab.eval(`return [].concat(
      window.__kcLines(document.getElementById('t-narrow')),
      window.__kcLines(document.getElementById('t-narrow3')));`)
    assert(lines.length >= 3, '样本应折成多行，实际 ' + JSON.stringify(lines))
    const offenders = lines.filter((l) => l.length && bad.indexOf(l[0]) >= 0)
    eq(offenders.length, 0, '这些行以禁则字符开头：' + JSON.stringify(offenders) + ' 全部行=' + JSON.stringify(lines))
  })

  await it('行尾不出现起始类标点', async () => {
    const bad = '（『「《“‘'
    const lines = await tab.eval(`return window.__kcLines(document.getElementById('t-narrow2'));`)
    assert(lines.length >= 2, '样本应折成多行')
    const offenders = lines.slice(0, -1).filter((l) => l.length && bad.indexOf(l[l.length - 1]) >= 0)
    eq(offenders.length, 0, '这些行以起始类标点结尾：' + JSON.stringify(offenders) + ' 全部行=' + JSON.stringify(lines))
  })

  await it('行内代码与中文视觉居中（墨色中心差 ≤1px）', async () => {
    const r = await tab.eval(`
      var p=document.getElementById('t-inline');
      var code=p.querySelector('.kc-code');
      var cs=getComputedStyle(code); var ps=getComputedStyle(p);
      var c=document.createElement('canvas').getContext('2d');
      function ink(font,text,baseTop){ c.font=font; var m=c.measureText(text);
        return baseTop + m.actualBoundingBoxAscent - (m.actualBoundingBoxAscent-m.actualBoundingBoxDescent)/2; }
      // 用 Range 拿到中文与代码各自的基线位置
      var t=p.firstChild; var r1=document.createRange(); r1.setStart(t,0); r1.setEnd(t,1);
      var zhRect=r1.getBoundingClientRect(); var enRect=code.getBoundingClientRect();
      c.font=ps.fontSize+' '+ps.fontFamily; var mz=c.measureText('中文的字');
      var zhBaseline=zhRect.top+ (zhRect.height*mz.fontBoundingBoxAscent/(mz.fontBoundingBoxAscent+mz.fontBoundingBoxDescent));
      c.font=cs.fontSize+' '+cs.fontFamily; var me=c.measureText('await');
      var padTop=parseFloat(cs.paddingTop);
      var enBaseline=enRect.top+padTop+(enRect.height-padTop-parseFloat(cs.paddingBottom))*me.fontBoundingBoxAscent/(me.fontBoundingBoxAscent+me.fontBoundingBoxDescent);
      var zhCenter=zhBaseline-(mz.actualBoundingBoxAscent-mz.actualBoundingBoxDescent)/2;
      var enCenter=enBaseline-(me.actualBoundingBoxAscent-me.actualBoundingBoxDescent)/2;
      return {zhCenter:zhCenter, enCenter:enCenter, diff:zhCenter-enCenter, shift:cs.top, fs:cs.fontSize, pfs:ps.fontSize};`)
    near(r.diff, 0, 1.0, '行内代码墨色中心与中文墨色中心的差')
  })

  await it('行内代码不撑开所在行的行高', async () => {
    const r = await tab.eval(`var p=document.getElementById('t-inline');
      var h1=p.getBoundingClientRect().height;
      var clone=p.cloneNode(true); clone.querySelector('.kc-code').outerHTML='await';
      p.parentNode.appendChild(clone); var h2=clone.getBoundingClientRect().height;
      clone.remove(); return {withCode:h1, without:h2};`)
    near(r.withCode, r.without, 0.6, '带行内代码的段落高度不许变')
  })

  await it('行内代码字号约为周围中文的 0.9 倍', async () => {
    const r = await tab.eval(`var p=document.getElementById('t-inline');
      return parseFloat(getComputedStyle(p.querySelector('.kc-code')).fontSize)/parseFloat(getComputedStyle(p).fontSize);`)
    near(r, 0.9, 0.02, '行内代码字号比')
  })

  await it('全站只出现 400 与 700 两个字重，且没有倾斜文字', async () => {
    const r = await tab.eval(`var bad=[],ital=[];
      [].forEach.call(document.querySelectorAll('body *'),function(n){
        var s=getComputedStyle(n); var w=s.fontWeight;
        if(w!=='400'&&w!=='700') bad.push(n.className+':'+w);
        if(s.fontStyle!=='normal') ital.push(n.className+':'+s.fontStyle);
        if(s.fontSynthesisWeight&&s.fontSynthesisWeight!=='none') bad.push(n.className+':synth');
      });
      return {bad:bad.slice(0,8), ital:ital.slice(0,8)};`)
    eq(r.bad.length, 0, '出现了 400/700 之外的字重或字重伪造：' + JSON.stringify(r.bad))
    eq(r.ital.length, 0, '出现了倾斜文字：' + JSON.stringify(r.ital))
  })

  await it('正文每行 30–40 个汉字', async () => {
    const lines = await tab.eval(`return window.__kcLines(document.getElementById('t-measure'));`)
    const full = lines.slice(0, -1)
    assert(full.length >= 2, '样本应折成多行，实际 ' + lines.length)
    for (const l of full) assert(l.length >= 30 && l.length <= 40, '每行汉字数应在 30–40，实际 ' + l.length + '：' + l)
  })

  await it('代码块内不生效任何中文排版规则', async () => {
    const r = await tab.eval(`var pre=document.getElementById('t-pre');
      return {lat:pre.querySelectorAll('.kc-lat').length, pun:pre.querySelectorAll('.kc-pun').length,
              text:pre.textContent, lang:pre.getAttribute('lang')};`)
    eq(r.lat, 0, '代码块里不许注入中西文间距')
    eq(r.pun, 0, '代码块里不许压缩标点')
    eq(r.lang, 'en', 'data-kc-lang 必须同步到 lang 属性')
    assert(r.text.indexOf('// 中文注释，200 个，（不要动它）') >= 0, '代码块内文字必须逐字保持')
  })

  await it('文本可选中可复制', async () => {
    const r = await tab.eval(`var bad=[];
      [].forEach.call(document.querySelectorAll('.kc-course *'),function(n){
        var s=getComputedStyle(n); if(s.userSelect==='none'&&!n.classList.contains('kc-module__number')) bad.push(n.className);});
      return bad.slice(0,5);`)
    eq(r.length, 0, '这些元素禁止了选中：' + JSON.stringify(r))
  })
})

// ---------------------------------------------------------------- 页面骨架

describe('页面骨架 page-shell', async (tab) => {
  const tall = '<section class="kc-screen"><p>' + '这是一段很长的中文正文，用来把模块撑到视口两倍以上的高度。'.repeat(90) + '</p></section>'
  const url = fixture('shell', COURSE([
    THREE[0],
    { ...THREE[1], body: tall },
    THREE[2]
  ]))
  await tab.goto(url)

  await it('页面没有发出任何非 file:// 的请求', async () => {
    const outside = tab.requests.filter((u) => !u.startsWith('file://'))
    eq(outside.length, 0, '发出了外部请求：' + JSON.stringify(outside))
  })

  await it('页内脚本没有抛错', async () => {
    eq(tab.errors.length, 0, '页面抛错：' + JSON.stringify(tab.errors))
  })

  await it('相邻模块背景色不同', async () => {
    const bgs = await tab.eval(`return [].map.call(document.querySelectorAll('.kc-module'),function(m){return getComputedStyle(m).backgroundColor;});`)
    assert(bgs.length === 3, '应有 3 个模块')
    for (let i = 1; i < bgs.length; i++) assert(bgs[i] !== bgs[i - 1], '第 ' + (i + 1) + ' 个模块与前一个背景色相同：' + bgs[i])
  })

  await it('每个模块都有编号、标题、副标题、比喻，且比喻不重复', async () => {
    const r = await tab.eval(`var seen={},dup=[],missing=[];
      [].forEach.call(document.querySelectorAll('.kc-module'),function(m,i){
        ['.kc-module__number','.kc-module__title','.kc-module__subtitle'].forEach(function(s){ if(!m.querySelector(s)) missing.push(i+s); });
        var mp=m.getAttribute('data-kc-metaphor');
        if(!mp) missing.push(i+':metaphor'); else if(seen[mp]) dup.push(mp); else seen[mp]=1;
      });
      return {missing:missing, dup:dup};`)
    eq(r.missing.length, 0, '缺件：' + JSON.stringify(r.missing))
    eq(r.dup.length, 0, '比喻重复：' + JSON.stringify(r.dup))
  })

  await it('高于视口两倍的模块，能停在中间不被吸附走', async () => {
    await tab.eval(`document.documentElement.style.scrollBehavior='auto'; return true;`)
    const r = await tab.eval(`var m=document.getElementById('kc-m2');
      var rect=m.getBoundingClientRect(); var top=rect.top+window.scrollY;
      return {top:top, h:rect.height, vh:window.innerHeight};`)
    assert(r.h > r.vh * 2, '第二个模块应高于视口两倍，实际 ' + r.h + ' vs ' + r.vh)
    const mid = Math.round(r.top + r.h / 2)
    await tab.scrollTo(mid)
    await tab.wait(400)
    const after = await tab.eval(`return window.scrollY;`)
    near(after, mid, 40, '滚到长模块中间后被推走了')
  })

  await it('禁用 JavaScript 时所有文字与代码依然可读', async () => {
    const nojs = fixture('shell-nojs', COURSE(THREE), { nojs: true })
    await tab.goto(nojs)
    const r = await tab.eval(`var hidden=[];
      [].forEach.call(document.querySelectorAll('.kc-module, .kc-screen, .kc-module__title, .kc-screen__title, .kc-screen p'),function(n){
        var s=getComputedStyle(n); var r=n.getBoundingClientRect();
        if(s.display==='none'||s.visibility==='hidden'||parseFloat(s.opacity)===0||(r.width===0&&r.height===0)) hidden.push(n.className||n.tagName);});
      return hidden;`)
    eq(r.length, 0, '无脚本时这些内容不可见：' + JSON.stringify(r))
  })
})

// ---------------------------------------------------------------- 导航条

describe('导航条 navigation', async (tab) => {
  const filler = '<section class="kc-screen"><p>' + '正文内容占位，用来把模块撑高。'.repeat(30) + '</p></section>'
  const url = fixture('nav', COURSE(THREE.map((m) => ({ ...m, body: filler }))) +
    '<textarea id="probe-input" style="position:fixed;bottom:0;left:0"></textarea>')
  await tab.goto(url)
  await tab.eval(`document.documentElement.style.scrollBehavior='auto'; return true;`)

  await it('圆点数量与模块数量一致，且双向对应', async () => {
    const r = await tab.eval(`
      var dots=[].slice.call(document.querySelectorAll('.kc-nav__dot'));
      var mods=[].slice.call(document.querySelectorAll('.kc-module'));
      var targets=dots.map(function(d){return d.getAttribute('data-kc-target');});
      var ids=mods.map(function(m){return m.id;});
      return {dots:dots.length, mods:mods.length,
        dangling:targets.filter(function(t){return ids.indexOf(t)<0;}),
        orphan:ids.filter(function(i){return targets.indexOf(i)<0;}),
        broken:document.querySelectorAll('.kc-broken').length};`)
    eq(r.dots, r.mods, '圆点数与模块数不等')
    eq(r.dangling.length, 0, '圆点指向不存在的模块：' + JSON.stringify(r.dangling))
    eq(r.orphan.length, 0, '这些模块没有圆点指向：' + JSON.stringify(r.orphan))
    eq(r.broken, 0, '不该出现可见错误痕迹')
  })

  await it('圆点是可聚焦按钮，并向辅助技术说明是第几个模块', async () => {
    const r = await tab.eval(`return [].map.call(document.querySelectorAll('.kc-nav__dot'),function(d){
      return {tag:d.tagName, role:d.getAttribute('role'), label:d.getAttribute('aria-label'), tabbable:d.tabIndex>=0};});`)
    r.forEach((d, i) => {
      eq(d.tag, 'BUTTON', '圆点必须是按钮')
      eq(d.role, 'tab', '圆点应向辅助技术说明是一组标签页中的一项')
      assert(d.tabbable, '圆点必须可聚焦')
      assert(/第 \d+ 个模块：/.test(d.label || ''), '缺"第 N 个模块：标题"说明，实际 ' + d.label)
    })
    eq(r.length, 3)
  })

  await it('三种圆点状态在灰度下仍可区分', async () => {
    await tab.scrollTo(0)
    const r = await tab.eval(`
      var mods=document.querySelectorAll('.kc-module');
      window.scrollTo(0, mods[1].getBoundingClientRect().top+window.scrollY+window.innerHeight*0.3);
      return new Promise(function(res){requestAnimationFrame(function(){requestAnimationFrame(function(){
        var out=[].map.call(document.querySelectorAll('.kc-nav__dot'),function(d){
          var s=getComputedStyle(d,'::before');
          function lum(c){var m=c.match(/[\\d.]+/g)||[0,0,0,1]; var a=m[3]===undefined?1:parseFloat(m[3]);
            var l=(0.2126*+m[0]+0.7152*+m[1]+0.0722*+m[2])/255; return a<0.05?1:l;}
          return {cls:d.className, bgLum:+lum(s.backgroundColor).toFixed(3), w:s.width,
                  shadow:s.boxShadow!=='none'};});
        res(out);});});});`)
    const cur = r.filter((d) => /kc-is-current/.test(d.cls))
    const vis = r.filter((d) => /kc-is-visited/.test(d.cls))
    const none = r.filter((d) => !/kc-is-(current|visited)/.test(d.cls))
    eq(cur.length, 1, '任意时刻只有一个当前圆点：' + JSON.stringify(r.map((x) => x.cls)))
    assert(vis.length >= 1 && none.length >= 1, '样本里应同时出现已读过和未到达：' + JSON.stringify(r.map((x) => x.cls)))
    assert(cur[0].shadow, '当前圆点必须带一圈外扩光晕')
    assert(cur[0].w !== none[0].w, '当前与未到达的形状必须不同（大小）：' + cur[0].w + ' vs ' + none[0].w)
    const lums = [cur[0].bgLum, vis[0].bgLum, none[0].bgLum]
    assert(new Set(lums.map((x) => x.toFixed(2))).size === 3, '三态在灰度下明度必须互不相同：' + JSON.stringify(lums))
  })

  await it('滚到底时进度条满格', async () => {
    await tab.eval(`window.scrollTo(0, document.documentElement.scrollHeight); return true;`)
    await tab.wait(150)
    const r = await tab.eval(`return {w:document.querySelector('.kc-nav__progress-fill').style.width,
      aria:document.querySelector('.kc-nav__progress').getAttribute('aria-valuenow')};`)
    near(parseFloat(r.w), 100, 0.6, '进度条宽度')
    eq(r.aria, '100', '进度百分比要暴露给辅助技术')
  })

  await it('键盘聚焦圆点后按回车能跳到对应模块', async () => {
    await tab.scrollTo(0)
    await tab.focus('.kc-nav__dot', 2)
    const focused = await tab.eval(`return document.activeElement.getAttribute('data-kc-target');`)
    eq(focused, 'kc-m3', '焦点应落在第三个圆点上')
    await tab.key('Enter')
    await tab.wait(300)
    const r = await tab.eval(`var m=document.getElementById('kc-m3');
      return {top:Math.round(m.getBoundingClientRect().top), navH:document.querySelector('.kc-nav').getBoundingClientRect().height};`)
    assert(Math.abs(r.top - r.navH) < 20 || Math.abs(r.top) < 20, '第三个模块应滚到视口顶部，实际 top=' + r.top)
  })

  await it('方向键跳模块，但在文本框里打字时失效', async () => {
    await tab.scrollTo(0)
    await tab.key('ArrowDown')
    await tab.wait(300)
    const jumped = await tab.eval(`return window.scrollY;`)
    assert(jumped > 100, '在页面上按向下方向键应跳到下一个模块，实际 scrollY=' + jumped)

    await tab.eval(`document.getElementById('probe-input').value='一二三四五'; return true;`)
    await tab.focus('#probe-input')
    await tab.eval(`var t=document.getElementById('probe-input'); t.setSelectionRange(0,0); return true;`)
    const before = await tab.eval(`return window.scrollY;`)
    await tab.key('ArrowDown')
    await tab.wait(250)
    const after = await tab.eval(`return {y:window.scrollY, focus:document.activeElement.id};`)
    eq(after.y, before, '文本框获得焦点时方向键不许跳模块')
    eq(after.focus, 'probe-input', '焦点应留在文本框里')
  })

  await it('悬停圆点显示模块标题', async () => {
    const r = await tab.eval(`var d=document.querySelectorAll('.kc-nav__dot')[1];
      var s=getComputedStyle(d,'::after');
      return {content:s.content, label:d.getAttribute('data-kc-label')};`)
    assert(r.content.indexOf(r.label) >= 0 || r.content === 'attr(data-kc-label)',
      '圆点的悬停提示应取自 data-kc-label，实际 ' + r.content)
  })

  await it('页面短到不可滚动时进度条保持满格', async () => {
    const short = fixture('nav-short', COURSE([THREE[0]]).replace('min-height', 'x-min-height'))
    await tab.goto(short)
    await tab.viewport(1100, 3000)
    await tab.eval(`document.querySelector('.kc-module').style.minHeight='0'; window.dispatchEvent(new Event('resize')); return true;`)
    await tab.wait(150)
    const r = await tab.eval(`return {w:document.querySelector('.kc-nav__progress-fill').style.width,
      scrollable:document.documentElement.scrollHeight-window.innerHeight};`)
    assert(r.scrollable <= 0, '这个夹具应当不可滚动，实际可滚 ' + r.scrollable)
    near(parseFloat(r.w), 100, 0.6, '不可滚动时进度条应满格')
    await tab.viewport(1100, 800)
  })
})

// ---------------------------------------------------------------- 静态元素

const CODE_SAMPLE = [
  'async function create(title) {',
  '  // 标题里只有空格的，别让它进来',
  '  if (!title.trim()) return null;',
  '',
  '  const todo = { id: nextId++, title, done: false };',
  '  await persist(todo);',
  '  return todo;',
  '}'
].join('\n')

describe('代码对照 kc-code-pair', async (tab) => {
  const url = fixture('code-pair', `
<main class="kc-course"><section class="kc-module" id="kc-m1" data-kc-tone="a" data-kc-metaphor="食堂窗口">
<section class="kc-screen">
  <div class="kc-code-pair" id="cp-ok">
    <div class="kc-code-pair__code">
      <p class="kc-code-pair__source">src/store.js:12-19</p>
      <pre data-kc-lang="en">${CODE_SAMPLE.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>
    </div>
    <div class="kc-code-pair__lines">
      <p class="kc-code-pair__line">这一行给函数起名 create，意思是“造一个出来”。</p>
      <p class="kc-code-pair__line">原作者自己写的注释：空标题要挡在门外。</p>
      <p class="kc-code-pair__line">trim 把首尾空格去掉，去完还是空的就直接返回。</p>
      <p class="kc-code-pair__line">这里才真正拼出一条待办，done 一开始是 false。</p>
    </div>
  </div>
  <div class="kc-code-pair" id="cp-bad">
    <div class="kc-code-pair__code">
      <p class="kc-code-pair__source">store.js 第十二行</p>
      <pre data-kc-lang="en">const a = 1;</pre>
    </div>
    <div class="kc-code-pair__lines"><p class="kc-code-pair__line">说明。</p></div>
  </div>
</section></section></main>`)
  await tab.goto(url)

  await it('代码在宽屏和窄屏下都不出现横向滚动条', async () => {
    for (const w of [1100, 900, 480, 360]) {
      await tab.viewport(w, 800)
      const r = await tab.eval(`var pre=document.querySelector('#cp-ok pre');
        var col=document.querySelector('#cp-ok .kc-code-pair__code');
        return {sw:pre.scrollWidth, cw:pre.clientWidth, ov:getComputedStyle(pre).overflowX,
                colSW:col.scrollWidth, colCW:col.clientWidth, docSW:document.documentElement.scrollWidth, docCW:document.documentElement.clientWidth};`)
      assert(r.sw <= r.cw + 1, w + 'px 下代码块内部溢出：' + r.sw + ' > ' + r.cw)
      assert(r.colSW <= r.colCW + 1, w + 'px 下左栏溢出')
      assert(r.docSW <= r.docCW + 1, w + 'px 下整页出现横向滚动条')
    }
    await tab.viewport(1100, 800)
  })

  await it('语法高亮只包 span，代码与源文逐字一致', async () => {
    const r = await tab.eval(`var pre=document.querySelector('#cp-ok pre');
      return {text:pre.textContent, spans:pre.querySelectorAll('span[class^="kc-syn"]').length};`)
    eq(r.text, CODE_SAMPLE, '代码文字被改动了')
    assert(r.spans > 5, '应当有语法高亮，实际 span 数 ' + r.spans)
  })

  await it('代码可选中，且代码区域内不生效中文排版规则', async () => {
    const r = await tab.eval(`var pre=document.querySelector('#cp-ok pre');
      return {lat:pre.querySelectorAll('.kc-lat').length, pun:pre.querySelectorAll('.kc-pun').length,
              sel:getComputedStyle(pre).userSelect, lang:pre.getAttribute('lang'),
              ws:getComputedStyle(pre).whiteSpace};`)
    eq(r.lat, 0, '代码里不许注入中西文间距')
    eq(r.pun, 0, '代码里不许压缩标点')
    eq(r.lang, 'en', 'data-kc-lang 必须同步到 lang')
    assert(r.sel !== 'none', '代码必须可选中复制')
    assert(r.ws.indexOf('pre-wrap') >= 0, '长行必须自动折行，实际 white-space=' + r.ws)
  })

  await it('来源标注格式不对时在页面上留下可见痕迹', async () => {
    const r = await tab.eval(`
      var ok=document.getElementById('cp-ok').querySelectorAll('.kc-broken').length;
      var bad=document.getElementById('cp-bad').querySelector('.kc-broken');
      return {ok:ok, badText:bad?bad.textContent:null,
              visible: bad ? getComputedStyle(bad).display!=='none' : false};`)
    eq(r.ok, 0, '合规的对照块不该报错')
    assert(r.badText && r.badText.indexOf('src/store.js:45-55') >= 0, '格式错误应给出正确形式，实际：' + r.badText)
    assert(r.visible, '错误痕迹必须可见')
  })

  await it('窄屏下变为上下排布，中文在代码下方', async () => {
    await tab.viewport(400, 900)
    const r = await tab.eval(`var c=document.querySelector('#cp-ok .kc-code-pair__code').getBoundingClientRect();
      var l=document.querySelector('#cp-ok .kc-code-pair__lines').getBoundingClientRect();
      return {codeBottom:c.bottom, linesTop:l.top, codeLeft:c.left, linesLeft:l.left};`)
    assert(r.linesTop >= r.codeBottom - 2, '窄屏下中文栏应整体落在代码下方')
    near(r.linesLeft, r.codeLeft, 2, '窄屏下两栏应左对齐（同一列）')
    await tab.viewport(1100, 800)
  })
})

describe('提示框 kc-note', async (tab) => {
  const url = fixture('note', `
<main class="kc-course"><section class="kc-screen">
  <div class="kc-note" data-kc-tone="insight"><span class="kc-note__icon">✦</span><p class="kc-note__title">关注点分离</p><p class="kc-note__body">每一块只管一件事。</p></div>
  <div class="kc-note" data-kc-tone="info"><span class="kc-note__icon">ℹ</span><p class="kc-note__title">补充</p><p class="kc-note__body">知道了更好。</p></div>
  <div class="kc-note" data-kc-tone="warning"><span class="kc-note__icon">⚠</span><p class="kc-note__title">容易踩的坑</p><p class="kc-note__body">这里最常出错。</p></div>
  <div class="kc-note" id="note-bad" data-kc-tone="danger"><span class="kc-note__icon">!</span><p class="kc-note__title">语气不合法</p><p class="kc-note__body">应当留下痕迹。</p></div>
</section></main>`)
  await tab.goto(url)

  await it('三种语气各有不同的左边框颜色', async () => {
    const r = await tab.eval(`return [].slice.call(document.querySelectorAll('.kc-note')).slice(0,3)
      .map(function(n){return getComputedStyle(n).borderInlineStartColor;});`)
    eq(new Set(r).size, 3, '三种语气的左边框颜色必须互不相同：' + JSON.stringify(r))
  })

  await it('三种语气靠图标区分，灰度截图里仍可分辨', async () => {
    const r = await tab.eval(`return [].slice.call(document.querySelectorAll('.kc-note')).slice(0,3)
      .map(function(n){return n.querySelector('.kc-note__icon').textContent.trim();});`)
    eq(r.length, 3)
    eq(new Set(r).size, 3, '三种语气的图标字符必须互不相同（不能只靠颜色）：' + JSON.stringify(r))
    assert(r.every((x) => x.length > 0), '每个提示框都要有图标')
  })

  await it('语气取值不在三个值里时留下可见痕迹', async () => {
    const r = await tab.eval(`var b=document.querySelector('#note-bad .kc-broken');
      return {text:b?b.textContent:null, ok:document.querySelectorAll('.kc-note:not(#note-bad) .kc-broken').length};`)
    eq(r.ok, 0, '合规的提示框不该报错')
    assert(r.text && r.text.indexOf('insight') >= 0, '痕迹里要说清楚合法取值，实际：' + r.text)
  })
})

describe('概念卡片 kc-cards', async (tab) => {
  const url = fixture('cards', `
<main class="kc-course"><section class="kc-screen">
  <div class="kc-cards" id="cards-ok">
    <div class="kc-cards__item" data-kc-accent="1"><span class="kc-cards__icon">◆</span><p class="kc-cards__title">读</p><p class="kc-cards__body">把数据取出来，比如打开页面时先问一遍后端。</p></div>
    <div class="kc-cards__item" data-kc-accent="2"><span class="kc-cards__icon">◇</span><p class="kc-cards__title">写</p><p class="kc-cards__body">把新东西存进去。</p></div>
    <div class="kc-cards__item" data-kc-accent="3"><span class="kc-cards__icon">○</span><p class="kc-cards__title">删</p><p class="kc-cards__body">把一条记录去掉，通常只是打个标记。</p></div>
  </div>
  <div class="kc-cards" id="cards-bad"><div class="kc-cards__item" data-kc-accent="9"><span class="kc-cards__icon">×</span><p class="kc-cards__title">越界</p><p class="kc-cards__body">颜色取值超出范围。</p></div></div>
</section></main>`)
  await tab.goto(url)

  await it('同一组内颜色不重复', async () => {
    const r = await tab.eval(`return [].map.call(document.querySelectorAll('#cards-ok .kc-cards__item'),
      function(n){return getComputedStyle(n).borderBlockStartColor;});`)
    eq(r.length, 3)
    eq(new Set(r).size, 3, '同组卡片顶边颜色重复了：' + JSON.stringify(r))
  })

  await it('窄屏下自动变为单列', async () => {
    await tab.viewport(1100, 800)
    const wide = await tab.eval(`return [].map.call(document.querySelectorAll('#cards-ok .kc-cards__item'),function(n){return Math.round(n.getBoundingClientRect().top);});`)
    assert(new Set(wide).size === 1, '宽屏下三张卡片应在同一行：' + JSON.stringify(wide))
    await tab.viewport(380, 900)
    const narrow = await tab.eval(`return [].map.call(document.querySelectorAll('#cards-ok .kc-cards__item'),function(n){return Math.round(n.getBoundingClientRect().top);});`)
    eq(new Set(narrow).size, 3, '窄屏下三张卡片应各占一行：' + JSON.stringify(narrow))
    await tab.viewport(1100, 800)
  })

  await it('卡片高度不齐时底部对齐良好', async () => {
    const r = await tab.eval(`return [].map.call(document.querySelectorAll('#cards-ok .kc-cards__item'),
      function(n){var r=n.getBoundingClientRect();return {top:Math.round(r.top),bottom:Math.round(r.bottom)};});`)
    const tops = new Set(r.map((x) => x.top))
    const bottoms = new Set(r.map((x) => x.bottom))
    eq(tops.size, 1, '同一行卡片顶部应对齐')
    eq(bottoms.size, 1, '同一行卡片底部应对齐，不许出现参差的空洞：' + JSON.stringify(r))
  })

  await it('颜色取值超出 1–5 时留下可见痕迹', async () => {
    const r = await tab.eval(`return {bad:document.querySelectorAll('#cards-bad .kc-broken').length,
      ok:document.querySelectorAll('#cards-ok .kc-broken').length};`)
    eq(r.ok, 0)
    assert(r.bad > 0, 'accent=9 应留下可见痕迹')
  })
})

describe('编号步骤卡 kc-steps', async (tab) => {
  const url = fixture('steps', `
<main class="kc-course"><section class="kc-screen">
  <div class="kc-steps" id="steps-ok">
    <div class="kc-steps__item"><span class="kc-steps__num">1</span><p class="kc-steps__title">你点了添加</p><p class="kc-steps__body">浏览器把你打的字收起来。</p></div>
    <div class="kc-steps__item"><span class="kc-steps__num">2</span><p class="kc-steps__title">发给 server.js</p><p class="kc-steps__body">走的是 POST /todos 这条路。</p></div>
    <div class="kc-steps__item"><span class="kc-steps__num">5</span><p class="kc-steps__title">页面重新问一遍</p><p class="kc-steps__body">这里故意跳号，实现不许改写作者写的编号。</p></div>
  </div>
  <div class="kc-steps" id="steps-bad"><div class="kc-steps__item"><span class="kc-steps__num"></span><p class="kc-steps__title">缺编号</p><p class="kc-steps__body">应当留下痕迹。</p></div></div>
</section></main>`)
  await tab.goto(url)

  await it('编号由写内容的人给，实现不自动生成也不改写', async () => {
    const r = await tab.eval(`return [].map.call(document.querySelectorAll('#steps-ok .kc-steps__num'),function(n){return n.textContent.trim();});`)
    eq(r.join(','), '1,2,5', '编号被改写了（故意跳号的 5 必须保留）')
  })

  await it('缺编号时留下可见痕迹', async () => {
    const r = await tab.eval(`return {bad:document.querySelectorAll('#steps-bad .kc-broken').length,
      ok:document.querySelectorAll('#steps-ok .kc-broken').length};`)
    eq(r.ok, 0)
    assert(r.bad > 0, '空编号应留下痕迹')
  })

  await it('窄屏下卡片不挤压变形也不溢出', async () => {
    await tab.viewport(360, 900)
    const r = await tab.eval(`var bad=[];
      [].forEach.call(document.querySelectorAll('#steps-ok .kc-steps__item'),function(n){
        var num=n.querySelector('.kc-steps__num').getBoundingClientRect();
        var box=n.getBoundingClientRect();
        if(num.width<20||num.height<20) bad.push('圆形编号被压扁 '+Math.round(num.width)+'x'+Math.round(num.height));
        if(Math.abs(num.width-num.height)>1.5) bad.push('编号不圆了 '+num.width+'x'+num.height);
        if(box.right>document.documentElement.clientWidth+1) bad.push('卡片溢出视口');});
      return {bad:bad, docSW:document.documentElement.scrollWidth, docCW:document.documentElement.clientWidth};`)
    eq(r.bad.length, 0, JSON.stringify(r.bad))
    assert(r.docSW <= r.docCW + 1, '窄屏下出现了横向滚动条')
    await tab.viewport(1100, 800)
  })
})

describe('箭头流程 kc-chain', async (tab) => {
  const url = fixture('chain', `
<main class="kc-course"><section class="kc-screen">
  <div class="kc-chain" id="chain">
    <div class="kc-chain__step"><span class="kc-chain__num">1</span>你点了按钮</div>
    <span class="kc-chain__arrow">→</span>
    <div class="kc-chain__step"><span class="kc-chain__num">2</span>请求发出去</div>
    <span class="kc-chain__arrow">→</span>
    <div class="kc-chain__step"><span class="kc-chain__num">3</span>页面重新画</div>
  </div>
</section></main>`)
  await tab.goto(url)

  await it('横向排列时不出现横向滚动条', async () => {
    const r = await tab.eval(`var c=document.getElementById('chain');
      var tops=[].map.call(c.querySelectorAll('.kc-chain__step'),function(n){return Math.round(n.getBoundingClientRect().top);});
      return {sw:c.scrollWidth, cw:c.clientWidth, docSW:document.documentElement.scrollWidth, docCW:document.documentElement.clientWidth, tops:tops};`)
    assert(r.sw <= r.cw + 1, '流程容器内部横向溢出')
    assert(r.docSW <= r.docCW + 1, '整页出现横向滚动条')
    eq(new Set(r.tops).size, 1, '宽屏下三步应在同一行：' + JSON.stringify(r.tops))
  })

  await it('窄屏下改为纵向排列', async () => {
    await tab.viewport(360, 900)
    const tops = await tab.eval(`return [].map.call(document.querySelectorAll('#chain .kc-chain__step'),function(n){return Math.round(n.getBoundingClientRect().top);});`)
    eq(new Set(tops).size, 3, '窄屏下三步应各占一行：' + JSON.stringify(tops))
  })

  await it('窄屏下箭头方向变为向下', async () => {
    const r = await tab.eval(`return [].map.call(document.querySelectorAll('#chain .kc-chain__arrow'),function(n){return getComputedStyle(n).transform;});`)
    eq(r.length, 2)
    // rotate(90deg) 的矩阵是 matrix(0, 1, -1, 0, 0, 0)
    r.forEach((t) => assert(/matrix\(\s*0(\.\d+)?\s*,\s*1/.test(t) || t.indexOf('rotate(90') >= 0,
      '窄屏箭头应旋转 90 度，实际 transform=' + t))
    await tab.viewport(1100, 800)
    const wide = await tab.eval(`return getComputedStyle(document.querySelector('#chain .kc-chain__arrow')).transform;`)
    assert(wide === 'none' || /matrix\(1,\s*0,\s*0,\s*1/.test(wide), '宽屏下箭头不该旋转，实际 ' + wide)
  })
})

describe('代号表 kc-deflist', async (tab) => {
  const KEY = 'ECONNREFUSED 127.0.0.1:3000'
  const url = fixture('deflist', `
<main class="kc-course"><section class="kc-screen">
  <div class="kc-deflist" id="dl-ok">
    <div class="kc-deflist__row"><code class="kc-deflist__key" data-kc-lang="en">404</code><p class="kc-deflist__value">你要的东西不在这个地址上，先检查路径拼对没有。</p></div>
    <div class="kc-deflist__row"><code class="kc-deflist__key" data-kc-lang="en">${KEY}</code><p class="kc-deflist__value">服务没起来，或者端口不是 3000。先看终端里 npm start 有没有报错。</p></div>
    <div class="kc-deflist__row"><code class="kc-deflist__key" data-kc-lang="en">500</code><p class="kc-deflist__value">服务器自己出错了，去看终端里那一大段红字。</p></div>
    <div class="kc-deflist__row" id="dl-long"><code class="kc-deflist__key" data-kc-lang="en">Error: listen EADDRINUSE: address already in use :::3000</code><p class="kc-deflist__value">3000 这个端口已经被另一个程序占了。先把它关掉，或者换个端口。</p></div>
  </div>
  <div class="kc-deflist" id="dl-bad"><div class="kc-deflist__row"><code class="kc-deflist__key">401</code><p class="kc-deflist__value">没标英文。</p></div></div>
</section></main>`)
  await tab.goto(url)

  await it('代号可完整选中复制，与源文一字不差', async () => {
    const r = await tab.eval(`var k=document.querySelectorAll('#dl-ok .kc-deflist__key')[1];
      var sel=window.getSelection(); var r=document.createRange(); r.selectNodeContents(k);
      sel.removeAllRanges(); sel.addRange(r);
      var got=sel.toString(); sel.removeAllRanges();
      return {text:k.textContent, selected:got, us:getComputedStyle(k).userSelect};`)
    eq(r.text, KEY, '代号文字被改动了')
    eq(r.selected, KEY, '选中拿到的文字与源文不一致')
    assert(r.us !== 'none', '代号必须可选中')
  })

  await it('长代号在窄屏下折行而不撑破容器', async () => {
    await tab.viewport(340, 900)
    const r = await tab.eval(`var row=document.getElementById('dl-long');
      var k=row.querySelector('.kc-deflist__key');
      return {keyRight:k.getBoundingClientRect().right, rowRight:row.getBoundingClientRect().right,
              docSW:document.documentElement.scrollWidth, docCW:document.documentElement.clientWidth,
              lines:Math.round(k.getBoundingClientRect().height/parseFloat(getComputedStyle(k).lineHeight))};`)
    assert(r.keyRight <= r.rowRight + 1, '长代号撑破了容器')
    assert(r.docSW <= r.docCW + 1, '窄屏下出现横向滚动条')
    assert(r.lines >= 2, '长代号应当折行，实际行数 ' + r.lines)
    await tab.viewport(1100, 800)
  })

  await it('代号区域不生效中文排版规则；没标英文时留下痕迹', async () => {
    const r = await tab.eval(`var k=document.querySelectorAll('#dl-ok .kc-deflist__key')[1];
      return {lat:k.querySelectorAll('.kc-lat').length, pun:k.querySelectorAll('.kc-pun').length,
              lang:k.getAttribute('lang'),
              bad:document.querySelectorAll('#dl-bad .kc-broken').length,
              ok:document.querySelectorAll('#dl-ok .kc-broken').length};`)
    eq(r.lat, 0, '代号里不许注入中西文间距')
    eq(r.pun, 0, '代号里不许压缩标点')
    eq(r.lang, 'en')
    eq(r.ok, 0)
    assert(r.bad > 0, '未标 data-kc-lang="en" 的代号应留下可见痕迹')
  })
})

describe('文件树 kc-tree', async (tab) => {
  const url = fixture('tree', `
<main class="kc-course"><section class="kc-screen">
  <div class="kc-tree" id="tree-ok">
    <div class="kc-tree__dir"><code class="kc-tree__name" data-kc-lang="en">src/</code><span class="kc-tree__note">代码都在这儿，其余都是配置。</span></div>
    <div class="kc-tree__children">
      <div class="kc-tree__file"><code class="kc-tree__name" data-kc-lang="en">server.js</code><span class="kc-tree__note">大门口——启动程序，决定每种请求交给谁。</span></div>
      <div class="kc-tree__file"><code class="kc-tree__name" data-kc-lang="en">store.js</code><span class="kc-tree__note">只有它碰硬盘，数据不对的时候先来这里找。</span></div>
    </div>
  </div>
  <div class="kc-tree" id="tree-bad">
    <div class="kc-tree__file"><code class="kc-tree__name" data-kc-lang="en">a.js</code><span class="kc-tree__note"></span></div>
    <div class="kc-tree__file"><code class="kc-tree__name">b.js</code><span class="kc-tree__note">名字没标英文。</span></div>
  </div>
</section></main>`)
  await tab.goto(url)

  await it('层级关系一眼可辨：子层有缩进和竖线', async () => {
    const r = await tab.eval(`var dir=document.querySelector('#tree-ok .kc-tree__dir').getBoundingClientRect();
      var child=document.querySelector('#tree-ok .kc-tree__children');
      var f=child.querySelector('.kc-tree__file').getBoundingClientRect();
      var s=getComputedStyle(child);
      return {indent:f.left-dir.left, border:s.borderInlineStartStyle, bw:parseFloat(s.borderInlineStartWidth)};`)
    assert(r.indent >= 12, '子层缩进不足，实际 ' + r.indent + 'px')
    assert(r.bw > 0 && r.border !== 'none', '子层应有左侧竖线，实际 ' + r.border)
  })

  await it('窄屏下说明换行到名字下方，不横向溢出', async () => {
    await tab.viewport(340, 900)
    const r = await tab.eval(`var row=document.querySelector('#tree-ok .kc-tree__file');
      var n=row.querySelector('.kc-tree__name').getBoundingClientRect();
      var t=row.querySelector('.kc-tree__note').getBoundingClientRect();
      return {noteTop:t.top, nameBottom:n.bottom,
              docSW:document.documentElement.scrollWidth, docCW:document.documentElement.clientWidth};`)
    assert(r.noteTop >= r.nameBottom - 2, '窄屏下说明应落到名字下方')
    assert(r.docSW <= r.docCW + 1, '窄屏下出现横向滚动条')
    await tab.viewport(1100, 800)
  })

  await it('缺说明或名字没标英文时留下可见痕迹', async () => {
    const r = await tab.eval(`var b=document.querySelectorAll('#tree-bad .kc-broken');
      return {n:b.length, texts:[].map.call(b,function(x){return x.textContent;}),
              ok:document.querySelectorAll('#tree-ok .kc-broken').length};`)
    eq(r.ok, 0, '合规的树不该报错')
    assert(r.n >= 2, '缺说明与未标英文各应留下一条痕迹，实际 ' + r.n + '：' + JSON.stringify(r.texts))
  })

  await it('文件名可复制，与真实路径一致', async () => {
    const r = await tab.eval(`return [].map.call(document.querySelectorAll('#tree-ok .kc-tree__name'),function(n){return n.textContent;});`)
    eq(r.join('|'), 'src/|server.js|store.js', '文件名被改动了')
  })
})

describe('角色行 kc-rolelist', async (tab) => {
  const url = fixture('rolelist', `
<main class="kc-course"><section class="kc-screen">
  <div class="kc-rolelist" id="rl-ok">
    <div class="kc-rolelist__row" data-kc-accent="2"><span class="kc-rolelist__icon">S</span><p class="kc-rolelist__name">server.js</p><p class="kc-rolelist__note">收请求、分诊、把活派给别人。</p></div>
    <div class="kc-rolelist__row" data-kc-accent="3"><span class="kc-rolelist__icon">T</span><p class="kc-rolelist__name">store.js</p><p class="kc-rolelist__note">只有它碰硬盘。</p></div>
    <div class="kc-rolelist__row" data-kc-accent="2"><span class="kc-rolelist__icon">S</span><p class="kc-rolelist__name">server.js</p><p class="kc-rolelist__note">同一个角色第二次出现，颜色必须一样。</p></div>
  </div>
  <div class="kc-rolelist" id="rl-bad"><div class="kc-rolelist__row" data-kc-accent="0"><span class="kc-rolelist__icon">X</span><p class="kc-rolelist__name">x.js</p><p class="kc-rolelist__note">越界。</p></div></div>
</section></main>`)
  await tab.goto(url)

  await it('同一个角色在全课颜色一致', async () => {
    const r = await tab.eval(`return [].map.call(document.querySelectorAll('#rl-ok .kc-rolelist__icon'),
      function(n){return getComputedStyle(n).backgroundColor;});`)
    eq(r[0], r[2], '同一个角色（accent=2）两次出现颜色不一致：' + JSON.stringify(r))
    assert(r[0] !== r[1], '不同角色应有不同颜色：' + JSON.stringify(r))
  })

  await it('窄屏下图标与文字不重叠', async () => {
    await tab.viewport(340, 900)
    const r = await tab.eval(`var bad=[];
      [].forEach.call(document.querySelectorAll('#rl-ok .kc-rolelist__row'),function(row){
        var i=row.querySelector('.kc-rolelist__icon').getBoundingClientRect();
        var n=row.querySelector('.kc-rolelist__name').getBoundingClientRect();
        var t=row.querySelector('.kc-rolelist__note').getBoundingClientRect();
        if(n.left<i.right-0.5) bad.push('名字压到图标上');
        if(t.left<i.right-0.5) bad.push('说明压到图标上');
        if(i.width<20) bad.push('图标被压扁');});
      return {bad:bad, docSW:document.documentElement.scrollWidth, docCW:document.documentElement.clientWidth};`)
    eq(r.bad.length, 0, JSON.stringify(r.bad))
    assert(r.docSW <= r.docCW + 1, '窄屏下出现横向滚动条')
    await tab.viewport(1100, 800)
  })

  await it('颜色取值超出 1–5 时留下可见痕迹', async () => {
    const r = await tab.eval(`return {bad:document.querySelectorAll('#rl-bad .kc-broken').length,
      ok:document.querySelectorAll('#rl-ok .kc-broken').length};`)
    eq(r.ok, 0)
    assert(r.bad > 0, 'accent=0 应留下可见痕迹')
  })
})

// ---------------------------------------------------------------- 术语气泡

describe('术语气泡 kc-term', async (tab) => {
  const DEF = 'middle（中间）+ ware（东西），夹在中间的那层。在这个项目里，它是请求到达路由之前依次经过的一串检查函数。国内叫中间件，口语里也直接说 middleware。'
  const url = fixture('term', `
<main class="kc-course"><section class="kc-module" id="kc-m1" data-kc-tone="a" data-kc-metaphor="地铁安检">
<section class="kc-screen" style="padding-top:300px">
  <p id="p1">请求先经过<span class="kc-term" data-kc-define="${DEF}">中间件</span>，再进到<span class="kc-term" data-kc-define="路由（route）就是分诊台：按你说的科室，把你指到对应诊室。">路由</span>里。</p>
  <p id="p-edge" style="text-align:right"><span class="kc-term" id="t-right" data-kc-define="这个术语贴着视口右边缘，气泡必须自动向内收，不许被裁掉。">贴边的术语</span></p>
  <p id="p-top" style="position:fixed;top:4px;left:300px;margin:0;z-index:5"><span class="kc-term" id="t-top" data-kc-define="这个术语贴着视口顶部，上方放不下，气泡必须翻到下方，小三角跟着换方向。">贴顶的术语</span></p>
  <div class="kc-code-pair">
    <div class="kc-code-pair__code">
      <p class="kc-code-pair__source">src/server.js:1-3</p>
      <pre data-kc-lang="en">app.use(express.json());</pre>
    </div>
    <div class="kc-code-pair__lines">
      <p class="kc-code-pair__line">这一行装上一个<span class="kc-term" id="t-inside" data-kc-define="装在管道上的一节，请求先流过它。这里它负责把 JSON 文本变成对象。">中间件</span>，在裁剪容器内部。</p>
    </div>
  </div>
  <p id="p-bad">解释为空的<span class="kc-term" id="t-empty" data-kc-define="">术语</span>，和嵌套的<span class="kc-term" id="t-nest" data-kc-define="外层解释"><span class="kc-term" data-kc-define="内层解释">术语</span></span>。</p>
  <div style="height:1400px"></div>
</section></section></main>`)
  await tab.goto(url)

  await it('术语可聚焦，向辅助技术说明带有解释，且鼠标指针是手型不是问号', async () => {
    const r = await tab.eval(`var t=document.querySelector('#p1 .kc-term');var s=getComputedStyle(t);
      return {tabbable:t.tabIndex>=0, role:t.getAttribute('role'), exp:t.getAttribute('aria-expanded'),
              cursor:s.cursor, border:s.borderBottomStyle};`)
    assert(r.tabbable, '术语必须可聚焦')
    eq(r.role, 'button', '要向辅助技术说明它是可以触发的')
    eq(r.exp, 'false', '未打开时 aria-expanded 应为 false')
    eq(r.cursor, 'pointer', '指针必须是手型，不许用 help（问号）')
    eq(r.border, 'dashed', '术语底下要有虚线')
  })

  await it('代码对照块内部的术语，气泡完整可见没有被裁掉', async () => {
    await tab.click('#t-inside')
    const r = await tab.eval(`var b=document.querySelector('.kc-term__bubble');
      var pair=document.querySelector('.kc-code-pair');
      var r=b.getBoundingClientRect();
      var vw=document.documentElement.clientWidth, vh=document.documentElement.clientHeight;
      // 气泡平时是 pointer-events:none（免得挡住底下的字），命中测试时临时打开再还原
      var prev=b.style.pointerEvents; b.style.pointerEvents='auto';
      var pts=[[r.left+2,r.top+2],[r.right-2,r.top+2],[r.left+2,r.bottom-2],[r.right-2,r.bottom-2],[r.left+r.width/2,r.top+r.height/2]];
      var miss=pts.filter(function(p){var h=document.elementFromPoint(p[0],p[1]);return !(h&&h.closest('.kc-term__bubble'));});
      b.style.pointerEvents=prev;
      return {parent:b.parentElement.tagName, open:b.classList.contains('kc-is-open'),
              pos:getComputedStyle(b).position, insidePair:pair.contains(b),
              pairOverflow:getComputedStyle(pair).overflow,
              inView:r.left>=0&&r.top>=0&&r.right<=vw&&r.bottom<=vh,
              miss:miss.length,
              rect:{l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}};`)
    assert(r.open, '气泡应当打开')
    eq(r.parent, 'BODY', '气泡必须挂在 body 上，才不会被祖先容器裁剪')
    eq(r.pos, 'fixed', '气泡必须脱离文档流定位')
    assert(r.pairOverflow.indexOf('hidden') >= 0, '这个夹具的代码对照块应当是会裁剪的容器，否则测不出问题')
    assert(!r.insidePair, '气泡不许是裁剪容器的后代 —— 这正是原版的缺陷')
    assert(r.inView, '气泡被挤出视口了：' + JSON.stringify(r.rect))
    eq(r.miss, 0, '气泡有 ' + r.miss + ' 个角被盖住或裁掉了')
  })

  await it('同一时刻最多一个气泡', async () => {
    await tab.click('#t-inside')
    await tab.hover('#p1 .kc-term', 0)
    await tab.hover('#p1 .kc-term', 1)
    const r = await tab.eval(`return {bubbles:document.querySelectorAll('.kc-term__bubble').length,
      open:document.querySelectorAll('.kc-term__bubble.kc-is-open').length,
      terms:document.querySelectorAll('.kc-term.kc-is-open').length,
      text:document.querySelector('.kc-term__bubble').textContent.slice(0,4)};`)
    eq(r.bubbles, 1, '整页只应有一个气泡节点')
    eq(r.open, 1, '同时只能有一个气泡打开')
    eq(r.terms, 1, '同时只能有一个术语处于打开状态')
    assert(r.text.indexOf('路由') >= 0, '气泡内容应换成后打开的那个术语，实际“' + r.text + '”')
  })

  await it('点一下能开，再点一下能关，点别处也能关', async () => {
    await tab.eval(`document.querySelector('.kc-term__bubble').classList.remove('kc-is-open');return true;`)
    await tab.click('#p1 .kc-term', 0)
    const opened = await tab.eval(`return document.querySelectorAll('.kc-term__bubble.kc-is-open').length;`)
    eq(opened, 1, '点一下应当打开')
    await tab.click('#p1 .kc-term', 0)
    const closed = await tab.eval(`return document.querySelectorAll('.kc-term__bubble.kc-is-open').length;`)
    eq(closed, 0, '再点一下应当关闭')
    await tab.click('#p1 .kc-term', 0)
    await tab.click('#p-bad')
    const outside = await tab.eval(`return document.querySelectorAll('.kc-term__bubble.kc-is-open').length;`)
    eq(outside, 0, '点别处应当关闭')
  })

  await it('键盘能聚焦并打开，Esc 能关', async () => {
    await tab.focus('#p1 .kc-term', 1)
    const opened = await tab.eval(`return {open:document.querySelectorAll('.kc-term__bubble.kc-is-open').length,
      exp:document.querySelectorAll('#p1 .kc-term')[1].getAttribute('aria-expanded'),
      desc:document.querySelectorAll('#p1 .kc-term')[1].getAttribute('aria-describedby')};`)
    eq(opened.open, 1, '聚焦应当打开气泡')
    eq(opened.exp, 'true')
    eq(opened.desc, 'kc-term-bubble', '打开时应把气泡指给辅助技术')
    await tab.key('Escape')
    const after = await tab.eval(`return {open:document.querySelectorAll('.kc-term__bubble.kc-is-open').length,
      exp:document.querySelectorAll('#p1 .kc-term')[1].getAttribute('aria-expanded')};`)
    eq(after.open, 0, 'Esc 应当关闭气泡')
    eq(after.exp, 'false')
  })

  await it('气泡在视口边缘自动向内收，不许被裁掉', async () => {
    await tab.click('#t-right')
    const r = await tab.eval(`var b=document.querySelector('.kc-term__bubble').getBoundingClientRect();
      var t=document.getElementById('t-right').getBoundingClientRect();
      return {bl:b.left, br:b.right, vw:document.documentElement.clientWidth, tr:t.right,
              arrow:getComputedStyle(document.querySelector('.kc-term__bubble')).getPropertyValue('--kc-term-arrow-x')};`)
    assert(r.bl >= 0, '气泡左边超出视口：' + r.bl)
    assert(r.br <= r.vw, '气泡右边超出视口：' + r.br + ' > ' + r.vw)
    assert(parseFloat(r.arrow) > 0, '小三角应当单独对准那个词，实际 --kc-term-arrow-x=' + r.arrow)
  })

  await it('上方空间不够时翻到下方，小三角跟着换方向', async () => {
    await tab.click('#t-top')
    const r = await tab.eval(`var b=document.querySelector('.kc-term__bubble');
      var br=b.getBoundingClientRect(); var tr=document.getElementById('t-top').getBoundingClientRect();
      var a=getComputedStyle(b,'::after');
      return {below:b.classList.contains('kc-is-below'), bubbleTop:br.top, termBottom:tr.bottom,
              topColor:a.borderTopColor, bottomColor:a.borderBottomColor};`)
    assert(r.below, '上方放不下时应翻到下方')
    assert(r.bubbleTop >= r.termBottom - 1, '气泡应在术语下方，实际 ' + r.bubbleTop + ' vs ' + r.termBottom)
    assert(r.bottomColor !== 'rgba(0, 0, 0, 0)', '翻到下方时小三角应朝上（底边着色）')
    assert(r.topColor === 'rgba(0, 0, 0, 0)', '翻到下方时上边不该再着色，实际 ' + r.topColor)
  })

  await it('页面滚动后气泡不会孤零零留在原地', async () => {
    await tab.click('#p1 .kc-term', 0)
    const before = await tab.eval(`return document.querySelectorAll('.kc-term__bubble.kc-is-open').length;`)
    eq(before, 1)
    await tab.eval(`window.scrollTo(0, 500); return true;`)
    await tab.wait(120)
    const after = await tab.eval(`return document.querySelectorAll('.kc-term__bubble.kc-is-open').length;`)
    eq(after, 0, '滚动后气泡应当跟随或消失，不许留在原地')
    await tab.scrollTo(0)
  })

  await it('解释为空或嵌套术语时留下可见痕迹，且点不开', async () => {
    const r = await tab.eval(`var e=document.getElementById('t-empty'), n=document.getElementById('t-nest');
      return {emptyBroken:e.classList.contains('kc-is-broken'), nestBroken:n.classList.contains('kc-is-broken'),
              emptyColor:getComputedStyle(e).color, okColor:getComputedStyle(document.querySelector('#p1 .kc-term')).color,
              emptyLive:e.classList.contains('kc-is-live')};`)
    assert(r.emptyBroken, '解释为空应留下痕迹')
    assert(r.nestBroken, '嵌套术语应留下痕迹')
    assert(!r.emptyLive, '有问题的术语不该被当成可用的')
    assert(r.emptyColor !== r.okColor, '痕迹必须看得见（颜色与正常术语不同）')
    await tab.click('#t-empty')
    const opened = await tab.eval(`return document.querySelectorAll('.kc-term__bubble.kc-is-open').length;`)
    eq(opened, 0, '有问题的术语不许打开气泡')
  })

  await it('脚本未运行时虚线下划线仍在，正文完整可读', async () => {
    const nojs = fixture('term-nojs', `<main class="kc-course"><section class="kc-screen">
      <p id="p1">请求先经过<span class="kc-term" data-kc-define="${DEF}">中间件</span>，再进到路由里。</p></section></main>`, { nojs: true })
    await tab.goto(nojs)
    const r = await tab.eval(`var t=document.querySelector('.kc-term'); var s=getComputedStyle(t);
      return {border:s.borderBottomStyle, cursor:s.cursor, display:s.display,
              text:document.getElementById('p1').textContent, bubbles:document.querySelectorAll('.kc-term__bubble').length};`)
    eq(r.border, 'dashed', '无脚本时虚线下划线必须还在')
    eq(r.cursor, 'pointer')
    assert(r.display !== 'none', '术语必须可见')
    eq(r.text, '请求先经过中间件，再进到路由里。', '正文必须完整可读')
    eq(r.bubbles, 0, '无脚本时不该创建气泡')
  })
})

// ---------------------------------------------------------------- 选择题

const QUIZ = (id, opts) => `
<div class="kc-quiz" id="${id}">
  <div class="kc-quiz__question" data-kc-answer="b"
       data-kc-right="对。因为只有 store.js 碰硬盘，数据不对的时候就该先去那里看。"
       data-kc-wrong="再看一眼提交函数的最后一行——页面不是自己把新待办画上去的，它是重新问了一遍。">
    <p class="kc-quiz__prompt">用户说“加了待办刷新就没了”，你先去哪个文件找？</p>
    <button class="kc-quiz__option" data-kc-value="a"><span class="kc-quiz__marker"></span>app.js，因为页面是它画的</button>
    <button class="kc-quiz__option" data-kc-value="b"><span class="kc-quiz__marker"></span>store.js，因为只有它往硬盘上写</button>
    <button class="kc-quiz__option" data-kc-value="c"><span class="kc-quiz__marker"></span>server.js，因为请求是它收的</button>
    <div class="kc-quiz__feedback"></div>
  </div>
  <div class="kc-quiz__question" data-kc-answer="y"
       data-kc-right="对。校验放后端，前端绕不过去。"
       data-kc-wrong="想想学员自己改浏览器里的代码有多容易——前端的检查拦不住有心的人。">
    <p class="kc-quiz__prompt">“标题不能为空”这个检查，放前端还是后端？</p>
    <button class="kc-quiz__option" data-kc-value="x"><span class="kc-quiz__marker"></span>只放前端就够了</button>
    <button class="kc-quiz__option" data-kc-value="y"><span class="kc-quiz__marker"></span>后端一定要有，前端可以再加一层</button>
    <div class="kc-quiz__feedback"></div>
  </div>
  <div class="kc-quiz__actions">
    <button class="kc-quiz__check">看看答案</button>
    <button class="kc-quiz__reset">再来一次</button>
  </div>
</div>`

describe('选择题 kc-quiz', async (tab) => {
  const url = fixture('quiz', `<main class="kc-course"><section class="kc-screen">
${QUIZ('kc-quiz-m1')}
<div class="kc-quiz" id="quiz-bad">
  <div class="kc-quiz__question" data-kc-answer="zzz" data-kc-right="对" data-kc-wrong="错">
    <p class="kc-quiz__prompt">正确答案对不上任何选项</p>
    <button class="kc-quiz__option" data-kc-value="a"><span class="kc-quiz__marker"></span>甲</button>
    <button class="kc-quiz__option" data-kc-value="b"><span class="kc-quiz__marker"></span>乙</button>
    <div class="kc-quiz__feedback"></div>
  </div>
  <div class="kc-quiz__question" data-kc-answer="a">
    <p class="kc-quiz__prompt">缺解释文字</p>
    <button class="kc-quiz__option" data-kc-value="a"><span class="kc-quiz__marker"></span>甲</button>
    <button class="kc-quiz__option" data-kc-value="b"><span class="kc-quiz__marker"></span>乙</button>
    <div class="kc-quiz__feedback"></div>
  </div>
  <div class="kc-quiz__actions"><button class="kc-quiz__check">看看答案</button><button class="kc-quiz__reset">再来一次</button></div>
</div>
</section></main>`)
  await tab.goto(url)

  await it('一题只能选一个', async () => {
    await tab.click('#kc-quiz-m1 .kc-quiz__option', 0)
    await tab.click('#kc-quiz-m1 .kc-quiz__option', 2)
    const r = await tab.eval(`var q=document.querySelector('#kc-quiz-m1 .kc-quiz__question');
      return {sel:q.querySelectorAll('.kc-is-selected').length,
              which:[].map.call(q.querySelectorAll('.kc-quiz__option'),function(o){return o.getAttribute('aria-checked');}).join(',')};`)
    eq(r.sel, 1, '同一题里只能有一个被选中')
    eq(r.which, 'false,false,true', 'aria-checked 应跟着走')
  })

  await it('对答案后选错的题同时标出正确项，并展开解释', async () => {
    await tab.click('#kc-quiz-m1 .kc-quiz__check')
    const r = await tab.eval(`var q=document.querySelectorAll('#kc-quiz-m1 .kc-quiz__question')[0];
      var opts=[].map.call(q.querySelectorAll('.kc-quiz__option'),function(o){
        return {v:o.getAttribute('data-kc-value'), right:o.classList.contains('kc-is-right'),
                wrong:o.classList.contains('kc-is-wrong'), disabled:o.disabled};});
      var f=q.querySelector('.kc-quiz__feedback');
      return {opts:opts, fb:f.textContent, open:f.classList.contains('kc-is-open'),
              visible:getComputedStyle(f).display!=='none'};`)
    const wrong = r.opts.find((o) => o.v === 'c')
    const right = r.opts.find((o) => o.v === 'b')
    assert(wrong.wrong, '选错的那一项要标为错误')
    assert(right.right, '选错时必须同时把正确项标出来')
    assert(r.opts.every((o) => o.disabled), '对完答案所有选项都不可点')
    assert(r.open && r.visible, '解释应当展开')
    assert(r.fb.indexOf('再看一眼提交函数') >= 0, '答错时应显示"往哪儿想"的解释，实际：' + r.fb)
  })

  await it('未作答的题不产生任何负面反馈', async () => {
    const r = await tab.eval(`var q=document.querySelectorAll('#kc-quiz-m1 .kc-quiz__question')[1];
      var f=q.querySelector('.kc-quiz__feedback');
      return {marks:q.querySelectorAll('.kc-is-right,.kc-is-wrong').length, fb:f.textContent,
              open:f.classList.contains('kc-is-open')};`)
    eq(r.marks, 0, '没作答的题不许被标对错')
    eq(r.fb, '', '没作答的题不该展开解释')
    assert(!r.open)
  })

  await it('页面上找不到任何分数', async () => {
    const r = await tab.eval(`var t=document.getElementById('kc-quiz-m1').textContent;
      var hits=[]; ['答对了','得分','分数','正确率','/5','score','Score'].forEach(function(w){if(t.indexOf(w)>=0)hits.push(w);});
      if(/\\d+\\s*\\/\\s*\\d+/.test(t)) hits.push('N/M 形式的计分');
      return hits;`)
    eq(r.length, 0, '出现了计分：' + JSON.stringify(r))
  })

  await it('“再来一次”完全复原', async () => {
    await tab.click('#kc-quiz-m1 .kc-quiz__reset')
    const r = await tab.eval(`var root=document.getElementById('kc-quiz-m1');
      return {marks:root.querySelectorAll('.kc-is-selected,.kc-is-right,.kc-is-wrong').length,
              open:root.querySelectorAll('.kc-quiz__feedback.kc-is-open').length,
              fbText:[].map.call(root.querySelectorAll('.kc-quiz__feedback'),function(f){return f.textContent;}).join(''),
              disabled:[].filter.call(root.querySelectorAll('.kc-quiz__option'),function(o){return o.disabled;}).length,
              checkDisabled:root.querySelector('.kc-quiz__check').disabled};`)
    eq(r.marks, 0, '所有选择与判定都应清空')
    eq(r.open, 0, '所有解释都应收起')
    eq(r.fbText, '', '解释文字应清空')
    eq(r.disabled, 0, '选项应恢复可点')
    assert(!r.checkDisabled, '“看看答案”应恢复可点')
  })

  await it('键盘能选中选项并触发两个按钮', async () => {
    await tab.focus('#kc-quiz-m1 .kc-quiz__option', 1)
    await tab.key(' ')
    const sel = await tab.eval(`return document.querySelectorAll('#kc-quiz-m1 .kc-quiz__option')[1].classList.contains('kc-is-selected');`)
    assert(sel, '空格应能选中选项')
    await tab.focus('#kc-quiz-m1 .kc-quiz__check')
    await tab.key('Enter')
    const judged = await tab.eval(`return document.querySelectorAll('#kc-quiz-m1 .kc-quiz__feedback.kc-is-open').length;`)
    assert(judged >= 1, '回车应能触发“看看答案”')
    await tab.focus('#kc-quiz-m1 .kc-quiz__reset')
    await tab.key('Enter')
    const cleared = await tab.eval(`return document.querySelectorAll('#kc-quiz-m1 .kc-quiz__feedback.kc-is-open').length;`)
    eq(cleared, 0, '回车应能触发“再来一次”')
  })

  await it('答案对不上选项、缺解释时留下可见痕迹', async () => {
    const r = await tab.eval(`var b=document.querySelectorAll('#quiz-bad .kc-broken');
      return {n:b.length, texts:[].map.call(b,function(x){return x.textContent;}),
              ok:document.querySelectorAll('#kc-quiz-m1 .kc-broken').length};`)
    eq(r.ok, 0, '合规的那组不该报错')
    assert(r.n >= 2, '两处问题各应留下一条痕迹，实际 ' + r.n + '：' + JSON.stringify(r.texts))
    assert(r.texts.join('').indexOf('对不上任何选项') >= 0, '要说清楚是答案对不上选项')
  })

  await it('脚本未运行时题目可读，解释直接可见', async () => {
    const nojs = fixture('quiz-nojs', `<main class="kc-course"><section class="kc-screen">${QUIZ('kc-quiz-m1')}</section></main>`, { nojs: true })
    await tab.goto(nojs)
    const r = await tab.eval(`var q=document.querySelector('.kc-quiz__question');
      var after=getComputedStyle(q,'::after');
      return {content:after.content, display:after.display,
              opts:document.querySelectorAll('.kc-quiz__option').length,
              promptVisible:getComputedStyle(document.querySelector('.kc-quiz__prompt')).display!=='none'};`)
    eq(r.opts, 5, '所有选项照常可读')
    assert(r.promptVisible, '题干照常可读')
    assert(r.content.indexOf('只有 store.js 碰硬盘') >= 0, '无脚本时解释应当直接可见，实际 content=' + r.content)
    assert(r.display !== 'none', '解释区不许被隐藏')
  })
})

// ---------------------------------------------------------------- 场景题

describe('场景题 kc-scenario', async (tab) => {
  const url = fixture('scenario', `<main class="kc-course"><section class="kc-screen">
<div class="kc-scenario" id="sc-ok">
  <span class="kc-scenario__label">场景</span>
  <p class="kc-scenario__body">同学把项目跑起来，浏览器打开 localhost:3000 是白的。终端里最后一行写着 <code class="kc-code" data-kc-lang="en">Error: listen EADDRINUSE: address already in use :::3000</code>。他上一个终端窗口还开着。</p>
  ${QUIZ('kc-quiz-sc')}
</div>
<div class="kc-scenario" id="sc-bad"><span class="kc-scenario__label">场景</span><p class="kc-scenario__body"></p></div>
</section></main>`)
  await tab.goto(url)

  await it('场景块本身不可交互，判定完全由内部选择题负责', async () => {
    const r = await tab.eval(`var s=document.getElementById('sc-ok');
      return {label:!!s.querySelector('.kc-scenario__label'), body:!!s.querySelector('.kc-scenario__body'),
              quiz:s.querySelectorAll('.kc-quiz').length,
              buttonsOutsideQuiz:[].filter.call(s.querySelectorAll('button'),function(b){return !b.closest('.kc-quiz');}).length,
              live:s.classList.contains('kc-is-live')};`)
    assert(r.label && r.body, '场景块要有标签和描述')
    eq(r.quiz, 1, '场景块里应当正好有一道选择题')
    eq(r.buttonsOutsideQuiz, 0, '场景部分本身不可交互')
    assert(r.live)
  })

  await it('内部选择题的行为与独立选择题完全一致', async () => {
    await tab.click('#sc-ok .kc-quiz__option', 2)
    await tab.click('#sc-ok .kc-quiz__check')
    const r = await tab.eval(`var q=document.querySelector('#sc-ok .kc-quiz__question');
      return {wrong:q.querySelectorAll('.kc-quiz__option.kc-is-wrong').length, right:q.querySelectorAll('.kc-quiz__option.kc-is-right').length,
              fb:q.querySelector('.kc-quiz__feedback').classList.contains('kc-is-open')};`)
    eq(r.wrong, 1)
    eq(r.right, 1, '选错时必须同时标出正确项')
    assert(r.fb, '解释应展开')
  })

  await it('报错原文保持英文原样，不被中文排版规则改动', async () => {
    const r = await tab.eval(`var c=document.querySelector('#sc-ok code.kc-code');
      return {text:c.textContent, lang:c.getAttribute('lang'),
              lat:c.querySelectorAll('.kc-lat').length, pun:c.querySelectorAll('.kc-pun').length};`)
    eq(r.text, 'Error: listen EADDRINUSE: address already in use :::3000', '报错原文被改动了')
    eq(r.lang, 'en')
    eq(r.lat + r.pun, 0, '报错里不许注入中文排版')
  })

  await it('场景描述为空或没有选择题时留下可见痕迹', async () => {
    const r = await tab.eval(`var b=document.querySelectorAll('#sc-bad .kc-broken');
      return {n:b.length, texts:[].map.call(b,function(x){return x.textContent;}),
              ok:document.querySelectorAll('#sc-ok .kc-broken').length};`)
    eq(r.ok, 0)
    assert(r.n >= 2, '空描述与缺选择题各应留一条痕迹，实际 ' + r.n + '：' + JSON.stringify(r.texts))
  })
})

// ---------------------------------------------------------------- 找 bug

const BUG = (id, bugLine) => `
<div class="kc-bughunt" id="${id}">
  <p class="kc-bughunt__lead">这段代码被人悄悄改坏了，点一下你觉得有问题的那一行。</p>
  <div class="kc-bughunt__code" data-kc-lang="en">
    <button class="kc-bughunt__line" data-kc-hint="这一行只是给函数起名字，名字本身不会出错。"><span class="kc-bughunt__lineno">1</span>async function create(title) {</button>
    <button class="kc-bughunt__line" ${bugLine === 2 ? 'data-kc-bug data-kc-explain="检查的是原始的 title，不是 trim 之后的。用户敲一串空格就能存进来。把判断改成 title.trim() 就对了。"' : 'data-kc-hint="空标题确实该挡住，问题在于挡的是哪个值。"'}><span class="kc-bughunt__lineno">2</span>  if (!title) return null;</button>
    <button class="kc-bughunt__line" data-kc-hint="这一行只是把几个字段拼成一个对象，拼错了会在别处炸出来。"><span class="kc-bughunt__lineno">3</span>  const todo = { id: nextId++, title: title.trim(), done: false };</button>
    <button class="kc-bughunt__line" data-kc-hint="写盘这一步有 await，该等的都等了。"><span class="kc-bughunt__lineno">4</span>  await persist(todo);</button>
    <button class="kc-bughunt__line" data-kc-hint="把结果还回去，这一行没什么可挑的。"><span class="kc-bughunt__lineno">5</span>  return todo;</button>
  </div>
  <div class="kc-bughunt__feedback"></div>
</div>`

describe('找 bug kc-bughunt', async (tab) => {
  const url = fixture('bughunt', `<main class="kc-course"><section class="kc-screen">
${BUG('bh-1', 2)}
${BUG('bh-2', 2)}
<div class="kc-bughunt" id="bh-bad">
  <p class="kc-bughunt__lead">两处问题：反馈区带了标识符，而且没有一行标为问题行。</p>
  <div class="kc-bughunt__code" data-kc-lang="en">
    <button class="kc-bughunt__line" data-kc-hint="甲"><span class="kc-bughunt__lineno">1</span>const a = 1;</button>
    <button class="kc-bughunt__line" data-kc-hint="乙"><span class="kc-bughunt__lineno">2</span>const b = 2;</button>
  </div>
  <div class="kc-bughunt__feedback" id="bh-bad-feedback"></div>
</div>
</section></main>`)
  await tab.goto(url)

  await it('有且只有一行是正确答案，每一行的提示各不相同', async () => {
    const r = await tab.eval(`var root=document.getElementById('bh-1');
      var lines=[].slice.call(root.querySelectorAll('.kc-bughunt__line'));
      var hints=lines.filter(function(l){return !l.hasAttribute('data-kc-bug');}).map(function(l){return l.getAttribute('data-kc-hint');});
      return {bugs:root.querySelectorAll('[data-kc-bug]').length, lines:lines.length,
              hints:hints.length, unique:new Set(hints).size,
              explain:root.querySelector('[data-kc-bug]').getAttribute('data-kc-explain')};`)
    eq(r.bugs, 1, '有且只能有一行标 data-kc-bug')
    eq(r.hints, r.unique, '每一行的提示必须各不相同，不许共用一句"不是这行"')
    assert(r.explain.indexOf('title.trim()') >= 0, '找到后的解释要说清楚怎么改')
  })

  await it('点错约 2 秒后自动恢复，可以继续点，不计次不锁定', async () => {
    await tab.click('#bh-1 .kc-bughunt__line', 3)
    const hit = await tab.eval(`var root=document.getElementById('bh-1');
      return {wrong:root.querySelectorAll('.kc-bughunt__line.kc-is-wrong').length,
              fb:root.querySelector('.kc-bughunt__feedback').textContent,
              disabled:[].filter.call(root.querySelectorAll('.kc-bughunt__line'),function(l){return l.disabled;}).length};`)
    eq(hit.wrong, 1, '点错的那一行应短暂标红')
    assert(hit.fb.indexOf('await') >= 0, '应给出这一行专属的提示，实际：' + hit.fb)
    eq(hit.disabled, 0, '点错不许锁定任何行')

    await tab.wait(2300)
    const back = await tab.eval(`var root=document.getElementById('bh-1');
      return {wrong:root.querySelectorAll('.kc-bughunt__line.kc-is-wrong').length, fb:root.querySelector('.kc-bughunt__feedback').textContent};`)
    eq(back.wrong, 0, '约 2 秒后应自动恢复')
    eq(back.fb, '', '提示应一并收掉')

    await tab.click('#bh-1 .kc-bughunt__line', 0)
    const again = await tab.eval(`return document.querySelectorAll('#bh-1 .kc-bughunt__line.kc-is-wrong').length;`)
    eq(again, 1, '恢复后必须还能继续点')
  })

  await it('找到之后标为找到、展开完整解释、全部行不可点', async () => {
    await tab.click('#bh-1 .kc-bughunt__line', 1)
    const r = await tab.eval(`var root=document.getElementById('bh-1');
      var fb=root.querySelector('.kc-bughunt__feedback');
      return {found:root.querySelectorAll('.kc-bughunt__line.kc-is-found').length,
              wrong:root.querySelectorAll('.kc-bughunt__line.kc-is-wrong').length,
              disabled:[].filter.call(root.querySelectorAll('.kc-bughunt__line'),function(l){return l.disabled;}).length,
              total:root.querySelectorAll('.kc-bughunt__line').length,
              fb:fb.textContent, cls:fb.className};`)
    eq(r.found, 1, '正确行应标为找到')
    eq(r.wrong, 0, '找到后不该还留着标红')
    eq(r.disabled, r.total, '找到后全部行不可点')
    assert(r.fb.indexOf('trim') >= 0, '应展开完整解释，实际：' + r.fb)
    assert(/kc-is-right/.test(r.cls), '反馈区应标为正确')
  })

  await it('同一页面上两处找 bug 互不干扰', async () => {
    const r = await tab.eval(`return {
      one:{found:document.querySelectorAll('#bh-1 .kc-bughunt__line.kc-is-found').length,
           fb:document.querySelector('#bh-1 .kc-bughunt__feedback').textContent.length},
      two:{found:document.querySelectorAll('#bh-2 .kc-bughunt__line.kc-is-found').length,
           fb:document.querySelector('#bh-2 .kc-bughunt__feedback').textContent.length,
           disabled:[].filter.call(document.querySelectorAll('#bh-2 .kc-bughunt__line'),function(l){return l.disabled;}).length}};`)
    eq(r.one.found, 1)
    eq(r.two.found, 0, '第二处不该受影响')
    eq(r.two.fb, 0, '第二处的反馈区应仍是空的')
    eq(r.two.disabled, 0, '第二处的行应仍可点')
    await tab.click('#bh-2 .kc-bughunt__line', 1)
    const after = await tab.eval(`return {two:document.querySelectorAll('#bh-2 .kc-bughunt__line.kc-is-found').length,
      oneFb:document.querySelector('#bh-1 .kc-bughunt__feedback').textContent.length};`)
    eq(after.two, 1, '第二处应能独立完成')
    assert(after.oneFb > 0, '第一处的结果不该被第二处清掉')
  })

  await it('键盘能逐行聚焦并触发', async () => {
    const url2 = fixture('bughunt-kbd', `<main class="kc-course"><section class="kc-screen">${BUG('bh-k', 2)}</section></main>`)
    await tab.goto(url2)
    const tabbable = await tab.eval(`return [].map.call(document.querySelectorAll('#bh-k .kc-bughunt__line'),function(l){return [l.tagName,l.tabIndex];});`)
    tabbable.forEach((t) => { eq(t[0], 'BUTTON', '每一行都要能用键盘到达'); assert(t[1] >= 0) })
    await tab.focus('#bh-k .kc-bughunt__line', 4)
    await tab.key('Enter')
    const wrong = await tab.eval(`return document.querySelectorAll('#bh-k .kc-bughunt__line.kc-is-wrong').length;`)
    eq(wrong, 1, '回车应能触发点错')
    await tab.focus('#bh-k .kc-bughunt__line', 1)
    await tab.key(' ')
    const found = await tab.eval(`return {found:document.querySelectorAll('#bh-k .kc-bughunt__line.kc-is-found').length,
      fb:document.querySelector('#bh-k .kc-bughunt__feedback').textContent.length};`)
    eq(found.found, 1, '空格应能触发找到')
    assert(found.fb > 0)
  })

  await it('反馈区带标识符、或没有唯一的问题行时留下可见痕迹', async () => {
    await tab.goto(url)
    const r = await tab.eval(`var b=document.querySelectorAll('#bh-bad .kc-broken');
      return {n:b.length, texts:[].map.call(b,function(x){return x.textContent;}),
              ok:document.querySelectorAll('#bh-1 .kc-broken').length+document.querySelectorAll('#bh-2 .kc-broken').length};`)
    eq(r.ok, 0, '合规的两处不该报错')
    assert(r.n >= 2, '两处问题各应留一条痕迹，实际 ' + r.n + '：' + JSON.stringify(r.texts))
    assert(r.texts.join('').indexOf('反馈区一律不带标识符') >= 0, '要说清楚反馈区不许带标识符')
  })

  await it('脚本未运行时代码照常可读，解释直接可见', async () => {
    const nojs = fixture('bughunt-nojs', `<main class="kc-course"><section class="kc-screen">${BUG('bh-n', 2)}</section></main>`, { nojs: true })
    await tab.goto(nojs)
    const r = await tab.eval(`var bug=document.querySelector('#bh-n [data-kc-bug]');
      var after=getComputedStyle(bug,'::after');
      return {content:after.content, lines:document.querySelectorAll('#bh-n .kc-bughunt__line').length,
              visible:getComputedStyle(document.querySelector('#bh-n .kc-bughunt__code')).display!=='none'};`)
    eq(r.lines, 5, '代码照常可读')
    assert(r.visible)
    assert(r.content.indexOf('title.trim()') >= 0, '无脚本时解释应直接可见，实际 content=' + r.content)
  })
})

// ---------------------------------------------------------------- 输出题

const OUT = (id, kind, min) => `
<div class="kc-output" id="${id}" data-kc-kind="${kind}" data-kc-min="${min}">
  <span class="kc-output__label"></span>
  <p class="kc-output__prompt">用你自己的话说一遍：点了“添加”之后，这句话经过了哪些文件？</p>
  <textarea class="kc-output__input"></textarea>
  <p class="kc-output__meter"></p>
  <button class="kc-output__reveal">我说完了，看对照清单</button>
  <ul class="kc-output__checklist">
    <li class="kc-output__item">说出了 app.js 这个文件名，以及它负责把你打的字收起来</li>
    <li class="kc-output__item">提到了请求走的是 POST /todos 这条路</li>
    <li class="kc-output__item">说清楚了只有 store.js 会往硬盘上写</li>
  </ul>
</div>`

describe('输出题 kc-output', async (tab) => {
  const url = fixture('output', `<main class="kc-course"><section class="kc-screen">
${OUT('kc-output-m1', 'retell', 80)}
${OUT('kc-output-m2', 'instruct', 60)}
<div class="kc-output" id="out-bad" data-kc-kind="freeform" data-kc-min="10">
  <span class="kc-output__label"></span>
  <p class="kc-output__prompt">类别不合法、下限太低、清单只有两条且没有英文</p>
  <textarea class="kc-output__input"></textarea>
  <p class="kc-output__meter"></p>
  <button class="kc-output__reveal">我说完了，看对照清单</button>
  <ul class="kc-output__checklist">
    <li class="kc-output__item">说清楚了顺序</li>
    <li class="kc-output__item">讲明白了原理</li>
  </ul>
</div>
</section></main>`)
  await tab.goto(url)
  await tab.eval(`try{localStorage.clear()}catch(e){}; return true;`)
  await tab.goto(url)

  await it('标签文字与声明的类别一致，由实现生成不由作者手写', async () => {
    const r = await tab.eval(`
      function lab(id){var e=document.querySelector('#'+id+' .kc-output__label');
        return {html:e.textContent, css:getComputedStyle(e,'::before').content};}
      return {m1:lab('kc-output-m1'), m2:lab('kc-output-m2')};`)
    eq(r.m1.html, '', '标签在 HTML 里应当留空')
    assert(r.m1.css.indexOf('复述路径') >= 0, 'retell 的标签应是“复述路径”，实际 ' + r.m1.css)
    assert(r.m2.css.indexOf('给 AI 下指令') >= 0, 'instruct 的标签应是“给 AI 下指令”，实际 ' + r.m2.css)
  })

  await it('未写够字数时按钮点不动，提示还差多少字', async () => {
    const r = await tab.eval(`var root=document.getElementById('kc-output-m1');
      return {disabled:root.querySelector('.kc-output__reveal').disabled,
              meter:root.querySelector('.kc-output__meter').textContent,
              listVisible:getComputedStyle(root.querySelector('.kc-output__checklist')).display!=='none'};`)
    assert(r.disabled, '未写够时按钮必须点不动')
    eq(r.meter, '还差 80 字', '应提示还差多少字，实际：' + r.meter)
    assert(!r.listVisible, '清单初始不可见')
    await tab.focus('#kc-output-m1 .kc-output__input')
    await tab.typeText('我点了添加以后')
    const after = await tab.eval(`var root=document.getElementById('kc-output-m1');
      return {disabled:root.querySelector('.kc-output__reveal').disabled, meter:root.querySelector('.kc-output__meter').textContent};`)
    assert(after.disabled, '还没写够，按钮仍应点不动')
    eq(after.meter, '还差 73 字', '字数按去掉首尾空白后的字符数算，一个汉字算一个；实际：' + after.meter)
    await tab.click('#kc-output-m1 .kc-output__reveal')
    const clicked = await tab.eval(`return document.querySelector('#kc-output-m1 .kc-output__checklist').classList.contains('kc-is-open');`)
    assert(!clicked, '点不动的按钮不许把清单打开')
  })

  await it('写够后按钮可点，提示文字改变', async () => {
    await tab.focus('#kc-output-m1 .kc-output__input')
    await tab.typeText('，浏览器里的 app.js 把这句话收起来，走 POST /todos 交给后端。server.js 收下之后转手给 store.js，只有它会往硬盘上写。写完页面又重新问了一遍，才把新的那一条画出来。所以刷新之后它还在。')
    const r = await tab.eval(`var root=document.getElementById('kc-output-m1');
      return {disabled:root.querySelector('.kc-output__reveal').disabled,
              meter:root.querySelector('.kc-output__meter').textContent,
              listVisible:getComputedStyle(root.querySelector('.kc-output__checklist')).display!=='none'};`)
    assert(!r.disabled, '写够字数后按钮应可点，当前提示是“' + r.meter + '”')
    assert(/^写了 \d+ 字，可以看对照清单了$/.test(r.meter), '提示文字应改变，实际：' + r.meter)
    assert(!r.listVisible, '还没点按钮，清单仍应隐藏')
  })

  await it('点开清单后再删字，清单不会收回（已揭晓是终态）', async () => {
    await tab.click('#kc-output-m1 .kc-output__reveal')
    const opened = await tab.eval(`var root=document.getElementById('kc-output-m1');
      return {visible:getComputedStyle(root.querySelector('.kc-output__checklist')).display!=='none',
              disabled:root.querySelector('.kc-output__reveal').disabled};`)
    assert(opened.visible, '点按钮后清单应出现')
    assert(opened.disabled, '揭晓后按钮应永久不可点')

    await tab.eval(`var t=document.querySelector('#kc-output-m1 .kc-output__input');
      t.value='短'; t.dispatchEvent(new Event('input',{bubbles:true})); return true;`)
    const after = await tab.eval(`var root=document.getElementById('kc-output-m1');
      return {visible:getComputedStyle(root.querySelector('.kc-output__checklist')).display!=='none',
              disabled:root.querySelector('.kc-output__reveal').disabled,
              meter:root.querySelector('.kc-output__meter').textContent};`)
    assert(after.visible, '删字之后清单不许收回')
    assert(after.disabled, '揭晓后按钮不许重新变成可点')
    assert(after.meter.indexOf('还差') === 0, '字数提示可以退回“还差 N 字”，实际：' + after.meter)
  })

  await it('勾选后出现计数，且不出现任何“对/错”“得分”字样', async () => {
    const boxes = await tab.eval(`return document.querySelectorAll('#kc-output-m1 .kc-output__tick').length;`)
    eq(boxes, 3, '每一条清单都应有一个勾选框，由实现创建')
    await tab.click('#kc-output-m1 .kc-output__tick', 0)
    await tab.click('#kc-output-m1 .kc-output__tick', 2)
    const r = await tab.eval(`var root=document.getElementById('kc-output-m1');
      var t=root.querySelector('.kc-output__tally');
      var text=root.textContent;
      var bad=[]; ['答对','答错','正确','错误','得分','分数','score'].forEach(function(w){if(text.indexOf(w)>=0)bad.push(w);});
      return {tally:t.textContent, visible:getComputedStyle(t).display!=='none', bad:bad};`)
    eq(r.tally, '你勾了 2 / 3 项', '计数不对，实际：' + r.tally)
    assert(r.visible, '计数应当可见')
    eq(r.bad.length, 0, '出现了评判字样：' + JSON.stringify(r.bad))
  })

  await it('刷新页面，之前写的字还在', async () => {
    const before = await tab.eval(`return document.querySelector('#kc-output-m1 .kc-output__input').value;`)
    await tab.eval(`var t=document.querySelector('#kc-output-m1 .kc-output__input');
      t.value='刷新之后这段字必须还在，这是输出题唯一需要落盘的东西。';
      t.dispatchEvent(new Event('input',{bubbles:true})); return true;`)
    await tab.goto(url)
    const after = await tab.eval(`return {v:document.querySelector('#kc-output-m1 .kc-output__input').value,
      other:document.querySelector('#kc-output-m2 .kc-output__input').value};`)
    eq(after.v, '刷新之后这段字必须还在，这是输出题唯一需要落盘的东西。', '草稿没有恢复（之前是“' + before.slice(0, 8) + '…”）')
    eq(after.other, '', '另一道输出题的草稿不许被串到一起')
  })

  await it('存储被禁时不报错，功能照常', async () => {
    const nostore = fixture('output-nostore', `<main class="kc-course"><section class="kc-screen">${OUT('kc-output-p', 'explain', 60)}</section></main>`)
    await tab.goto('about:blank')
    // 在脚本跑起来之前把 localStorage 打瘸，模拟隐私模式
    await tab.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `Object.defineProperty(window,'localStorage',{get:function(){throw new DOMException('denied','SecurityError');}});`
    }).then((r) => { tab._removeStub = r.identifier })
    await tab.goto(nostore)
    const r = await tab.eval(`var root=document.getElementById('kc-output-p');
      return {live:root.classList.contains('kc-is-live'), broken:root.querySelectorAll('.kc-broken').length,
              meter:root.querySelector('.kc-output__meter').textContent,
              ticks:root.querySelectorAll('.kc-output__tick').length};`)
    eq(tab.errors.length, 0, '存储被禁时不许抛错：' + JSON.stringify(tab.errors))
    assert(r.live, '其余功能应照常初始化')
    eq(r.broken, 0, '存储不可用不是数据错误，不该报错')
    eq(r.meter, '还差 60 字')
    eq(r.ticks, 3)
    await tab.focus('#kc-output-p .kc-output__input')
    await tab.typeText('一'.repeat(60))
    const ok = await tab.eval(`return document.querySelector('#kc-output-p .kc-output__reveal').disabled;`)
    assert(!ok, '存储被禁时揭晓流程仍应能走通')
    await tab.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: tab._removeStub })
  })

  await it('键盘可以走完全流程', async () => {
    const kurl = fixture('output-kbd', `<main class="kc-course"><section class="kc-screen">${OUT('kc-output-k', 'explain', 60)}</section></main>`)
    await tab.goto(kurl)
    await tab.eval(`try{localStorage.removeItem('kc-output:'+location.pathname+':kc-output-k')}catch(e){}; return true;`)
    await tab.goto(kurl)
    await tab.focus('#kc-output-k .kc-output__input')
    await tab.typeText('服务器（server）就是一台一直开着的电脑，别人问它要东西，它就把东西找出来给别人。你自己的电脑一关就没了，它不关，所以别人随时都能找到它。')
    await tab.focus('#kc-output-k .kc-output__reveal')
    await tab.key('Enter')
    const opened = await tab.eval(`return getComputedStyle(document.querySelector('#kc-output-k .kc-output__checklist')).display!=='none';`)
    assert(opened, '回车应能揭晓清单')
    await tab.focus('#kc-output-k .kc-output__tick', 1)
    await tab.key(' ')
    const r = await tab.eval(`return {checked:document.querySelectorAll('#kc-output-k .kc-output__tick:checked').length,
      tally:document.querySelector('#kc-output-k .kc-output__tally').textContent};`)
    eq(r.checked, 1, '空格应能勾选')
    eq(r.tally, '你勾了 1 / 3 项')
  })

  await it('类别不合法、下限小于 60、清单条数不对、没有英文标注，四条各留一条痕迹', async () => {
    await tab.goto(url)
    const r = await tab.eval(`var b=document.querySelectorAll('#out-bad .kc-broken');
      return {n:b.length, texts:[].map.call(b,function(x){return x.textContent;}),
              ok:document.querySelectorAll('#kc-output-m1 .kc-broken').length};`)
    eq(r.ok, 0, '合规的输出题不该报错')
    assert(r.n >= 4, '四处问题各应留一条痕迹，实际 ' + r.n + '：' + JSON.stringify(r.texts))
    const all = r.texts.join('')
    assert(all.indexOf('retell') >= 0, '要说清楚类别的合法取值')
    assert(all.indexOf('60') >= 0, '要说清楚下限不得小于 60')
    assert(all.indexOf('3–4 条') >= 0, '要说清楚清单条数')
    assert(all.indexOf('英文标注') >= 0, '要说清楚缺英文标注')
  })

  await it('脚本未运行时文本框仍可输入，清单直接可见', async () => {
    const nojs = fixture('output-nojs', `<main class="kc-course"><section class="kc-screen">${OUT('kc-output-n', 'retell', 80)}</section></main>`, { nojs: true })
    await tab.goto(nojs)
    const r = await tab.eval(`var root=document.getElementById('kc-output-n');
      var ta=root.querySelector('.kc-output__input');
      return {listVisible:getComputedStyle(root.querySelector('.kc-output__checklist')).display!=='none',
              items:root.querySelectorAll('.kc-output__item').length,
              disabled:ta.disabled||ta.readOnly,
              label:getComputedStyle(root.querySelector('.kc-output__label'),'::before').content};`)
    assert(r.listVisible, '无脚本时清单应当直接可见，而不是永远打不开')
    eq(r.items, 3)
    assert(!r.disabled, '文本框仍可输入')
    assert(r.label.indexOf('复述路径') >= 0, '无脚本时类别标签也应显示')
  })
})

/* KC_GROUPS_END */

// ---------------------------------------------------------------- 入口

async function main () {
  for (const f of [STYLES, MAIN]) {
    if (!existsSync(f)) { console.error('缺文件：' + f); process.exit(1) }
  }
  const browser = await launch()
  try {
    const { targetId } = await browser.cdp.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await browser.cdp.send('Target.attachToTarget', { targetId, flatten: true })
    const tab = new Tab(browser.cdp, sessionId)
    await tab.init()
    await tab.viewport(1100, 800)

    const chosen = groups.filter((g) => !filters.length || filters.some((f) => g.name.includes(f)))
    console.log('TAP version 13')
    for (const g of chosen) {
      currentGroup = g.name
      await tab.viewport(1100, 800)
      try {
        await g.fn(tab)
      } catch (e) {
        n++
        failed++
        console.log('not ok ' + n + ' - ' + currentGroup + ': 整组崩溃')
        console.log('  # ' + String(e && e.stack ? e.stack : e).split('\n').slice(0, 5).join('\n  # '))
        failures.push(currentGroup + ': 整组崩溃')
      }
    }
  } finally {
    await browser.close()
    if (fixtureDir) { try { rmSync(fixtureDir, { recursive: true, force: true }) } catch {} }
  }

  console.log('1..' + n)
  console.log('# 断言 ' + n + '，通过 ' + (n - failed) + '，失败 ' + failed)
  if (failed) {
    console.log('# 失败清单：')
    for (const f of failures) console.log('#   - ' + f)
    process.exit(1)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
