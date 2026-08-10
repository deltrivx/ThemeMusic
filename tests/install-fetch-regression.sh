#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/thememusic-install-test.XXXXXX")
trap 'rm -rf "$TMP"' EXIT INT TERM

# Execute the production functions with a local fixture instead of a network.
awk '/^download\(\) \{/,/^\}$/ { print } /^fetch_pkg\(\) \{/,/^\}$/ { print }' \
  "$ROOT/scripts/install.sh" > "$TMP/functions.sh"
cat > "$TMP/harness.sh" <<'EOF'
#!/bin/sh
set -eu
ucwc_log() { :; }
ucwc_url_candidates() { printf '%s\n' "$1"; }
ucwc_curl() {
  dest=""
  previous=""
  for arg in "$@"; do
    if [ "$previous" = "-o" ]; then dest="$arg"; previous=""; continue; fi
    [ "$arg" = "-o" ] && previous="-o"
  done
  cp "$FIXTURE" "$dest"
}
manifest_get() { [ "$2" = "sha256" ] && printf '%s' "$EXPECTED_SHA" || printf '%s' "$EXPECTED_SIZE"; }
local_path_for() { printf '%s' ''; }
file_sha256() { sha256sum "$1" | awk '{print $1}'; }
file_size() { wc -c < "$1" | tr -d ' '; }
verify_download() {
  [ "$(file_sha256 "$1")" = "$EXPECTED_SHA" ] && [ "$(file_size "$1")" = "$EXPECTED_SIZE" ]
}
INSTALL_MODE=full
OTA_FETCHED=0
OTA_SKIPPED=0
. "$FUNCTIONS"
fetch_pkg "$TARGET" https://example.invalid/ThemeMusic.page ThemeMusic.page
[ -s "$TARGET" ]
[ ! -e "$TARGET.download.$$" ]
[ "$OTA_FETCHED" = 1 ]
EOF
printf 'Theme Music installer regression fixture\n' > "$TMP/fixture"
EXPECTED_SHA=$(sha256sum "$TMP/fixture" | awk '{print $1}')
EXPECTED_SIZE=$(wc -c < "$TMP/fixture" | tr -d ' ')
FIXTURE="$TMP/fixture" TARGET="$TMP/result" FUNCTIONS="$TMP/functions.sh" EXPECTED_SHA="$EXPECTED_SHA" EXPECTED_SIZE="$EXPECTED_SIZE" \
  sh "$TMP/harness.sh"
printf '%s\n' 'installer fetch regression passed'
