#!/bin/sh
set -eu

REPO_RAW="https://raw.githubusercontent.com/deltrivx/ThemeMusic/main"
REPO_MIRRORS="
https://cdn.jsdelivr.net/gh/deltrivx/ThemeMusic@main
https://fastly.jsdelivr.net/gh/deltrivx/ThemeMusic@main
https://raw.gitmirror.com/deltrivx/ThemeMusic/main
https://ghfast.top/https://raw.githubusercontent.com/deltrivx/ThemeMusic/main
"
PERSIST_DIR="/boot/config/plugins/theme.music"
RUNTIME_DIR="/usr/local/emhttp/plugins/theme.music"
STATE_FILE="$PERSIST_DIR/ThemeMusic.state"
OPTIONS_FILE="$PERSIST_DIR/ThemeMusic.options"
LOADER_PAGE="$PERSIST_DIR/ThemeMusic_Loader.page"
LOADER_RUNTIME="$RUNTIME_DIR/ThemeMusic_Loader.page"
MUSIC_PAGE="$PERSIST_DIR/ThemeMusic.page"
MUSIC_RUNTIME="$RUNTIME_DIR/ThemeMusic.page"
MUSIC_CFG="$PERSIST_DIR/theme-music.cfg"
SERVICE_CFG="$PERSIST_DIR/theme.music.cfg"
PLUGIN_BOOT="/boot/config/plugins/theme.music.plg"
PLUGIN_LOG="/var/log/plugins/theme.music.plg"

VERSION=""
INSTALL_MODE="ota"
IS_LATEST="no"

ucwc_log() {
  if [ "${UCWC_PLUGIN_INSTALL:-}" = "1" ]; then
    echo "$*"
  else
    echo "$*" >&2
  fi
}

progress() {
  ucwc_log "[进度 $1%] $2：$3"
}

ucwc_curl() {
  # Mirror candidates already provide retries. Keep each failed endpoint bounded
  # so an established-but-stalled raw.githubusercontent.com connection cannot
  # block a small OTA file for several minutes.
  curl -4 -fsSL --http1.1 --tlsv1.2 --connect-timeout 8 --retry 0 "$@"
}

