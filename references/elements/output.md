# 输出题 `kc-output`

要求学员用自己的话写出来。**每个模块结尾必须有一道，放在选择题之后。**

```html
<div class="kc-output" id="kc-output-{模块slug}" data-kc-kind="retell" data-kc-min="80">
  <span class="kc-output__label"></span>
  <p class="kc-output__prompt">用你自己的话说一遍：点了“添加”之后，这句话经过了哪些文件？</p>
  <textarea class="kc-output__input"></textarea>
  <p class="kc-output__meter"></p>
  <button class="kc-output__reveal">我说完了，看对照清单</button>
  <ul class="kc-output__checklist">
    <li class="kc-output__item">说出了 app.js 这个文件名，以及它负责把你打的字收起来</li>
    <li class="kc-output__item">提到了请求走的是 POST /todos 这条路</li>
    <li class="kc-output__item">说清楚了只有 store.js 会往硬盘上写</li>
  </ul>
</div>
```

**标签、字数提示、勾选框、勾选计数全部由实现填，不要手写。** 标签手写就会出现类别和文字对不上。

## 数据契约

| 名字 | 用在哪 | 必填 | 取值 |
|---|---|---|---|
| `kc-output` | 根节点 | 是 | |
| `id` | 根节点 | 是 | 页面内唯一，草稿保存靠它区分 |
| `data-kc-kind` | 根节点 | 是 | `retell` / `instruct` / `explain` |
| `data-kc-min` | 根节点 | 是 | 整数，**不得小于 60**，建议 60–120 |
| `kc-output__label` | 类别标签 | 是 | **内容留空** |
| `kc-output__prompt` | 题干 | 是 | |
| `kc-output__input` | 文本框 | 是 | |
| `kc-output__meter` | 字数提示 | 是 | **内容留空** |
| `kc-output__reveal` | 按钮 | 是 | |
| `kc-output__checklist` | 清单容器 | 是 | |
| `kc-output__item` | 清单每一项 | 是 | 只写说明文字，勾选框由实现创建 |

## 三类怎么选

| `data-kc-kind` | 标签（实现生成） | 问什么 |
|---|---|---|
| `retell` | 复述路径 | “点了那个按钮之后，数据经过了哪些文件？” |
| `instruct` | 给 AI 下指令 | “你要加一个功能。把你会对 AI 说的那句话原样写出来。” |
| `explain` | 解释给朋友听 | “你朋友问‘服务器到底是啥’，用不超过三句话讲给他听。” |

## 内容规则

- 清单 **3–4 条**，不多不少。
- 每条点名一个**具体**的东西：一个文件名、一个函数名、一个该学会的术语、一个顺序。
- **至少一条要用英文标注一个东西**：`retell` / `instruct` 点文件名或函数名；
  `explain` 点**这个概念的英文原词**（那道题本来就要求学员别用术语，逼他写文件名是和题意打架）。
- 四条都是“说清楚了顺序”“讲明白了原理”这种空话 → 不合格，学员无从自查。

## 失败与边界

- 类别不在三个值里、下限缺失或小于 60、缺标识符、清单不是 3–4 条、
  清单里没有任何英文标注 → 页面上各留一条红色痕迹，构建失败。
- 草稿只存在本机浏览器，不上传、不联网。存储被禁时静默降级，其余功能照常。
- 脚本未运行 → 文本框仍可输入，清单直接可见。
