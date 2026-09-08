# 图示 `kc-figure`

一张图加一行说明。截图、示意图、界面照片都走这一个元素。

```html
<figure class="kc-figure">
  <img class="kc-figure__image" src="demo-screenshot.png"
       alt="SIGNAL LOG 主页：左侧是发射表单，右侧是三条已提交的留言，每条带信号强度">
  <figcaption class="kc-figure__caption">这是它在本机真实跑起来之后截的，三条留言是我自己发的。</figcaption>
</figure>
```

**不许给 `<img>` 写内联 `style`。** 样式全在 `styles.css` 里，内联会让一门课里的图各长各的样。校验会卡。

## 数据契约

| 名字 | 必填 | 说明 |
|---|---|---|
| `kc-figure`（`<figure>`） | 是 | 根节点 |
| `kc-figure__image`（`<img>`） | 是 | |
| `src` | 是 | **课程目录内的相对路径**，不许外网地址 |
| `alt` | 是 | 图里**有什么** |
| `kc-figure__caption`（`<figcaption>`） | 是 | 这张图**为什么在这儿**，一行 |

## 内容规则

- **`alt` 和说明不是一回事，两句都要写。**
  `alt` 描述图里有什么（"左侧是发射表单，右侧是三条留言"）；
  说明讲它为什么在这儿（"这是它在本机真实跑起来之后截的"）。
- 说明一行。要写两句以上，说明那些话该进正文，不该当图注。
- **截图必须是真的跑出来截的。** 跑不起来就别放图，改用文字描述界面。
  **绝不许编造截图，也绝不许假装自己跑过。**
- 图片文件放课程目录根下，`src` 写文件名即可（模块 HTML 会被拼进 `index.html`，
  **不要写 `../`**）。

## 失败与边界

- `<img>` 带内联 `style`、不在 `kc-figure` 里、缺 `alt`、缺说明 → 构建失败。
- `src` 指向外网 → "零外部请求"检查卡住；文件不存在 → "local assets exist" 卡住。
- 脚本未运行 → 图和说明照常显示。