ucwc_url_candidates() {
  _u=$1
  _rel=""
  case "$_u" in
    https://github.com/deltrivx/ThemeMusic/releases/download/??*)
      printf '%s\n' "$_u"
      printf '%s%s\n' "https://ghfast.top/" "$_u"
      return 0
      ;;
  esac
  for _base in \
    "https://raw.githubusercontent.com/deltrivx/ThemeMusic/main" \
    "https://cdn.jsdelivr.net/gh/deltrivx/ThemeMusic@main" \
    "https://fastly.jsdelivr.net/gh/deltrivx/ThemeMusic@main" \
    "https://raw.gitmirror.com/deltrivx/ThemeMusic/main" \
    "https://ghfast.top/https://raw.githubusercontent.com/deltrivx/ThemeMusic/main"
  do
    case "$_u" in
      "$_base"/*)
        _rel=${_u#"$_base"}
        break
        ;;
    esac
  done
  if [ -z "$_rel" ]; then
    printf '%s\n' "$_u"
    return 0
  fi
  printf '%s%s\n' "https://raw.githubusercontent.com/deltrivx/ThemeMusic/main" "$_rel"
  for _m in $REPO_MIRRORS; do
    [ -n "$_m" ] || continue
    printf '%s%s\n' "${_m%/}" "$_rel"
  done
}

download() {
  dl_dest=""
  dl_url=""
  dl_prev=""
  dl_extra=""
  for dl_arg in "$@"; do
    if [ "$dl_prev" = "-o" ]; then
      dl_dest="$dl_arg"
      dl_prev=""
      continue
    fi
    case "$dl_arg" in
      -o) dl_prev="-o" ;;
      http://*|https://*) dl_url="$dl_arg" ;;
      *) dl_extra="$dl_extra $dl_arg" ;;
    esac
  done
  if [ -z "$dl_url" ]; then
    echo "download: missing URL" >&2
    return 1
  fi
  dl_name=$(basename "$dl_url" | sed 's/[?].*$//')
  ucwc_log "下载文件：$dl_name"
  dl_status=1
  # shellcheck disable=SC2086
  for dl_candidate in $(ucwc_url_candidates "$dl_url" | tr '\n' ' '); do
    [ -n "$dl_candidate" ] || continue
    if [ -n "$dl_dest" ]; then
      if ucwc_curl --max-time 30 -o "$dl_dest" $dl_extra "$dl_candidate" && [ -s "$dl_dest" ]; then
        dl_status=0
        break
      fi
      [ -e "$dl_dest" ] && rm -f "$dl_dest"
    else
      if ucwc_curl --max-time 30 $dl_extra "$dl_candidate"; then
        dl_status=0
        break
      fi
    fi
    ucwc_log "镜像重试：$dl_name"
  done
  return "$dl_status"
}

fetch_index() {
  _ts=$(date +%s)
  _idx=""
  _bases="$REPO_RAW"
  for _m in $REPO_MIRRORS; do
    [ -n "$_m" ] || continue
    _bases="$_bases $_m"
  done
  for _b in $_bases; do
    _b=${_b%/}
    _idx=$(ucwc_curl --max-time 30 "$_b/versions/index.json?_ts=$_ts" 2>/dev/null) || _idx=""
    case "$_idx" in
      "{"*)
        REPO_RAW="$_b"
        export REPO_RAW
        printf '%s\n' "$_idx"
        return 0
        ;;
      *)
        _cut=$(printf '%s\n' "$_idx" | sed -n '/^{/,$p' 2>/dev/null || true)
        case "$_cut" in
          "{"*)
            REPO_RAW="$_b"
            export REPO_RAW
            printf '%s\n' "$_cut"
            return 0
            ;;
        esac
        ;;
    esac
    ucwc_log "版本索引镜像重试：$_b"
  done
  return 1
}

file_sha256() {
  if [ ! -f "$1" ]; then echo ""; return 0; fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" 2>/dev/null | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$1" 2>/dev/null | awk '{print $NF}'
  else
    echo ""
  fi
}

file_size() {
  if [ ! -f "$1" ]; then echo "0"; return 0; fi
  wc -c < "$1" 2>/dev/null | tr -d ' \t\r\n'
}

clear_legacy_boot_caches() {
  _removed=0
  _bytes=0
  for _legacy in \
    "$PERSIST_DIR/lyrics-cache" \
    "$PERSIST_DIR/cover-cache"
  do
    # Safety invariant: only these two retired dynamic-cache directories may be removed.
    case "$_legacy" in
      "$PERSIST_DIR/lyrics-cache"|"$PERSIST_DIR/cover-cache") ;;
      *) ucwc_log "拒绝清理非白名单路径：$_legacy"; return 1 ;;
    esac
    if [ -d "$_legacy" ]; then
      _n=$(find "$_legacy" -type f 2>/dev/null | wc -l | tr -d ' ')
      _b=$(du -sk "$_legacy" 2>/dev/null | awk '{print $1 * 1024}')
      _removed=$((_removed + ${_n:-0}))
      _bytes=$((_bytes + ${_b:-0}))
      rm -rf -- "$_legacy"
    fi
  done
  ucwc_log "已清理启动盘旧动态缓存：${_removed} 个文件，${_bytes} 字节；配置与密钥均保留"
}

local_path_for() {
  case "$1" in
    assets/*) printf '%s\n' "$PERSIST_DIR/$1" ;;
    ThemeMusic.page) printf '%s\n' "$MUSIC_PAGE" ;;
    ThemeMusic_Loader.page) printf '%s\n' "$LOADER_PAGE" ;;
    PLUGIN-README.md) printf '%s\n' "$PERSIST_DIR/README.md" ;;
    theme-music.cfg) printf '%s\n' "$MUSIC_CFG" ;;
    theme.music.cfg) printf '%s\n' "$SERVICE_CFG" ;;
    ucwc-music-api.php) printf '%s\n' "$PERSIST_DIR/ucwc-music-api.php" ;;
    theme-music-save.php) printf '%s\n' "$PERSIST_DIR/theme-music-save.php" ;;
    theme-music-update.php) printf '%s\n' "$PERSIST_DIR/theme-music-update.php" ;;
    *) printf '%s\n' "$PERSIST_DIR/$1" ;;
  esac
}

manifest_get() {
  _mp=$1
  _mf=$2
  if [ -z "${MANIFEST_JSON:-}" ]; then echo ""; return 0; fi
  printf '%s' "$MANIFEST_JSON" | jq -r --arg p "$_mp" --arg f "$_mf" '
    .files[]? | select(.path == $p) | .[$f] // empty
  ' 2>/dev/null || true
}

validate_manifest() {
  _manifest=$1
  _version=$2
  [ -s "$_manifest" ] || { ucwc_log "错误：缺少 files.manifest"; return 1; }
  jq -e --arg version "$_version" '
    type == "object" and .schema == 1 and .version == $version and
    (.files | type == "array" and length > 0) and
    ([.files[] | select(
      (.path | type) != "string" or .path == "" or
      (.path | startswith("/") or contains("..")) or
      (.size | type) != "number" or .size < 0 or
      (.sha256 | type) != "string" or (.sha256 | test("^[0-9a-fA-F]{64}$") | not)
    )] | length == 0)
  ' "$_manifest" >/dev/null 2>&1 || {
    ucwc_log "错误：files.manifest 校验失败（版本 $_version）"
    return 1
  }
  MANIFEST_JSON=$(cat "$_manifest")
  for _required in \
    ThemeMusic.page ThemeMusic_Loader.page PLUGIN-README.md \
    assets/theme-music-settings.css assets/theme-music-settings.js \
    assets/ucwc-music.css assets/ucwc-music.js \
    theme-music-save.php theme-music-update.php theme-music.cfg \
    theme.music.cfg ucwc-music-api.php
  do
    manifest_get "$_required" sha256 | grep -Eq '^[0-9a-fA-F]{64}$' || {
      ucwc_log "错误：files.manifest 缺少必需文件 $_required"
      return 1
    }
  done
}

verify_download() {
  _path=$1
  _rel=$2
  _expect_sha=$(manifest_get "$_rel" sha256)
  _expect_sz=$(manifest_get "$_rel" size)
  [ -n "$_expect_sha" ] || return 0
  _actual_sha=$(file_sha256 "$_path")
  _actual_sz=$(file_size "$_path")
  [ "$_actual_sha" = "$_expect_sha" ] && [ "$_actual_sz" = "$_expect_sz" ] || {
    ucwc_log "错误：文件校验失败：$_rel（期望 sha=$_expect_sha size=$_expect_sz，实际 sha=$_actual_sha size=$_actual_sz）"
    rm -f -- "$_path"
    return 1
  }
}

fetch_pkg() {
  _dest=$1
  _url=$2
  _rel=$3
  _label=${4:-$_rel}
  _source=${5:-}
  mkdir -p "$(dirname "$_dest")"

  _expect_sha=$(manifest_get "$_rel" sha256)
  _local=$(local_path_for "$_rel")

  if [ "$INSTALL_MODE" = "ota" ] && [ -n "$_local" ] && [ -f "$_local" ]; then
    _skip=0
    if [ -n "$_expect_sha" ]; then
      _cur=$(file_sha256 "$_local")
      if [ -n "$_cur" ] && [ "$_cur" = "$_expect_sha" ]; then
        _skip=1
      fi
    fi
    if [ "$_skip" = "1" ]; then
      ucwc_log "OTA 跳过（未变）：$_label"
      OTA_SKIPPED=$(( ${OTA_SKIPPED:-0} + 1 ))
      cp -a "$_local" "$_dest"
      return 0
    fi
    ucwc_log "OTA 重新安装（哈希不匹配或缺少清单）：$_label"
  fi

  OTA_FETCHED=$(( ${OTA_FETCHED:-0} + 1 ))
  if [ -n "$_source" ] && [ -f "$_source" ]; then
    cp -a "$_source" "$_dest"
    verify_download "$_dest" "$_rel"
    return $?
  fi
  _tmp="$_dest.download.$$"
  rm -f -- "$_tmp"
  if ! download -o "$_tmp" "$_url"; then
    rm -f -- "$_tmp"
    return 1
  fi
  if ! verify_download "$_tmp" "$_rel"; then
    return 1
  fi
  mv -f -- "$_tmp" "$_dest"
}

install_pair() {
  src=$1
  dst_f=$2
  dst_r=$3
  [ -f "$src" ] || return 0
  install -m 0644 "$src" "$dst_f"
  install -m 0644 "$src" "$dst_r"
}

write_options() {
  {
    printf 'version=%s\n' "$VERSION"
    printf 'install_mode=%s\n' "$INSTALL_MODE"
    printf 'updated_at=%s\n' "$(date +%Y%m%d-%H%M%S)"
    printf 'source=deltrivx/ThemeMusic\n'
  } > "$OPTIONS_FILE"
}

sync_plugin_metadata() {
  _dst="$1"
  # The boot PLG must include the current offline-recovery bootstrap. Release
  # assets are immutable and may predate a bootstrap-only hotfix.
  _url="$REPO_RAW/theme.music.plg"
  if ! download -o "$_dst" "$_url"; then
    ucwc_log "错误：PLG 元数据下载失败"
    return 1
  fi
  _plg_ver=$(sed -n 's/.*<!ENTITY[[:space:]]\+version[[:space:]]\+"\([^"]*\)".*/\1/p' "$_dst" | head -1)
  if [ -z "$_plg_ver" ] || ! grep -q '<PLUGIN name="&name;"' "$_dst"; then
    ucwc_log "错误：PLG 元数据校验失败（得到 ${_plg_ver:-空}）"
    return 1
  fi
  install -m 0644 "$_dst" "$PLUGIN_BOOT"
  if [ -d "$(dirname "$PLUGIN_LOG")" ]; then
    # Unraid discovers installed plugins through /var/log/plugins/*.plg
    # registration symlinks. During a PLG-driven install, plugin(8) creates
    # the link after this script returns; terminal/OTA installs must register
    # themselves. A regular copied file here can be omitted from Plugins UI.
    if [ "${UCWC_PLUGIN_INSTALL:-}" = "1" ]; then
      [ -L "$PLUGIN_LOG" ] || rm -f "$PLUGIN_LOG"
    else
      ln -sfn "$PLUGIN_BOOT" "$PLUGIN_LOG"
    fi
  fi
  ucwc_log "已同步 Unraid 插件列表元数据：$VERSION"
}

