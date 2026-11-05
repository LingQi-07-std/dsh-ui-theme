# 阿罗娜主题插件 · 开发说明（开发版）

DSH Web GUI 主题插件：`@dsh-external/dsh-client-ui-theme-bluearchive`，版本 `0.2.0-dev`。
适配 DSH `>=0.2.0-rc.2 <0.3.0`，在 `0.2.1-rc.2` 桌面版实测。

---

## 1. 插件是什么

一个 DSH bundle 插件，由两半组成：

- **host 半**（`lib/index.js`）：在 Web 服务上注册背景图上传/删除/列出的 API
- **client 半**（`lib/client.js`）：覆盖主题色 token、注入样式、提供设置卡片、替换图标

安装后出现在插件页，行 id 为 `ui-theme-bluearchive`；开关就是这一行。

---

## 2. 功能清单

### 主题与配色
- `ctx.theme.overrideTokens("arona", …)` 覆盖整套 `--dsw-alias-*` token，亮/暗各一套
- 亮色：浅蓝白底 + 深蓝文字；暗色：深蓝底 + 浅蓝文字
- 自动跟随系统/应用亮暗切换

### 背景与壁纸
- 预设壁纸 `bg1` / `bg2` / `bg3`（内嵌在包里，`ASSETS`）
- 自定义壁纸：上传图片文件，经 host API 存盘（默认在 Electron 用户数据目录），按 `custom:<id>` 引用
- 随机背景：从多选集合里每次启动随机一张
- 面板不透明度：`opaque`（不透明）/ `glass`（玻璃）
- 背景层：`body::before` 暗化遮罩 + `body::after` 统一色调，壁纸固定不随滚动

### 标题栏
- 完全不透明底色（`--arona-surface`），与三个窗口按钮同一表面
- 标题栏贴图 `::before`，带亮度调节 `--arona-titlebar-tint`（亮色略压暗、暗色略提亮）
- 标题簇 `titleCluster` 提升层级，避免被纹理盖住

### 角落补块（corner patch）
- 修补窗口会话列左上角圆角处泄露的背景
- 形状：16×16 方块减去以右下角为圆心、半径 16 的圆（mask）
- 位置：挂在会话根容器 `Dc7z0a_root` 上，`absolute 0,0`，随布局移动，无 JS 跟随
- 颜色：侧栏底色 `--arona-corner-fill` + 侧栏纹理 `--arona-sidebar-bg`

### 侧栏
- 侧栏纹理贴图 + 底部角色立绘（mascot）
- 折叠成窄栏时隐藏 mascot
- 侧栏导航的 hover/active 颜色替换

### 输入区
- 玻璃 composer：半透明填充 + 毛玻璃 + 青色描边
- 附件卡片复用同一表面变量，避免透明穿透
- 拖拽调侧栏时临时关闭 composer 的 `backdrop-filter`（降级换流畅）

### 字体
- 内嵌 FZLanTingYuan（单一字重，4MB 级 OTF，FontFace 注册为 400）
- 粗体：浏览器合成 700 + `-webkit-text-stroke: 0.3px currentColor`
- 粗体颜色用 `color-mix(currentColor 55%, --arona-strong-ink)`：亮色更深、暗色更浅，且跟随上下文（思考区保持淡色）

### 图标与装饰
- 首屏 hero 图案替换（`conversation.hero.brand.mark`）
- 思考中鲸鱼图标（APNG mask 动画）
- 插件卡片图标
- 标题栏 / 侧栏的若干视觉细节

### 设置卡片
- 挂在设置页：主题开关、背景选择、自定义背景上传/删除、随机模式、多选、圆角装饰开关、透明度、图标替换
- 文案中英双语（`locale/en.json`、`locale/zh.json`）

---

## 3. 目录结构

```
dsh-client-ui-theme-bluearchive/
├─ package.json          # name/version/dsh.bundle.patch/dsh.client/files/engines
├─ cordis.patch.yml      # bundle 层：插入 ui-theme-bluearchive 行
├─ lib/
│  ├─ index.js           # host 半：背景图 API（webServer 注入）
│  ├─ backgrounds.js     # 背景图存储/路由实现
│  ├─ client.js          # client 半（≈6MB，内嵌字体与图库 base64）
│  └─ assets/            # 品牌 SVG、思考鲸鱼 APNG/SVG
├─ locale/
│  ├─ en.json            # 展示元信息（发现入口，必须存在）
│  └─ zh.json
├─ README.md
└─ DEVELOPMENT.md        # 本文件
```

