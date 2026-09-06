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
