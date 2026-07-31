# Theme Music Changelog

## v1.0.8 — 2026-07-31 (`2026.07.31f`)

### 右侧曲目/歌词区
- `fitRightPane` 改用**列表项实际字体**测量（修浏览器/CJK 字宽偏差）
- 列宽上限只认真正的仪表盘列（table-cell 等），避免 `max-content` 祖先把宽度自我锁死在偏窄值
- 仍硬顶 **280px**，不撑开其它卡片

## v1.0.7 — 2026-07-31 (`2026.07.31e`)

### 右侧曲目/歌词区
- 复用栏宽度按最长曲名**动态测量**，并硬顶 **280px**（原列宽上限），不撑开仪表盘整列/其它卡片
- 短曲名时栏更窄，减少不同浏览器字宽导致的「长短不一」观感

### 仪表盘位置
- 位置记忆增加服务端 `dash-pos.json`（`action=dash_pos`），跨浏览器 / 重启仍可恢复
- 更严拒绝「误插到第一列第一个」的 race 覆盖；服务端位加载后再稳定落位

## v1.0.6 — 2026-07-31 (`2026.07.31d`)

### 空库 / 未配置提示
- 初始无曲目时，「请在 Theme Music 设置中配置…」等错误**只**显示在音量下方的 status 行
- 歌名下方副标题不再复用同一段 `state.error`，避免标题下与音量下重复提醒

## v1.0.5 — 2026-07-31 (`2026.07.31b`)

### 开机恢复（plg）
- 插件脚本**先**从 flash 恢复 emhttp runtime，再尝试 OTA
- 网络/GitHub 超时不再把已装插件打进 `plugins-error` 导致「重启后丢失」
- 有完整 flash 包时离线 boot 仍 `exit 0`；包 id **v1.0.5**（内容同 v1.0.4 业务 + 官方 boot 路径）

## v1.0.4 — 2026-07-30 (`2026.07.30e`)

### 歌词错配修复（深度）
- **根因**：侧车 `.lrc` 仅按文件名 stem 关联，不校验正文；网易云弱匹配曾把「别怕我伤心」写入 `09.回来.lrc` 等多首曲目
- 新增 `m_lrc_matches_track`：校验 `[ti]`、正文横幅（`歌手-歌名`）、粘连歌名
- `m_find_matching_lrc`：错配侧车自动隔离为 `.bad-*`，并在 `fetch=1` 时重新拉取
- lrclib / 网易云：要求强标题相关；**禁止**回退到搜索第一首
- 写入前最终校验；插件 lyrics-cache 同样校验后才使用

## v1.0.3 — 2026-07-30 (`2026.07.30d`)

### 歌词同步
- 对齐 **ThemeEffects beta 内置音乐** 时钟：`Math.floor(currentTime*1000) - offsetMs`
- **去掉固定 +160ms lead**（此前人工提前量导致高亮长期偏离 LRC 时间戳）
- 保留 rAF 跟拍与 `driftMs` 可选微调（默认 0）

## v1.0.2 — 2026-07-30 (`2026.07.30c`)

### 布局
- 加宽左侧控制栏（`left-w` 286px），降低右栏 z-index，避免「曲目/歌词」切换钮被右栏遮挡
- 左侧 `overflow: visible`，按钮行完整露出 6 个控件

### 歌词同步
- `lyricClockMs`：按 A2 正确处理 LRC offset（正值延迟显示 → 减时钟）
- 播放中 rAF 跟拍 + seeked 强制同步；仅当前行高亮/跑马灯
- 固定 lead 校准高亮与人声起点

## v1.0.1 — 2026-07-30 (`2026.07.30a`)

### 布局与歌词
- 卡片左右栏间距加大并隔离层叠，避免右侧歌词/曲目区与左侧重叠
- 歌词**仅当前行**在过长时横向滑动；其它行静态省略，不再整列跑马灯
- 歌词时间轴同步校准（offset + 轻微提前量）；纵向只滚动歌词面板内当前行

### 仪表盘与移动端
- 音乐卡片位置持久化加强（`dash_pos_v3`）：刷新/重装后尽量恢复用户放置位置，默认不再强制左上第一位
- 移动端设置页底部「应用 / 完成」按钮居中，修复左偏

---

## v1.0.0 — 2026-07-30 (`2026.07.30`)

正式版。自 ThemeEffects 拆出的独立 Unraid 音乐插件；汇总 Beta1–Beta9 可用能力。

### 设置
- **音乐音源**置顶；「本地音乐目录」随音源显隐（仿主题特效壁纸 hideRow）
- 音源选项文案：**本地目录**（去掉 V1 后缀）
- **电脑 / 手机**分设：运行模式、默认音量、自动播放、随机、循环
- 手机运行模式默认「和电脑端配置相同」，选此项隐藏其余手机项
- **运行模式**三选项：音乐卡片（仅仪表盘）/ 音乐胶囊（全站）/ 卡片+胶囊（全站）
- 标题后 **SERVICE** 总开关；取消表单「播放范围」
- 设置页控件统一列宽；路径浏览对齐主题特效；独立检查更新 / 更新日志

### 播放与跨页
- 仪表盘音乐卡片 + 全站 mini 胶囊（页内浮层，不新开标签）
- 本地目录曲库、LRC 歌词、封面缓存
- 跨页续播 intent；仪表盘 tile 被替换时卡片/进度重建
- 移动端：划掉标签 / 切后台暂停 HTMLAudio，保留续播 intent
- FLAC/CIFS seek 失败硬重置，避免假播放卡死

### 布局
- 卡片左右固定宽；曲目/歌词区加宽；长标题跑马灯不撑破卡片

### 说明
- 插件 id：`theme.music`；与 ThemeEffects ≥ v2.6.0 并存（主题侧已无内置音乐）

---

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
