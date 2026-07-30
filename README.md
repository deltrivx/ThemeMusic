# Theme Music

独立的 **Unraid WebGUI 音乐插件**（插件 id：`theme.music`）。

从 [ThemeEffects](https://github.com/deltrivx/ThemeEffects) 音乐组件拆出，路径 / 配置 / 缓存完全独立。  
**本阶段 ThemeEffects 内的音乐代码仍保留**；请勿在两边同时开启音乐。

## 功能（v1.0.0-Beta2）

- 仪表盘音乐卡片（曲目列表 / 歌词 / 封面）
- 可选全站 mini chip（上一曲 / 播放 / 下一曲 + 当前歌词）
- 本地目录音源（`/mnt/…`，mp3 / flac / m4a / aac / ogg / opus / wav / wma）
- 同目录 `.lrc` 或自动下载歌词；封面缓存
- 跨页续播（尽力而为：会话记忆 + 手势解锁 + hard-reset 抗 demuxer 错误）

## 安装

在 Unraid **插件 → 安装插件** 粘贴：

```text
https://raw.githubusercontent.com/deltrivx/ThemeMusic/main/theme.music.plg
```

默认安装包：**v1.0.0-Beta2**（beta）。

设置入口：**设置 → 用户偏好 → Theme Music**

## 与 ThemeEffects 并存

| | Theme Music | ThemeEffects 音乐 |
|--|-------------|-------------------|
| 插件 id | `theme.music` | `theme.effects`（内置） |
| 配置 | `/boot/config/plugins/theme.music/theme-music.cfg` | `theme-effects.cfg` 内 `MUSIC_*` |
| API | `/plugins/theme.music/ucwc-music-api.php` | `/plugins/theme.effects/…` |
| 缓存 | `…/theme.music/cover-cache` 等 | `…/theme.effects/…` |

- **不要**两边同时 `MUSIC_ENABLE=yes`，否则可能双实例。
- 配置**不会**自动迁移；需在 Theme Music 设置页重新选择音乐目录。
- 主题特效侧剥离音乐将在本插件完善后另做。

## 配置项

| 键 | 说明 |
|----|------|
| `SERVICE` | `theme.music.cfg` 总开关 |
| `MUSIC_ENABLE` | 是否注入播放器 |
| `MUSIC_LOCAL_DIR` | 本地音乐根目录（`/mnt/…`） |
| `MUSIC_VOLUME` | 默认音量 0–100 |
| `MUSIC_AUTOPLAY` | 自动播放（浏览器可能拦截） |
| `MUSIC_SHUFFLE` / `MUSIC_REPEAT` | 随机 / 循环 |
| `MUSIC_DASH_ONLY` | `yes` 仅仪表盘；`no` 全站 |

## 开发 / 打包

- 源码与 OTA 包在仓库 `versions/<id>/` + `files.manifest`（sha256）。
- 安装脚本：`scripts/install.sh install v1.0.0-Beta2`
- 正式进入 GitHub 的产物走 raw 树 / Actions 惯例；**禁止**仅本地构建后上传代替云端树。

## 许可与作者

Author: **deltrivx**  
Repo: https://github.com/deltrivx/ThemeMusic
