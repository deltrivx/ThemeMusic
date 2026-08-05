#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-}"
cd "$ROOT"

echo "[1/7] JavaScript 与 Shell 语法"
node --check assets/ucwc-music.js
node --check assets/theme-music-settings.js
python3 - <<'PY'
import pathlib, re
player = pathlib.Path('assets/ucwc-music.js').read_text(encoding='utf-8')
api = pathlib.Path('ucwc-music-api.php').read_text(encoding='utf-8')
installer = pathlib.Path('scripts/install.sh').read_text(encoding='utf-8')
assert 'window.open(' not in player, '播放器不得包含 window.open 弹窗'
assert 'BroadcastChannel' not in player, '播放器不得包含 BroadcastChannel 跨标签通信'
assert 'HOST_NAME' not in player and 'HOST_CHANNEL' not in player, '播放器不得包含宿主弹窗常量'
assert '"strategy" => "smb"' in api and '"strategy" => "nfs"' in api, '缺少 SMB/NFS 独立存储策略'
assert 'cmdWOL' in api and '"local_disk"' in api, 'emcmd 必须只用于本地磁盘唤醒'
assert 'pathinfo($rel, PATHINFO_FILENAME)' in api and '.lrc' in api, '歌词未按歌曲名匹配同目录文件'
assert 'pathinfo($rel, PATHINFO_FILENAME)' in api and '.jpg' in api, '封面未按歌曲名匹配同目录文件'
assert 'clear_legacy_boot_caches' in installer and 'rm -rf -- "$_legacy"' in installer, '安装器缺少旧启动盘缓存清理'
print('JS 语法与无弹窗约束通过')
PY
sh -n scripts/install.sh
bash -n scripts/build-release.sh
bash -n scripts/verify-release.sh

echo "[2/7] JSON 与版本索引"
python3 -m json.tool versions/index.json >/dev/null
python3 - <<'PY'
import json, pathlib, re
root = pathlib.Path('.')
index = json.loads((root / 'versions/index.json').read_text())
ids = [item['id'] for item in index['versions']]
assert ids, '版本索引为空'
assert len(ids) == len(set(ids)), '版本索引存在重复 id'
assert index['default'] == index['latest_version'] == ids[0], '默认、最新和首项不一致'
latest_channels = [item['id'] for item in index['versions'] if item.get('channel') == 'latest']
latest_id = index['latest_version']
latest_item = next(item for item in index['versions'] if item['id'] == latest_id)
for item in index['versions']:
    version_dir = root / 'versions' / item['id']
    assert version_dir.is_dir(), f"索引版本缺少快照目录：{item['id']}"
    assert (version_dir / 'files.manifest').is_file(), f"索引版本缺少 manifest：{item['id']}"
assert latest_channels in ([], [latest_id]), f'latest 频道标记错误：{latest_channels}'
assert latest_item.get('channel') in ('latest', 'beta'), '最新版本必须属于 latest 或 beta 频道'
plg = (root / 'theme.music.plg').read_text()
m = re.search(r'<!ENTITY\s+version\s+"([^"]+)">', plg)
assert m and m.group(1) == ids[0], 'PLG 版本与索引不一致'
readme = (root / 'README.md').read_text()
assert ids[0] in readme, 'README 未声明当前版本'
changelog = (root / 'CHANGELOG.md').read_text()
assert re.search(r'^##\s+' + re.escape(ids[0]) + r'\b', changelog, re.M), 'CHANGELOG 缺少当前版本'
print(f"当前版本：{ids[0]}；索引版本数：{len(ids)}")
PY

