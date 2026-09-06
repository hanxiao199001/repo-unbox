# 交互元素 · 索引

**这是索引，不是内容。** 每种元素的完整写法在 `references/elements/<名字>.md` 里。
**只读你这个模块真正要用的那几份**——一次性把 18 种全读进来，是这份 skill 最大的一笔固定开销。

> **架构约定：** 这些元素的 CSS 和 JS 全部在 `references/styles.css` 和 `references/main.js` 里，
> 由构建脚本原样复制进课程目录。写模块 HTML 时只写下面这些 HTML 结构，
> **不要**为它们内联 `<style>` 或 `<script>`。`main.js` 会在页面加载时按 class 名和
> `data-*` 属性自动初始化。

> **语言约定：** 页面是 `lang="zh-CN"`。凡是内容为英文的元素——代码块、报错原文、
> 终端输出、单独出现的文件名和标识符——都必须带 `lang="en"`，
> 否则浏览器会按中文规则给它断行和换字体。这条适用于 `.translation-code` 里的 `<pre>`、
> `.bug-code`、`.badge-code`，以及任何报错文本块。`scripts/build.mjs` 会补上漏掉的，
> 并打印补了多少个：不为零就说明模块 HTML 没按规范写。

---

## 全课必须出现的元素

这五种少一样都不行，`scripts/validate.mjs` 会卡：

| 文件 | 元素 | 什么时候用 |
|---|---|---|
| `elements/output-task.md` | **输出题** | **每个模块结尾必须有一道。**学员自己写，写够字数才看得到对照清单 |
| `elements/code-translation.md` | **代码 ↔ 中文对照** | **每个模块至少一处。**左边源码原文，右边逐行中文 |
| `elements/quiz-multiple-choice.md` | **选择题** | 每个模块至少一道，放在输出题之前当热身 |
| `elements/group-chat.md` | **群聊动画** | 全课至少一处。组件之间像微信群一样对话 |
| `elements/flow-animation.md` | **数据流动画** | 全课至少一处。数据在角色之间一步步移动 |
| `elements/spot-the-bug.md` | **找 bug** | **全课至少 2 处。**让学员亲手点出错误行 |

外加**术语气泡**（`elements/glossary-tooltip.md`）：每个技术术语、每个英文单词，每模块首次出现都要有。

另外两条按模块查、不是按全课查的硬指标：**每个模块都要有代码对照块**，
**每个模块正文中文不少于 800 字**。全课总数达标但某个模块很薄，校验一样会卡。

---

## 按需选用的元素

| 文件 | 元素 | 什么时候用 |
|---|---|---|
| `elements/scenario-quiz.md` | 场景题 | 题干比较长、要先铺一段情境时，套在选择题外面 |
| `elements/drag-and-drop.md` | 拖拽匹配 | 要学员把「职责」和「文件」对应起来时 |
| `elements/architecture-diagram.md` | 架构图 | 讲「有哪些角色、各在哪一层」时，点一下看说明 |
| `elements/layer-toggle.md` | 分层切换 | 讲「HTML→CSS→JS 一层层叠上去」这类递进关系时 |
| `elements/callout.md` | 提示框 | 「原来如此」的通用原理，每模块最多 2 个 |
| `elements/pattern-cards.md` | 模式卡片 | 3 项以上的并列概念，替代项目符号列表 |
| `elements/step-cards.md` | 编号步骤卡 | 一串有顺序的步骤 |
| `elements/flow-diagram.md` | 流程图 | 短的线性流程，比步骤卡更紧凑 |
| `elements/file-tree.md` | 文件树 | 讲「哪个文件干什么」时，替代一段文字罗列 |
| `elements/icon-rows.md` | 图标行 | 讲「有哪几个角色」时的轻量列表 |
| `elements/badges.md` | 徽章列表 | 讲状态码、配置项、权限项这类「代号 + 一句解释」 |

---

## 怎么用这份索引

1. **写 brief 时**（Phase 2.5）：在 brief 的「交互元素」一节里，把这个模块要用的元素
   **按文件名**列出来，例如 `elements/code-translation.md`、`elements/group-chat.md`。
2. **写模块时**（Phase 3）：只 `cat` brief 里列出的那几个文件。
3. 没有 brief 的简单代码库：先想清楚这个模块要哪几种元素，再只读那几份。

**不要一次读完 `elements/` 下所有文件。** 一门课通常只用到 6–8 种。
