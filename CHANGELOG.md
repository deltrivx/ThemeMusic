# Theme Music Changelog

## v1.0.0-Beta9 — 2026-07-30 (`2026.07.30i`)

### 设置
- **电脑 / 手机** 分设：运行模式、默认音量、自动播放、随机、循环
- 手机运行模式默认「和电脑端配置相同」；选此项时隐藏其余手机项（仿主题特效 hideRow）
- 音源与本地目录仍共享；标题 `SERVICE` 仍为总开关

### 运行时
- Loader 注入 `mobile` 配置块；客户端按触控/窄屏选用手机配置
- **划掉标签页 / 切后台**：暂停 HTMLAudio，保留续播 intent（修复移动端进程后台仍播）

---

## v1.0.0-Beta8 — 2026-07-30 (`2026.07.30h`)

### 设置
- 「音乐组件」改为 **运行模式**：音乐卡片（仅仪表盘）/ 音乐胶囊（全站）/ 卡片+胶囊（全站）
- 取消「播放范围」；关闭播放器用标题后总开关（`SERVICE`）
- 配置键 `MUSIC_RUN_MODE=card|chip|both`，并派生 `MUSIC_ENABLE` / `MUSIC_DASH_ONLY` / `MUSIC_UI`
- 旧「全站」(`DASH_ONLY=no`) 迁移为 `both`；无 `RUN_MODE` 时按 ENABLE+DASH_ONLY 推导

### 运行时
- `chip` 模式仪表盘不挂卡片，仅胶囊；`card`/`both` 卡片逻辑不变
- Loader / API 注入 `run_mode`；`shouldShowCard` 增加 `wantCardUi()`

---

## v1.0.0-Beta7 — 2026-07-30 (`2026.07.30g`)

### 跨页续播 / 移动端
- 全页导航后卡片 DOM 与内存引用脱节时自动重建并重绑进度/播放控件
- 进度条直接绘制到当前文档中的 live 节点，避免卡在 `0:00`
- FLAC/SMB 中段 seek 失败导致「假播放」时自动硬重置恢复
- 仪表盘 tile 被 Unraid 替换时的卡片重建与进度同步更稳

---

## v1.0.0-Beta6 — 2026-07-30 (`2026.07.30f`)

### 仪表盘卡片布局
- 左右栏**固定宽度**（左约 248px / 右约 300px），卡片 `max-content` 不再被仪表盘列拉长
- 曲目/歌词复用区**加宽**并向左靠拢；栏间距由 14px 收至 8px
- 长标题跑马灯仍在右侧栏内裁剪，不改变整卡宽度

---

## v1.0.0-Beta5 — 2026-07-30 (`2026.07.30e`)

### 设置页
- 标题 **Theme Music → 主题音乐**
- 运行开关移到标题后（仿主题特效 service switch），去掉表单内「运行」区块
- 移除「音乐」子标题与双装提示
- 控件列宽统一：全部 select + 路径框同一 `--tm-ctrl-w`，消除长短不一

### 其它
- `theme-music-save.php` 支持标题开关仅写 SERVICE

---

## v1.0.0-Beta4 — 2026-07-30 (`2026.07.30d`)

### 设置页
- select / 路径框 / 音量条统一为同一控制列宽（`--tm-ctrl-w`），消除长短不一与错位

### 全站播放
- Loader 写入独立 `window.__UCWC_MUSIC__`，并在 DOM 就绪后重申，避免 ThemeEffects 将 `music.enable=false` 覆盖
- `ucwc-music.js` 优先读 `__UCWC_MUSIC__`
- chip 样式去掉 `all: unset`，保证非仪表盘页可见

## v1.0.0-Beta3 — 2026-07-30 (`2026.07.30c`)

### 设置页布局
- 右侧 select：`width: max-content !important`，对抗 Unraid `default-base.css` 的 `width:100%`
- 路径框/音量条：`--tm-ctrl-w` 跟随邻近 select；fileTree 绝对定位在 path-field 下方（对齐 ThemeEffects）
- 取消标题下方「已保存…」提示；保存后静默刷新

### 独立版本管理
- 新增 `theme-music-update.php`（仓库 deltrivx/ThemeMusic，jobs `/tmp/theme-music-jobs`）
- 标题栏：版本号 +「检查更新」「更新日志」（与 ThemeEffects 完全独立）
- `assets/theme-music-settings.js`：OTA/全量/进度/changelog 面板

### 安装
- `install.sh` / OTA manifest 纳入 update API 与 settings JS
- 音乐卡片仍为 ThemeMusic 路径的 ucwc-music（与主题特效功能对齐）

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
