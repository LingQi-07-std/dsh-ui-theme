# 在 DSH 插件页创建自定义设置面板

本文件给要**在插件页（侧栏 → 插件）里画自己设置面板**的插件开发者使用。
所有内容按 DSH `0.2.1-rc.2` 实测，来源是 `@deepseek-ai/dsh-client-ui-plugin-manager` 的源码与运行中的 Slot 契约。

---

## 0. 先看结论

- 插件页没有"通用配置容器"可寄生；正确做法是向宿主的 **keyed Slot** 注册组件，宿主负责页面框架（标题、图标、面包屑），你只负责 section 内容。
- 两个注册点，分工不同：

| Slot | key | 渲染位置 | 是否传 form |
|---|---|---|---|
| `plugins.bundle.config` | 包名 `@scope/pkg` | 组合包详情页，描述/配图之后、行列表之前 | **不传** |
| `plugins.row.config` | `<包名>#<行 id>` | 行详情页，点行的「配置」进入 | page 视图传 |

- 同一个组件会以两种 `view` 被调用：`summary`（行页描述位的一句话）和 `page`（完整面板）。按 `props.view` 分支。
- 面板里**不需要**画标题、图标、返回按钮——宿主已经画了。你只管 section 内部。

---

## 1. 最小可运行骨架

client 半（`lib/client.js`，`window.__ModuleLoader__.load` 工厂形式）：

```js
window.__ModuleLoader__.load({
  id: "@scope/dsh-client-ui-my-plugin",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const h = React.createElement; // 不要依赖 react/jsx-runtime 的 jsx 一定可用

    const PKG = "@scope/dsh-client-ui-my-plugin";
    const ROW_ID = "my-plugin"; // 与 cordis.patch.yml 里的行 id 一致
    const NS = "myPlugin"; // 自己的 locale 命名空间，可选

    /** 完整面板（page）与一句话摘要（summary）共用。 */
    function MyPanel(props) {
      if (props.view === "summary") return "已启用 · 背景 1"; // 纯文本，别放控件
      const state = props.form?.state;
      const values = state?.value ?? {};
      const disabled = state !== undefined && state.writable === false;
      return h("div", { className: "my-panel" }, [
        h("h3", { className: "my-panel-title", key: "t" }, "外观"),
        h("p", { className: "my-panel-hint", key: "d" }, "选择界面背景，点击立即生效。"),
        h("label", { className: "my-field", key: "f" }, [
          h("span", { key: "l" }, "背景"),
          h("input", {
            key: "i",
            type: "text",
            value: values.background ?? "bg1",
            disabled,
            onChange: (event) => {
              // 行页给的 form 是 { state, mutate }；bundle 页见第 4 节
              props.form?.mutate(
                [{ op: "set", path: ["background"], value: event.target.value }],
                state?.revision,
              );
            },
          }),
        ]),
      ]);
    }

    function apply(ctx) {
      // 行页：有 form
      ctx.effect(() => ctx.slots.inject("plugins.row.config", () => ctx.slots.register({
        name: "plugins.row.config",
        key: `${PKG}#${ROW_ID}`,
      }, MyPanel)), "my-plugin: row panel");

      // 组合包页：没有 form，读数方式见第 4.2 节
      ctx.effect(() => ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
        name: "plugins.bundle.config",
        key: PKG,
      }, MyPanel)), "my-plugin: bundle panel");
    }

    exports.apply = apply;
    exports.inject = ["slots", "locale"]; // 只声明用到的
    return module.exports;
  },
});
```

配套 `package.json` 必须有 `dsh.bundle.patch` 与 `dsh.client`：

```json
{
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "inject": [], "platform": "web" }
  }
}
```

`cordis.patch.yml` 里声明行（行 id 必须与上面 `ROW_ID` 一致）：

```yaml
- insert:
    - id: my-plugin
      name: "@scope/dsh-client-ui-my-plugin"
```

---

## 2. 宿主是怎么画的（理解这点才不会踩坑）

1. 宿主的插件页把这三个 keyed Slot 声明为自己的 children：`plugins.bundle.config`、`plugins.row.config`、`plugins.bundle.activation`。
2. 组合包详情页：只要槽里有这个包名的 key，就渲染
   `<section data-plugin-config class="detailSection">`，里面 `renderSlot("plugins.bundle.config", { view: "page" }, { entryKey: 包名 })`。
3. 行列表里，只要槽里有 `<包名>#<行 id>`，该行就多一个「配置」按钮；点进去是行详情页。
4. 行详情页：页头画行标题（`行 meta.title`，没有就用模块名）、模块名、描述；描述位在行没有 `description` 时会用 `renderSlot("plugins.row.config", { view: "summary" })`；随后
   `<section data-plugin-config>` 里 `renderSlot("plugins.row.config", { view: "page", form }, { entryKey })`。
