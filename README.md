# Theme Music · 主题音乐

[![最新版本](https://img.shields.io/github/v/release/deltrivx/ThemeMusic?display_name=tag&sort=semver&label=最新版本)](https://github.com/deltrivx/ThemeMusic/releases/latest)
[![Unraid](https://img.shields.io/badge/Unraid-6.12%2B-F15A2C?logo=unraid&logoColor=white)](https://unraid.net/)
[![代码许可](https://img.shields.io/badge/代码许可-MIT-2ea44f)](LICENSE)
[![文档与视觉资产](https://img.shields.io/badge/文档与视觉资产-CC%20BY--NC--SA%204.0-8a2be2)](LICENSE-ASSETS.md)

面向 Unraid WebGUI 的独立音乐播放器插件。它把本地目录或 Navidrome/OpenSubsonic 曲库原生融入仪表盘，同时提供可跨页面工作的音乐胶囊、歌词、封面、断点续播和完整的桌面/移动端配置。

> 当前正式版：**v1.1.2** · 插件 ID：`theme.music` · 最低 Unraid：**6.12.0**

## 为什么选择 Theme Music

| 能力 | 说明 |
|---|---|
| 双音源 | 读取 Unraid 本地目录，或通过 Subsonic API 接入 Navidrome/OpenSubsonic |
| 原生界面 | 仪表盘音乐卡片复用 Dynamix 卡片结构、配色、拖拽顺序与折叠行为 |
| 全站播放 | 音乐胶囊在 Unraid 页面间保持播放控制，卡片与胶囊状态双向同步 |
| 完整媒体体验 | 播放列表、搜索、排序、随机、循环、进度、音量、封面与同步/普通歌词 |
| PC / 手机分设 | 两端可独立选择运行模式、音量、自动播放、随机与循环策略 |
| 存储友好 | 播放前唤醒本地磁盘；CIFS/NFS 音源以轻量读取等待远端存储恢复 |
| 可靠升级 | flash 持久化、离线启动恢复、SHA256 差异 OTA、指定版本回滚与中文更新日志 |
| 隐私优先 | Navidrome 密码独立保存为 `0600`，不写入普通配置、前端或日志 |

## 界面与运行模式

Theme Music 只有一个状态源。卡片与胶囊是否显示完全由设置页的总开关、电脑运行模式和手机运行模式决定，不提供会造成第二套隐藏状态的“关闭磁贴”按钮。

| 模式 | 仪表盘卡片 | 全站胶囊 | 离开仪表盘后播放 |
|---|:---:|:---:|:---:|
| `card` | ✓ | — | 停止 |
| `chip` | — | ✓ | 继续 |
| `both` | ✓ | ✓ | 继续 |

手机运行模式可选择“和电脑端配置相同”，也可以独立覆盖。浏览器的自动播放策略仍可能要求首次手势确认。

## 安装

在 Unraid 中打开 **插件 → 安装插件**，粘贴：

```text
https://raw.githubusercontent.com/deltrivx/ThemeMusic/main/theme.music.plg
```

安装完成后进入 **设置 → 用户偏好 → 主题音乐**。

也可在 Unraid 终端使用独立安装器：

```bash
curl -fsSL https://raw.githubusercontent.com/deltrivx/ThemeMusic/main/scripts/install.sh | sh
```

指定版本与模式：

```bash
curl -fsSL https://raw.githubusercontent.com/deltrivx/ThemeMusic/main/scripts/install.sh -o /tmp/theme-music-install.sh
sh /tmp/theme-music-install.sh install v1.1.2 ota
```

## 快速配置

### 本地目录

1. 音乐音源选择“本地目录”。
2. 选择 `/mnt/user/...`、`/mnt/diskN/...` 或已挂载的 CIFS/NFS 音乐目录。
3. 选择电脑/手机运行模式并应用。
4. 通过卡片的“重新加载曲库”刷新列表。

支持常见浏览器音频格式。与音频同目录的 `.lrc`、常见封面文件及 FLAC 内嵌图片会被自动识别。

### Navidrome / OpenSubsonic

1. 音乐音源选择“Navidrome”。
2. 填写服务器地址、用户名和密码。
3. 直接点击“测试连接”，无需先保存。
4. 测试通过后应用配置。

插件使用加盐令牌调用 Subsonic API。浏览器只访问 Unraid 同源代理，不接触 Navidrome 密码。

## 主要功能

- 上一首、播放/暂停、下一首在卡片与胶囊之间即时双向同步。
- 随机、列表循环、单曲循环、曲目/歌词视图切换。
- 按歌手、曲名、路径或大小排序；按曲名、歌手、专辑实时搜索。
- 本地侧车歌词、Navidrome 结构化歌词、普通歌词和可控的在线歌词匹配。
- 目录封面、FLAC 内嵌封面、Navidrome 封面和受控的封面补全。
- HTTP Range 串流、进度拖动、跨页会话恢复和播放失败自恢复。
- 卡片位置持久化，兼容 Unraid 重绘、克隆、两栏/三栏与移动布局。
- 曲库、歌词和封面缓存管理；手动刷新可绕过曲库缓存。

## 数据、网络与安全

- 普通设置保存在 `/boot/config/plugins/theme.music/theme-music.cfg`。
- 服务总开关保存在 `/boot/config/plugins/theme.music/theme.music.cfg`。
- Navidrome 密码单独保存在 `navidrome.secret`，权限为 `0600`。
- 播放接口通过 Unraid WebGUI 同源路径提供，不向浏览器输出上游凭据。
- 在线歌词/封面匹配仅在对应功能被调用时访问外部服务；可仅使用本地或 Navidrome 数据。
- 项目不会上传音乐文件、播放记录或账户凭据。

安全问题请不要公开披露，参阅 [SECURITY.md](SECURITY.md)。

## 持久化路径

| 内容 | 路径 |
|---|---|
| 插件与版本状态 | `/boot/config/plugins/theme.music/` |
| 运行时 | `/usr/local/emhttp/plugins/theme.music/` |
| 普通配置 | `/boot/config/plugins/theme.music/theme-music.cfg` |
| 服务开关 | `/boot/config/plugins/theme.music/theme.music.cfg` |
| Navidrome 密码 | `/boot/config/plugins/theme.music/navidrome.secret` |
| 封面/歌词缓存 | `/boot/config/plugins/theme.music/cover-cache`、`lyrics-cache` |
| Web API | `/plugins/theme.music/ucwc-music-api.php` |

用户配置、密码和缓存不会打入 GitHub Release。升级默认保留配置；卸载会禁用服务并保留 flash 中的用户数据，便于恢复。

## 发布、校验与回滚

每个正式 Release 提供：

- `ThemeMusic-<版本>.zip`
- `ThemeMusic-<版本>.tar.gz`
- `theme.music-<版本>.plg`
- `files.manifest`
- `install.sh`
- `SHA256SUMS`

校验示例：

```bash
shasum -a 256 -c SHA256SUMS
```

设置页支持稳定版、测试版和历史版本选择。OTA 根据版本清单比较 SHA256，只下载变化文件；插件列表元数据也会同步到所安装的版本。

## 兼容性与边界

- 支持 Unraid 6.12 及以上版本。
- 需要 `curl`、`jq` 和 PHP cURL；这些通常随 Unraid 提供。
- Theme Music 已从 ThemeEffects 完全拆分。请勿同时启用 ThemeEffects 的旧音乐组件。
- 本项目不是 Unraid、Navidrome 或 OpenSubsonic 的官方项目，也不包含任何音乐内容。

## 项目文档

- [ABOUT.md](ABOUT.md)：项目定位、架构和设计原则
- [CHANGELOG.md](CHANGELOG.md)：完整中文更新记录
- [CONTRIBUTING.md](CONTRIBUTING.md)：贡献与本地验证流程
- [SECURITY.md](SECURITY.md)：安全支持范围和报告方式
- [SUPPORT.md](SUPPORT.md)：故障排查与提交信息

## 许可证

- 程序源代码采用 [MIT License](LICENSE)。MIT 允许使用、修改、分发和商业使用。
- 仓库原创文档与视觉资产采用 [CC BY-NC-SA 4.0](LICENSE-ASSETS.md)，要求署名、非商业使用并以相同方式共享。
- 第三方名称、商标、图标及服务分别归其权利人所有，详见 [NOTICE](NOTICE)。

两套许可适用于不同材料，互不覆盖；“非商业”限制不适用于 MIT 授权的程序源代码。

## 致谢

感谢 Unraid、Navidrome、OpenSubsonic 社区以及所有参与测试和反馈的用户。Theme Music 最初从 ThemeEffects 的音乐组件独立出来，自此拥有完全独立的路径、配置、缓存、发布与维护周期。
