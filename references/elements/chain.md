# 箭头流程 `kc-chain`

一条短的线性流程，横向排列，方块之间用箭头连。比编号步骤卡更紧凑，适合一眼扫完。

```html
<div class="kc-chain">
  <div class="kc-chain__step"><span class="kc-chain__num">1</span>你点了按钮</div>
  <span class="kc-chain__arrow">→</span>
  <div class="kc-chain__step"><span class="kc-chain__num">2</span>请求发出去</div>
  <span class="kc-chain__arrow">→</span>
  <div class="kc-chain__step"><span class="kc-chain__num">3</span>页面重新画</div>
</div>
```

箭头由你写在步骤之间，窄屏时样式会把它转成向下。

## 它和数据流演示的区别

这个是**静态图示**，一眼看完；数据流演示（`flow.md`）是学员点着一步步走的动画。
需要学员参与就用数据流演示，只是标注一下流程就用这个。

## 数据契约

| 名字 | 用在哪 | 必填 |
|---|---|---|
| `kc-chain` | 容器 | 是 |
| `kc-chain__step` | 每个方块 | 是 |
| `kc-chain__num` | 方块里的数字 | 是 |
| `kc-chain__arrow` | 箭头，写在步骤之间 | 是 |

## 内容规则

- **3–5 步**。超过 5 步横向排不下。
- 每步一句短话，越短越好，最好不超过 12 个字。
- 只用于线性流程。有分支的用架构图（`map.md`）。

## 失败与边界

- 某个方块缺数字 → 页面留红色痕迹。
- 箭头数量不等于步骤数减一、步骤超过 6 个 → 构建时提示，不失败。
