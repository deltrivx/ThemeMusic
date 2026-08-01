#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-}"
cd "$ROOT"

echo "[1/7] JavaScript 与 Shell 语法"
node --check assets/ucwc-music.js
node --check assets/theme-music-settings.js
python3 - <<'PY'
import pathlib, re, subprocess, tempfile
host = pathlib.Path('assets/ucwc-music-host.html').read_text(encoding='utf-8')
match = re.search(r'<script>\s*(.*?)\s*</script>', host, re.S)
assert match, '音乐宿主缺少内联脚本'
with tempfile.NamedTemporaryFile('w', suffix='.js') as fh:
    fh.write(match.group(1)); fh.flush()
    subprocess.run(['node', '--check', fh.name], check=True)
player = pathlib.Path('assets/ucwc-music.js').read_text(encoding='utf-8')
assert player.count('hostWindow = window.open(') == 1, '宿主窗口创建点必须严格等于一处'
assert 'var HOST_NAME = "ucwc_theme_music_host_v2";' in player, '客户端缺少固定宿主窗口名'
assert 'var HOST_NAME = "ucwc_theme_music_host_v2";' in host, '宿主页面窗口名不一致'
assert 'window.open(' not in host, '宿主页面不得创建任何新窗口'
assert not re.search(r'set(?:Interval|Timeout)\s*\([^;]{0,1000}window\.open\s*\(', player, re.S), '定时器不得创建宿主窗口'
print('音乐宿主语法与单窗口约束通过')
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
plg = (root / 'theme.music.plg').read_text()
m = re.search(r'<!ENTITY\s+version\s+"([^"]+)">', plg)
assert m and m.group(1) == ids[0], 'PLG 版本与索引不一致'
readme = (root / 'README.md').read_text()
assert ids[0] in readme, 'README 未声明当前版本'
changelog = (root / 'CHANGELOG.md').read_text()
assert re.search(r'^##\s+' + re.escape(ids[0]) + r'\b', changelog, re.M), 'CHANGELOG 缺少当前版本'
print(f"当前版本：{ids[0]}；索引版本数：{len(ids)}")
PY

echo "[3/7] 所有版本清单哈希"
python3 - <<'PY'
import hashlib, json, pathlib
root = pathlib.Path('versions')
count = 0
for manifest in sorted(root.glob('*/files.manifest')):
    data = json.loads(manifest.read_text())
    assert data.get('version') == manifest.parent.name, f'{manifest}: version 不一致'
    for item in data.get('files', []):
        path = manifest.parent / item['path']
        assert path.is_file(), f'{manifest}: 缺少 {item["path"]}'
        raw = path.read_bytes()
        assert len(raw) == item['size'], f'{path}: size 不一致'
        assert hashlib.sha256(raw).hexdigest() == item['sha256'], f'{path}: sha256 不一致'
        count += 1
print(f'已校验 {count} 个版本文件')
PY

echo "[4/7] PLG 内联脚本"
python3 - <<'PY'
import html, pathlib, re, subprocess, tempfile
text = pathlib.Path('theme.music.plg').read_text()
blocks = re.findall(r'<FILE(?: [^>]*)? Run="/bin/bash"(?: [^>]*)?>\s*<INLINE>\n(.*?)\n</INLINE>', text, re.S)
assert blocks, '未找到 PLG 内联脚本'
for idx, block in enumerate(blocks):
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
grep -q '^# PolyForm Noncommercial License 1.0.0$' LICENSE
grep -q 'PolyForm Noncommercial License 1.0.0' README.md
grep -q '^SERVICE="disabled"$' theme.music.cfg
if grep -q '代码许可-MIT' README.md; then
  echo "README 仍声明 MIT" >&2
  exit 1
fi

echo "[6/7] 当前源文件一致性"
if [ -n "$VERSION" ]; then
  test -d "versions/$VERSION" || { echo "版本目录不存在：$VERSION" >&2; exit 1; }
  for rel in ThemeMusic.page ThemeMusic_Loader.page PLUGIN-README.md assets/theme-music-settings.css assets/theme-music-settings.js assets/ucwc-music.css assets/ucwc-music-host.html assets/ucwc-music.js theme-music-save.php theme-music-update.php theme-music.cfg theme.music.cfg ucwc-music-api.php; do
    cmp -s "$rel" "versions/$VERSION/$rel" || { echo "快照不一致：$rel" >&2; exit 1; }
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
