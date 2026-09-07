# 拖拽匹配 `kc-match`

把卡片拖到对应的描述上，练“职责归哪个文件”这类对应关系。

```html
<div class="kc-match" id="kc-match-{模块slug}">
  <div class="kc-match__cards">
    <button class="kc-match__card" data-kc-key="app.js">app.js</button>
    <button class="kc-match__card" data-kc-key="server.js">server.js</button>
    <button class="kc-match__card" data-kc-key="store.js">store.js</button>
  </div>

  <div class="kc-match__slots">
    <div class="kc-match__slot" data-kc-expect="app.js">
      <p class="kc-match__label">你打的字先被它收起来，它还会先看一眼标题是不是空的。</p>
      <div class="kc-match__drop">拖到这里</div>
    </div>
    <div class="kc-match__slot" data-kc-expect="server.js">
      <p class="kc-match__label">它谁的活都不干，只负责把来的人指到对的地方。</p>
      <div class="kc-match__drop">拖到这里</div>
    </div>
    <div class="kc-match__slot" data-kc-expect="store.js">
      <p class="kc-match__label">只有它碰硬盘，数据不对的时候先来这里找。</p>
      <div class="kc-match__drop">拖到这里</div>
    </div>
  </div>

  <div class="kc-match__actions">
    <button class="kc-match__check">对一下</button>
    <button class="kc-match__reset">重来</button>
  </div>
</div>
```

## 数据契约

| 名字 | 用在哪 | 必填 |
|---|---|---|
| `kc-match` + `id` | 根节点 | 是 |
| `kc-match__cards` / `kc-match__slots` | 两个容器 | 是 |
| `kc-match__card` + `data-kc-key` | 每张卡片 | 是 |
| `kc-match__slot` + `data-kc-expect` | 每个靶位，值等于正确卡片的 `data-kc-key` | 是 |
| `kc-match__label` | 靶位上的描述 | 是 |
| `kc-match__drop` | 靶位的空位，文字写“拖到这里” | 是 |
| `kc-match__check` / `kc-match__reset` | 两个按钮 | 是 |

## 内容规则

- 卡片 **3–5 张**，靶位数量与卡片相同，**一一对应**。
- 描述写成学员会说的话：“标题里只有空格的，别让它进来。”
  不要写成“负责输入校验”这种教科书语言。
- 卡片上是**真实的文件名或函数名**，英文原样。

## 失败与边界

- 卡片数与靶位数不等、某靶位期待的卡片不存在、两个靶位期待同一张
  → 页面留红色痕迹，构建失败。
- 鼠标、手指、键盘三条路都能走完全流程；一张卡片同一时刻只能在一个靶位上。
- 空着的靶位在“对一下”时不判。
- 脚本未运行 → 卡片与描述照常可读，拖拽无效。