install_version() {
  case "$INSTALL_MODE" in
    ota|full) ;;
    *) INSTALL_MODE="ota" ;;
  esac

  index=$(fetch_index)
  if ! printf '%s' "$index" | jq -e --arg version "$VERSION" \
    '.versions[] | select(.id == $version)' >/dev/null; then
    # GitHub raw mirrors can lag behind a freshly published index. For an
    # explicit version, accept it only when its signed manifest is reachable.
    _probe=$(mktemp)
    if ! download -o "$_probe" "$REPO_RAW/versions/$VERSION/files.manifest?_ts=$(date +%s)" \
      || ! validate_manifest "$_probe" "$VERSION"; then
      rm -f "$_probe"
      echo "未知版本：$VERSION" >&2
      exit 64
    fi
    rm -f "$_probe"
    index=$(printf '{"latest_version":"%s","default":"%s","versions":[{"id":"%s"}]}' "$VERSION" "$VERSION" "$VERSION")
  fi

  latest=$(printf '%s' "$index" | jq -r '.latest_version // .default // empty')
  if [ "$VERSION" = "$latest" ]; then
    IS_LATEST="yes"
  else
    IS_LATEST="no"
  fi

  base="$REPO_RAW/versions/$VERSION"
  release_base="https://github.com/deltrivx/ThemeMusic/releases/download/$VERSION"
  tmp=$(mktemp -d /tmp/ThemeMusic.XXXXXX)
  trap 'rm -rf "$tmp"' EXIT INT TERM
  OTA_SKIPPED=0
  OTA_FETCHED=0
  MANIFEST_JSON=""

  if [ "$INSTALL_MODE" = "full" ]; then
    echo "正在全量安装 $VERSION …"
    progress 18 "准备安装" "全量模式：将重新下载全部包文件"
  else
    echo "正在 OTA 安装 $VERSION …"
    progress 18 "准备安装" "OTA 模式：比对本地后仅下载变更文件"
  fi
  mkdir -p "$tmp/assets" "$PERSIST_DIR/assets" "$RUNTIME_DIR/assets"

  progress 22 "拉取清单" "files.manifest（OTA 差异比对）"
  manifest_ok=0
  if download -o "$tmp/files.manifest" "$release_base/files.manifest" \
    && validate_manifest "$tmp/files.manifest" "$VERSION"; then
    manifest_ok=1
  else
    ucwc_log "Release 清单不可用，回退版本快照：$VERSION"
    rm -f "$tmp/files.manifest"
    if download -o "$tmp/files.manifest" "$base/files.manifest?_ts=$(date +%s)" \
      && validate_manifest "$tmp/files.manifest" "$VERSION"; then
      manifest_ok=1
    fi
  fi
  if [ "$manifest_ok" -ne 1 ]; then
    ucwc_log "错误：正式版本缺少有效 files.manifest"
    echo "无法安装：files.manifest 无效或不可访问。" >&2
    exit 1
  fi
  MANIFEST_JSON=$(cat "$tmp/files.manifest")
  ucwc_log "已加载并验证文件清单（逐文件 SHA256/大小比对）"

  # Prefer one small, checksummed Release archive over a dozen raw GitHub
  # requests. OTA still compares every manifest hash and only writes changed
  # runtime files. Legacy releases automatically fall back to per-file fetches.
  ARCHIVE_DIR=""
  archive="$tmp/ThemeMusic-$VERSION.tar.gz"
  sums="$tmp/SHA256SUMS"
  if download -o "$sums" "$release_base/SHA256SUMS" \
    && download -o "$archive" "$release_base/ThemeMusic-$VERSION.tar.gz"; then
    archive_expect=$(awk -v n="ThemeMusic-$VERSION.tar.gz" '{name=$2; sub(/^\*/, "", name); if ($1 == n || name == n) {print $1; exit}}' "$sums" 2>/dev/null || true)
    archive_actual=$(file_sha256 "$archive")
    archive_root="ThemeMusic-$VERSION"
    if [ -n "$archive_expect" ] && [ "$archive_actual" = "$archive_expect" ] \
      && tar -tzf "$archive" | awk -v p="$archive_root" '
        $0 == p || index($0, p "/") == 1 {
          if ($0 ~ /(^|\/)\.\.(\/|$)/) bad=1
          next
        }
        { bad=1 }
        END { exit bad }
      ' \
      && ! tar -tvzf "$archive" | awk '$1 ~ /^[lh]/ { found=1 } END { exit !found }'; then
      mkdir -p "$tmp/release"
      if tar -xzf "$archive" -C "$tmp/release" \
        && [ -d "$tmp/release/$archive_root" ]; then
        ARCHIVE_DIR="$tmp/release/$archive_root"
        ucwc_log "已验证并展开 Release 归档（单次下载，逐文件 SHA256）"
      fi
    fi
  fi
  if [ -z "$ARCHIVE_DIR" ]; then
    ucwc_log "Release 归档不可用，将回退到逐文件镜像下载"
  fi

  progress 35 "下载文件" "ThemeMusic 页面与播放器"
  for f in \
    ThemeMusic.page \
    ThemeMusic_Loader.page \
    PLUGIN-README.md \
    theme-music.cfg \
    theme.music.cfg \
    ucwc-music-api.php \
    theme-music-save.php \
    theme-music-update.php \
    assets/ucwc-music.js \
    assets/ucwc-music.css \
    assets/theme-music-settings.css \
    assets/theme-music-settings.js
  do
    bn=$(basename "$f")
    dir=$(dirname "$f")
    mkdir -p "$tmp/$dir"
    if fetch_pkg "$tmp/$f" "$base/$f" "$f" "$bn" "${ARCHIVE_DIR:+$ARCHIVE_DIR/$f}"; then
      :
    elif fetch_pkg "$tmp/$f" "$REPO_RAW/$f" "$f" "$bn"; then
      :
    else
      ucwc_log "错误：未找到或校验失败：$f"
      exit 1
    fi
  done

  if [ "$INSTALL_MODE" = "ota" ]; then
    ucwc_log "OTA 统计：跳过 ${OTA_SKIPPED:-0} 个未变文件，下载 ${OTA_FETCHED:-0} 个"
    progress 65 "OTA 比对完成" "跳过 ${OTA_SKIPPED:-0} · 下载 ${OTA_FETCHED:-0}"
  fi

  progress 70 "迁移缓存" "删除启动盘旧歌词/封面缓存（保留配置）"
  clear_legacy_boot_caches

  progress 75 "写入文件" "安装到 flash + runtime"
  install_pair "$tmp/ThemeMusic.page" "$MUSIC_PAGE" "$MUSIC_RUNTIME"
  install_pair "$tmp/ThemeMusic_Loader.page" "$LOADER_PAGE" "$LOADER_RUNTIME"
  install_pair "$tmp/PLUGIN-README.md" "$PERSIST_DIR/README.md" "$RUNTIME_DIR/README.md"
  install_pair "$tmp/ucwc-music-api.php" "$PERSIST_DIR/ucwc-music-api.php" "$RUNTIME_DIR/ucwc-music-api.php"
  install_pair "$tmp/theme-music-save.php" "$PERSIST_DIR/theme-music-save.php" "$RUNTIME_DIR/theme-music-save.php"
  install_pair "$tmp/theme-music-update.php" "$PERSIST_DIR/theme-music-update.php" "$RUNTIME_DIR/theme-music-update.php"
  install_pair "$tmp/assets/ucwc-music.js" "$PERSIST_DIR/assets/ucwc-music.js" "$RUNTIME_DIR/assets/ucwc-music.js"
  install_pair "$tmp/assets/ucwc-music.css" "$PERSIST_DIR/assets/ucwc-music.css" "$RUNTIME_DIR/assets/ucwc-music.css"
  install_pair "$tmp/assets/theme-music-settings.css" "$PERSIST_DIR/assets/theme-music-settings.css" "$RUNTIME_DIR/assets/theme-music-settings.css"
  install_pair "$tmp/assets/theme-music-settings.js" "$PERSIST_DIR/assets/theme-music-settings.js" "$RUNTIME_DIR/assets/theme-music-settings.js"

  # Preserve user cfg; seed defaults on first install; fill missing keys
  if [ ! -f "$MUSIC_CFG" ]; then
    install -m 0644 "$tmp/theme-music.cfg" "$MUSIC_CFG"
  else
    while IFS='=' read -r k v; do
      [ -n "$k" ] || continue
      case "$k" in \#*) continue ;; esac
      if ! grep -q "^${k}=" "$MUSIC_CFG" 2>/dev/null; then
        # MUSIC_RUN_MODE: do not seed package default "card" over legacy sitewide.
        # Derive from existing ENABLE + DASH_ONLY when missing.
        if [ "$k" = "MUSIC_RUN_MODE" ]; then
          _en=$(grep -E '^MUSIC_ENABLE=' "$MUSIC_CFG" 2>/dev/null | head -1 | sed 's/^MUSIC_ENABLE=//;s/^"//;s/"$//')
          _dash=$(grep -E '^MUSIC_DASH_ONLY=' "$MUSIC_CFG" 2>/dev/null | head -1 | sed 's/^MUSIC_DASH_ONLY=//;s/^"//;s/"$//')
          if [ "$_en" = "yes" ] && [ "$_dash" = "no" ]; then
            v='"both"'
          elif [ "$_en" = "yes" ]; then
            v='"card"'
          else
            v='"card"'
          fi
        fi
        printf '%s=%s\n' "$k" "$v" >> "$MUSIC_CFG"
      fi
    done < "$tmp/theme-music.cfg"
    # If RUN_MODE was already wrongly seeded as card while DASH_ONLY=no (Beta8 first OTA), heal once.
    if grep -q '^MUSIC_RUN_MODE="card"' "$MUSIC_CFG" 2>/dev/null \
      && grep -q '^MUSIC_DASH_ONLY="no"' "$MUSIC_CFG" 2>/dev/null \
      && grep -q '^MUSIC_ENABLE="yes"' "$MUSIC_CFG" 2>/dev/null; then
      # Prefer explicit both when user had legacy sitewide and never saved a run mode intentionally.
      # Only heal when UI is still card (package/legacy default), not chip.
      _ui=$(grep -E '^MUSIC_UI=' "$MUSIC_CFG" 2>/dev/null | head -1 | sed 's/^MUSIC_UI=//;s/^"//;s/"$//')
      if [ "$_ui" = "card" ] || [ "$_ui" = "both" ] || [ -z "$_ui" ]; then
        sed -i 's/^MUSIC_RUN_MODE="card"/MUSIC_RUN_MODE="both"/' "$MUSIC_CFG" 2>/dev/null || true
        sed -i 's/^MUSIC_UI="card"/MUSIC_UI="both"/' "$MUSIC_CFG" 2>/dev/null || true
        ucwc_log "已将遗留全站配置对齐为 MUSIC_RUN_MODE=both"
      fi
    fi
  fi
  if [ ! -f "$SERVICE_CFG" ]; then
    install -m 0644 "$tmp/theme.music.cfg" "$SERVICE_CFG"
  fi

  # The boot PLG was installed before this updater ran. Do not overwrite its
  # verified offline bootstrap with a potentially stale CDN or immutable release asset.

  # Publish installed version only after all runtime files have been verified and written.
  write_options
  {
    printf 'version=%s\n' "$VERSION"
    printf 'install_mode=%s\n' "$INSTALL_MODE"
    printf 'updated_at=%s\n' "$(date +%Y%m%d-%H%M%S)"
    printf 'source=deltrivx/ThemeMusic\n'
  } > "$STATE_FILE"

  progress 95 "收尾" "写入状态"
  echo "已安装：ThemeMusic $VERSION（模式：$INSTALL_MODE）"
  if [ "$INSTALL_MODE" = "ota" ]; then
    echo "  OTA：跳过 ${OTA_SKIPPED:-0} 个未变文件，实际下载 ${OTA_FETCHED:-0} 个"
  fi
  echo "打开：设置 → 用户偏好 → Theme Music"
  echo "请强制刷新 Unraid WebGUI（Ctrl+F5）。"
  if [ -f "/boot/config/plugins/theme.effects/theme-effects.cfg" ]; then
    echo "提示：检测到 ThemeEffects。请勿两边同时开启音乐。"
  fi
}

