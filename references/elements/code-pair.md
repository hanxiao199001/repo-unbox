# 代码对照 `kc-code-pair`

左边源码原文，右边逐行中文。**全课最重要的教学元素，每个模块至少一处。**

```html
<div class="kc-code-pair">
  <div class="kc-code-pair__code">
    <p class="kc-code-pair__source">src/store.js:12-19</p>
    <pre data-kc-lang="en">async function create(title) {
  // 标题里只有空格的，别让它进来
  if (!title.trim()) return null;

  const todo = { id: nextId++, title, done: false };
  await persist(todo);
  return todo;
}</pre>
  </div>
  <div class="kc-code-pair__lines">
    <p class="kc-code-pair__line">这一行给函数起名 create，意思是“造一个出来”。</p>
    <p class="kc-code-pair__line">原作者自己写的注释：空标题要挡在门外。</p>
    <p class="kc-code-pair__line">trim 把首尾空格去掉，去完还是空的就直接返回，不往下走。</p>
    <p class="kc-code-pair__line">这里才真正拼出一条待办，done 一开始是 false。</p>
  </div>
</div>
```

不需要标识符。「中文逐行」那行小字由样式表生成，不要手写。

## 数据契约

| 名字 | 用在哪 | 必填 |
|---|---|---|
| `kc-code-pair` | 根节点 | 是 |
| `kc-code-pair__code` | 左栏 | 是 |
| `kc-code-pair__source` | 来源标注，形如 `路径:起始行-结束行` | 是 |
| `data-kc-lang="en"` | 左栏里的 `<pre>` | 是 |
| `kc-code-pair__lines` | 右栏 | 是 |
| `kc-code-pair__line` | 右栏每一条中文 | 是 |

## 内容规则

**这是全项目最硬的一条约束：**

1. 代码必须是源文件里**连续的若干行**，**逐字复制**。不删、不简化、不改名、不加注释。
2. **允许整体去掉公共缩进；不许改动相对缩进。**
3. 空行是代码的一部分，保留。
4. **原作者写的注释是代码的一部分，不许删。** 那往往是最好的教学材料。
5. 需要展示不相邻的代码，就**开两个对照块**，各自连续，各自标注来源。**永远不拼接。**
6. 嫌某段太长？**换一段**，不要裁剪。
7. 右栏每条对应 1–2 行代码，讲“为什么”而不只是“是什么”。
8. 代码块整体不超过 12 行。

## 失败与边界

- 来源标注缺失或格式不对 → 页面上出现红色痕迹，构建失败。
- 代码在源文件里找不到逐字连续匹配 → 构建失败，指出是哪个块。
- 行号与实际位置不符 → 构建失败。
- 右栏条数超过代码行数 1.5 倍 → 提示，说明拆得过碎。