`lib/client.js` 关键区域（按 `//#region` 分块）：
- `settings namespace`：设置默认值、背景引用、API 常量
- `assets`：内嵌 base64 贴图
- `arona-light / arona-dark token overrides`：亮暗 token 表
- `override layer`：token 注入
- `injected styles`：`ARONA_STYLE_CSS`，所有 CSS 规则
- `i18n dictionaries`
- `store + component`：设置卡片
- `apply(ctx)`：注册 token、注入样式、字体、观察器、补块、图标

---

## 4. 安装与开发流程

### 安装（给协作者）
插件页 → 添加插件 → 填 tgz 的完整路径（或包名），安装后重启 DSH。

或用工具：`plugin_manager install_bundle`，`target` 填 tgz 路径 / 包目录 / npm 包名。

### 开发循环
1. 修改 `_stage/pkgs/dsh-client-ui-theme-bluearchive/lib/client.js`
2. `node --check` 语法检查
3. 同步到 profile 的副本：
   `Copy-Item lib/client.js "$env:DSH_PROFILE_DIR/node_modules/@dsh-external/dsh-client-ui-theme-bluearchive/lib/client.js" -Force`
4. 刷新页面（host 半改动或依赖变化则重启 DSH）

> **重要**：profile 里装的是 `file:` 安装的**副本**，不是链接。只改源目录不会生效，必须同步或重装。

### 打包
```powershell
cd <包目录>
pnpm pack --pack-destination <输出目录>
```
`files` 白名单决定包里有什么；漏写会导致装上后缺文件。

### 发布约定
- 改版本号（语义化）；协作期间用 `-dev` 后缀
- `engines.dsh` 写区间，不要钉死精确版本
- 不要把 `node_modules` 打进包

---

## 5. 本次修改记录（2026-10-19）

| # | 问题 | 处理 |
|---|---|---|
| 1 | 轮次条悬停详情卡片消失 | 删除全局 `[role='tooltip'] { display:none !important }`，tooltip 恢复 |
| 2 | `**粗体**` 看不出加粗 | FontFace 由 `weight:700` 改为 `400`（让浏览器合成），加同色描边 |
| 3 | 粗体“叠字”感、颜色不随上下文 | 去掉固定色与 `paint-order`，描边改 `currentColor`，粗体色用 `color-mix` |
| 4 | 拖侧栏卡顿 | 拖拽期间关闭 composer 的 `backdrop-filter` |
| 5 | 拖侧栏左上角补块滞后 | 补块从 fixed+测量改为挂容器、随布局 |
| 6 | 补块始终被裁切 | 诊断发现唯一裁剪源是 `BynINW_centerCol`（`overflow:hidden` + 16px 左上圆角），放开它 |
| 7 | 标题两段文字发淡 | 纹理 `::before`（z-index 0）盖住普通流文字；给 `titleCluster` 提升到 `z-index:1` |
| 8 | 设置页变暗时补块仍最上层 | 补块 `z-index` 从 2147483000 降到 10（低于遮罩） |
| 9 | 补块形状错误 | 恢复“16px 方块减去右下角半径 16 圆”的 mask |
| 10 | 标题栏贴图过深/过浅 | 增加 `--arona-titlebar-tint`（亮 `/0.95`、暗 `brightness(1.15)`） |

---

## 6. 踩坑记录（改代码前必读）

1. **别用 `[role='tooltip']` 一刀切**：轮次导航详情卡片也是 tooltip。
2. **FontFace 只有一个字重时不要声明 `weight:700`**：浏览器会认为粗体已存在，关闭合成。
3. **补块类元素不要用 `fixed` + 每帧测量**：拖拽时没有事件通知，必然滞后；挂进会移动的容器最稳。
4. **裁剪不止 `overflow`**：`border-radius + overflow:hidden`、`clip-path`、`contain:paint` 都会裁。定位裁剪源用 DevTools 沿祖先链打印 computed style。
5. **`border-radius` 会裁元素自身背景，但不裁 `overflow:visible` 的子元素**。
6. **profile 里是副本**：改 `_stage` 必须同步。
7. **DSH 0.2.1 客户端模块表**：client 半不得 require 其他 Harness Client 包，图标要内联。

---

## 7. 已知限制

- 背景图上传依赖 host 半的 HTTP 路由，host 半未加载时设置卡片会提示“host 离线”。
- 粗体为浏览器合成，不同系统/字体下的观感略有差异；描边宽度 `0.3px` 是折中值。
- 补块尺寸与圆角半径绑定（16px），外壳圆角变化时需要同步调整。
- 主题大量使用 `!important` 覆盖应用样式，DSH 大版本更新后需要重新核对选择器。
