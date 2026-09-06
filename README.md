# codebase-course-cn

把任意代码库变成一门**中文交互式课程**，讲给零编程基础、正在学 vibe coding 的中文学员听。

基于 [zarazhangrui/codebase-to-course](https://github.com/zarazhangrui/codebase-to-course) 改造。
原版在 `upstream/`，只读不改。

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
git clone <this-repo> codebase-course-cn
cd codebase-course-cn
node scripts/install.mjs
```

装到 `~/.claude/skills/codebase-course-cn/`，然后**新开一个 Claude Code 会话**就能用。
只复制 `SKILL.md`、`references/`、`scripts/`；`upstream/`、`output/`、`examples/`、`.git` 不会被带过去。

```bash
node scripts/install.mjs --dry-run          # 先看会复制什么
node scripts/install.mjs --target <dir>     # 装到别处
```

装完在任意目录说“把这个项目做成课程”，或者直接 `/codebase-course-cn`。

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
| `scripts/validate.mjs` | 22 项校验，含代码块逐字比对、中文字数、标点、数量词清单 |
| `scripts/fetch-fonts.mjs` | 重新抓取自托管字体（霞鹜文楷 + JetBrains Mono，均为 OFL 1.1） |
| `scripts/measure-fonts.mjs` | 用真实 Chrome 量一门课实际下载多少字体 |
| `scripts/test-output-task.mjs` | 输出题交互引擎的功能测试 |

## 目录

```
SKILL.md              给模型的主指令（中文，≤500 行）
references/           内容原则、交互元素规范、设计系统、翻车清单、字体
scripts/              构建与校验（Node，零依赖，跨平台）
examples/todo-api/    贯穿全程的示例代码库（Express 待办 API，约 340 行）
output/               生成的课程（baseline / baseline-v2 / v1）
upstream/             原版仓库，只读
```

## 授权

课程代码本身沿用上游授权。随附字体：
霞鹜文楷与 JetBrains Mono 均为 SIL Open Font License 1.1，
授权原文见 `references/fonts/LICENSE-*.txt`。
