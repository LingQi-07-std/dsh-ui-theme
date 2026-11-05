# 阿罗娜主题（蔚蓝档案）

DSH Web GUI 的蓝档案·阿罗娜主题插件：亮/暗双套配色、预设与自定义壁纸、玻璃输入区、标题栏贴图、内嵌字体与粗体增强。

| 项 | 值 |
|---|---|
| 包名 | `@dsh-external/dsh-client-ui-theme-bluearchive` |
| 版本 | `0.2.0-dev` |
| 适配 | DSH `>=0.2.0-rc.2 <0.3.0`（桌面版 `0.2.1-rc.2` 实测） |
| 平台 | Web |

## 功能

- **配色**：整套 `--dsw-alias-*` token 覆盖，亮色浅蓝白底、暗色深蓝底，跟随系统亮暗切换。
- **壁纸**：内置 `bg1` / `bg2` / `bg3`，支持上传自定义图片（存盘在 Electron 用户数据目录），可多选随机。
- **面板**：不透明 / 玻璃两档，背景层带暗化遮罩与统一色调，固定不随滚动。
- **标题栏**：不透明底色与窗口按钮同表面，贴图带亮度调节。
- **侧栏**：纹理贴图 + 角色立绘，折叠时自动隐藏；导航 hover/active 颜色替换。
- **输入区**：半透明毛玻璃 composer，青色描边；拖拽侧栏时临时关闭毛玻璃保流畅。
- **字体**：内嵌 FZLanTingYuan，粗体由浏览器合成并加同色描边，颜色随上下文变化。
- **装饰**：首屏 hero 图案、思考中鲸鱼图标、插件卡片图标。
- **角落补块**：修补会话列左上角圆角处泄露的背景。

## 安装

1. 打开 DSH 侧栏「插件」→「添加插件」
2. 填入本仓库打包出的 `tgz` 路径（或解压后的包目录）
3. 重启 DSH，在插件页确认 `ui-theme-bluearchive` 一行处于开启状态
4. 点该行的「配置」进入主题设置面板

也可以用工具安装：`plugin_manager` 的 `install_bundle`，`target` 填 tgz 路径或包名。

## 仓库说明

本仓库只纳入**运行必需文件**与**展示文档**：

```
package.json          # 包元信息（dsh.bundle / dsh.client / engines）
cordis.patch.yml      # bundle 层：向 profile 插入 ui-theme-bluearchive 行
lib/
  index.js            # host 半：背景图 HTTP API（注入 webServer）
  backgrounds.js      # 背景图存储与路由实现
  client.js           # client 半：token 覆盖、样式注入、设置面板、图标
  assets/             # 品牌 SVG 与思考鲸鱼资源
locale/
  en.json             # 插件页展示元信息
  zh.json
README.md             # 本文件
LICENSE
```

开发说明、插件页面板规范等本地文档不随仓库分发。`node_modules/`、`dist/`、`*.tgz`、日志与编辑器配置均在忽略之列。

## 开发

改完 `lib/client.js` 先做语法检查：

```powershell
node --check lib/client.js
```

再同步到 profile 的安装副本（是副本，不是链接，只改源目录不生效）：

```powershell
Copy-Item lib/client.js "$env:DSH_PROFILE_DIR/node_modules/@dsh-external/dsh-client-ui-theme-bluearchive/lib/client.js" -Force
```

只改 client 半，刷新页面或等 HMR 即可；改了 host 半、`package.json` 或 `cordis.patch.yml`，需要重启 DSH。

## 许可

MIT，见 [LICENSE](./LICENSE)。
