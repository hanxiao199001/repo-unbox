# 数据流演示 `kc-flow`

一排角色，数据在他们之间一步步移动，学员自己点“下一步”控制节奏。**全课至少出现一次。**

```html
<div class="kc-flow" data-kc-steps='[
  {"actor":"kc-flow-{模块slug}-you","text":"你在输入框里打了“买牛奶”，点了添加。"},
  {"actor":"kc-flow-{模块slug}-app","text":"页面先自己看一眼：标题不是空的，可以发。","from":"kc-flow-{模块slug}-you","to":"kc-flow-{模块slug}-app"},
  {"actor":"kc-flow-{模块slug}-server","text":"请求过网线到了服务器，走的是 POST /todos 这条路。","from":"kc-flow-{模块slug}-app","to":"kc-flow-{模块slug}-server"},
  {"actor":"kc-flow-{模块slug}-store","text":"服务器自己不存东西，它把这条待办交给管硬盘的那个。","from":"kc-flow-{模块slug}-server","to":"kc-flow-{模块slug}-store"},
  {"actor":"kc-flow-{模块slug}-app","text":"写完了，页面重新问了一遍全部待办，你才看见它出现在列表里。","from":"kc-flow-{模块slug}-store","to":"kc-flow-{模块slug}-app"}
]'>
  <div class="kc-flow__actors">
    <div class="kc-flow__actor" id="kc-flow-{模块slug}-you"><span class="kc-flow__icon">🧑</span><span class="kc-flow__name">你</span></div>
    <div class="kc-flow__actor" id="kc-flow-{模块slug}-app"><span class="kc-flow__icon">▤</span><span class="kc-flow__name">app.js</span></div>
    <div class="kc-flow__actor" id="kc-flow-{模块slug}-server"><span class="kc-flow__icon">▣</span><span class="kc-flow__name">server.js</span></div>
    <div class="kc-flow__actor" id="kc-flow-{模块slug}-store"><span class="kc-flow__icon">▦</span><span class="kc-flow__name">store.js</span></div>
  </div>

  <span class="kc-flow__packet"></span>
  <p class="kc-flow__caption">点“下一步”，跟着这条待办走一遍。</p>
  <div class="kc-flow__actions">
    <button class="kc-flow__next">下一步</button>
    <button class="kc-flow__reset">重来</button>
  </div>
  <p class="kc-flow__progress"></p>
</div>
```

`kc-flow__caption` 里写的是**引导语**，“重来”会恢复到它。进度提示留空。

## 步骤序列 `data-kc-steps`

单引号属性里放一个 JSON 数组，每一步：

| 字段 | 必填 | 说明 |
|---|---|---|
| `actor` | 是 | 这一步高亮哪个角色，值是角色的 `id` |
| `text` | 是 | 这一步的说明文字 |
| `from` / `to` | 否 | 两个都给才会有数据包飞；只给一个等于不飞 |

**说明文字里不许出现英文单引号。** 一个撇号就会提前闭合属性，JSON 断在那里，
整个动画静默失效。需要引号时用中文引号。

## 数据契约

| 名字 | 用在哪 | 必填 |
|---|---|---|
| `kc-flow` + `data-kc-steps` | 根节点 | 是 |
| `kc-flow__actors` | 角色容器 | 是 |
| `kc-flow__actor` + `id` | 每个角色，**标识符整页唯一** | 是 |
| `kc-flow__icon` / `kc-flow__name` | 角色的图标与名字 | 是 |
| `kc-flow__packet` | 飞行的数据包，**留空** | 是 |
| `kc-flow__caption` | 引导语 | 是 |
| `kc-flow__next` / `kc-flow__reset` | 两个按钮 | 是 |
| `kc-flow__progress` | 进度提示，**留空** | 是 |

## 内容规则

- 角色 **3–5 个**，步骤 **5–8 步**。
- 每步说明一句话，说清楚“发生了什么”而不是“调用了什么”。
- 主线要对应学员真实做过的动作，从他点的那一下开始。
- **角色标识符必须整页唯一**：两个模块各有一个数据流演示、角色都叫“第一个”就会撞名，
  标识符中间要放模块特有的部分。

## 失败与边界

- 步骤序列解析失败、引用了不存在的角色、角色标识符重复、步骤为空
  → 页面留红色痕迹并指出原因，构建失败。**这是最容易静默失效的地方，必须硬失败。**
- 脚本未运行 → 角色和名字照常可见，说明文字停在引导语，按钮无效。