uninstall_plugin() {
  rm -f \
    "$MUSIC_PAGE" "$MUSIC_RUNTIME" \
    "$LOADER_PAGE" "$LOADER_RUNTIME" \
    "$PERSIST_DIR/README.md" "$RUNTIME_DIR/README.md" \
    "$PERSIST_DIR/ucwc-music-api.php" "$RUNTIME_DIR/ucwc-music-api.php" \
    "$PERSIST_DIR/theme-music-save.php" "$RUNTIME_DIR/theme-music-save.php" \
    "$PERSIST_DIR/theme-music-update.php" "$RUNTIME_DIR/theme-music-update.php" \
    "$PERSIST_DIR/assets/ucwc-music.js" "$RUNTIME_DIR/assets/ucwc-music.js" \
    "$PERSIST_DIR/assets/ucwc-music.css" "$RUNTIME_DIR/assets/ucwc-music.css" \
    "$PERSIST_DIR/assets/theme-music-settings.css" "$RUNTIME_DIR/assets/theme-music-settings.css" \
    "$PERSIST_DIR/assets/theme-music-settings.js" "$RUNTIME_DIR/assets/theme-music-settings.js" \
    "$OPTIONS_FILE"
  # Keep flash configuration and secrets; dynamic media caches are retired.
  printf 'SERVICE="disabled"\n' > "$SERVICE_CFG" 2>/dev/null || true
  rm -rf "$RUNTIME_DIR"
  echo "ThemeMusic 已卸载（flash 配置保留于 $PERSIST_DIR）。请强制刷新 WebGUI。"
}

