# 架构图 `kc-map`

把系统里的角色画成分区的方块图，点一个方块看它负责什么。

```html
<div class="kc-map">
  <div class="kc-map__zone">
    <p class="kc-map__zone-name">浏览器</p>
    <button class="kc-map__node" data-kc-about="它画页面，也收你敲的字。它不存东西，关掉标签页什么都不剩。">
      <span class="kc-map__icon">▤</span><span class="kc-map__name">app.js</span>
    </button>
  </div>
  <div class="kc-map__zone">
    <p class="kc-map__zone-name">服务器</p>
    <button class="kc-map__node" data-kc-about="它只管分诊：按你走的那条路，把活派给对应的人。它自己不碰硬盘。">
      <span class="kc-map__icon">▣</span><span class="kc-map__name">server.js</span>
    </button>
    <button class="kc-map__node" data-kc-about="只有它碰硬盘，所以数据不对的时候先来这里找。">
      <span class="kc-map__icon">▦</span><span class="kc-map__name">store.js</span>
    </button>
  </div>

  <p class="kc-map__about">点任意一个方块，看它负责什么</p>
</div>
```

**说明区不带标识符**，靠所属图定位，一页放两张图也不会互相干扰。
里面写的是**默认文字**，学员没点任何方块时显示它。

## 数据契约

| 名字 | 用在哪 | 必填 |
|---|---|---|
| `kc-map` | 根节点 | 是 |
| `kc-map__zone` / `kc-map__zone-name` | 每个分区与分区名 | 是 |
| `kc-map__node` + `data-kc-about` | 每个方块与它的说明 | 是 |
| `kc-map__icon` / `kc-map__name` | 方块的图标与名字 | 是 |
| `kc-map__about` | 说明区，**不带 id** | 是 |

## 内容规则

- 分区 2–4 个，方块总数 4–8 个。分区名用中文，方块名用**真实文件名**，英文原样。
- 说明 1–3 句，讲“它负责什么、不负责什么”。
  “只有它碰硬盘，所以数据不对的时候先来这里找”比“数据访问层”有用得多。

## 失败与边界

- 某方块没有说明、说明区带了标识符 → 页面留红色痕迹，构建失败。
- 高亮是排他的；再点同一个方块保持选中，不切回默认文字。
- 脚本未运行 → 图照常可见，说明区停在默认文字。
