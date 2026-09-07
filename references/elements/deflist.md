# 代号表 `kc-deflist`

一列“代号 + 一句解释”。用于状态码、配置项、权限项、报错这类需要逐条对照的东西。

```html
<div class="kc-deflist">
  <div class="kc-deflist__row">
    <code class="kc-deflist__key" data-kc-lang="en">404</code>
    <p class="kc-deflist__value">你要的东西不在这个地址上。先检查路径拼对没有，再检查那条数据是不是真的存在。</p>
  </div>
  <div class="kc-deflist__row">
    <code class="kc-deflist__key" data-kc-lang="en">Error: listen EADDRINUSE: address already in use :::3000</code>
    <p class="kc-deflist__value">3000 这个端口已经被另一个程序占了，通常是你上一个终端窗口还开着。关掉它，或者换个端口。可以对 AI 说：“把服务改成从 PORT 环境变量读端口。”</p>
  </div>
  <div class="kc-deflist__row">
    <code class="kc-deflist__key" data-kc-lang="en">500</code>
    <p class="kc-deflist__value">服务器自己出错了，不是你请求写错了。去看终端里那一大段红字，最上面一行才是原因。</p>
  </div>
</div>
```

## 数据契约

| 名字 | 用在哪 | 必填 |
|---|---|---|
| `kc-deflist` | 容器 | 是 |
| `kc-deflist__row` | 每一行 | 是 |
| `kc-deflist__key` + `data-kc-lang="en"` | 代号 | 是 |
| `kc-deflist__value` | 中文解释 | 是 |

## 内容规则

- **3–6 行**。
- 代号是**真实的英文原文**：状态码、报错、配置键名，一字不改。
- 解释要说清楚“这意味着什么”和“你该做什么”，不只是字面翻译。
- 用来放课末“你最可能撞上的报错”时，每条要包含：报错原文、中文意思、通常什么原因、
  该对 AI 怎么说。
- **报错原文必须是真的跑出来过的**，并且要说清楚在什么条件下才会出现。
  不要写成“一定会失败”——那对一半的读者是假的。

## 失败与边界

- 代号没有标 `data-kc-lang="en"` → 页面留红色痕迹，构建失败（中文断行规则会作用在报错文本上）。
- 行数超过 8 → 构建时提示。
