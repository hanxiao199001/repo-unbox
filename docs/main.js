/* =============================================================================
   repo-unbox（开箱）— 课程页面全部交互逻辑
   传统脚本，不是 ES module：学员是双击 index.html 打开的，file:// 下 type="module"
   会被 CORS 直接拦死。整份文件一个 IIFE，不依赖任何外部库。

   降级原则（贯穿全文件）：
   样式表默认让所有内容都是可见的。每个元素只有在自己 init 成功之后，才给自己的根节点
   挂上 kc-is-live，隐藏规则一律写成 .kc-xxx.kc-is-live .kc-xxx__yyy { display:none }。
   所以脚本没跑、被禁用、或某一个元素初始化时抛了错，页面都会退化成一份完整可读的长文档，
   绝不会出现"脚本挂了导致整页空白"。
   ============================================================================= */

(function () {
  'use strict';

  var doc = document;
  var win = window;

  /* ------------------------------------------------------------------ util */

  function qs (sel, root) { return (root || doc).querySelector(sel); }
  function qsa (sel, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(sel)); }
  function on (el, type, fn, opts) { el.addEventListener(type, fn, opts); }
  function clamp (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function el (tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* 把高频事件压到每帧一次 */
  function rafThrottle (fn) {
    var queued = false;
    return function () {
      if (queued) return;
      queued = true;
      win.requestAnimationFrame(function () { queued = false; fn(); });
    };
  }

  /* localStorage 在隐私模式 / 存储被禁时会直接抛错。静默降级，绝不阻断。 */
  var store = (function () {
    var ok = false;
    try {
      var k = '__kc_probe__';
      win.localStorage.setItem(k, '1');
      win.localStorage.removeItem(k);
      ok = true;
    } catch (e) { ok = false; }
    return {
      available: ok,
      get: function (key) { try { return ok ? win.localStorage.getItem(key) : null; } catch (e) { return null; } },
      set: function (key, val) { try { if (ok) win.localStorage.setItem(key, val); } catch (e) {} }
    };
  })();

  /* 无声失败是最严重的缺陷：数据不对时在页面上留下看得见的痕迹。 */
  function broken (host, msg) {
    if (!host) return;
    var b = el('p', 'kc-broken', '⚠ 这个元素的数据有问题：' + msg);
    if (host.firstChild) host.insertBefore(b, host.firstChild);
    else host.appendChild(b);
  }

  function live (root) { root.classList.add('kc-is-live'); }

  /* --------------------------------------------------------------- 中文排版 */
  /* 三件事，全部只改变呈现、不改变文字本身：
     1. 中文与拉丁字母/数字之间加视觉间距（外边距，不插空格 —— 复制出来与源文一致）
     2. 连续全角标点压缩（负外边距，量按前后两个字各自的空白半边算）
     3. 英文区（data-kc-lang="en"）内一律不处理 */

  var RE_CJK = /[㐀-䶿一-鿿豈-﫿]/;
  /* 全角、墨在左半边、右半边留白 */
  var FW_CLOSE = '。．，、；：？！）》〉】｝｣';
  /* 全角、墨在右半边、左半边留白 */
  var FW_OPEN = '（《〈【｛｢';
  /* 参与"连续标点"判定的全部字符。引号在霞鹜文楷里是比例宽度，不按全角算空白。 */
  var PUNCT = FW_CLOSE + FW_OPEN + '“”‘’—…·';
  var RE_LATIN = /[A-Za-z0-9]+(?:[._\-/][A-Za-z0-9]+)*/y;

  var TYPO_SKIP = 'script,style,textarea,input,pre,code,[data-kc-lang="en"],[lang="en"],.kc-code,.kc-no-typo';

  function isCJK (ch) { return !!ch && RE_CJK.test(ch); }

  /* 压缩量：前一个字右半边留白 0.5em + 当前字左半边留白 0.5em，收掉一半。 */
  function compressClass (prev, cur) {
    if (!prev || PUNCT.indexOf(prev) < 0 || PUNCT.indexOf(cur) < 0) return null;
    var blank = (FW_CLOSE.indexOf(prev) >= 0 ? 0.5 : 0) + (FW_OPEN.indexOf(cur) >= 0 ? 0.5 : 0);
    if (blank >= 1) return 'kc-pun--half';
    if (blank > 0) return 'kc-pun--quarter';
    return null;
  }

  function typoTextNode (node) {
    var s = node.nodeValue;
    if (!s || s.length < 2) return;
    if (!RE_CJK.test(s) && !/[A-Za-z0-9]/.test(s)) return;

    var out = [];
    var buf = '';
    var i = 0;
    var changed = false;

    function flush () { if (buf) { out.push(doc.createTextNode(buf)); buf = ''; } }

    while (i < s.length) {
      RE_LATIN.lastIndex = i;
      var m = RE_LATIN.exec(s);
      if (m && m.index === i) {
        var run = m[0];
        var left = i > 0 ? s.charAt(i - 1) : '';
        var right = i + run.length < s.length ? s.charAt(i + run.length) : '';
        if (isCJK(left) || isCJK(right)) {
          flush();
          var span = el('span', 'kc-lat', run);
          if (!isCJK(left)) span.classList.add('kc-lat--nostart');
          if (!isCJK(right)) span.classList.add('kc-lat--noend');
          out.push(span);
          changed = true;
        } else {
          buf += run;
        }
        i += run.length;
        continue;
      }
      var ch = s.charAt(i);
      var cls = i > 0 ? compressClass(s.charAt(i - 1), ch) : null;
      if (cls) {
        flush();
        out.push(el('span', 'kc-pun ' + cls, ch));
        changed = true;
        i += 1;
        continue;
      }
      buf += ch;
      i += 1;
    }
    if (!changed) return;
    flush();
    var frag = doc.createDocumentFragment();
    for (var j = 0; j < out.length; j++) frag.appendChild(out[j]);
    node.parentNode.replaceChild(frag, node);
  }

  function applyTypography (root) {
    if (!root) return;
    var walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var p = node.parentElement;
        if (!p || p.closest(TYPO_SKIP)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    var n;
    while ((n = walker.nextNode())) nodes.push(n);
    for (var i = 0; i < nodes.length; i++) typoTextNode(nodes[i]);
  }

  /* data-kc-lang 是内容契约，lang 才是浏览器真正用来断行和选字体的属性。
     两者同步，缺一不可。 */
  function syncLangAttr (root) {
    qsa('[data-kc-lang]', root || doc).forEach(function (n) {
      var v = n.getAttribute('data-kc-lang');
      if (v && n.getAttribute('lang') !== v) n.setAttribute('lang', v);
    });
  }

  /* --------------------------------------------------------------- 导航条 */

  function initNav () {
    var nav = qs('.kc-nav');
    if (!nav) return;
    var fill = qs('.kc-nav__progress-fill', nav);
    var bar = qs('.kc-nav__progress', nav);
    var dots = qsa('.kc-nav__dot', nav);
    var modules = qsa('.kc-module');
    var course = qs('.kc-course');

    var problems = [];
    var pairs = [];
    var seen = {};

    dots.forEach(function (dot, i) {
      var id = dot.getAttribute('data-kc-target');
      var target = id ? doc.getElementById(id) : null;
      if (!target) {
        problems.push('第 ' + (i + 1) + ' 个导航圆点的 data-kc-target="' + (id || '') + '" 找不到对应模块');
        return;
      }
      seen[id] = true;
      pairs.push({ dot: dot, target: target });
      dot.setAttribute('role', 'tab');
      dot.setAttribute('type', 'button');
      dot.setAttribute('aria-label', '第 ' + (i + 1) + ' 个模块：' + (dot.getAttribute('data-kc-label') || target.id));
      dot.setAttribute('aria-controls', id);
      on(dot, 'click', function () {
        target.scrollIntoView({ behavior: prefersMotion() ? 'smooth' : 'auto', block: 'start' });
      });
    });

    modules.forEach(function (m, i) {
      if (!m.id) problems.push('第 ' + (i + 1) + ' 个模块没有标识符，导航圆点无法定位到它');
      else if (!seen[m.id]) problems.push('模块 ' + m.id + ' 没有任何导航圆点指向它');
    });

    if (problems.length && course) broken(course, '导航与模块对不上 —— ' + problems.join('；'));

    function prefersMotion () {
      return !win.matchMedia || !win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function currentIndex () {
      var center = win.scrollY + win.innerHeight / 2;
      var found = -1;
      for (var i = 0; i < pairs.length; i++) {
        var r = pairs[i].target.getBoundingClientRect();
        var top = r.top + win.scrollY;
        if (center >= top && center < top + r.height) return i;
        if (top <= center) found = i;
      }
      return found;
    }

    var update = rafThrottle(function () {
      var docEl = doc.documentElement;
      var max = docEl.scrollHeight - win.innerHeight;
      /* 页面短到不可滚动 → 进度条满格，不报错 */
      var pct = max <= 0 ? 100 : clamp((win.scrollY / max) * 100, 0, 100);
      if (fill) fill.style.width = pct.toFixed(2) + '%';
      if (bar) bar.setAttribute('aria-valuenow', String(Math.round(pct)));

      var cur = currentIndex();
      var bottom = win.scrollY + win.innerHeight;
      for (var i = 0; i < pairs.length; i++) {
        var r = pairs[i].target.getBoundingClientRect();
        var top = r.top + win.scrollY;
        var isCur = i === cur;
        var visited = !isCur && bottom > top;
        pairs[i].dot.classList.toggle('kc-is-current', isCur);
        pairs[i].dot.classList.toggle('kc-is-visited', visited);
        pairs[i].dot.setAttribute('aria-selected', isCur ? 'true' : 'false');
      }
    });

    on(win, 'scroll', update, { passive: true });
    on(win, 'resize', update);
    update();

    /* 键盘跳模块。学员正在输出题里打字时按方向键，必须是在文字里移动光标。 */
    function isTyping (node) {
      if (!node) return false;
      var t = node.tagName;
      return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || node.isContentEditable === true;
    }

    function jump (i) {
      if (!pairs.length) return;
      i = clamp(i, 0, pairs.length - 1);
      pairs[i].target.scrollIntoView({ behavior: prefersMotion() ? 'smooth' : 'auto', block: 'start' });
    }

    on(doc, 'keydown', function (ev) {
      if (ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (isTyping(ev.target)) return;
      var cur = currentIndex();
      switch (ev.key) {
        case 'ArrowDown': case 'PageDown': jump(cur + 1); break;
        case 'ArrowUp': case 'PageUp': jump(cur < 0 ? 0 : cur - 1); break;
        case 'Home': jump(0); break;
        case 'End': jump(pairs.length - 1); break;
        default: return;
      }
      ev.preventDefault();
    });

    nav.classList.add('kc-is-live');
  }

  /* --------------------------------------------------------------- 入场动画 */

  function initReveal () {
    if (!('IntersectionObserver' in win)) return;
    var targets = qsa('.kc-module__number, .kc-module__title, .kc-module__subtitle, .kc-screen > *')
      .filter(function (t) { return !t.classList.contains('kc-feedback') && !t.classList.contains('kc-feedback__panel'); });
    if (!targets.length) return;

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('kc-is-in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.01 });

    targets.forEach(function (t) {
      t.classList.add('kc-reveal');
      io.observe(t);
    });

    /* 兜底：任何原因导致观察器没回调，4 秒后一律显示。绝不允许内容永久隐形。 */
    win.setTimeout(function () {
      targets.forEach(function (t) { t.classList.add('kc-is-in'); });
    }, 4000);
  }

  /* --------------------------------------------------------------- 注册表 */

  var modules = [];
  function register (name, sel, init) { modules.push({ name: name, sel: sel, init: init }); }

  /* ------------------------------------------------------- 语法高亮（代码对照用） */
  /* 只包 span，不改一个字符：学员复制走的代码必须与源文件逐字一致。 */

  var SYN_KEYWORDS = (
    'const let var function return if else for while do switch case break continue ' +
    'new class extends super import from export default async await try catch finally throw ' +
    'typeof instanceof delete void yield this null undefined true false ' +
    'def elif not and or None True False lambda pass with as global nonlocal raise assert ' +
    'require module exports interface type enum public private static'
  ).split(' ');

  var SYN_KW = {};
  for (var _i = 0; _i < SYN_KEYWORDS.length; _i++) SYN_KW[SYN_KEYWORDS[_i]] = true;

  function synHighlightable (path) {
    return /\.(js|mjs|cjs|jsx|ts|tsx|json|py|rb|go|java|c|h|cpp|rs|php|sh|swift)$/i.test(path || '');
  }

  function highlight (text) {
    var frag = doc.createDocumentFragment();
    var buf = '';
    var i = 0;

    function flush () { if (buf) { frag.appendChild(doc.createTextNode(buf)); buf = ''; } }
    function emit (cls, s) { flush(); frag.appendChild(el('span', 'kc-syn--' + cls, s)); }

    while (i < text.length) {
      var c = text.charAt(i);
      var two = text.substr(i, 2);

      if (two === '//' || (c === '#' && text.charAt(i + 1) !== '{')) {
        var nl = text.indexOf('\n', i);
        if (nl < 0) nl = text.length;
        emit('comment', text.slice(i, nl));
        i = nl;
        continue;
      }
      if (two === '/*') {
        var end = text.indexOf('*/', i + 2);
        end = end < 0 ? text.length : end + 2;
        emit('comment', text.slice(i, end));
        i = end;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        var j = i + 1;
        while (j < text.length) {
          if (text.charAt(j) === '\\') { j += 2; continue; }
          if (text.charAt(j) === c) { j += 1; break; }
          if (text.charAt(j) === '\n' && c !== '`') break;
          j += 1;
        }
        emit('string', text.slice(i, j));
        i = j;
        continue;
      }
      if (/[0-9]/.test(c) && !/[A-Za-z_$]/.test(text.charAt(i - 1) || ' ')) {
        var num = /^[0-9][0-9_.xXa-fA-F]*/.exec(text.slice(i))[0];
        emit('number', num);
        i += num.length;
        continue;
      }
      if (/[A-Za-z_$]/.test(c)) {
        var word = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(i))[0];
        if (SYN_KW[word]) emit('keyword', word);
        else buf += word;
        i += word.length;
        continue;
      }
      if ('{}()[];,.=<>+-*/%!&|?:'.indexOf(c) >= 0) {
        emit('punct', c);
        i += 1;
        continue;
      }
      buf += c;
      i += 1;
    }
    flush();
    return frag;
  }

  /* ------------------------------------------------ 代码对照 kc-code-pair (01) */

  var RE_SOURCE = /^\S+:\d+-\d+$/;

  register('代码对照', '.kc-code-pair', function (root) {
    var source = qs('.kc-code-pair__source', root);
    var codeCol = qs('.kc-code-pair__code', root);
    var lines = qs('.kc-code-pair__lines', root);
    var pre = codeCol && qs('pre', codeCol);

    if (!source || !source.textContent.trim()) {
      broken(root, '缺少来源标注（kc-code-pair__source），学员没法回源文件里找这段代码');
    } else if (!RE_SOURCE.test(source.textContent.trim())) {
      broken(root, '来源标注格式不对：“' + source.textContent.trim() + '”，应形如 src/store.js:45-55');
    }
    if (!pre) { broken(root, '左栏里没有代码块（kc-code-pair__code 里应有一个 <pre>）'); return; }
    if (pre.getAttribute('data-kc-lang') !== 'en') {
      broken(root, '代码区域没有标 data-kc-lang="en"，中文断行规则会作用到代码上');
    }
    if (!lines || !qsa('.kc-code-pair__line', lines).length) {
      broken(root, '右栏没有任何中文逐行说明（kc-code-pair__line）');
    }

    var path = source ? source.textContent.trim().split(':')[0] : '';
    if (synHighlightable(path)) {
      var text = pre.textContent;
      var frag = highlight(text);
      pre.textContent = '';
      pre.appendChild(frag);
      /* 高亮只许包 span。万一 tokenizer 有 bug 改动了字符，立刻还原并留下痕迹。 */
      if (pre.textContent !== text) {
        pre.textContent = text;
        broken(root, '语法高亮改动了代码字符，已还原为原文');
      }
    }
    live(root);
  });

  /* ------------------------------------------------------ 静态元素的数据体检 */
  /* 这些元素没有交互，但数据不对时必须在页面上留下痕迹，不许静默地什么都不显示。 */

  function checkEnum (root, attr, allowed, what) {
    var v = root.getAttribute(attr);
    if (allowed.indexOf(v) < 0) {
      broken(root, what + ' 的 ' + attr + ' 取值是“' + (v === null ? '（没写）' : v) + '”，只能是 ' + allowed.join(' / '));
      return false;
    }
    return true;
  }

  var ACCENTS = ['1', '2', '3', '4', '5'];

  register('提示框', '.kc-note', function (root) {
    checkEnum(root, 'data-kc-tone', ['insight', 'info', 'warning'], '提示框');
    if (!qs('.kc-note__icon', root)) broken(root, '提示框缺图标：三种语气必须能靠图标区分，不能只靠颜色');
    if (!qs('.kc-note__title', root)) broken(root, '提示框缺小标题');
    if (!qs('.kc-note__body', root)) broken(root, '提示框缺正文');
    live(root);
  });

  register('概念卡片', '.kc-cards', function (root) {
    qsa('.kc-cards__item', root).forEach(function (item, i) {
      checkEnum(item, 'data-kc-accent', ACCENTS, '第 ' + (i + 1) + ' 张卡片');
    });
    live(root);
  });

  register('角色行', '.kc-rolelist', function (root) {
    qsa('.kc-rolelist__row', root).forEach(function (row, i) {
      checkEnum(row, 'data-kc-accent', ACCENTS, '第 ' + (i + 1) + ' 行角色');
    });
    live(root);
  });

  register('编号步骤卡', '.kc-steps', function (root) {
    qsa('.kc-steps__item', root).forEach(function (item, i) {
      var num = qs('.kc-steps__num', item);
      if (!num || !num.textContent.trim()) {
        broken(root, '第 ' + (i + 1) + ' 步没有编号（kc-steps__num）；编号由写内容的人给，实现不自动生成');
      }
    });
    live(root);
  });

  register('箭头流程', '.kc-chain', function (root) {
    /* 箭头数与步骤数对不上、步骤超过 6 个，都是"构建时提示"而不是失败，
       所以这里不报错；只查契约里标了必填的部件。 */
    qsa('.kc-chain__step', root).forEach(function (step, i) {
      var num = qs('.kc-chain__num', step);
      if (!num || !num.textContent.trim()) broken(root, '第 ' + (i + 1) + ' 个方块没有数字（kc-chain__num）');
    });
    live(root);
  });

  register('代号表', '.kc-deflist', function (root) {
    qsa('.kc-deflist__row', root).forEach(function (row, i) {
      var key = qs('.kc-deflist__key', row);
      if (!key) { broken(root, '第 ' + (i + 1) + ' 行没有代号（kc-deflist__key）'); return; }
      if (key.getAttribute('data-kc-lang') !== 'en') {
        broken(root, '第 ' + (i + 1) + ' 行的代号没有标 data-kc-lang="en"，中文断行规则会作用在报错文本上');
      }
      if (!qs('.kc-deflist__value', row)) broken(root, '第 ' + (i + 1) + ' 行的代号没有中文解释');
    });
    live(root);
  });

  register('文件树', '.kc-tree', function (root) {
    qsa('.kc-tree__dir, .kc-tree__file', root).forEach(function (row, i) {
      var name = qs('.kc-tree__name', row);
      if (!name) { broken(root, '第 ' + (i + 1) + ' 行没有名字（kc-tree__name）'); return; }
      if (name.getAttribute('data-kc-lang') !== 'en') {
        broken(root, '第 ' + (i + 1) + ' 行的名字“' + name.textContent.trim() + '”没有标 data-kc-lang="en"');
      }
      var note = qs('.kc-tree__note', row);
      if (!note || !note.textContent.trim()) {
        broken(root, '第 ' + (i + 1) + ' 行“' + name.textContent.trim() + '”没有说明；没有说明的行就不该出现在树里');
      }
    });
    live(root);
  });

  /* ------------------------------------------------ 术语气泡 kc-term (06) */
  /* 全课最重要的无障碍设施：学员永远不需要离开页面去搜一个词。
     同一时刻最多一个气泡；气泡挂在 body 上，不受任何祖先容器裁剪。 */

  var term = (function () {
    var bubble = null;
    var openOn = null;
    var openedBy = null;

    function ensure () {
      if (bubble) return bubble;
      bubble = el('div', 'kc-term__bubble');
      bubble.id = 'kc-term-bubble';
      bubble.setAttribute('role', 'tooltip');
      doc.body.appendChild(bubble);
      return bubble;
    }

    function close () {
      if (!openOn) return;
      openOn.classList.remove('kc-is-open');
      openOn.setAttribute('aria-expanded', 'false');
      openOn.removeAttribute('aria-describedby');
      openOn = null;
      openedBy = null;
      if (bubble) bubble.classList.remove('kc-is-open');
    }

    function place (node) {
      var rects = node.getClientRects();
      var r = rects.length ? rects[0] : node.getBoundingClientRect();
      var vw = doc.documentElement.clientWidth;
      var vh = doc.documentElement.clientHeight;
      var pad = 8;
      var gap = 10;

      bubble.style.maxWidth = Math.min(360, vw - pad * 2) + 'px';
      bubble.classList.remove('kc-is-below');
      bubble.style.left = '0px';
      bubble.style.top = '0px';
      var b = bubble.getBoundingClientRect();

      var top = r.top - b.height - gap;
      if (top < pad) {
        top = r.bottom + gap;
        bubble.classList.add('kc-is-below');
      }
      top = clamp(top, pad, Math.max(pad, vh - b.height - pad));

      var left = r.left + r.width / 2 - b.width / 2;
      left = clamp(left, pad, Math.max(pad, vw - b.width - pad));

      var arrowX = clamp(r.left + r.width / 2 - left, 12, Math.max(12, b.width - 12));

      bubble.style.left = Math.round(left) + 'px';
      bubble.style.top = Math.round(top) + 'px';
      bubble.style.setProperty('--kc-term-arrow-x', Math.round(arrowX) + 'px');
    }

    function open (node, how) {
      var text = node.getAttribute('data-kc-define');
      if (!text) return;
      if (openOn === node) {
        /* 悬停已经打开的词又被点了一下：记成"点开的"，这样移开鼠标不会收掉。 */
        if (how === 'click' || how === 'focus') openedBy = how;
        return;
      }
      close();
      ensure();
      bubble.textContent = text;
      try { applyTypography(bubble); } catch (e) {}
      bubble.classList.add('kc-is-open');
      openOn = node;
      openedBy = how || 'hover';
      node.classList.add('kc-is-open');
      node.setAttribute('aria-expanded', 'true');
      node.setAttribute('aria-describedby', bubble.id);
      place(node);
    }

    return { open: open, close: close,
             current: function () { return openOn; },
             openedBy: function () { return openedBy; } };
  })();

  register('术语气泡', '.kc-term', function (root) {
    var define = root.getAttribute('data-kc-define');
    if (!define || !define.trim()) {
      root.classList.add('kc-is-broken');
      root.setAttribute('title', '这个术语没有写解释（data-kc-define 为空）');
      return;
    }
    if (qs('.kc-term', root)) {
      root.classList.add('kc-is-broken');
      root.setAttribute('title', '术语里套了另一个术语，气泡里套气泡无法交互');
      return;
    }
    if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '0');
    root.setAttribute('role', 'button');
    root.setAttribute('aria-expanded', 'false');
    live(root);
  });

  /* 事件用委托挂一次，不给每个术语各挂一份 */
  function bindTerms () {
    function usable (node) {
      return node && node.classList.contains('kc-is-live') && !node.classList.contains('kc-is-broken');
    }
    on(doc, 'mouseover', function (ev) {
      var t = ev.target.closest ? ev.target.closest('.kc-term') : null;
      if (usable(t)) term.open(t, 'hover');
    });
    on(doc, 'mouseout', function (ev) {
      var t = ev.target.closest ? ev.target.closest('.kc-term') : null;
      if (!t || t !== term.current()) return;
      /* 点开的和聚焦打开的，不因为鼠标移走就收掉 */
      if (term.openedBy() !== 'hover') return;
      var to = ev.relatedTarget;
      if (to && (t.contains(to) || (to.closest && to.closest('.kc-term__bubble')))) return;
      if (t === doc.activeElement) return;
      term.close();
    });
    on(doc, 'focusin', function (ev) {
      var t = ev.target.closest ? ev.target.closest('.kc-term') : null;
      if (usable(t)) term.open(t, 'focus');
      else if (term.current()) term.close();
    });
    /* 触屏：点一下开，再点一下或点别处关 */
    on(doc, 'click', function (ev) {
      var t = ev.target.closest ? ev.target.closest('.kc-term') : null;
      if (!usable(t)) { if (!ev.target.closest('.kc-term__bubble')) term.close(); return; }
      /* 只有"上一次也是点开的"才收；悬停打开后再点，是要把它钉住 */
      if (term.current() === t && term.openedBy() === 'click') term.close();
      else term.open(t, 'click');
    });
    on(doc, 'keydown', function (ev) {
      if (ev.key === 'Escape' && term.current()) {
        var t = term.current();
        term.close();
        if (t && t.blur) t.blur();
      }
    });
    /* 滚动时不许把气泡孤零零留在原地 */
    on(win, 'scroll', function () { term.close(); }, { passive: true });
    on(win, 'resize', function () { term.close(); });
  }

  /* ------------------------------------------------- 选择题 kc-quiz (03) */
  /* 不评分、不排名。页面上永远不出现"你答对了 3/5"。 */

  register('选择题', '.kc-quiz', function (root) {
    var questions = qsa('.kc-quiz__question', root);
    var check = qs('.kc-quiz__check', root);
    var reset = qs('.kc-quiz__reset', root);

    if (!questions.length) { broken(root, '这组选择题里一道题都没有'); return; }
    if (!check || !reset) { broken(root, '缺少“看看答案”或“再来一次”按钮'); return; }

    var qs_ = [];
    questions.forEach(function (q, qi) {
      var answer = q.getAttribute('data-kc-answer');
      var options = qsa('.kc-quiz__option', q);
      var feedback = qs('.kc-quiz__feedback', q);
      var values = options.map(function (o) { return o.getAttribute('data-kc-value'); });

      if (!answer) { broken(root, '第 ' + (qi + 1) + ' 题没有标注正确答案（data-kc-answer）'); return; }
      if (values.indexOf(answer) < 0) {
        broken(root, '第 ' + (qi + 1) + ' 题的正确答案“' + answer + '”对不上任何选项（选项是 ' + values.join(' / ') + '）');
        return;
      }
      if (!q.getAttribute('data-kc-right') || !q.getAttribute('data-kc-wrong')) {
        broken(root, '第 ' + (qi + 1) + ' 题缺解释文字（data-kc-right / data-kc-wrong 都必填）');
        return;
      }
      if (!feedback) { broken(root, '第 ' + (qi + 1) + ' 题缺解释区（kc-quiz__feedback）'); return; }
      if (options.length < 2) { broken(root, '第 ' + (qi + 1) + ' 题的选项少于 2 个'); return; }

      q.setAttribute('role', 'radiogroup');
      options.forEach(function (o) {
        o.setAttribute('type', 'button');
        o.setAttribute('role', 'radio');
        o.setAttribute('aria-checked', 'false');
        on(o, 'click', function () {
          if (o.disabled) return;
          options.forEach(function (x) {
            var isIt = x === o;
            x.classList.toggle('kc-is-selected', isIt);
            x.setAttribute('aria-checked', isIt ? 'true' : 'false');
          });
        });
      });

      qs_.push({ q: q, answer: answer, options: options, feedback: feedback });
    });

    function judge () {
      qs_.forEach(function (item) {
        var picked = null;
        item.options.forEach(function (o) {
          if (o.classList.contains('kc-is-selected')) picked = o;
          o.disabled = true;
        });
        /* 未作答的题不算错，只是没有结果 —— 不惩罚跳过 */
        if (!picked) return;
        var right = picked.getAttribute('data-kc-value') === item.answer;
        picked.classList.remove('kc-is-selected');
        picked.classList.add(right ? 'kc-is-right' : 'kc-is-wrong');
        if (!right) {
          /* 选错时同时把正确项也标出来 */
          item.options.forEach(function (o) {
            if (o.getAttribute('data-kc-value') === item.answer) o.classList.add('kc-is-right');
          });
        }
        item.feedback.textContent = item.q.getAttribute(right ? 'data-kc-right' : 'data-kc-wrong');
        try { applyTypography(item.feedback); } catch (e) {}
        item.feedback.classList.add('kc-is-open');
        item.feedback.classList.toggle('kc-is-right', right);
        item.feedback.classList.toggle('kc-is-wrong', !right);
      });
      check.disabled = true;
    }

    function clear () {
      qs_.forEach(function (item) {
        item.options.forEach(function (o) {
          o.disabled = false;
          o.classList.remove('kc-is-selected', 'kc-is-right', 'kc-is-wrong');
          o.setAttribute('aria-checked', 'false');
        });
        item.feedback.textContent = '';
        item.feedback.classList.remove('kc-is-open', 'kc-is-right', 'kc-is-wrong');
      });
      check.disabled = false;
    }

    check.setAttribute('type', 'button');
    reset.setAttribute('type', 'button');
    on(check, 'click', judge);
    on(reset, 'click', clear);
    live(root);
  });

  /* ------------------------------------------------ 场景题 kc-scenario (07) */
  /* 自身没有状态：判定与展开解释全部由它包着的那道选择题负责。 */

  register('场景题', '.kc-scenario', function (root) {
    if (!qs('.kc-scenario__label', root)) broken(root, '场景块缺顶部的“场景”标签');
    var body = qs('.kc-scenario__body', root);
    if (!body || !body.textContent.trim()) broken(root, '场景描述是空的');
    if (!qs('.kc-quiz', root)) broken(root, '场景块里没有选择题；场景是选择题的外壳，不是独立元素');
    live(root);
  });

  /* ------------------------------------------------ 找 bug kc-bughunt (08) */
  /* 点错不惩罚、不计次、不锁定：可以一直点到找到为止。 */

  var BUGHUNT_WRONG_MS = 2000;

  register('找 bug', '.kc-bughunt', function (root) {
    var code = qs('.kc-bughunt__code', root);
    var feedback = qs('.kc-bughunt__feedback', root);
    var lines = qsa('.kc-bughunt__line', root);

    if (!code) { broken(root, '缺代码容器（kc-bughunt__code）'); return; }
    if (code.getAttribute('data-kc-lang') !== 'en') {
      broken(root, '代码容器没有标 data-kc-lang="en"');
    }
    if (!feedback) { broken(root, '缺反馈区（kc-bughunt__feedback）'); return; }
    /* 一门课有两处找 bug，写死的标识符必然重复 */
    if (feedback.id) { broken(root, '反馈区带了标识符 id="' + feedback.id + '"；反馈区一律不带标识符，靠所属块定位'); }
    if (!lines.length) { broken(root, '代码里一行都没有'); return; }

    var bugs = lines.filter(function (l) { return l.hasAttribute('data-kc-bug'); });
    if (bugs.length !== 1) {
      broken(root, '有且只能有一行标 data-kc-bug，现在有 ' + bugs.length + ' 行');
      return;
    }
    var bug = bugs[0];
    if (!bug.getAttribute('data-kc-explain')) {
      broken(root, '问题行缺解释（data-kc-explain）：找到之后学员什么也看不到');
      return;
    }
    var noHint = lines.filter(function (l) { return l !== bug && !l.getAttribute('data-kc-hint'); });
    if (noHint.length) {
      broken(root, '有 ' + noHint.length + ' 行没有点错时的提示（data-kc-hint）；每一行的提示都要不一样');
    }

    var found = false;
    var timer = null;

    function setFeedback (text, kind) {
      feedback.textContent = text;
      try { applyTypography(feedback); } catch (e) {}
      feedback.classList.toggle('kc-is-right', kind === 'right');
      feedback.classList.toggle('kc-is-wrong', kind === 'wrong');
    }

    lines.forEach(function (line) {
      line.setAttribute('type', 'button');
      on(line, 'click', function () {
        if (found || line.disabled) return;
        if (line === bug) {
          found = true;
          if (timer) { win.clearTimeout(timer); timer = null; }
          qsa('.kc-bughunt__line', root).forEach(function (l) {
            l.disabled = true;
            l.classList.remove('kc-is-wrong');
          });
          line.classList.add('kc-is-found');
          setFeedback(bug.getAttribute('data-kc-explain'), 'right');
          return;
        }
        if (timer) win.clearTimeout(timer);
        qsa('.kc-bughunt__line', root).forEach(function (l) { l.classList.remove('kc-is-wrong'); });
        line.classList.add('kc-is-wrong');
        setFeedback(line.getAttribute('data-kc-hint') || '再看看别的行。', 'wrong');
        timer = win.setTimeout(function () {
          line.classList.remove('kc-is-wrong');
          setFeedback('', null);
          timer = null;
        }, BUGHUNT_WRONG_MS);
      });
    });

    setFeedback('', null);
    live(root);
  });

  /* ------------------------------------------------- 输出题 kc-output (02) */
  /* 全课唯一一个逼学员产出内容的元素。不评分、不判对错、不排名、不联网。
     判断权完全在学员自己手里。 */

  var OUTPUT_KINDS = ['retell', 'instruct', 'explain'];
  var OUTPUT_MIN_FLOOR = 60;
  var OUTPUT_PLACEHOLDER = '不用写得漂亮，写得具体就行。';

  register('输出题', '.kc-output', function (root) {
    var kind = root.getAttribute('data-kc-kind');
    var minRaw = root.getAttribute('data-kc-min');
    var min = parseInt(minRaw, 10);
    var input = qs('.kc-output__input', root);
    var meter = qs('.kc-output__meter', root);
    var reveal = qs('.kc-output__reveal', root);
    var checklist = qs('.kc-output__checklist', root);
    var items = qsa('.kc-output__item', root);
    var tally = qs('.kc-output__tally', root);

    if (!root.id) broken(root, '输出题没有标识符（id）；草稿保存靠它区分，多道题会互相覆盖');
    if (OUTPUT_KINDS.indexOf(kind) < 0) {
      broken(root, '类别 data-kc-kind 是“' + (kind === null ? '（没写）' : kind) + '”，只能是 ' + OUTPUT_KINDS.join(' / '));
    }
    if (!minRaw || isNaN(min) || min < OUTPUT_MIN_FLOOR) {
      broken(root, '字数下限 data-kc-min 是“' + (minRaw === null ? '（没写）' : minRaw) + '”，必须是不小于 ' +
        OUTPUT_MIN_FLOOR + ' 的整数；下限太低学员会打“就是那样”然后跳过');
    }
    if (!input || !meter || !reveal || !checklist) {
      broken(root, '缺件：文本框 / 字数提示 / 按钮 / 对照清单，四样都必须有');
      return;
    }
    if (items.length < 3 || items.length > 4) {
      broken(root, '对照清单有 ' + items.length + ' 条，规格要求 3–4 条');
    }
    /* 至少一条要用英文标注一个具体的东西 */
    var hasEnglish = items.some(function (it) { return /[A-Za-z]{2,}/.test(it.textContent); });
    if (!hasEnglish) {
      broken(root, '对照清单里没有任何英文标注；至少一条要点名一个英文的文件名、函数名或概念原词');
    }

    if (!input.getAttribute('placeholder')) input.setAttribute('placeholder', OUTPUT_PLACEHOLDER);

    if (!tally) {
      tally = el('p', 'kc-output__tally');
      checklist.parentNode.insertBefore(tally, checklist.nextSibling);
    }

    /* 勾选框由实现创建：写内容的人只写那一句说明 */
    var ticks = items.map(function (item) {
      var box = qs('.kc-output__tick', item);
      if (!box) {
        box = doc.createElement('input');
        box.type = 'checkbox';
        box.className = 'kc-output__tick';
        item.insertBefore(box, item.firstChild);
      }
      on(box, 'change', updateTally);
      return box;
    });

    var revealed = false;
    if (isNaN(min) || min < OUTPUT_MIN_FLOOR) min = OUTPUT_MIN_FLOOR;

    /* 草稿只存在本机浏览器里，不上传、不联网。
       file:// 下所有页面共享同一个源，所以键里带上路径，免得两门课互相覆盖。 */
    var key = 'kc-output:' + win.location.pathname + ':' + (root.id || '');

    function count () { return input.value.trim().length; }

    function updateTally () {
      if (!revealed) return;
      var n = ticks.filter(function (b) { return b.checked; }).length;
      tally.textContent = '你勾了 ' + n + ' / ' + ticks.length + ' 项';
      tally.classList.add('kc-is-open');
    }

    function refresh () {
      var n = count();
      if (n >= min) {
        meter.textContent = '写了 ' + n + ' 字，可以看对照清单了';
        if (!revealed) reveal.disabled = false;
      } else {
        meter.textContent = '还差 ' + (min - n) + ' 字';
        /* “已揭晓”是终态：删字不会把清单收回去 */
        if (!revealed) reveal.disabled = true;
      }
    }

    reveal.setAttribute('type', 'button');
    on(reveal, 'click', function () {
      if (revealed || reveal.disabled) return;
      revealed = true;
      checklist.classList.add('kc-is-open');
      reveal.disabled = true;
      updateTally();
    });

    on(input, 'input', function () {
      refresh();
      store.set(key, input.value);
    });

    if (root.id) {
      var saved = store.get(key);
      if (saved) input.value = saved;
    }
    refresh();
    live(root);
  });

  /* ------------------------------------------------- 组件群聊 kc-chat (04) */

  /* 角色配色必须"同一个文件在任何模块里都是同一个颜色"。写内容的人没有地方声明颜色，
     所以由实现分配：一门课就是一个页面，按全页所有消息里"首次出现的先后"发号，
     同一个角色在任何模块里拿到的都是同一个号，而且前五个角色一定不撞色。
     （先试过按角色名做哈希，app.js / server.js / store.js 三个真的撞到了同一档。）
     角色行（kc-rolelist）里作者手写的 data-kc-accent 应当与这个顺序对齐。 */
  var speakerOrder = null;

  function speakerAccent (name) {
    if (!speakerOrder) {
      speakerOrder = {};
      var n = 0;
      qsa('.kc-chat__message[data-kc-speaker]').forEach(function (m) {
        var sp = m.getAttribute('data-kc-speaker');
        if (speakerOrder[sp] === undefined) speakerOrder[sp] = (n++ % 5) + 1;
      });
    }
    return speakerOrder[name] || 1;
  }

  var CHAT_TYPING_MS = 800;
  var CHAT_STEP_MS = 1400;

  register('组件群聊', '.kc-chat', function (root) {
    var stream = qs('.kc-chat__stream', root);
    var typing = qs('.kc-chat__typing', root);
    var next = qs('.kc-chat__next', root);
    var all = qs('.kc-chat__all', root);
    var replay = qs('.kc-chat__replay', root);
    var progress = qs('.kc-chat__progress', root);
    var messages = qsa('.kc-chat__message', root);

    if (!root.id) broken(root, '群聊没有标识符（id）；一页多个聊天窗会互相干扰');
    if (!stream) { broken(root, '缺消息列表（kc-chat__stream）'); return; }
    if (!next || !replay) { broken(root, '缺“下一条”或“重放”按钮，这两个是必需的'); return; }
    if (!typing) { broken(root, '缺打字指示（kc-chat__typing）'); return; }
    if (!messages.length) { broken(root, '一条消息都没有'); return; }

    var speakers = [];
    var bad = 0;
    messages.forEach(function (m, i) {
      var sp = m.getAttribute('data-kc-speaker');
      if (!sp) {
        broken(root, '第 ' + (i + 1) + ' 条消息没有声明发言者（data-kc-speaker），打字指示无法确定头像');
        bad++;
        return;
      }
      speakers.push(sp);
      m.style.setProperty('--kc-accent', 'var(--kc-accent-' + speakerAccent(sp) + ')');
    });
    if (bad) return;

    /* 头像从消息里推断，不要求作者在打字指示里再写一遍 */
    var avatarOf = {};
    messages.forEach(function (m) {
      var sp = m.getAttribute('data-kc-speaker');
      var av = qs('.kc-chat__avatar', m);
      if (av && avatarOf[sp] === undefined) avatarOf[sp] = av.textContent;
    });

    var typingAvatar = el('span', 'kc-chat__avatar');
    var dots = el('span', 'kc-chat__typing-dots');
    dots.appendChild(el('span'));
    dots.appendChild(el('span'));
    dots.appendChild(el('span'));
    typing.textContent = '';
    typing.appendChild(typingAvatar);
    typing.appendChild(dots);
    typing.setAttribute('aria-hidden', 'true');

    var cursor = 0;
    var busy = false;
    var playing = false;
    var timer = null;

    function paint () {
      messages.forEach(function (m, i) { m.classList.toggle('kc-is-shown', i < cursor); });
      if (progress) progress.textContent = cursor + ' / ' + messages.length + ' 条';
      next.disabled = busy || cursor >= messages.length;
      if (all) all.disabled = busy || cursor >= messages.length;
    }

    function showTyping (on) {
      typing.classList.toggle('kc-is-shown', !!on);
      if (on) {
        var sp = messages[cursor].getAttribute('data-kc-speaker');
        typingAvatar.textContent = avatarOf[sp] || sp.charAt(0);
        typingAvatar.style.setProperty('--kc-accent', 'var(--kc-accent-' + speakerAccent(sp) + ')');
        typing.setAttribute('data-kc-speaker', sp);
      } else {
        typing.removeAttribute('data-kc-speaker');
      }
    }

    /* 播放期间再点"下一条"不许造成重复或跳条：busy 期间一律不受理 */
    function advance (done) {
      if (busy || cursor >= messages.length) { if (done) done(false); return; }
      busy = true;
      paint();
      showTyping(true);
      timer = win.setTimeout(function () {
        showTyping(false);
        cursor += 1;
        busy = false;
        paint();
        if (done) done(true);
      }, CHAT_TYPING_MS);
    }

    function playAll () {
      if (playing) return;
      playing = true;
      (function step () {
        advance(function (moved) {
          if (!moved || cursor >= messages.length) { playing = false; paint(); return; }
          timer = win.setTimeout(step, CHAT_STEP_MS - CHAT_TYPING_MS);
        });
      })();
    }

    function reset () {
      if (timer) { win.clearTimeout(timer); timer = null; }
      busy = false;
      playing = false;
      cursor = 0;
      showTyping(false);
      paint();
    }

    [next, all, replay].forEach(function (b) { if (b) b.setAttribute('type', 'button'); });
    on(next, 'click', function () { advance(); });
    if (all) on(all, 'click', playAll);
    on(replay, 'click', reset);

    reset();
    live(root);
  });

  /* --------------------------------------------- 数据流演示 kc-flow (05) */

  var FLOW_PACKET_MS = 800;

  register('数据流演示', '.kc-flow', function (root) {
    var actors = qsa('.kc-flow__actor', root);
    var packet = qs('.kc-flow__packet', root);
    var caption = qs('.kc-flow__caption', root);
    var next = qs('.kc-flow__next', root);
    var reset = qs('.kc-flow__reset', root);
    var progress = qs('.kc-flow__progress', root);
    var raw = root.getAttribute('data-kc-steps');

    if (!actors.length) { broken(root, '一个角色都没有（kc-flow__actor）'); return; }
    if (!caption || !next || !reset) { broken(root, '缺说明文字、“下一步”或“重来”按钮'); return; }
    if (!packet) { broken(root, '缺数据包（kc-flow__packet）'); return; }

    var byId = {};
    var dup = [];
    actors.forEach(function (a, i) {
      if (!a.id) { broken(root, '第 ' + (i + 1) + ' 个角色没有标识符（id）；角色标识符必须整页唯一'); return; }
      if (doc.querySelectorAll('#' + CSS.escape(a.id)).length > 1) dup.push(a.id);
      byId[a.id] = a;
    });
    if (dup.length) {
      broken(root, '角色标识符重复：' + dup.join('、') + '；标识符中间要放模块特有的部分');
      return;
    }

    /* 这是最容易静默失效的地方：步骤序列解析不了就必须硬失败，不许悄悄不动。
       说明文字里出现英文单引号会提前闭合属性，JSON 就断在那里。 */
    if (!raw || !raw.trim()) { broken(root, '没有步骤序列（data-kc-steps）'); return; }
    var steps;
    try {
      steps = JSON.parse(raw);
    } catch (e) {
      broken(root, '步骤序列解析失败：' + e.message +
        '。最常见的原因是说明文字里出现了英文单引号，它会提前闭合属性；需要引号时用中文引号。' +
        '原文开头是：' + raw.slice(0, 60));
      return;
    }
    if (!Array.isArray(steps) || !steps.length) { broken(root, '步骤序列是空的'); return; }

    var missing = [];
    steps.forEach(function (s, i) {
      ['actor', 'from', 'to'].forEach(function (k) {
        if (s[k] && !byId[s[k]]) missing.push('第 ' + (i + 1) + ' 步的 ' + k + '="' + s[k] + '"');
      });
      if (!s.actor) missing.push('第 ' + (i + 1) + ' 步没有指定高亮的角色');
      if (!s.text) missing.push('第 ' + (i + 1) + ' 步没有说明文字');
    });
    if (missing.length) {
      broken(root, '步骤引用了不存在的角色标识符，或缺件：' + missing.join('；'));
      return;
    }

    var lead = caption.textContent;
    var cursor = 0;
    var flyTimer = null;

    function paint () {
      actors.forEach(function (a) { a.classList.remove('kc-is-current'); });
      if (cursor > 0) {
        /* 高亮是排他的：任何时刻最多一个角色 */
        var cur = byId[steps[cursor - 1].actor];
        if (cur) cur.classList.add('kc-is-current');
        caption.textContent = steps[cursor - 1].text;
        try { applyTypography(caption); } catch (e) {}
      } else {
        caption.textContent = lead;
      }
      if (progress) progress.textContent = '第 ' + cursor + ' 步 / 共 ' + steps.length + ' 步';
      next.disabled = cursor >= steps.length;
    }

    function fly (fromId, toId) {
      var a = byId[fromId];
      var b = byId[toId];
      if (!a || !b) return;
      var base = root.getBoundingClientRect();
      var ra = a.getBoundingClientRect();
      var rb = b.getBoundingClientRect();
      /* 按实际元素位置算，窄屏下角色换行也不会飞到屏幕外 */
      var x0 = ra.left + ra.width / 2 - base.left;
      var y0 = ra.top + ra.height / 2 - base.top;
      var x1 = rb.left + rb.width / 2 - base.left;
      var y1 = rb.top + rb.height / 2 - base.top;

      if (flyTimer) win.clearTimeout(flyTimer);
      packet.style.transition = 'none';
      packet.style.left = x0 + 'px';
      packet.style.top = y0 + 'px';
      packet.style.transform = 'none';
      packet.classList.add('kc-is-flying');
      packet.setAttribute('data-kc-from', fromId);
      packet.setAttribute('data-kc-to', toId);
      /* 强制一次重排，让起点先生效 */
      void packet.offsetWidth;
      packet.style.transition = 'transform ' + FLOW_PACKET_MS + 'ms var(--kc-ease)';
      packet.style.transform = 'translate(' + (x1 - x0) + 'px,' + (y1 - y0) + 'px)';
      flyTimer = win.setTimeout(function () {
        packet.classList.remove('kc-is-flying');
        flyTimer = null;
      }, FLOW_PACKET_MS);
    }

    [next, reset].forEach(function (b) { b.setAttribute('type', 'button'); });
    on(next, 'click', function () {
      if (cursor >= steps.length) return;
      var s = steps[cursor];
      cursor += 1;
      paint();
      if (s.from && s.to) fly(s.from, s.to);
    });
    on(reset, 'click', function () {
      if (flyTimer) { win.clearTimeout(flyTimer); flyTimer = null; }
      packet.classList.remove('kc-is-flying');
      cursor = 0;
      paint();
    });

    paint();
    live(root);
  });

  /* ------------------------------------------------ 拖拽匹配 kc-match (09) */
  /* 桌面拖放机制在手机上完全无效，所以这里只用一套指针事件（pointer events），
     鼠标和手指走同一条路；键盘另有一条完整路径，不是只有拖拽一条路。 */

  register('拖拽匹配', '.kc-match', function (root) {
    var cards = qsa('.kc-match__card', root);
    var slots = qsa('.kc-match__slot', root);
    var check = qs('.kc-match__check', root);
    var reset = qs('.kc-match__reset', root);

    if (!root.id) broken(root, '拖拽匹配没有标识符（id）');
    if (!cards.length || !slots.length) { broken(root, '缺卡片或靶位'); return; }
    if (!check || !reset) { broken(root, '缺“对一下”或“重来”按钮'); return; }
    if (cards.length !== slots.length) {
      broken(root, '卡片有 ' + cards.length + ' 张，靶位有 ' + slots.length + ' 个，必须一一对应');
      return;
    }

    var keys = {};
    var badKey = false;
    cards.forEach(function (c, i) {
      var k = c.getAttribute('data-kc-key');
      if (!k) { broken(root, '第 ' + (i + 1) + ' 张卡片没有 data-kc-key'); badKey = true; return; }
      keys[k] = c;
      c.setAttribute('type', 'button');
    });
    if (badKey) return;

    var expects = {};
    var problems = [];
    slots.forEach(function (s, i) {
      var e = s.getAttribute('data-kc-expect');
      if (!e) { problems.push('第 ' + (i + 1) + ' 个靶位没有 data-kc-expect'); return; }
      if (!keys[e]) { problems.push('第 ' + (i + 1) + ' 个靶位期待的卡片“' + e + '”不存在'); return; }
      if (expects[e]) { problems.push('“' + e + '”被两个靶位同时期待'); return; }
      expects[e] = s;
      if (!qs('.kc-match__drop', s)) problems.push('第 ' + (i + 1) + ' 个靶位没有空位（kc-match__drop）');
    });
    if (problems.length) { broken(root, problems.join('；')); return; }

    var placed = {};     /* slot 索引 -> card key */
    var emptyText = {};
    var picked = null;
    var ghost = null;

    slots.forEach(function (s, i) {
      emptyText[i] = qs('.kc-match__drop', s).textContent;
      s.setAttribute('tabindex', '0');
      s.setAttribute('role', 'button');
    });

    function slotIndex (s) { return slots.indexOf(s); }

    function paint () {
      slots.forEach(function (s, i) {
        var drop = qs('.kc-match__drop', s);
        var k = placed[i];
        drop.textContent = k ? k : emptyText[i];
        s.classList.toggle('kc-is-placed', !!k);
      });
      var used = {};
      Object.keys(placed).forEach(function (i) { used[placed[i]] = true; });
      cards.forEach(function (c) {
        c.classList.toggle('kc-is-placed', !!used[c.getAttribute('data-kc-key')]);
      });
      var box = cards.length ? cards[0].parentElement : null;
      if (box && box.classList.contains('kc-match__cards')) {
        box.classList.toggle('kc-is-empty', Object.keys(used).length === cards.length);
      }
    }

    /* 一张卡片同一时刻只能在一个靶位上 */
    function place (key, slot) {
      var idx = slotIndex(slot);
      if (idx < 0) return;
      Object.keys(placed).forEach(function (i) { if (placed[i] === key) delete placed[i]; });
      placed[idx] = key;
      slot.classList.remove('kc-is-right', 'kc-is-wrong');
      paint();
    }

    function pick (card) {
      if (picked) picked.classList.remove('kc-is-picked');
      picked = card;
      if (card) card.classList.add('kc-is-picked');
    }

    /* ---- 指针拖动：鼠标和手指同一条路 ---- */
    var suppressClick = false;

    cards.forEach(function (card) {
      on(card, 'pointerdown', function (ev) {
        if (ev.button !== undefined && ev.button !== 0) return;
        var x0 = ev.clientX;
        var y0 = ev.clientY;
        var moved = false;

        function move (e) {
          if (!moved) {
            if (Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0) < 4) return;
            moved = true;
            /* 真的开始拖了才拦默认行为：不拦的话按一下就选中文字 */
            ghost = card.cloneNode(true);
            ghost.className = 'kc-match__card kc-match__ghost';
            doc.body.appendChild(ghost);
            pick(card);
          }
          if (e.cancelable) e.preventDefault();
          ghost.style.left = e.clientX + 'px';
          ghost.style.top = e.clientY + 'px';
          var over = doc.elementFromPoint(e.clientX, e.clientY);
          var slot = over && over.closest ? over.closest('.kc-match__slot') : null;
          slots.forEach(function (s) { s.classList.toggle('kc-is-over', s === slot && root.contains(s)); });
        }

        function up (e) {
          doc.removeEventListener('pointermove', move);
          doc.removeEventListener('pointerup', up);
          doc.removeEventListener('pointercancel', up);
          if (ghost) { ghost.remove(); ghost = null; }
          slots.forEach(function (s) { s.classList.remove('kc-is-over'); });
          if (!moved) return;
          /* 拖完之后浏览器还会补一个 click，别让它把刚放好的又取消掉 */
          suppressClick = true;
          win.setTimeout(function () { suppressClick = false; }, 0);
          var over = doc.elementFromPoint(e.clientX, e.clientY);
          var slot = over && over.closest ? over.closest('.kc-match__slot') : null;
          if (slot && root.contains(slot)) place(card.getAttribute('data-kc-key'), slot);
          pick(null);
        }

        on(doc, 'pointermove', move);
        on(doc, 'pointerup', up);
        on(doc, 'pointercancel', up);
      });

      /* ---- 键盘：聚焦卡片按回车选中（鼠标点一下也走这条路） ---- */
      on(card, 'click', function () {
        if (suppressClick) return;
        pick(picked === card ? null : card);
      });
    });

    /* ---- 键盘：再聚焦靶位按回车放下 ---- */
    slots.forEach(function (slot) {
      function drop () {
        if (suppressClick || !picked) return;
        place(picked.getAttribute('data-kc-key'), slot);
        pick(null);
        slot.focus();
      }
      on(slot, 'click', drop);
      on(slot, 'keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); drop(); }
      });
    });

    check.setAttribute('type', 'button');
    reset.setAttribute('type', 'button');
    on(check, 'click', function () {
      slots.forEach(function (s, i) {
        s.classList.remove('kc-is-right', 'kc-is-wrong');
        var k = placed[i];
        /* 空着的靶位不判 */
        if (!k) return;
        s.classList.add(k === s.getAttribute('data-kc-expect') ? 'kc-is-right' : 'kc-is-wrong');
      });
    });
    on(reset, 'click', function () {
      placed = {};
      pick(null);
      slots.forEach(function (s) { s.classList.remove('kc-is-right', 'kc-is-wrong', 'kc-is-over'); });
      paint();
    });

    paint();
    live(root);
  });

  /* --------------------------------------------------- 架构图 kc-map (10) */

  register('架构图', '.kc-map', function (root) {
    var about = qs('.kc-map__about', root);
    var nodes = qsa('.kc-map__node', root);

    if (!about) { broken(root, '缺说明区（kc-map__about）'); return; }
    /* 说明区靠所属图定位，不带标识符：一页放两张图也不会互相干扰 */
    if (about.id) broken(root, '说明区带了标识符 id="' + about.id + '"；说明区一律不带标识符');
    if (!nodes.length) { broken(root, '一个方块都没有（kc-map__node）'); return; }

    var missing = [];
    nodes.forEach(function (n, i) {
      if (!n.getAttribute('data-kc-about')) {
        missing.push('第 ' + (i + 1) + ' 个方块“' + (qs('.kc-map__name', n) || {}).textContent + '”');
      }
    });
    if (missing.length) { broken(root, '这些方块没有说明（data-kc-about）：' + missing.join('、')); return; }

    nodes.forEach(function (n) {
      n.setAttribute('type', 'button');
      n.setAttribute('aria-pressed', 'false');
      on(n, 'click', function () {
        /* 高亮是排他的；再点同一个保持选中，不切回默认文字 */
        nodes.forEach(function (x) {
          var isIt = x === n;
          x.classList.toggle('kc-is-current', isIt);
          x.setAttribute('aria-pressed', isIt ? 'true' : 'false');
        });
        about.textContent = n.getAttribute('data-kc-about');
        try { applyTypography(about); } catch (e) {}
      });
    });

    live(root);
  });

  /* ----------------------------------------------- 分层切换 kc-layers (11) */

  register('分层切换', '.kc-layers', function (root) {
    var tabs = qsa('.kc-layers__tab', root);
    var panels = qsa('.kc-layers__panel', root);
    var note = qs('.kc-layers__note', root);

    if (!tabs.length || !panels.length) { broken(root, '缺标签或层'); return; }
    if (!note) { broken(root, '缺说明文字（kc-layers__note）'); return; }

    var problems = [];
    var byId = {};
    panels.forEach(function (p, i) {
      if (!p.id) { problems.push('第 ' + (i + 1) + ' 层没有标识符（id）'); return; }
      if (doc.querySelectorAll('#' + CSS.escape(p.id)).length > 1) {
        problems.push('层标识符“' + p.id + '”重复；标识符中间要带模块特有的部分');
        return;
      }
      byId[p.id] = p;
    });

    var pairs = [];
    var pointed = {};
    tabs.forEach(function (t, i) {
      var id = t.getAttribute('data-kc-layer');
      if (!id || !byId[id]) { problems.push('第 ' + (i + 1) + ' 个标签指向不存在的层“' + (id || '') + '”'); return; }
      pointed[id] = true;
      pairs.push({ tab: t, panel: byId[id] });
    });
    panels.forEach(function (p) {
      if (p.id && byId[p.id] && !pointed[p.id]) problems.push('层“' + p.id + '”没有任何标签指向它');
    });
    if (problems.length) { broken(root, problems.join('；')); return; }

    var tablist = tabs[0].parentElement;
    if (tablist) tablist.setAttribute('role', 'tablist');

    function show (i) {
      pairs.forEach(function (p, j) {
        var isIt = j === i;
        p.tab.classList.toggle('kc-is-current', isIt);
        p.tab.setAttribute('aria-selected', isIt ? 'true' : 'false');
        p.tab.tabIndex = isIt ? 0 : -1;
        p.panel.classList.toggle('kc-is-current', isIt);
        p.panel.setAttribute('aria-hidden', isIt ? 'false' : 'true');
      });
      var n = pairs[i].tab.getAttribute('data-kc-note');
      if (n) {
        note.textContent = n;
        try { applyTypography(note); } catch (e) {}
      }
    }

    pairs.forEach(function (p, i) {
      p.tab.setAttribute('type', 'button');
      p.tab.setAttribute('role', 'tab');
      p.tab.setAttribute('aria-controls', p.panel.id);
      p.panel.setAttribute('role', 'tabpanel');
      on(p.tab, 'click', function () { show(i); });
      on(p.tab, 'keydown', function (ev) {
        var d = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        ev.preventDefault();
        var next = (i + d + pairs.length) % pairs.length;
        show(next);
        pairs[next].tab.focus();
      });
    });

    show(0);
    live(root);
  });

  /* ------------------------------------------- 这里没看懂 kc-feedback (19) */
  /* 学员唯一能对课程说话的地方。不联网、不上报、不判分 ——
     记录只存在他自己的浏览器里，导不导出、发给谁，都由他决定。 */

  var feedback = (function () {
    var KEY = 'kc-feedback:' + win.location.pathname;
    var items = null;

    function load () {
      if (items) return items;
      items = [];
      var raw = store.get(KEY);
      if (raw) { try { var p = JSON.parse(raw); if (Array.isArray(p)) items = p; } catch (e) {} }
      return items;
    }
    /* 存不下就算了：隐私模式下按钮照样能点，只是刷新之后不留。 */
    function save () { store.set(KEY, JSON.stringify(load())); }
    function idOf (moduleId, screenIndex) { return moduleId + '#' + screenIndex; }
    function find (key) { return load().filter(function (x) { return x.key === key; })[0] || null; }

    return {
      all: load,
      get: find,
      add: function (rec) { load().push(rec); save(); },
      remove: function (key) { items = load().filter(function (x) { return x.key !== key; }); save(); },
      note: function (key, text) { var r = find(key); if (r) { r.note = text; save(); } },
      clear: function () { items = []; save(); },
      keyOf: idOf
    };
  })();

  var feedbackWatchers = [];

  register('这里没看懂', '.kc-feedback', function (root) {
    var screen = root.closest('.kc-screen');
    var mod = root.closest('.kc-module');
    if (!screen || !mod) { broken(root, '反馈按钮必须在一个 kc-screen 里，而这一屏又必须在一个 kc-module 里'); return; }

    var screens = qsa('.kc-screen', mod);
    var screenIndex = screens.indexOf(screen) + 1;
    var key = feedback.keyOf(mod.id || '?', screenIndex);
    var titleEl = qs('.kc-screen__title', screen);
    var screenTitle = titleEl ? titleEl.textContent.trim() : '（这一屏没有标题）';

    root.setAttribute('type', 'button');
    root.setAttribute('aria-pressed', 'false');
    root.setAttribute('aria-label', '这里没看懂：' + screenTitle);
    root.textContent = '这里没看懂';

    var panel = el('div', 'kc-feedback__panel');
    var note = doc.createElement('input');
    note.type = 'text';
    note.className = 'kc-feedback__note';
    note.setAttribute('placeholder', '想补一句吗？不写也行');
    note.setAttribute('aria-label', '这一屏哪里没看懂（可以不填）');
    var hint = el('p', 'kc-feedback__hint', '已记下。再点一次按钮可以撤销。这条只存在你自己的浏览器里。');
    panel.appendChild(note);
    panel.appendChild(hint);
    screen.appendChild(panel);

    function paint () {
      var on = !!feedback.get(key);
      root.classList.toggle('kc-is-marked', on);
      root.setAttribute('aria-pressed', on ? 'true' : 'false');
      panel.classList.toggle('kc-is-open', on);
      if (on) note.value = feedback.get(key).note || '';
    }

    on(root, 'click', function () {
      if (feedback.get(key)) {
        feedback.remove(key);
      } else {
        var num = qs('.kc-module__number', mod);
        feedback.add({
          key: key,
          module: mod.id || '',
          moduleNumber: num ? num.textContent.trim() : '',
          moduleTitle: (qs('.kc-module__title', mod) || {}).textContent || '',
          screen: screenIndex,
          screenTitle: screenTitle,
          note: '',
          at: new Date().toISOString()
        });
      }
      paint();
      if (feedback.get(key)) note.focus();
      feedbackWatchers.forEach(function (f) { f(); });
    });

    /* 那一句话是可选的：写到一半关掉页面，那条记录也已经在了。 */
    on(note, 'input', function () { feedback.note(key, note.value); });
    on(note, 'keydown', function (ev) { if (ev.key === 'Escape') root.focus(); });

    feedbackWatchers.push(paint);
    paint();
    live(root);
  });

  function initFeedbackExport () {
    var root = qs('.kc-feedback-export');
    if (!root) return;
    var count = qs('.kc-feedback-export__count', root);
    var button = qs('.kc-feedback-export__button', root);
    var clear = qs('.kc-feedback-export__clear', root);
    var fallback = qs('.kc-feedback-export__fallback', root);
    if (!count || !button || !clear || !fallback) { broken(root, '课末反馈块缺件'); return; }

    function refresh () {
      var n = feedback.all().length;
      count.textContent = n === 0
        ? '你还没有标记过任何一屏。看不懂的地方点一下那一屏右上角的“这里没看懂”，只记在你自己的浏览器里。'
        : '你一共标了 ' + n + ' 处没看懂。';
      button.disabled = n === 0;
    }
    feedbackWatchers.push(refresh);

    [button, clear].forEach(function (b) { b.setAttribute('type', 'button'); });

    on(button, 'click', function () {
      var payload = JSON.stringify({
        course: doc.title,
        exportedAt: new Date().toISOString(),
        items: feedback.all()
      }, null, 2);
      var name = 'feedback-' + new Date().toISOString().slice(0, 10) + '.json';
      /* 有些环境不允许页面发起下载。拦住了就把 JSON 摊出来让学员自己复制，
         绝不能什么都不发生。 */
      var ok = false;
      try {
        var blob = new Blob([payload], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = doc.createElement('a');
        a.href = url;
        a.download = name;
        doc.body.appendChild(a);
        a.click();
        a.remove();
        win.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        ok = true;
      } catch (e) { ok = false; }
      fallback.value = payload;
      fallback.classList.toggle('kc-is-open', !ok);
      root.setAttribute('data-kc-exported', ok ? 'download' : 'fallback');
    });

    on(clear, 'click', function () {
      feedback.clear();
      fallback.classList.remove('kc-is-open');
      feedbackWatchers.forEach(function (f) { f(); });
    });

    refresh();
    live(root);
  }

  /* --------------------------------------------------- 图示 kc-figure (20) */
  /* 无交互，只做数据体检：一张没有 alt 的截图，对看不见它的人等于不存在。 */

  register('图示', '.kc-figure', function (root) {
    var img = qs('.kc-figure__image', root) || qs('img', root);
    if (!img) { broken(root, '图示里没有图片（kc-figure__image）'); return; }
    if (!img.getAttribute('src')) broken(root, '图片没有 src');
    if (!(img.getAttribute('alt') || '').trim()) {
      broken(root, '图片没有 alt；alt 要描述图里有什么，看不见图的人只能靠它');
    }
    if (img.getAttribute('style')) {
      broken(root, '图片带了内联 style；样式全在 styles.css 里，内联会让一门课里的图各长各的样');
    }
    var cap = qs('.kc-figure__caption', root);
    if (!cap || !cap.textContent.trim()) broken(root, '图示缺一行说明（kc-figure__caption）');
    live(root);
  });

  /* KC_MODULES_END */

  /* ----------------------------------------------------------------- boot */

  function boot () {
    try { syncLangAttr(doc); } catch (e) {}
    try { applyTypography(doc.body); } catch (e) {}
    try { initNav(); } catch (e) {}

    modules.forEach(function (m) {
      qsa(m.sel).forEach(function (root) {
        try {
          m.init(root);
        } catch (err) {
          broken(root, m.name + ' 初始化失败：' + (err && err.message ? err.message : err));
        }
      });
    });

    try { initFeedbackExport(); } catch (e) {}
    try { bindTerms(); } catch (e) {}
    try { initReveal(); } catch (e) {}
  }

  /* main.js 由 _footer.html 放在 </body> 之前，DOM 已经解析完；
     但被别处提前引入时也要能工作。 */
  if (doc.readyState === 'loading') on(doc, 'DOMContentLoaded', boot);
  else boot();
})();
