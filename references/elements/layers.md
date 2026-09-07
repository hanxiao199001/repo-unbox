# 分层切换 `kc-layers`

同一个东西的几个层次，用标签页切换。适合讲“一层层叠上去”的递进关系。

```html
<div class="kc-layers">
  <div class="kc-layers__tabs">
    <button class="kc-layers__tab" data-kc-layer="kc-layer-{模块slug}-a" data-kc-note="这一层只有骨架：字和框都在，但一点也不好看。">骨架</button>
    <button class="kc-layers__tab" data-kc-layer="kc-layer-{模块slug}-b" data-kc-note="加上样式之后，同样的字有了轻重和留白。">加上样式</button>
    <button class="kc-layers__tab" data-kc-layer="kc-layer-{模块slug}-c" data-kc-note="加上交互之后，它才会回应你点的那一下。">加上交互</button>
  </div>

  <div class="kc-layers__panel" id="kc-layer-{模块slug}-a">只有 HTML。</div>
  <div class="kc-layers__panel" id="kc-layer-{模块slug}-b">HTML 加上 CSS。</div>
  <div class="kc-layers__panel" id="kc-layer-{模块slug}-c">HTML 加 CSS 再加 JavaScript。</div>

  <p class="kc-layers__note"></p>
</div>
```

说明文字留空，由实现按当前标签的 `data-kc-note` 填。初始显示第一层。

## 数据契约

| 名字 | 用在哪 | 必填 |
|---|---|---|
| `kc-layers` | 根节点 | 是 |
| `kc-layers__tabs` | 标签容器 | 是 |
| `kc-layers__tab` + `data-kc-layer` + `data-kc-note` | 每个标签 | 是 |
| `kc-layers__panel` + `id` | 每一层，**标识符整页唯一** | 是 |
| `kc-layers__note` | 说明文字，**留空** | 是 |

标签与层必须**一一对应，双向可查**：每个标签指向一个真实存在的层，每一层都有标签指向它。

## 内容规则

- **2–4 层**。超过 4 层就不是递进，是列表了，那种用卡片。
- 层的顺序必须是真正的递进关系，不是并列关系。
- 说明一句话，讲“这一层加上了什么、解决了什么”。
- **层标识符整页唯一**，中间要带模块特有的部分。

## 失败与边界

- 标签指向不存在的层、有层没有任何标签指向、层标识符重复
  → 页面留红色痕迹，构建失败。
- 脚本未运行 → **所有层依次全部可见**（退化成一个纵向列表），而不是只剩第一层。
