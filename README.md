# 主题音乐（Theme Music）

独立的 **Unraid WebGUI 音乐插件**（插件 id：`theme.music`）。

从 [ThemeEffects](https://github.com/deltrivx/ThemeEffects) 音乐组件拆出，路径 / 配置 / 缓存完全独立。  
自 **ThemeEffects v2.6.0** 起主题侧已清除全部音乐代码；音乐仅由本插件提供。

## 功能

- **运行模式**三选一：音乐卡片（仅仪表盘）/ 音乐胶囊（全站）/ 卡片+胶囊（全站）
- 仪表盘音乐卡片（曲目列表 / 歌词 / 封面；左右固定宽）
- 全站 mini 胶囊（上一曲 / 播放 / 下一曲 + 当前歌词）
- 本地目录音源（`/mnt/…`，mp3 / flac / m4a / aac / ogg / opus / wav / wma）
- 同目录 `.lrc` 或自动下载歌词；封面缓存
- 跨页续播（尽力而为）
- 设置页标题「主题音乐」+ 标题后**总开关**（`SERVICE`）；选模式并「应用」后开启播放

## 安装

在 Unraid **插件 → 安装插件** 粘贴：

```text
https://raw.githubusercontent.com/deltrivx/ThemeMusic/main/theme.music.plg
```

默认安装包以仓库 `theme.music.plg` / `versions/index.json` 为准。

设置入口：**设置 → 用户偏好 → 主题音乐**

## 配置路径

| | 路径 |
|--|------|
| 插件 id | `theme.music` |
| 音乐配置 | `/boot/config/plugins/theme.music/theme-music.cfg`（`MUSIC_RUN_MODE` 等） |
| 总开关 | `/boot/config/plugins/theme.music/theme.music.cfg`（`SERVICE`） |
| API | `/plugins/theme.music/ucwc-music-api.php` |
| 缓存 | `…/theme.music/cover-cache`、`lyrics-cache` |

### 运行模式（`MUSIC_RUN_MODE`）

| 值 | 含义 |
|----|------|
| `card` | 仅仪表盘音乐卡片 |
| `chip` | 全站音乐胶囊（仪表盘也不显示卡片） |
| `both` | 仪表盘卡片 + 全站胶囊 |

关闭注入：标题后总开关（`SERVICE=disabled`）。应用任一运行模式会将 `MUSIC_ENABLE=yes`。

## 许可

与 ThemeEffects 相同的使用约定；代码以仓库为准。