5. 页面容器固定：最大宽 960px，左右 `clamp(24px, 4vw, 48px)`，块间距 32px；`detailSection` 自身是竖向 flex、间距 12px，**不自带标题**。

所以：行页和包页的 section 是同一块视觉区域，你的组件必须自带"区块标题 + 说明 + 内容"的节奏。

---

## 3. 组件契约（props）

宿主只保证两个 props：

```ts
interface PluginPanelProps {
  view: 'summary' | 'page'
  form?: ConfigPageForm
}
```

- `view === "summary"`：只返回**一句话或内联节点**。它会被渲染在行页描述位（包页不渲染 summary）。
- `view === "page"`：完整面板。
- `form`：**只有行页（`plugins.row.config`）的 page 视图会传**。包页（`plugins.bundle.config`）永远没有，item 页（`plugins.item`）有。

`form` 的形状（不是 store，是一次性快照加写函数）：

```ts
form = {
  state: {
    status: "loading" | "ready" | "unavailable",
    value: { /* 解析后的配置 */ },
    base: { /* 继承/默认值 */ },
    user: { /* 用户显式覆盖 */ },
    revision: 12,
    writable: true,
  },
  mutate(ops, expectedRevision) => Promise<boolean>,
}
```

宿主页面在配置变化时会重渲染，`form.state` 随之更新——不需要自己订阅。

`status` 的三个取值要分别处理：`loading` 时 `value` 可能还没有（渲染骨架或占位，不要用默认值假装已加载）；`ready` 才是真实值；`unavailable` 表示这个命名空间当前没被宿主服务，直接显示"当前不可配置"。

写值只有两种 op：

```js
await form.mutate([{ op: "set", path: ["background"], value: "bg2" }], state.revision);
await form.mutate([{ op: "unset", path: ["background"] }], state.revision);
```

- 多个字段要原子生效就放进同一个 ops 数组。
- `path` 是字段名数组；嵌套字段写成 `["appearance", "opacity"]`。
- `expectedRevision` 传读到的 `state.revision`，冲突时宿主保留你的草稿并返回 `false`。
- `mutate` 返回 `false` 时**不要**假装成功：回滚乐观更新并显示错误。
- `state.writable === false` 时控件要禁用并说明（部署把设置存成只读）。

---

## 4. 读配置：三种场景

### 4.1 行页（有 form）——首选

```js
const state = props.form?.state;
const values = state?.value ?? {};
```

这是唯一的真源。不要另外读 cookie / localStorage 来驱动控件，否则会出现"配置页显示 A，界面是 B"。

### 4.2 组合包页（没有 form）

包页不传 form，但可以拿同一份表单。**在 `apply(ctx)` 里取一次，用闭包传给组件**（组件内部没有 `ctx` 可用，也不要每次渲染都取）：

```js
const forms = ctx.get("configForms"); // ui-settings 注册的公开 Client 服务
const form = forms?.get(ROW_ID);      // 行 id 就是命名空间
```

它是真正的 store：

```js
form.getSnapshot()   // 与 form.state 同结构
form.subscribe(fn)   // 返回退订函数
form.mutate(ops, revision)
```

React 里用：

```js
const snapshot = React.useSyncExternalStore(
  form !== undefined ? form.subscribe.bind(form) : () => () => {},
  () => form?.getSnapshot(),
  () => form?.getSnapshot(),
);
```

`ctx.get("configForms")` 可能取不到（宿主变体/时序），必须判空。取不到时：

- 只读展示 + 一句"在当前版本的 DSH 上请到行的配置页修改"，或者
- 退回自己的持久化（cookie / host 路由），但**必须**和行页共享同一份数据，否则两页会打架。

### 4.3 item 页（`plugins.item`，官方插件卡片）

用 `props.form`，同 4.1；`view === "summary"` 用来给卡片渲染一句话。

---

## 5. 页面结构规范

按下面的层级组织，观感才和官方插件页一致：

```
section（宿主提供，flex column，gap 12）
├─ 区块标题     14px / 500 / 20px 行高，color: var(--dsw-alias-label-primary)
├─ 区块说明     12.5~13px / 18px 行高，color: var(--dsw-alias-label-tertiary)
├─ 内容区       flex column，gap 8~12
└─ 提示条       仅在错误/警告时出现
```

