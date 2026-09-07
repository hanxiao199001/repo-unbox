# 概念卡片 `kc-cards`

一组并列的卡片，替代三项以上的项目符号列表。

```html
<div class="kc-cards">
  <div class="kc-cards__item" data-kc-accent="1">
    <span class="kc-cards__icon">◆</span>
    <p class="kc-cards__title">读</p>
    <p class="kc-cards__body">把数据取出来，比如打开页面时先问一遍后端现在有哪些待办。</p>
  </div>
  <div class="kc-cards__item" data-kc-accent="2">
    <span class="kc-cards__icon">◇</span>
    <p class="kc-cards__title">写</p>
    <p class="kc-cards__body">把新东西存进去，比如你点添加的那一下。</p>
  </div>
  <div class="kc-cards__item" data-kc-accent="3">
    <span class="kc-cards__icon">○</span>
    <p class="kc-cards__title">删</p>
    <p class="kc-cards__body">把一条记录去掉，很多项目里其实只是打个标记。</p>
  </div>
</div>
```

## 数据契约

| 名字 | 用在哪 | 必填 |
|---|---|---|
| `kc-cards` | 容器 | 是 |
| `kc-cards__item` + `data-kc-accent` | 每张卡片，颜色取 **1–5** | 是 |
| `kc-cards__icon` / `kc-cards__title` / `kc-cards__body` | 卡片三部分 | 是 |

## 内容规则

- **3–5 张**。两张用左右并排，六张以上说明该拆成两组。
- 卡片之间必须是**真正的并列关系**。有先后顺序的用编号步骤卡（`steps.md`）。
- 标题短，2–6 个字。描述 1–2 句，尽量带一个具体例子。
- **同一组内 `data-kc-accent` 不重复。**

## 失败与边界

- 颜色取值超出 1–5 → 页面留红色痕迹，构建失败。
- 少于 3 张 → 构建时提示，建议改用别的元素。
- 窄屏下自动变单列。
