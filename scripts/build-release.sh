#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-}"
MODE="${2:-snapshot}"

if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[Bb]eta[0-9]*)?$ ]]; then
  echo "用法：$0 v主版本.次版本.修订版本 [snapshot|existing]" >&2
  exit 2
fi
if [[ "$MODE" != "snapshot" && "$MODE" != "existing" ]]; then
  echo "模式只能是 snapshot 或 existing" >&2
  exit 2
fi

VERSION_DIR="$ROOT/versions/$VERSION"
DIST_DIR="$ROOT/dist/$VERSION"
PACKAGE_DIR="$DIST_DIR/ThemeMusic-$VERSION"
SOURCE_REF=""
if git -C "$ROOT" rev-parse --verify -q "$VERSION^{commit}" >/dev/null; then
  SOURCE_REF="$VERSION"
fi
RUNTIME_FILES=(
  ThemeMusic.page
  ThemeMusic_Loader.page
  PLUGIN-README.md
  assets/theme-music-settings.css
  assets/theme-music-settings.js
  assets/ucwc-music.css
  assets/ucwc-music.js
  theme-music-save.php
  theme-music-update.php
  theme-music.cfg
  theme.music.cfg
  ucwc-music-api.php
)

copy_source_file() {
  local rel="$1"
  local dest="$2"
  if [[ -n "$SOURCE_REF" ]]; then
    git -C "$ROOT" show "$SOURCE_REF:$rel" > "$dest"
  else
    cp "$ROOT/$rel" "$dest"
  fi
}

if [[ "$MODE" == "snapshot" ]]; then
  if [[ "$VERSION" != *-beta* && -z "$SOURCE_REF" ]]; then
    echo "正式版本 $VERSION 缺少对应 Git tag；拒绝从当前工作树生成正式快照" >&2
    exit 1
  fi
  rm -rf "$VERSION_DIR"
  mkdir -p "$VERSION_DIR/assets"
  for rel in "${RUNTIME_FILES[@]}"; do
    mkdir -p "$VERSION_DIR/$(dirname "$rel")"
    copy_source_file "$rel" "$VERSION_DIR/$rel"
  done
elif [[ ! -d "$VERSION_DIR" ]]; then
  echo "版本目录不存在：$VERSION_DIR" >&2
  exit 1
fi

python3 - "$VERSION" "$VERSION_DIR" "${RUNTIME_FILES[@]}" <<'PY'
import hashlib
import json
import pathlib
import sys

version = sys.argv[1]
base = pathlib.Path(sys.argv[2])
files = []
for rel in sys.argv[3:]:
    path = base / rel
    if not path.is_file():
        continue
    data = path.read_bytes()
    files.append({
        "path": rel,
        "sha256": hashlib.sha256(data).hexdigest(),
        "size": len(data),
    })
(base / "files.manifest").write_text(
    json.dumps({"schema": 1, "version": version, "files": files}, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
PY

rm -rf "$DIST_DIR"
mkdir -p "$PACKAGE_DIR"
cp -R "$VERSION_DIR"/. "$PACKAGE_DIR"/

copy_release_file() {
  local rel="$1"
  local dest="$2"
  local ref=""
  if [[ -n "$SOURCE_REF" ]]; then
    ref="$SOURCE_REF"
  elif [[ "$MODE" == "existing" ]]; then
    ref="$VERSION"
  fi
  if [[ -n "$ref" ]]; then
    if git -C "$ROOT" cat-file -e "$ref:$rel" 2>/dev/null; then
      git -C "$ROOT" show "$ref:$rel" > "$dest"
    else
      return 1
    fi
  else
    cp "$ROOT/$rel" "$dest"
  fi
}

copy_release_file theme.music.plg "$PACKAGE_DIR/theme.music.plg"
copy_release_file README.md "$PACKAGE_DIR/README.md"
copy_release_file CHANGELOG.md "$PACKAGE_DIR/CHANGELOG.md"
copy_release_file scripts/install.sh "$PACKAGE_DIR/install.sh"
for doc in ABOUT.md CONTRIBUTING.md SECURITY.md SUPPORT.md LICENSE LICENSE-ASSETS.md NOTICE; do
  copy_release_file "$doc" "$PACKAGE_DIR/$doc" || true
done

# Historical manifests used date-letter package versions. Release artifacts use
# one canonical semantic version in both Unraid's package version and OTA target.
python3 - "$VERSION" "$PACKAGE_DIR/theme.music.plg" <<'PY'
import pathlib
import re
import sys

version = sys.argv[1]
path = pathlib.Path(sys.argv[2])
text = path.read_text(encoding="utf-8")
text = re.sub(r'(<!ENTITY\s+version\s+")[^"]+(">)', rf'\g<1>{version}\2', text, count=1)
text = re.sub(r'(<!ENTITY\s+ver\s+")[^"]+(">)', rf'\g<1>{version}\2', text, count=1)
path.write_text(text, encoding="utf-8")
PY

(
  cd "$DIST_DIR"
  # macOS otherwise serializes extended attributes as hidden AppleDouble
  # entries (._*) that produce warnings and fail strict archive validation on
  # Unraid/Linux.
  COPYFILE_DISABLE=1 zip -q -X -r "ThemeMusic-$VERSION.zip" "ThemeMusic-$VERSION"
  tar_flags=(--no-xattrs)
  if tar --version 2>&1 | grep -qi bsdtar; then
    tar_flags+=(--no-mac-metadata)
  fi
  COPYFILE_DISABLE=1 tar "${tar_flags[@]}" -czf "ThemeMusic-$VERSION.tar.gz" "ThemeMusic-$VERSION"
  cp "$PACKAGE_DIR/theme.music.plg" "theme.music-$VERSION.plg"
  cp "$PACKAGE_DIR/files.manifest" files.manifest
  cp "$PACKAGE_DIR/install.sh" install.sh
  shasum -a 256 \
    "ThemeMusic-$VERSION.zip" \
    "ThemeMusic-$VERSION.tar.gz" \
    "theme.music-$VERSION.plg" \
    files.manifest \
    install.sh > SHA256SUMS
)

echo "版本目录：$VERSION_DIR"
echo "发布产物：$DIST_DIR"
