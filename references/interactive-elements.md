# 交互元素 · 索引

**这是索引，不是内容。** 每种元素的完整写法在 `references/elements/<名字>.md` 里。
**只读你这个模块真正要用的那几份**——一次性把 18 种全读进来，是这份 skill 最大的一笔固定开销。
一门课通常只用到 6–8 种。

> **架构约定：** 这些元素的 CSS 和 JS 全部在 `references/styles.css` 和 `references/main.js` 里，
> 由构建脚本原样复制进课程目录。写模块 HTML 时只写元素文档里的那些标签，
> **不要**为它们内联 `<style>` 或 `<script>`。`main.js` 会在页面加载时按 class 名和
> `data-kc-*` 属性自动初始化。

> **命名约定：** 元素根节点 `kc-<元素>`，内部部件 `kc-<元素>__<部件>`，
> 状态 `kc-is-<状态>`，数据属性 `data-kc-<名字>`。标识符由你给，**整页唯一**。
> 完整定义见 `spec/README.md`。**不许自创名字，也不许省略。**

> **语言约定：** 页面是 `lang="zh-CN"`。凡是内容为英文的部件——代码块、报错原文、
> 终端输出、单独出现的文件名和标识符——都必须带 `data-kc-lang="en"`，
> 否则中文断行规则会作用在它们身上。`scripts/build.mjs` 会补上漏掉的，并打印补了多少个：
> 不为零就说明模块 HTML 没按规范写。

> **留空约定：** 有些部件在 HTML 里**必须留空**，内容由实现填——
> 类别标签、字数提示、勾选计数、解释区、打字指示、进度提示、说明文字。
> 手写就会出现“声明的类别”和“显示的文字”对不上的情况。各元素文档里已逐个标出。

---

## 全课必须出现的元素

这几种少一样都不行，`scripts/validate.mjs` 会卡：

| 文件 | 元素 | 什么时候用 |
|---|---|---|
| `elements/output.md` | **输出题** `kc-output` | **每个模块结尾必须有一道。** 学员自己写，写够字数才看得到对照清单 |
| `elements/code-pair.md` | **代码对照** `kc-code-pair` | **每个模块至少一处。** 左边源码原文，右边逐行中文 |
| `elements/quiz.md` | **选择题** `kc-quiz` | 每个模块至少一道，放在输出题之前当热身 |
| `elements/chat.md` | **组件群聊** `kc-chat` | 全课至少一处。组件之间像微信群一样对话 |
| `elements/flow.md` | **数据流演示** `kc-flow` | 全课至少一处。数据在角色之间一步步移动 |
| `elements/bughunt.md` | **找 bug** `kc-bughunt` | **全课至少 2 处。** 让学员亲手点出错误行 |
| `elements/term.md` | **术语气泡** `kc-term` | 每个技术术语、每个英文单词，每模块首次出现都要有 |

另外两条按模块查、不是按全课查的硬指标：**每个模块都要有代码对照块**，
**每个模块正文中文不少于 800 字**。全课总数达标但某个模块很薄，校验一样会卡。

## 按需选用的元素

| 文件 | 元素 | 什么时候用 |
|---|---|---|
| `elements/scenario.md` | 场景题 `kc-scenario` | 题干比较长、要先铺一段情境时，套在选择题外面 |
| `elements/match.md` | 拖拽匹配 `kc-match` | 要学员把“职责”和“文件”对应起来时 |
| `elements/map.md` | 架构图 `kc-map` | 讲“有哪些角色、各在哪一层”时，点一下看说明 |
| `elements/layers.md` | 分层切换 `kc-layers` | 讲“HTML→CSS→JS 一层层叠上去”这类递进关系时 |
| `elements/note.md` | 提示框 `kc-note` | “原来如此”的通用原理，每模块最多 2 个 |
| `elements/cards.md` | 概念卡片 `kc-cards` | 3 项以上的并列概念，替代项目符号列表 |
| `elements/steps.md` | 编号步骤卡 `kc-steps` | 一串有顺序的步骤 |
| `elements/chain.md` | 箭头流程 `kc-chain` | 短的线性流程，比步骤卡更紧凑，一眼扫完 |
| `elements/tree.md` | 文件树 `kc-tree` | 讲“哪个文件干什么”时，替代一段文字罗列 |
| `elements/rolelist.md` | 角色行 `kc-rolelist` | 讲“系统里有谁”时的轻量名单 |
| `elements/deflist.md` | 代号表 `kc-deflist` | 状态码、配置项、报错这类“代号 + 一句解释” |

## 容易选错的三对

| | 用这个 | 还是这个 |
|---|---|---|
| 流程 | 学员要**点着走** → 数据流演示 `kc-flow` | 只是**标注一下** → 箭头流程 `kc-chain` |
| 罗列 | **并列的概念**，每个有独立描述段 → 概念卡片 `kc-cards` | **一份名单**，一行一个 → 角色行 `kc-rolelist` |
| 顺序 | 有真实先后 → 编号步骤卡 `kc-steps` | 并列无先后 → 概念卡片 `kc-cards` |

## 模块外壳

模块本身（`kc-module` / `kc-screen` / 模块头 / `data-kc-tone` / `data-kc-metaphor`）
不在这里，写法见 `SKILL.md` 的 Phase 3。

## 怎么用这份索引

1. **写 brief 时**（Phase 2.5）：在 brief 的「交互元素」一节里，把这个模块要用的元素
   **按文件名**列出来，例如 `elements/code-pair.md`、`elements/chat.md`。
2. **写模块时**（Phase 3）：只 `cat` brief 里列出的那几个文件。
3. 没有 brief 的简单代码库：先想清楚这个模块要哪几种元素，再只读那几份。

**不要一次读完 `elements/` 下所有文件。**
