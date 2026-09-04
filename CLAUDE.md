# codebase-course-cn

把任意代码库变成给**中国 web 编程小白**看的中英双语交互式课程。
基于 zarazhangrui/codebase-to-course 改造（原版在 upstream/，只读，不改）。

## 目标学员
中文母语，零编程基础，正在学 web coding。英文是和技术并列的第一道障碍。
目标不是成为工程师，而是：看懂代码、看懂英文报错、能用准确的术语指挥 AI。

## 与原版的核心差异（不可妥协）
1. 语言关是第一原则：代码里的英文单词本身要被解释，不只是概念
2. 术语三层对照：英文原词 / 直译词义 / 国内工程师叫法
3. 每个模块结尾给出"你可以这样对 AI 说"的中英双语指令示例
4. 无 Google Fonts、无外部 CDN，国内离线可开
5. 构建脚本用 Node/Python，不依赖 bash（学员多为 Windows）
6. 不依赖 Claude Code 特有能力（子 agent 等），需在 Codex CLI 和 OpenCode+DeepSeek 上可用

## 工作原则
- 每次改动后用 examples/ 里的代码库重新生成课程验证
- 需要"聪明"的逻辑留在 SKILL.md，需要"稳定"的逻辑写进 scripts/
- SKILL.md 控制在 500 行内

## 仓库布局
- `upstream/`  原版仓库（只读基线，不修改）
- `SKILL.md`   我们的 skill（当前 = 原版副本，待改造）
- `references/` 我们的参考文件（当前 = 原版副本，待改造）
- `scripts/`   稳定的构建/校验脚本（Node/Python，跨平台）
- `examples/todo-api/` 贯穿全程的目标代码库（Express 待办 API + 浏览器前端，约 340 行）
- `output/baseline/` 原版 skill 未经修改生成的课程（对照基线，不再改动）
