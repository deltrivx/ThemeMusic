# Theme Music Changelog

## v1.0.0-Beta2 — 2026-07-30 (`2026.07.30b`)

### 设置页 / 应用

- Unraid `form markdown="1"`：`Label:` / `: control` → 标准 `dt`/`dd` 行（对齐 ThemeEffects 音乐区，修复整行铺满）
- 应用按钮：监听 change/input，在 BodyInlineJS 将 `input[value=应用]` 禁用且跳过 `input.lock` 时自行解锁并允许原生 POST 保存
- 新增 `assets/theme-music-settings.css`：`--tm-ctrl-w` 路径框宽度、select 样式
- 保存后 `?applied=1` 展示成功提示；`install.sh` OTA/卸载纳入 settings CSS

## v1.0.0-Beta1 — 2026-07-30 (`2026.07.30a`)

### 首发

- 独立插件 `theme.music`：从 ThemeEffects 抽取音乐组件
- 仪表盘卡片 + 全站 mini chip；本地目录音源；LRC / 封面缓存；跨页续播尽力而为
- 设置：`ThemeMusic.page`；注入：`ThemeMusic_Loader.page`（Buttons:101）
- API：`ucwc-music-api.php`；可选 AJAX：`theme-music-save.php`
- OTA：`versions/v1.0.0-Beta1` + `files.manifest`
- 与 ThemeEffects 路径/配置/缓存完全独立；文档提示勿双开音乐