select_and_install_version() {
  index=$(fetch_index)
  count=$(printf '%s' "$index" | jq '.versions | length')
  echo "可安装版本："
  i=0
  while [ "$i" -lt "$count" ]; do
    id=$(printf '%s' "$index" | jq -r ".versions[$i].id")
    label=$(printf '%s' "$index" | jq -r ".versions[$i].label")
    released=$(printf '%s' "$index" | jq -r ".versions[$i].released_at")
    channel=$(printf '%s' "$index" | jq -r ".versions[$i].channel")
    suffix=""
    [ "$channel" = "latest" ] && suffix=" [最新版]"
    printf '  %s) %s%s - %s（%s）\n' "$((i + 1))" "$id" "$suffix" "$label" "$released"
    i=$((i + 1))
  done
  printf '请选择版本 [1]：'
  read -r choice
  choice=${choice:-1}
  case "$choice" in *[!0-9]*|'') echo "无效选择" >&2; exit 64 ;; esac
  [ "$choice" -ge 1 ] && [ "$choice" -le "$count" ] || {
    echo "选择超出范围" >&2
    exit 64
  }
  VERSION=$(printf '%s' "$index" | jq -r ".versions[$((choice - 1))].id")
  install_version
}

show_menu() {
  latest=$(fetch_index | jq -r '.latest_version // .default')
  installed="未安装"
  if [ -f "$MUSIC_PAGE" ] || [ -f "$MUSIC_RUNTIME" ]; then installed="已安装"; fi
  cat <<EOF
Theme Music — 独立插件 theme.music
当前状态：$installed
最新版：$latest

  1) 一键安装 / 升级最新版（$latest）
  2) 查看并安装指定版本
  3) 一键卸载
  4) 退出