python3 - <<'PY'
import pathlib
api = pathlib.Path('ucwc-music-api.php').read_text()
player = pathlib.Path('assets/ucwc-music.js').read_text()
page = pathlib.Path('ThemeMusic.page').read_text()
loader = pathlib.Path('ThemeMusic_Loader.page').read_text()
css = pathlib.Path('assets/theme-music-settings.css').read_text()
assert 'function m_local_scan_files(' in api and 'function m_local_music_root(' in api, '本地曲库扫描器缺失'
assert 'library_remote' in api and 'fnos' in api and 'navidrome' in api, '远端音源路由缺失'
assert 'listRenderLimit: 300' in player and 'ucwc-music-list-more' in player, '大曲库缺少分段渲染'
assert 'LYRIC_DRIFT_KEY' in player and 'adjustLyricDrift(500)' in player and 'adjustLyricDrift(-500)' in player, '歌词时间校准不完整'
assert 'tm-fnos-url' in page and 'fnos_test' in api, 'FnOS 音源设置或连接测试缺失'
assert 'in_array($src, ["local", "navidrome", "fnos"]' in page, '设置页未保留 FnOS source'
assert 'data-tm-source-row="local"' in page and 'data-tm-source-row="navidrome"' in page and 'data-tm-source-row="fnos"' in page, '设置页三套音源行不完整'
assert 'class="tm-source-config"' not in page and 'class="tm-source-row"' not in page, '设置页仍包含会造成二次偏移的 source wrapper/grid'
assert 'action === "list"' in api and 'action === "set_service"' in api, '播放器或服务按钮 action 缺失'
assert 'action === "check_update"' in api and 'action === "changelog"' in api, '版本管理 action 缺失'
assert '"detected"' in api and '"status"' in api, '存储状态字段契约缺失'
assert '&path=' in player and 'action=cover&path=' in player, '播放器媒体参数未统一为 path'
assert 'MUSIC_FNOS_URL' in loader and 'fnos_url' in loader and 'fnos_user' in loader, 'Loader 未注入 FnOS 配置'
print('曲库、远端音源、歌词校准与设置布局约束通过')
PY

