# 关于 Theme Music

Theme Music 是一个面向 Unraid WebGUI 的独立音乐播放器插件，目标是在不引入额外前端服务的前提下，让音乐库自然地成为 Unraid 仪表盘的一部分。

## 项目定位

- 不是独立音乐服务器，而是 Unraid 内的播放与控制层。
- 可以直接读取本地/远程挂载目录，也可以连接现有 Navidrome/OpenSubsonic 服务。
- 不复制用户音乐库，不向云端上传音乐、凭据或播放记录。
- 不依赖 ThemeEffects；两者拥有独立的插件 ID、路径、配置、缓存和版本生命周期。

## 设计原则

1. **设置是唯一真相来源**：卡片和胶囊显示由总开关与设备运行模式决定。
2. **状态必须一致**：卡片、胶囊、音频元素和 Media Session 使用同一播放状态。
3. **升级不破坏配置**：OTA 只替换版本文件，用户配置与密码独立保留。
4. **离线也能启动**：运行文件持久化到 flash，GitHub 不可用时仍可从本地恢复。
5. **凭据不进入浏览器**：Navidrome 鉴权只在服务端代理中完成。
6. **低配设备可用**：限制扫描、歌词刷新和 DOM 重绘频率，避免无意义的高频任务。

## 架构

```text
ThemeMusic.page（设置）
        │
        ├── theme-music.cfg / theme.music.cfg / navidrome.secret
        │
ThemeMusic_Loader.page（全局注入）
        │
        ├── ucwc-music.js + ucwc-music.css（卡片、胶囊、播放状态）
        │
        └── ucwc-music-api.php
              ├── 本地目录扫描 / Range 串流
              ├── Navidrome/OpenSubsonic 代理
              ├── 歌词与封面解析/缓存
              └── 仪表盘位置持久化
```

## 发布模型

- `versions/index.json` 是可安装版本索引。
- `versions/<版本>/files.manifest` 记录每个运行文件的大小和 SHA256。
- `scripts/install.sh` 负责安装、OTA、回滚、离线恢复和 PLG 元数据同步。
- GitHub Release 提供完整包、PLG、独立安装器、文件清单和总校验清单。

## 项目关系

Theme Music 最初来自 ThemeEffects 的音乐功能。自 ThemeEffects v2.6.0 起，音乐实现已从主题仓库移除，由本仓库独立维护。

Theme Music 与 Unraid、Navidrome、OpenSubsonic 均无官方隶属或背书关系。
