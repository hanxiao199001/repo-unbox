# 编号步骤卡 `kc-steps`

一串有先后顺序的步骤，纵向排列，每步一张卡片。

```html
<div class="kc-steps">
  <div class="kc-steps__item">
    <span class="kc-steps__num">1</span>
    <p class="kc-steps__title">你点了添加</p>
    <p class="kc-steps__body">浏览器把你打的字收起来，先自己看一眼是不是空的。</p>
  </div>
  <div class="kc-steps__item">
    <span class="kc-steps__num">2</span>
    <p class="kc-steps__title">发给 server.js</p>
    <p class="kc-steps__body">走的是 POST /todos 这条路。POST 的意思是“我要新建一个”。</p>
  </div>
  <div class="kc-steps__item">
    <span class="kc-steps__num">3</span>
    <p class="kc-steps__title">页面重新问一遍</p>
    <p class="kc-steps__body">页面不自己把新待办画上去，它重新问了一遍全部——画出来的才是真的。</p>
  </div>
</div>
```

**编号由你写在 `kc-steps__num` 里，实现不自动生成也不改写。**
课程里常需要从 1 以外的数字起步，或者跳号强调。

## 数据契约

| 名字 | 用在哪 | 必填 |
|---|---|---|
| `kc-steps` | 容器 | 是 |
| `kc-steps__item` | 每一步 | 是 |
| `kc-steps__num` | 圆形数字 | 是 |
| `kc-steps__title` / `kc-steps__body` | 标题与说明 | 是 |

## 内容规则

- **3–6 步**。顺序必须是真实的时间或因果顺序。
- 标题是“发生了什么”，说明是“为什么”或“注意什么”。
- 步骤里出现的文件名、函数名英文原样。

## 失败与边界

- 编号缺失 → 页面留红色痕迹，构建失败。
- 只有 1–2 步 → 构建时提示，建议直接写成正文。
