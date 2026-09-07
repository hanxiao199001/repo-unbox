# 找 bug `kc-bughunt`

给一段被改坏的代码，让学员点出有问题的那一行。**全课至少两处。**

```html
<div class="kc-bughunt">
  <p class="kc-bughunt__lead">这段代码被人悄悄改坏了，点一下你觉得有问题的那一行。</p>
  <div class="kc-bughunt__code" data-kc-lang="en">
    <button class="kc-bughunt__line" data-kc-hint="这一行只是给函数起名字，名字本身不会出错。"><span class="kc-bughunt__lineno">1</span>async function create(title) {</button>
    <button class="kc-bughunt__line" data-kc-bug data-kc-explain="检查的是原始的 title，不是 trim 之后的。用户敲一串空格就能存进来，列表里会出现一条空白待办。把判断改成 title.trim() 就对了。"><span class="kc-bughunt__lineno">2</span>  if (!title) return null;</button>
    <button class="kc-bughunt__line" data-kc-hint="这一行只是把几个字段拼成一个对象，拼错了会在别处炸出来。"><span class="kc-bughunt__lineno">3</span>  const todo = { id: nextId++, title: title.trim(), done: false };</button>
    <button class="kc-bughunt__line" data-kc-hint="写盘这一步有 await，该等的都等了。"><span class="kc-bughunt__lineno">4</span>  await persist(todo);</button>
    <button class="kc-bughunt__line" data-kc-hint="把结果还回去，这一行没什么可挑的。"><span class="kc-bughunt__lineno">5</span>  return todo;</button>
  </div>
  <div class="kc-bughunt__feedback"></div>
</div>
```

**反馈区一律不带标识符。** 一门课有两处找 bug，写死的标识符必然重复。

## 数据契约

| 名字 | 用在哪 | 必填 |
|---|---|---|
| `kc-bughunt` | 根节点 | 是 |
| `kc-bughunt__lead` | 引导语 | 是 |
| `kc-bughunt__code` + `data-kc-lang="en"` | 代码容器 | 是 |
| `kc-bughunt__line` | 每一行，必须是 `<button>` | 是 |
| `kc-bughunt__lineno` | 行号 | 是 |
| `data-kc-bug` | 有问题的那一行，**全块有且只有一行带它** | 是 |
| `data-kc-explain` | 有问题的那一行，找到后的完整解释 | 是 |
| `data-kc-hint` | 其余**每一行**，点错时的提示 | 是 |
| `kc-bughunt__feedback` | 反馈区，**留空、不带 id** | 是 |

## 内容规则

- 代码 **4–8 行**，从真实源码改出来，**只改一处**。
- 那一处要是**真实会犯的错**：漏了等待、比较用错、加号写成减号、检查了原值而不是处理后的值。
  不要造语法错误——那种编辑器就报了，学员用不着学。
- 每一行的提示都不一样，**不许几行共用一句“不是这行”**。提示要顺着学员的思路往正确方向引。
- 找到后的解释必须包含：为什么错、会出什么现象、怎么改。
- 代码里出现的函数名、变量名必须是这个项目里真实存在的。

## 失败与边界

- 没标问题行或标了不止一行、缺解释、某行缺提示、反馈区带了标识符
  → 页面留红色痕迹，构建失败。
- 点错不惩罚、不计次、不锁定：标红约 2 秒自动恢复，可以一直点到找到为止。
- 找到之后是终态，全部行不可点。
- 脚本未运行 → 代码照常可读，解释直接可见。