EOF
  printf '请选择操作 [1]：'
  read -r action
  action=${action:-1}
  case "$action" in
    1) VERSION=$latest; install_version ;;
    2) select_and_install_version ;;
    3) uninstall_plugin ;;
    4) exit 0 ;;
    *) echo "无效选择" >&2; exit 64 ;;
  esac
}

if [ -n "${UCWC_INSTALL_MODE:-}" ]; then
  case "$UCWC_INSTALL_MODE" in ota|full) INSTALL_MODE="$UCWC_INSTALL_MODE" ;; esac
fi

[ "$(id -u)" -eq 0 ] || { echo "请使用 root 用户运行。" >&2; exit 77; }
command -v curl >/dev/null 2>&1 || { echo "缺少 curl。" >&2; exit 69; }
command -v jq >/dev/null 2>&1 || { echo "缺少 jq。" >&2; exit 69; }

if [ "$#" -eq 0 ]; then
  if [ -t 0 ]; then
    show_menu
  else
    VERSION=$(fetch_index | jq -r '.latest_version // .default')
    echo "正在安装：$VERSION…"
    install_version
  fi
  exit 0
fi

case "$1" in
  install)
    VERSION=""
    case "${INSTALL_MODE:-}" in
      ota|full) ;;
      *) INSTALL_MODE="ota" ;;
    esac
    shift
    for _arg in "$@"; do
      case "$_arg" in
        ota|full) INSTALL_MODE="$_arg" ;;
        v[0-9]*) VERSION="$_arg" ;;
        *)
          if [ -z "$VERSION" ] && printf '%s' "$_arg" | grep -qE '^v[0-9]'; then
            VERSION="$_arg"
          fi
          ;;
      esac
    done
    if [ -z "$VERSION" ]; then
      VERSION=$(fetch_index | jq -r '.latest_version // .default')
    fi
    echo "正在安装：$VERSION（模式：$INSTALL_MODE）…"
    install_version
    ;;
  uninstall)
    uninstall_plugin
    ;;
  menu)
    [ -t 0 ] || { echo "menu 需要交互式终端。" >&2; exit 64; }
    show_menu
    ;;
  list)
    index=$(fetch_index)
    count=$(printf '%s' "$index" | jq '.versions | length')
    latest=$(printf '%s' "$index" | jq -r '.latest_version // .default')
    echo "latest=$latest"
    i=0
    while [ "$i" -lt "$count" ]; do
      id=$(printf '%s' "$index" | jq -r ".versions[$i].id")
      label=$(printf '%s' "$index" | jq -r ".versions[$i].label")
      channel=$(printf '%s' "$index" | jq -r ".versions[$i].channel")
      printf '%s\t%s\t%s\n' "$id" "$channel" "$label"
      i=$((i + 1))
    done
    ;;
  *)
    echo "用法：install.sh [install [version]|uninstall|menu|list]" >&2
    exit 64
    ;;
esac
