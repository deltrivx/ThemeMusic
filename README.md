# Theme Music · 主题音乐

[![最新版本](https://img.shields.io/github/v/release/deltrivx/ThemeMusic?display_name=tag&sort=semver&label=最新版本)](https://github.com/deltrivx/ThemeMusic/releases/latest)
[![Unraid](https://img.shields.io/badge/Unraid-6.12%2B-F15A2C?logo=unraid&logoColor=white)](https://unraid.net/)
[![代码许可](https://img.shields.io/badge/代码许可-GPL--2.0-blue)](LICENSE)
[![文档与视觉资产](https://img.shields.io/badge/文档与视觉资产-CC%20BY--NC--SA%204.0-8a2be2)](LICENSE-ASSETS.md)

Theme Music 是面向 Unraid WebGUI 的原生音乐播放器插件，将本地曲库、Navidrome/OpenSubsonic 和 FnOS 音乐 HTTP API 三类音源统一接入仪表盘与全站播放体验。

> 当前版本：**v1.3.7** · 插件 ID：`theme.music` · 最低 Unraid：**6.12.0**

## 核心能力

| 能力 | 说明 |
|---|---|
| 三音源 | 本地目录、Navidrome/OpenSubsonic、FnOS 音乐 HTTP API 可独立配置和切换 |
| 原生界面 | 仪表盘音乐卡片复用 Unraid 原生结构、配色、拖拽顺序、折叠和响应式布局 |
| 全站播放 | 音乐胶囊与仪表盘卡片共用单一播放状态，跨页面持续播放、暂停和恢复 |
| 媒体控制 | 播放列表、搜索、排序、随机、列表循环、单曲循环、进度和音量 |
| 歌词与封面 | 本地 LRC/TXT、Navidrome structured lyrics、FnOS 远端歌词、目录封面和 FLAC 内嵌封面 |
| 大曲库 | 低优先级单实例后台索引、六小时缓存、服务端总数、筛选排序和 300 首分段渲染 |
| 歌词校准 | 可按曲目提前或延后 0.5 秒，偏移持久化并支持手动归零 |
| PC / 手机分设 | 两端可独立选择运行模式、音量、自动播放、随机、循环、侧栏和续播状态 |
| 存储友好 | 本地磁盘唤醒与 SMB/NFS 远程挂载就绪探测分流，避免扫描阻塞 WebGUI |
| 可靠升级 | Release 归档校验、逐文件 SHA256、差异 OTA、指定版本回滚和 flash 离线恢复 |
| 隐私保护 | Navidrome/FnOS 密码独立以 `0600` 权限保存，不写入普通配置、前端或日志 |

## 运行模式

| 模式 | 仪表盘卡片 | 全站胶囊 | 离开仪表盘后播放 |
|---|:---:|:---:|:---:|
| `card` | ✓ | — | 停止 |
| `chip` | — | ✓ | 继续 |
| `both` | ✓ | ✓ | 继续 |

卡片与胶囊共用一个状态源。手机可继承电脑配置，也可以使用独立 profile 保存音量、随机、循环、曲目索引、曲库缓存和续播状态。全站模式使用内联 `<audio>`，不创建额外弹窗或宿主窗口。

## 安装

在 Unraid 中打开 **插件 → 安装插件**，粘贴：

```text
https://raw.githubusercontent.com/deltrivx/ThemeMusic/main/theme.music.plg
```

安装完成后插件默认关闭。进入 **设置 → 用户偏好 → 主题音乐**，开启总开关并配置音源。

也可使用独立安装器：

```bash
curl -fsSL https://raw.githubusercontent.com/deltrivx/ThemeMusic/main/scripts/install.sh | sh
```

指定版本和模式：

```bash
curl -fsSL https://raw.githubusercontent.com/deltrivx/ThemeMusic/main/scripts/install.sh -o /tmp/theme-music-install.sh
sh /tmp/theme-music-install.sh install v1.3.7 ota
```

## 音源配置

### 本地目录

选择“本地目录”，填写 `/mnt/user/...`、`/mnt/diskN/...` 或已挂载的 CIFS/NFS 音乐目录。插件会识别常见音频格式、同目录 `.lrc`/`.txt` 歌词、常见封面文件和 FLAC 内嵌图片。

### Navidrome / OpenSubsonic

填写服务器地址、用户名和密码后可直接测试连接。插件通过 Unraid 同源代理调用 Subsonic API，浏览器不接触上游密码，并支持曲库、串流、封面和结构化歌词。

### FnOS 音乐 HTTP API

填写 FnOS 音乐服务地址、用户名和密码后测试连接。插件支持远端曲库、封面、时长、播放和歌词，并对 token 失效执行一次自动重新登录重试。

三类音源均可单独选择；未配置或不可用的音源会跳过并显示明确状态，不会阻塞其他音源。

## 主要功能

- 卡片与胶囊的上一首、播放/暂停、下一首即时双向同步。
- 按曲名、歌手、专辑实时搜索，按歌手、曲名、路径或大小排序。
- HTTP Range 串流、进度拖动、跨页会话恢复和播放失败自恢复。
- 本地、Navidrome 和 FnOS 歌词统一进入同一歌词面板，支持同步与普通歌词。
- 曲库后台索引不会因刷新叠加；完整播放队列按 300 首分段渲染，不截断大曲库。
- 设置和播放状态支持桌面、移动端独立保存，兼容 Unraid 重绘、克隆、两栏/三栏和移动布局。
- 在线歌词与封面匹配仅在启用对应功能时访问外部服务，也可完全只使用本地或远端曲库数据。

## 数据与安全

- 普通设置：`/boot/config/plugins/theme.music/theme-music.cfg`
- 服务开关：`/boot/config/plugins/theme.music/theme.music.cfg`
- Navidrome 密码：`/boot/config/plugins/theme.music/navidrome.secret`，权限 `0600`
- FnOS 密码：`/boot/config/plugins/theme.music/fnos.secret`，权限 `0600`
- 运行时：`/usr/local/emhttp/plugins/theme.music/`
- Web API：`/plugins/theme.music/ucwc-music-api.php`

项目不会上传音乐文件、播放记录或账号凭据。安全问题请参阅 [SECURITY.md](SECURITY.md)，不要公开披露敏感细节。

## 发布与回滚

每个正式 Release 提供：

- `ThemeMusic-<版本>.zip`
- `ThemeMusic-<版本>.tar.gz`
- `theme.music-<版本>.plg`
- `files.manifest`
- `install.sh`
- `SHA256SUMS`

安装器优先下载经过总校验的 Release 归档，再按版本清单逐文件核对 SHA256，并只写入变化项。设置页支持稳定版、测试版和历史版本回滚，flash 中的用户配置、密码和插件状态会保留。

## 兼容性与边界

- 支持 Unraid 6.12 及以上版本。
- 需要 Unraid 提供的 `curl`、`jq`、PHP 和 PHP cURL。
- Theme Music 已从 ThemeEffects 完全拆分，请勿同时启用 ThemeEffects 的旧音乐组件。
- 本项目不是 Unraid、Navidrome 或 OpenSubsonic 的官方项目，也不包含任何音乐内容。

## 项目文档

- [ABOUT.md](ABOUT.md)：项目定位、架构和设计原则
- [CHANGELOG.md](CHANGELOG.md)：完整中文更新记录
- [CONTRIBUTING.md](CONTRIBUTING.md)：贡献与验证流程
- [SECURITY.md](SECURITY.md)：安全支持和报告方式
- [SUPPORT.md](SUPPORT.md)：故障排查与提交信息

## 许可证

- 程序源代码采用 [GNU GPL-2.0](LICENSE)：允许使用、研究、修改和分发；分发修改版本时须遵守 GPL-2.0 的相同许可条件。
- 仓库原创文档与视觉资产采用 [CC BY-NC-SA 4.0](LICENSE-ASSETS.md)，要求署名、非商业使用并以相同方式共享。
- 第三方名称、商标、图标及服务分别归其权利人所有，详见 [NOTICE](NOTICE)。

## 致谢

感谢 Unraid、Navidrome、OpenSubsonic、FnOS 社区以及所有参与测试和反馈的用户。Theme Music 是独立社区项目，与文中提及的产品或服务不存在官方隶属或背书关系。
