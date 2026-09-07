# 场景题 `kc-scenario`

一段情境铺垫，加一道选择题。用在“光看题干说不清楚”的时候。
**它是选择题的外壳，不是独立元素。一个模块最多一道。**

```html
<div class="kc-scenario">
  <span class="kc-scenario__label">场景</span>
  <p class="kc-scenario__body">
    同学把项目跑起来，浏览器打开 localhost:3000 是白的。终端里最后一行写着
    <code class="kc-code" data-kc-lang="en">Error: listen EADDRINUSE: address already in use :::3000</code>。
    他上一个终端窗口还开着。
  </p>

  <div class="kc-quiz" id="kc-quiz-{模块slug}-scenario">
    <!-- 内部完全按 quiz.md 写 -->
  </div>
</div>
```

## 数据契约

| 名字 | 用在哪 | 必填 |
|---|---|---|
| `kc-scenario` | 根节点 | 是 |
| `kc-scenario__label` | 顶部的“场景”标签 | 是 |
| `kc-scenario__body` | 情境描述 | 是 |

内部的选择题遵循 `quiz.md` 的全部契约，标识符要带上模块和 `scenario`，免得和模块里
另一组选择题撞名。

## 内容规则

- 情境 **2–4 句**，必须具体：给出真实的报错文字、真实的日志行、真实的用户抱怨。
- 报错和日志用**英文原文**，一字不改，并标 `data-kc-lang="en"`。
- 情境里要埋进解题所需的线索，**不能靠猜**。
- 全是场景题会让节奏变慢，一个模块最多一道。

## 失败与边界

- 场景块内没有选择题、或场景描述为空 → 页面留红色痕迹，构建失败。
- 场景部分本身不可交互，判定与展开解释全部由内部的选择题负责。
