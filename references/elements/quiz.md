# 选择题 `kc-quiz`

一组单选题，答完一起对答案。**每个模块至少一道，放在内容之后、输出题之前当热身。**

```html
<div class="kc-quiz" id="kc-quiz-{模块slug}">
  <div class="kc-quiz__question" data-kc-answer="b"
       data-kc-right="对。因为只有 store.js 碰硬盘，数据不对的时候就该先去那里看。"
       data-kc-wrong="再看一眼提交函数的最后一行——页面不是自己把新待办画上去的，它是重新问了一遍。">
    <p class="kc-quiz__prompt">用户说“加了待办刷新就没了”，你先去哪个文件找？</p>
    <button class="kc-quiz__option" data-kc-value="a"><span class="kc-quiz__marker"></span>app.js，因为页面是它画的</button>
    <button class="kc-quiz__option" data-kc-value="b"><span class="kc-quiz__marker"></span>store.js，因为只有它往硬盘上写</button>
    <button class="kc-quiz__option" data-kc-value="c"><span class="kc-quiz__marker"></span>server.js，因为请求是它收的</button>
    <div class="kc-quiz__feedback"></div>
  </div>

  <div class="kc-quiz__actions">
    <button class="kc-quiz__check">看看答案</button>
    <button class="kc-quiz__reset">再来一次</button>
  </div>
</div>
```

解释区留空，由实现按对错填。

## 数据契约

| 名字 | 用在哪 | 必填 |
|---|---|---|
| `kc-quiz` + `id` | 根节点 | 是 |
| `kc-quiz__question` | 每道题 | 是 |
| `data-kc-answer` | 每道题，值等于正确选项的 `data-kc-value` | 是 |
| `data-kc-right` / `data-kc-wrong` | 每道题的两段解释 | 是 |
| `kc-quiz__prompt` | 题干 | 是 |
| `kc-quiz__option` + `data-kc-value` | 每个选项 | 是 |
| `kc-quiz__marker` | 选项左边的圆点 | 是 |
| `kc-quiz__feedback` | 解释区，**留空** | 是 |
| `kc-quiz__check` / `kc-quiz__reset` | 两个按钮 | 是 |

## 内容规则

- 一个模块一组，**3–5 道**；选项 2–4 个，长度相近，不许有明显凑数的荒唐选项。
- **考应用，不考记忆。** 按价值从高到低：给一个没见过的新情况让他解决；
  调试场景“用户说 X 坏了，你先去哪儿找”；架构决策“这段逻辑放前端还是后端”；追踪“数据走了哪条路”。
- **不许考**：术语定义（那是术语气泡的活）、文件名背诵、语法细节、往上翻一屏就能抄到答案的东西。
- **答错的解释不许只说“错了，答案是 B”**，要说明该往哪儿想，而且要教到新东西。
- 语气不带评判。**页面上不许出现任何分数。**

## 失败与边界

- 没标正确答案、答案对不上任何选项、缺解释文字 → 页面上留红色痕迹，构建失败。
- 未作答的题在对答案时不算错，只是没有结果——不惩罚跳过。
- 脚本未运行 → 题目和选项照常可读，解释直接可见（宁可剧透，也不要变成死页面）。
