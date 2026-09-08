# repo-unbox（开箱）

把任意代码库变成一门**中文交互式课程**，讲给零编程基础、正在学 vibe coding 的中文学员听。

受 [zarazhangrui/codebase-to-course](https://github.com/zarazhangrui/codebase-to-course)
**启发**（方法论）。**本仓库不包含该项目的任何代码**——页面层已按 [`spec/`](spec/)
里的黑盒规格从零重写，class、id、data 属性全部重新命名。授权见 [LICENSE](LICENSE)。

## 先看一眼产物

**[在线示例：SIGNAL LOG 拆开来看](https://hanxiao199001.github.io/repo-unbox/)**
——用这个 skill 从 [`sdg5-hub/Signal_LOG`](https://github.com/sdg5-hub/Signal_LOG)（852 行）
端到端生成的一门课，六个模块，走固定五段结构：

```
00 这是什么项目   01 拆架构   02 发一条讯号   03 服务器怎么把关   04 找回讯号   05 做一个类似的
```

传输 683 KB。字体子集化到这门课真正用到的字，渲染与完整字体版逐像素一致；
截图转 WebP。零外部请求。模块 0 里那张截图是模型自己把项目跑起来截的，不是配图。

## 和原版的区别

| | 原版 | 这个版本 |
|---|---|---|
| 语言 | 英文 | 中文正文，代码和报错保持英文原样 |
| 英文单词 | 只解释概念 | 每个英文标识符给三层：直译词义 / 在这里指什么 / 国内工程师叫法 |
| 验证理解 | 选择题 | 选择题热身 + **输出题**：学员必须自己写出来 |
| 字体 | Google Fonts CDN（国内被墙） | 自托管霞鹜文楷 + JetBrains Mono，**零外部请求** |
| 构建 | `build.sh`（要 bash） | `scripts/build.mjs`（Node，Windows 可用） |
| 代码正确性 | 靠人看 | `scripts/validate.mjs` 拿每个代码块和源文件逐字比对 |
| 依赖 | Claude Code 子 agent | 无，Codex CLI / OpenCode 上同样能跑 |

## 安装

```bash
git clone <this-repo> repo-unbox
cd repo-unbox
node scripts/install.mjs
```

装到 `~/.claude/skills/repo-unbox/`，然后**新开一个 Claude Code 会话**就能用。
只复制 `SKILL.md`、`references/`、`scripts/`；`output/`、`examples/`、`.git` 不会被带过去。

```bash
node scripts/install.mjs --dry-run          # 先看会复制什么
node scripts/install.mjs --target <dir>     # 装到别处
```

装完在任意目录说“把这个项目做成课程”，或者直接 `/repo-unbox`。

## 用哪个模型

**推荐 Sonnet 5。** skill 本身不选模型，下面是实测。

端到端实测（`sdg5-hub/Signal_LOG`，852 行；全局安装的 skill，项目目录外的干净目录，
一句话提示，无人值守 `claude -p`，Sonnet 5）：

| | 第一次（v0.2） | 第二次（v0.2.1） |
|---|---|---|
| 费用 | $3.27 | **$1.93** |
| 时长 | 17.0 min | **14.5 min** |
| 助手轮次 | 50 | **23** |
| cache read | 7,713,692 | **2,565,587** |
| 首次校验 | 43/44 | **45/47** |
| 中文正文 | 7,167 字 | 4,972 字 |
| 代码块（逐字比对） | 14 | 6 |
| 比喻长在项目题材上 | 1/5 | **5/5** |
| 读过校验脚本 | 是（validate.mjs 2 次） | **否** |

第二次便宜快了一半，主要来自两件事：没再去读 `validate.mjs`，以及比喻不必再翻兜底表。
代码块从 14 个降到 6 个、中文从 7,167 字降到 4,972 字，是这一版更薄的地方——
两次都过了每模块的下限，但厚度差得不少。

产物在 `output/signal-log-e2e/`（第一次）和 `output/signal-log-e2e-2/`（第二次）。
**这些数字和 v0.1.1 时代那组不可比**：页面层、elements 文档、校验项全换过，
而且旧数据来自交互式会话（有人在旁边确认），这里是无人值守。

**DeepSeek 待测。** skill 不依赖 Claude Code 特有能力，理论上能在 Codex CLI 和
OpenCode + DeepSeek 上跑，但还没实测过。

## 用法

```bash
# 1. 写 _base.html 和 modules/*.html（由 skill 指导模型完成）
# 2. 构建
node scripts/build.mjs <课程目录> --source <代码库路径>
```

`--source` 必填：每个代码块都要拿去和这个代码库逐字比对，缺了直接失败。
构建会复制 `styles.css` / `main.js` / `_footer.html` / `fonts/`，拼出 `index.html`，然后跑全部校验。

单独跑校验：

```bash
node scripts/validate.mjs <课程目录> --source <代码库路径>
```

## 脚本

| 脚本 | 干什么 |
|---|---|
| `scripts/install.mjs` | 装到 `~/.claude/skills/` |
| `scripts/build.mjs` | 拼装课程 + 复制资源 + 补 `lang="en"` + 跑校验 |
| `scripts/validate.mjs` | 结构校验：代码块逐字比对、每模块代码块与中文字数下限、导航与模块双向对应、模块底色交替、找 bug 数量、比喻查重、标点、数量词清单 |
| `scripts/fetch-fonts.mjs` | 重新抓取自托管字体（霞鹜文楷 + JetBrains Mono，均为 OFL 1.1） |
| `scripts/measure-fonts.mjs` | 用真实 Chrome 量一门课实际下载多少字体 |
| `scripts/test-elements.mjs` | 用真实的 headless Chrome 跑每一种交互元素的行为测试，零第三方依赖 |
| `scripts/test-validate.mjs` | 校验脚本的负向测试：把一门合规课程逐条破坏，确认每项检查都真的会红 |

## 目录

```
SKILL.md              给模型的主指令（中文，≤500 行）
references/           内容原则、交互元素规范、翻车清单、页面层实现、字体
scripts/              构建与校验（Node，零依赖，跨平台）
examples/todo-api/    贯穿全程的示例代码库（Express 待办 API，约 340 行）
output/               生成的课程，按代码库命名：
  todo-api/           examples/todo-api，5 个模块
  signal-log/         examples/signal-log，5 个模块
```

**output/ 按代码库命名，不按测试条件命名**（用哪个模型、加载策略如何，这类条件记在
README 的测量表和 `scripts/analyze-run.mjs` 的记录里，不进目录名）。

v0.2 重写页面层之后，早先那些产物（`baseline`、`baseline-v2`、`real-1`、
`real-2-opus`、`real-2-sonnet`）都是旧实现渲染的，class 名、DOM 结构、构建链全部对不上，
留着只会误导，已经删除。

## 授权

[MIT](LICENSE)，Copyright (c) 2026 韩宵。

随附字体单独授权：霞鹜文楷与 JetBrains Mono 均为 SIL Open Font License 1.1，
授权原文随字体放在 `references/fonts/LICENSE-*.txt`。
