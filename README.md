# 阿罗娜主题（开发版）

DSH Web GUI 的蓝档案·阿罗娜主题：亮/暗双套配色、壁纸与自定义背景、玻璃输入区、标题栏贴图、内嵌字体与粗体增强，以及一整套插件设置卡片。

- 包名：`@dsh-external/dsh-client-ui-theme-bluearchive`
- 版本：`0.2.0-dev`
- 适配：DSH `>=0.2.0-rc.2 <0.3.0`（桌面版 0.2.1-rc.2 实测）

## 安装

1. 打开 DSH 侧栏「插件」→「添加插件」
2. 填入本 tgz 的完整路径（或解压后的包目录），点安装
3. 重启 DSH，在插件页确认 `ui-theme-bluearchive` 一行是开启状态

也可以让 agent 用 `plugin_manager install_bundle` 安装，`target` 填 tgz 路径。

## 开发

功能清单、目录结构、开发循环、本次修改记录与踩坑都在 [DEVELOPMENT.md](./DEVELOPMENT.md)。

改完 `lib/client.js` 后先 `node --check`，再同步到 profile 的 `node_modules` 副本（不是链接），刷新页面生效；host 半或依赖变化需要重启 DSH。