多个分区之间由宿主的 `detailSections` 提供 32px 间距；**你自己不要再套外层大卡片**，否则会出现"卡中卡"。

### 5.1 视觉 token 速查（全部来自官方主题，自动跟随亮暗）

| 用途 | 取值 |
|---|---|
| 主文字 / 次文字 / 辅助 | `--dsw-alias-label-primary` / `-secondary` / `-tertiary` |
| 页面/卡片底色 | `--dsw-alias-bg-base`、`-bg-layer-1/2/3` |
| 细边框 | `0.5px solid var(--dsw-alias-border-l1 / l2 / l3 / l4)` |
| 品牌强调 | `--dsw-alias-brand-primary`、`--dsw-alias-state-business-primary` |
| 成功 / 警告 / 错误 | `--dsw-alias-state-success-primary`、`--dsw-alias-state-warn-primary/-tertiary`、`--dsw-alias-state-error-primary` |
| 悬停 | `--dsw-alias-interactive-bg-hover` |
| 圆角 | `--dsw-radius-xs` 4 / `-sm` 8 / `-md` 12 / `-lg` 16 / `-xl` 20 |
| 阴影 | `--dsw-shadow-lv1/2/3`、`--dsw-elevation-soft/panel/prominent` |
| 等宽字体 | `var(--ds-font-family-code)` |
| 焦点环 | `2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))` |
| 动效 | `--ds-transition-duration-fast`(.1s) / `-duration`(.2s) / `-duration-slow`(.3s) |

### 5.2 官方控件尺寸（照抄即可）

| 控件 | 规格 |
|---|---|
| 输入框 | 高 40，`radius-md`，`0.5px border-l4`，底 `bg-layer-3`，左右内边距 14，字号 13 |
| 输入框聚焦 | 边框换 `state-business-primary`，再加 `inset 0 0 0 .5px` 同色 |
| 按钮 | 高 32，`radius-md`，左右 12，字号 13 |
| 危险按钮 | 文字/边框用 `state-error-primary`，悬停底色 `color-mix(error 8%, transparent)` |
| 事实行 | 每行底边 `0.5px border-l2`，最小高 44；左 13px 二级色，右 13px 右对齐 |
| 代码片段 | 底 `bg-module-platform`，圆角 4，`padding: 2px 6px`，等宽 12px |
| 警告条 | 底 `state-warn-tertiary`，圆角 `md`，`padding: 10px 12px`，12px/18px |
| 成功条 | 底 `color-mix(success 10%, transparent)`，圆角 `md`，`padding: 8px 12px` |

样式注入（ModuleLoader 形式，没有 `styles.insert`）：

```js
const style = document.createElement("style");
style.dataset.pluginCss = "my-plugin";
style.textContent = `
  .my-panel { display: flex; flex-direction: column; gap: 12px; }
  .my-panel-title { margin: 0; font-size: 14px; font-weight: 500; line-height: 20px; }
  .my-panel-hint { margin: 0; font-size: 12.5px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
  .my-field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
  .my-field input { height: 40px; border: .5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md);
    background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); padding: 0 14px;
    font: inherit; font-size: 13px; outline: none; }
  .my-field input:focus { border-color: var(--dsw-alias-state-business-primary);
    box-shadow: inset 0 0 0 .5px var(--dsw-alias-state-business-primary); }
`;
document.head.append(style);
```

---

## 6. summary 视图的规则

`summary` 只在行页描述位出现（行没有 `description` 时），也可能出现在官方插件卡片上。

- 只返回**纯文本**或内联文本节点，例如 `"背景 1 · 面板不透明 · 随机 4 张"`。
- 不要返回按钮、开关、选择器——那会让行页描述区变成一排控件。
- 需要可编辑的控件放进 `page`。

---

## 7. host 半的 Config（让配置持久化）

面板读写的 `value` 就是 host 半导出的 `Config` 投影。

```js
// lib/index.js
import Schema from "@deepseek-ai/schemastery";

export const Config = Schema.object({
  enabled: Schema.boolean().default(true),
  background: Schema.string().default("bg1"),        // 别用 union 枚举夹自定义值
  randomBg: Schema.boolean().default(false),
  selected: Schema.array(Schema.string()).default([]),
  opacity: Schema.union(["opaque", "glass"]).default("opaque"),
  strength: Schema.number().default(22),
});
```

