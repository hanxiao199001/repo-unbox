# references/fonts

由 `scripts/fetch-fonts.mjs` 生成，不要手改。重新抓取：`node scripts/fetch-fonts.mjs`

| 字体 | 用途 | 来源 | 版本 |
|---|---|---|---|
| LXGW WenKai 霞鹜文楷 | 正文 + 标题 | npm `lxgw-wenkai-webfont` | 1.7.0 |
| JetBrains Mono | 代码 | npm `@fontsource/jetbrains-mono` | 5.0.20 |

两者字体本身均为 SIL Open Font License 1.1，授权原文见同目录 `LICENSE-*-OFL.txt`，随字体一起分发。
把霞鹜文楷重新打包成 webfont 的那个 npm 包另有 MIT 授权，一并收录为 `LICENSE-LXGWWenKai-webfont-packaging-MIT.txt`。

- 霞鹜文楷只打包 Regular(400) 与 Bold(700) 两个字重，各 97 个 `unicode-range` 分片。
  分片是刻意保留的：浏览器只下载页面上真正出现的字所在的分片，一门课的实际下载量远小于目录体积。
- JetBrains Mono 只打包 latin 子集的 400 与 700，不含斜体。
- `fonts.css` 由上游各字重的 CSS 拼接而成，仅把 `./files/` 路径改写为同目录相对路径。

字体文件：196 个，共 8.86 MB。
抓取日期：2026-09-05