echo "[3/7] 所有版本清单哈希与正式 tag 基线"
python3 - <<'PY'
import hashlib, json, pathlib, subprocess, tempfile
root = pathlib.Path('versions')
current_version = json.loads((root / 'index.json').read_text())['latest_version']
# These published GitHub tags came from the pre-snapshot release chain. Their
# immutable tag trees differ from later corrected snapshots. Keep manifest
# validation for each, but do not use their embedded snapshots as a baseline.
legacy_remote_tag_mismatch_versions = {
    'v1.3.3', 'v1.3.4', 'v1.3.5', 'v1.3.6', 'v1.3.7', 'v1.3.8'
}
count = 0
for manifest in sorted(root.glob('*/files.manifest')):
    data = json.loads(manifest.read_text())
    version = manifest.parent.name
    assert data.get('version') == version, f'{manifest}: version 不一致'
    for item in data.get('files', []):
        path = manifest.parent / item['path']
        assert path.is_file(), f'{manifest}: 缺少 {item["path"]}'
        raw = path.read_bytes()
        assert len(raw) == item['size'], f'{path}: size 不一致'
        assert hashlib.sha256(raw).hexdigest() == item['sha256'], f'{path}: sha256 不一致'
        count += 1

    # A stable release archive must be byte-for-byte identical to its tag.
    # Beta snapshots may intentionally follow the current development tree.
    if '-beta' not in version and version != current_version:
        try:
            subprocess.run(['git', 'cat-file', '-e', f'{version}^{{commit}}'], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except subprocess.CalledProcessError:
            raise AssertionError(f'{version}: 缺少对应 Git tag，无法证明正式快照来源')
        if version in legacy_remote_tag_mismatch_versions:
            print(f'{version}: 跳过已记录的远端历史快照字节差异')
            continue
        # Compare each tracked archive file directly through git show.
        for item in data.get('files', []):
            path = manifest.parent / item['path']
            rel = path.relative_to(root.parent).as_posix()
            expected = subprocess.check_output(['git', 'show', f'{version}:{rel}'])
            assert path.read_bytes() == expected, f'{path}: 与 {version} tag 不一致'
print(f'已校验 {count} 个版本文件')
PY

echo "[4/7] PLG 内联脚本"
python3 - <<'PY'
import html, pathlib, re, subprocess, tempfile
text = pathlib.Path('theme.music.plg').read_text()
blocks = re.findall(r'<FILE(?: [^>]*)? Run="/bin/bash"(?: [^>]*)?>\s*<INLINE>\n(.*?)\n</INLINE>', text, re.S)
assert blocks, '未找到 PLG 内联脚本'
for idx, block in enumerate(blocks):
    block = block.replace('<![CDATA[', '').replace(']]>', '')
    block = html.unescape(block)
    for key, value in {
        '&ver;': 'v0.0.0', '&flash;': '/tmp/theme.music', '&plugdir;': '/tmp/theme.music.runtime',
        '&installSH;': 'https://example.invalid/install.sh', '&github;': 'owner/repo'
    }.items():
        block = block.replace(key, value)
    with tempfile.NamedTemporaryFile('w', suffix='.sh') as fh:
        fh.write(block); fh.flush()
        subprocess.run(['bash', '-n', fh.name], check=True)
print(f'已校验 {len(blocks)} 个内联脚本')
PY

echo "[5/7] 文档与许可证"
for file in README.md ABOUT.md CHANGELOG.md PLUGIN-README.md CONTRIBUTING.md SECURITY.md SUPPORT.md LICENSE LICENSE-ASSETS.md NOTICE; do
  test -s "$file" || { echo "缺少文档：$file" >&2; exit 1; }
done
grep -q '^[[:space:]]*GNU GENERAL PUBLIC LICENSE$' LICENSE
grep -q '代码许可-GPL--2.0' README.md
grep -q '^SERVICE="disabled"$' theme.music.cfg
if grep -q '代码许可-MIT' README.md; then
  echo "README 仍声明 MIT" >&2
  exit 1
fi

echo "[6/7] 当前源文件一致性"
if [ -n "$VERSION" ]; then
  test -d "versions/$VERSION" || { echo "版本目录不存在：$VERSION" >&2; exit 1; }
  for rel in ThemeMusic.page ThemeMusic_Loader.page PLUGIN-README.md assets/theme-music-settings.css assets/theme-music-settings.js assets/ucwc-music.css assets/ucwc-music.js theme-music-save.php theme-music-update.php theme-music.cfg theme.music.cfg ucwc-music-api.php; do
    if [[ "$VERSION" == *-beta* ]]; then
      cmp -s "$rel" "versions/$VERSION/$rel" || { echo "快照不一致：$rel" >&2; exit 1; }
    else
      git cat-file -e "$VERSION:$rel" 2>/dev/null || { echo "tag 缺少文件：$VERSION:$rel" >&2; exit 1; }
      case "$VERSION" in
        v1.3.3|v1.3.4|v1.3.5|v1.3.6|v1.3.7|v1.3.8) continue ;;
      esac
      cmp -s "versions/$VERSION/$rel" <(git show "$VERSION:$rel") || { echo "正式快照与 tag 不一致：$rel" >&2; exit 1; }
    fi
  done
else
  echo "未指定版本，跳过当前快照比较"
fi

echo "[7/7] 发布产物"
if [ -n "$VERSION" ]; then
  (
    cd "dist/$VERSION"
    shasum -a 256 -c SHA256SUMS
    tar -tzf "ThemeMusic-$VERSION.tar.gz" | awk -v p="ThemeMusic-$VERSION" '
      /(^|\/)\._/ { bad=1 }
      $0 == p || index($0, p "/") == 1 { next }
      { bad=1 }
      END { exit bad }
    '
    if zipinfo -1 "ThemeMusic-$VERSION.zip" | grep -Eq '(^|/)\._'; then
      echo "ZIP 含 macOS AppleDouble 元数据" >&2
      exit 1
    fi
  )
else
  echo "未指定版本，跳过发布产物校验"
fi

echo "Theme Music 发布检查全部通过。"
