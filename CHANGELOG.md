## v1.3.0-beta8 — 2026-08-02

### 修复

- **飞牛音乐测试连接不再显示 unknown**：后端 `ucwc-music-api.php` 此前没有 `fnos_test` action，前端点击统一落到兜底分支返回 `unknown action`；本次新增 `fnos_test` action（参照 `navidrome_test` 模板），调用飞牛 HTTP API 的 `track/list` 探活，返回 `server_type` / `library_access`；同时支持表单内 `url` / `user` / `password` 临时覆盖配置
- **存储准备按策略分流显示，去除混显示**：前端 `wireStorageStatus` 新增 `detectedLabel()` 工具函数，`自动检测` 标签按 `strategy` 单独渲染
  - 飞牛/Navidrome → 显示音源类型
  - 本地磁盘 → 显示「本地磁盘等待唤醒」（不再和 SMB 串在一起）
  - Unraid 用户共享 → 显示对应提示
  - SMB → 显示「SMB 远端默认挂载」
  - NFS → 显示「NFS 远端默认挂载」
  - 无效 → 显示「本地音乐目录不可访问」
- **飞牛音乐三框等宽到侧边**：`assets/theme-music-settings.css` 把 `#tm-fnos-url / user / password` 加入 Navidrome 那条 `var(--tm-ctrl-w, 14rem)` 的等宽选择器组；`max-width: 100%` + `box-sizing: border-box` 防止溢出右侧
- **取消设置页底部「清理启动盘旧缓存」按钮**：HTML 段 (`#tm-cache-actions`)、JS 端 `wireCacheClear()` 函数、其 `formatBytes()` 工具函数、`bootUi()` 引用一并删除；后端 `clear_cache` action 保留（不影响运维能力）
- **取消「卡片显示规则」说明段**：删除 ThemeMusic.page 中「仪表盘不再提供单独的关闭卡片按钮」独立行
- **取消「附属文件」说明段**：与清理缓存按钮同段一并删除，去除冗余提示

## v1.3.0-beta7 — 2026-08-02

### 修复

- **设置页布局错乱**：比对 v1.2.2 正式版结构逐行修复飞牛音乐配置区块
  - Navidrome 连接行的 `<span class="tm-inline-actions">` 此前未闭合，导致后续所有行被吞进该 span
  - 飞牛「地址 / 用户 / 密码 / 连接」四行的定义列表标签存在多余缩进，破坏 Unraid `dl/dt/dd` 渲染
  - 飞牛连接行结尾误用 `</div>`，应为 `</span>`；该多余闭合标签破坏整页 DOM 层级
  - 文件末尾丢失换行已补回
- **飞牛测试连接按钮无响应**：`wireFnosTest()` 此前只定义未调用，现已在初始化流程中接上
- 飞牛输入框属性对齐 Navidrome：地址 `maxlength=512` / `autocomplete=url`，用户 `autocomplete=username`
- **还原被污染的 v1.2.2 正式版归档**：`versions/v1.2.2/` 下的 `ThemeMusic.page`、`ucwc-music-api.php`、`files.manifest` 曾被 beta 内容覆盖，现恢复为 v1.2.2 发布时的原始内容

## v1.3.0-beta6 — 2026-08-02

### 修复

- **重写飞牛音乐(FnOS)音源**：从 SSH+sqlite3 方式彻底改为 HTTP API 方式
- 移除 SSH 连接和 sqlite3 命令依赖，改为通过 HTTP API 获取曲库、流媒体、封面、歌词
- 配置项改为「飞牛音乐地址 + 用户名 + 密码」，与 Navidrome 配置一致

### 配置项变化

| 旧配置（已移除） | 新配置 |
|---|---|
| `MUSIC_FNOS_HOST` | `MUSIC_FNOS_URL`（飞牛音乐 HTTP 地址） |
| `MUSIC_FNOS_DB` | `MUSIC_FNOS_USER`（飞牛音乐用户名） |
| `MUSIC_FNOS_MUSIC_DIR` | `MUSIC_FNOS_PASSWORD`（飞牛音乐密码） |

### 文件改动

