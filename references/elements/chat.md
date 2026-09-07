# 组件群聊 `kc-chat`

把代码里各部分之间的协作，演成一段微信群聊。**全课至少出现一次。**

```html
<div class="kc-chat" id="kc-chat-{模块slug}">
  <div class="kc-chat__stream">
    <div class="kc-chat__message" data-kc-speaker="app.js">
      <span class="kc-chat__avatar">A</span>
      <div class="kc-chat__bubble">
        <p class="kc-chat__speaker">app.js</p>
        我这边有人打了“买牛奶”，还点了添加。我先拦一下，标题是空的我就不发。
      </div>
    </div>
    <div class="kc-chat__message" data-kc-speaker="server.js">
      <span class="kc-chat__avatar">S</span>
      <div class="kc-chat__bubble">
        <p class="kc-chat__speaker">server.js</p>
        收到，POST /todos。我不存东西，我只管把活派下去。
      </div>
    </div>
  </div>

  <div class="kc-chat__typing"></div>
  <div class="kc-chat__actions">
    <button class="kc-chat__next">下一条</button>
    <button class="kc-chat__all">全部播放</button>
    <button class="kc-chat__replay">重放</button>
  </div>
  <p class="kc-chat__progress"></p>
</div>
```

打字指示留空，进度提示留空，两样都由实现填。
**头像从消息里推断，不要在打字指示里重复写一遍。**

## 数据契约

| 名字 | 用在哪 | 必填 |
|---|---|---|
| `kc-chat` + `id` | 根节点 | 是 |
| `kc-chat__stream` | 消息列表 | 是 |
| `kc-chat__message` + `data-kc-speaker` | 每条消息 | 是 |
| `kc-chat__avatar` | 头像，一个字或一个表情 | 是 |
| `kc-chat__bubble` / `kc-chat__speaker` | 气泡与发言者名 | 是 |
| `kc-chat__typing` | 打字指示，**留空** | 是 |
| `kc-chat__next` / `kc-chat__all` / `kc-chat__replay` | 三个按钮 | 是 |
| `kc-chat__progress` | 进度提示，**留空** | 是 |

## 内容规则

- **5–8 条**。少于 5 条撑不起，多于 8 条学员会失去耐心。
- 每条一到两句，**用角色的口吻说话**，不要写成旁白。
- 角色名用代码里的真实名字（文件名、函数名），英文原样，不翻译。
- 消息内容是中文，但里面提到的标识符、状态码、报错保持英文。
- 同一个 `data-kc-speaker` 的所有消息，头像必须一致。
- 配色由实现按全页首次出现顺序分配，同一个角色在任何模块里都是同一个颜色；
  角色行（`rolelist.md`）里手写的 `data-kc-accent` 应当与这个顺序对齐。

## 失败与边界

- 缺标识符、缺“下一条”或“重放”按钮、消息没有声明发言者 → 页面留红色痕迹，构建失败。
- 走到末尾再点“下一条”无效果，不报错。
- 脚本未运行 → 所有消息直接全部可见，按钮无效但不消失。