- 命名空间 = **行 id**（如 `my-plugin`），不是包名。
- 值写进 profile 的 `cordis.patch.yml` 中该行的 `config`，重启保留。
- 字段默认值即"恢复默认"的参照：`state.base` 是继承/默认，`state.user` 是用户覆盖。
- host 半改动需要重启；只改 client bundle 可等 HMR。
- 路径写错（比如用了不存在的字段）不会报错，只会被 schema 丢弃——写完核对 `state.user`。

---

## 8. 常见坑（逐条对应真实故障）

1. **包页拿不到 form**：`plugins.bundle.config` 的 renderSlot 只传 `{ view: "page" }`，`props.form` 是 `undefined`，直接 `props.form.mutate(...)` 会抛 TypeError。用第 4.2 节。
2. **把 `form` 当 store 用**：行页给的是 `{ state, mutate }`，没有 `getSnapshot/subscribe`。不要把 `useSyncExternalStore` 套在它上面。
3. **summary 里塞控件**：行页描述位会被撑成工具栏。
4. **require `@deepseek-ai/dsh-client-ui-primitives` 或其他 Harness Client 包**：0.2.1 起第三方插件禁止，元素类型会是 `undefined`，整条 slot 静默消失（React #130）。原生元素自己画。
5. **`react/jsx-runtime` 的 `jsx/jsxs` 不一定可用**：要么用 `React.createElement`，要么在工厂开头做幂等 shim。
6. **组件函数名小写**：React 当内置标签，`React #130`，面板不出现。
7. **用 portal / 向上找宿主 DOM**：0.2.1 的类名是构建哈希，随时会变。组件必须自包含，浮层直接渲染在返回值里。
8. **自己再套一层大卡片**：宿主的 `detailSection` 已经是内容区，嵌套会显得厚重。
9. **用 `background` 的 union 枚举存 `custom:<id>`**：schema 校验会拒绝，值被丢弃；这类字段一律 `Schema.string()`。
10. **控件先改本地状态、再写配置、失败不提示**：表现为"刷新后回到旧值"。写操作要等 `mutate` 结果，失败回滚并显示内联错误。
11. **行页标题是模块名**：`row.meta.title` 缺省时宿主显示 `moduleName`。要么接受，要么在自己的 section 顶部再画一个 14px 的区块标题把语义补回来。
12. **包关闭后控件消失**：`plugins.*.config` 的注册只在 bundle 启用期间存在，这是预期行为，不是 bug。
13. **全局选择器**：写 `.panel`、`[class*='card']` 这类宽泛选择器会误伤宿主和其他插件；所有样式挂在你自己独有的类名前缀上。
14. **原生 `<select>` 直接裸用**：会和官方视觉割裂，至少补齐高度、圆角、边框、底色（见 5.2）。
15. **key 写错**：`plugins.bundle.config` 的 key 必须与 `package.json` 的 `name` **逐字符一致**；`plugins.row.config` 的 key 必须是 `<包名>#<cordis.patch.yml 里的行 id>`。写错不会报错，只是面板永远不出现。
16. **跳过 `ctx.slots.inject` 直接 register**：宿主页面的 `main` 注册把这两个 Slot 声明为 children，`inject` 会等它们就绪；直接 register 在时序上能过，但失去了延迟声明与销毁保护，热重载后容易变成孤儿条目。

---

## 9. 交付前自检

- [ ] 行页点「配置」能进入；包页能看到自己的 section。
- [ ] `summary` 是一句话，不是控件。
- [ ] 行页改值后，刷新页面仍在；包页与行页显示一致。
- [ ] `state.writable === false` 时控件禁用并有说明。
- [ ] 写入失败（拔网/只读）有可见提示，且 UI 回到旧值。
- [ ] 亮色、暗色各看一遍，没有写死颜色。
- [ ] 侧栏宽度 280 / 420 两档不破版；键盘 Tab 可达，焦点环可见。
- [ ] `node --check lib/client.js` 通过；控制台没有 React #130。
- [ ] 只改了 client 半 → 可等 HMR；改了 host 半或 `package.json` → 重启 DSH 再验。

---

## 10. 参考实现

本包（`@dsh-external/dsh-client-ui-theme-bluearchive`）的 `lib/client.js` 里有两处可直接对照：

- `ctx.slots.inject("plugins.bundle.config" / "plugins.row.config", …)`：注册与 key 的写法。
- `AronaRowConfig`：一个组件同时服务 `summary` / `page`，演示 `form` 的判空与两视图分支。

它的背景卡片（`AronaCard`）也是"网格选择 + 上传 + 开关"的完整例子。
