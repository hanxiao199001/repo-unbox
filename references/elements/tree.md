# 文件树 `kc-tree`

带说明的目录树，替代一段“这个文件干什么、那个文件干什么”的文字罗列。

```html
<div class="kc-tree">
  <div class="kc-tree__dir">
    <code class="kc-tree__name" data-kc-lang="en">src/</code>
    <span class="kc-tree__note">代码都在这儿，外面那些是配置和说明。</span>
  </div>
  <div class="kc-tree__children">
    <div class="kc-tree__file">
      <code class="kc-tree__name" data-kc-lang="en">server.js</code>
      <span class="kc-tree__note">大门口——启动程序，决定每种请求交给谁。</span>
    </div>
    <div class="kc-tree__file">
      <code class="kc-tree__name" data-kc-lang="en">store.js</code>
      <span class="kc-tree__note">只有它碰硬盘，数据不对的时候先来这里找。</span>
    </div>
  </div>
</div>
```

树是**全部展开的**，不做折叠——课程里的树很小，折叠只会多一次点击。

## 数据契约

| 名字 | 用在哪 | 必填 |
|---|---|---|
| `kc-tree` | 容器 | 是 |
| `kc-tree__dir` / `kc-tree__file` | 文件夹行 / 文件行 | 是 |
| `kc-tree__name` + `data-kc-lang="en"` | 名字 | 是 |
| `kc-tree__note` | 中文说明 | 是 |
| `kc-tree__children` | 子层容器 | 是 |

## 内容规则

- **总行数不超过 12**。真实项目的完整目录树对零基础学员是噪音，只列这门课会讲到的。
- 每一行都要有说明，**没有说明的行就不该出现在树里**。
- 说明用角色化的语言：“大门口——启动程序，决定每种请求交给谁”，比“应用入口”有用得多。
- 路径和文件名英文原样。

## 失败与边界

- 某行缺说明、或名字未标 `data-kc-lang="en"` → 页面留红色痕迹，构建失败。
- 超过 12 行 → 构建时提示。
