# 角色行 `kc-rolelist`

一列“图标 + 名字 + 一句话”，介绍有哪几个角色。比卡片轻，比文字罗列清楚。

```html
<div class="kc-rolelist">
  <div class="kc-rolelist__row" data-kc-accent="1">
    <span class="kc-rolelist__icon">A</span>
    <p class="kc-rolelist__name">app.js</p>
    <p class="kc-rolelist__note">收你敲的字，画页面。它不存东西，关掉标签页什么都不剩。</p>
  </div>
  <div class="kc-rolelist__row" data-kc-accent="2">
    <span class="kc-rolelist__icon">S</span>
    <p class="kc-rolelist__name">server.js</p>
    <p class="kc-rolelist__note">分诊台——按你走的那条路，把活派给对应的人。</p>
  </div>
  <div class="kc-rolelist__row" data-kc-accent="3">
    <span class="kc-rolelist__icon">T</span>
    <p class="kc-rolelist__name">store.js</p>
    <p class="kc-rolelist__note">只有它碰硬盘。</p>
  </div>
</div>
```

## 它和概念卡片的区别

卡片是并列的概念，横向铺开，每张有独立的描述段；角色行是“名单”，纵向排列，一行一个，
说明更短。介绍“系统里有谁”用角色行，讲“有哪几种模式”用卡片。

## 数据契约

| 名字 | 用在哪 | 必填 |
|---|---|---|
| `kc-rolelist` | 容器 | 是 |
| `kc-rolelist__row` + `data-kc-accent` | 每一行，颜色取 **1–5** | 是 |
| `kc-rolelist__icon` | 圆形图标 | 是 |
| `kc-rolelist__name` | 名字 | 是 |
| `kc-rolelist__note` | 说明 | 是 |

## 内容规则

- **3–5 行**。名字如果是文件名，英文原样。
- 说明一句话，讲这个角色**负责什么**。
- 常用在模块一的开场，交代“这个项目由哪几部分组成”。
- **同一个角色在全课的颜色必须一致**，并与组件群聊里的角色配色对齐：
  群聊的配色按角色在全页首次出现的顺序发号（第一个出现的用 1，第二个用 2，以此类推），
  这里的 `data-kc-accent` 照着填。

## 失败与边界

- 颜色取值超出 1–5 → 页面留红色痕迹，构建失败。
- 超过 6 行 → 构建时提示，建议改用文件树。
