# 基线评估 · output/baseline

> 用 `upstream/` 原版 skill、未做任何修改，对 `examples/todo-api`（342 行，Express 待办 API + 浏览器前端）生成的课程。
> 5 个模块 / 30 个术语气泡 / 6 个代码对照块 / 5 组测验 / 1 个群聊动画 / 1 个数据流动画 / 1 个拖拽匹配 / 1 个找 bug。

## 一、中文零基础学员会卡在哪

### 1. 整份课程 100% 是英文 —— 这是最致命的一条
课程正文、术语气泡、测验题干、选项、答案解释、按钮文案（Next Step / Check Answers / Replay）全部是英文。
学员要先跨过英语阅读关，才轮到跨技术关。原版 skill 里没有任何一句提到语言。

### 2. 术语气泡解释的是"概念"，不解释"这个英文单词本身"
原版气泡长这样（真实产物）：

> **middleware** — Middleware is a small function that sits between the incoming request and the code that finally answers it…

对中国学员，缺的三层里它只给了第一层：
| 缺的东西 | 例子 |
|---|---|
| 英文原词怎么念、字面什么意思 | middle + ware，"中间的东西" |
| 直译词义 | 中间件 |
| 国内工程师口头怎么叫 | "中间件"（这个词国内直接用中文，但 `next()` 大家念 "next"） |

同样问题的词在基线产物里实际出现且未拆解的有：middleware(15 次)、validate(17)、await(7)、promise(6)、UUID(4)、writeQueue(4)、persist(3)、boot(3)、stringify(2)、stack trace(2)、randomUUID(2)、trim(1)、preventDefault(1)、toISOString(1)。

### 3. 代码里的英文标识符完全没被解释
代码块里出现 `preventDefault`、`writeQueue`、`randomUUID`、`toISOString`、`persist`、`res.status(201).json(...)`。
右栏的"plain English"翻译讲的是**这行代码干什么**，从不讲**这个函数名是哪几个英文单词拼的、为什么这么起名**。
零基础中国学员看代码时最大的心理障碍恰恰是"满屏不认识的单词"，原版完全没处理。

### 4. 英文报错看不懂 —— 而这正是学员最需要的能力
模块 5 教了 400/404/500 和 `errorHandler`，但展示的报错文本（`title is required`、`nothing to update: send title and/or done`、`No route for POST /api/todo`）没有一句中文对照。
学员真正遇到的场景是终端里蹦出一行英文，他需要"看懂 + 会向 AI 复述"。基线不提供这个训练。

### 5. 隐喻全部是英语文化语境
- module 1：a notebook in another room（还行）
- module 2：**theatre backstage crew**（舞台监督 / 灯光师 / 道具台 —— 中国学员不一定有这个心理图像）
- module 3：**airport security lane**（还行）
- module 5：**a vending machine that explains itself**（"会说话的自动售货机"—— 国内自动售货机通常只闪灯）

隐喻本身质量不错，但没有一个是从中文语境里长出来的。

### 6. 没有"你可以这样对 AI 说"的可执行输出
基线只在模块 5 结尾放了一句英文示范（"Put the rule in the validation middleware, throw an HttpError with a 409…"）。
没有中英双语指令卡片、没有可复制的句式模板。学员学完不知道该怎么开口。

### 7. 排版层面对中文不友好
- `<html lang="en">` —— 中文断行、字重渲染都会不对
- 字体栈里没有任何中文字体：`'Bricolage Grotesque', Georgia, serif` / `'DM Sans', -apple-system, sans-serif`
  Windows 上中文标题会掉到宋体，正文掉到微软雅黑，和整套"暖色手账"设计完全不搭
- `--leading-*` 行高是按拉丁字母调的，中文正文会显得挤

## 二、国内会失效的外部依赖

| 依赖 | 位置 | 国内表现 |
|---|---|---|
| `fonts.googleapis.com` (CSS) | `_base.html` `<link>` | **被墙**。请求挂起到超时（几秒到几十秒），期间字体不生效 |
| `fonts.gstatic.com` (字体文件) | 同上 `preconnect` | **被墙**。三套字体全部加载不到 |
| `<link rel="preconnect">` × 2 | `_base.html` | 指向上述两个域名，纯浪费一次 DNS + TCP 超时 |

课程本身是纯静态的，除字体外**没有别的 CDN**，`styles.css` / `main.js` 都是本地文件 —— 这点是好消息，改造成本不高。
但字体失效后：标题 fallback 到 `Georgia`（衬线），正文 fallback 到 `-apple-system`，等宽掉到 `Consolas/monospace`，
整套"暖色开发者手账"的视觉识别度基本归零。

## 三、构建链条上的问题（和"看不懂"无关，但会挡住学员）

1. **`build.sh` 依赖 bash**：`cat _base.html modules/*.html _footer.html > index.html`。
   Windows 学员（多数）没有 bash，`modules/*.html` 的通配符排序在不同 shell 下也不保证一致。
2. **原版 SKILL.md 的 parallel path 依赖 Claude Code 子 agent**："Dispatch modules to subagents in batches of up to 3"。
   Codex CLI / OpenCode+DeepSeek 上跑不了这一段，复杂代码库会直接卡住。
3. **SKILL.md 221 行**，还在 500 行预算内，改造有空间。

## 四、原版做得好、应该保留的部分

- 目录式产物（styles.css / main.js 不重新生成）—— 省 token、质量稳定，这个设计是对的
- 代码 ↔ 解释 双栏对照 —— 结构本身就是为"看不懂代码的人"设计的，只需把右栏换成中文 + 加一层单词解释
- 测验只考"你会怎么做"不考"这个词什么意思"—— 方向正确，直接沿用
- 术语气泡的 `position: fixed` + 挂到 `document.body` 的实现 —— 已经解决了溢出裁剪问题，别动
- 群聊动画 / 数据流动画 / 找 bug —— 交互形式对零基础学员有效，保留

## 五、下一步改造的优先级（我的建议）

1. **P0** 全文中文化 + 术语三层对照（英文原词 / 直译 / 国内叫法）
2. **P0** 去掉 Google Fonts，字体栈换成 `PingFang SC / Microsoft YaHei / Noto Sans SC` + 本地等宽，`lang="zh-CN"`
3. **P0** `build.sh` → `scripts/build.mjs`（Node，跨平台，显式排序）
4. **P1** 新增"代码里的英文单词"元素：每个代码块下方给标识符拆词表
5. **P1** 每模块结尾加"你可以这样对 AI 说"中英双语指令卡
6. **P1** 新增"英文报错对照"元素，专门练读报错
7. **P2** 隐喻本地化；把 SKILL.md 的 parallel path 改成不依赖子 agent 的写法
