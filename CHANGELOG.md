## v1.0.0-Beta1 - 2026-07-30

### 概述

**Theme Music** 独立插件首发。从 ThemeEffects 抽取音乐组件，以 `theme.music` 发布；路径、配置、缓存与主题特效完全分离。

### 变更

- 新建插件 `theme.music`（设置页 **Theme Music**，Loader `Buttons:101`）
- 播放器：`assets/ucwc-music.js` / `ucwc-music.css`（apiBase → `/plugins/theme.music/…`）
- API：`ucwc-music-api.php`（list / stream / lyrics / cover；缓存于 flash `theme.music`）
- 设置保存：`theme-music-save.php` + 页内 POST；配置 `theme-music.cfg` + `theme.music.cfg`
- OTA：`versions/v1.0.0-Beta1` + `files.manifest`；`scripts/install.sh` / `theme.music.plg`
- 文档：与 ThemeEffects 双装避让说明（勿两边同时开音乐；配置不自动迁移）

### 来源能力（对齐 ThemeEffects 音乐 Beta 线）

- 仪表盘卡片 + 全站 chip、歌词、封面、跨页续播 / 手势同步 play、FLAC demuxer hard-reset 等
