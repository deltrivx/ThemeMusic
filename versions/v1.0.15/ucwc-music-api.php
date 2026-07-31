<?php
/**
 * ThemeMusic music API (V1 local source)
 * JSON endpoints for library list + audio stream under configured MUSIC_LOCAL_DIR.
 */
header("X-Content-Type-Options: nosniff");

$persist = "/boot/config/plugins/theme.music";
$fx_path = "$persist/theme-music.cfg";
$dash_pos_path = "$persist/dash-pos.json";
$log_path = "/tmp/ucwc-music-api.log";

function mlog($msg) {
    global $log_path;
    @file_put_contents($log_path, date("Y-m-d H:i:s") . " " . $msg . "\n", FILE_APPEND);
}

function mjson($data, $code = 200) {
    http_response_code($code);
    header("Content-Type: application/json; charset=utf-8");
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function mcfg_resolve_run_mode($d) {
    $mode = strtolower(trim((string)($d["MUSIC_RUN_MODE"] ?? "")));
    if (in_array($mode, ["card", "chip", "both"], true)) return $mode;
    if (($d["MUSIC_ENABLE"] ?? "no") !== "yes") return "card";
    return (($d["MUSIC_DASH_ONLY"] ?? "yes") === "no") ? "both" : "card";
}

function mcfg_load($path) {
    $d = [
        "MUSIC_ENABLE" => "no",
        "MUSIC_RUN_MODE" => "card",
        "MUSIC_UI" => "card",
        "MUSIC_SOURCE" => "local",
        "MUSIC_LOCAL_DIR" => "",
        "MUSIC_VOLUME" => "70",
        "MUSIC_AUTOPLAY" => "no",
        "MUSIC_SHUFFLE" => "no",
        "MUSIC_REPEAT" => "off",
        "MUSIC_DASH_ONLY" => "yes",
        "MUSIC_RUN_MODE_MOBILE" => "same",
        "MUSIC_VOLUME_MOBILE" => "70",
        "MUSIC_AUTOPLAY_MOBILE" => "no",
        "MUSIC_SHUFFLE_MOBILE" => "no",
        "MUSIC_REPEAT_MOBILE" => "off",
    ];
    $had_run_mode = false;
    $had_mobile = false;
    if (is_file($path)) {
        $raw = @parse_ini_file($path);
        if (is_array($raw)) {
            foreach ($d as $k => $v) {
                if (isset($raw[$k]) && $raw[$k] !== "") $d[$k] = (string)$raw[$k];
            }
            $had_run_mode = isset($raw["MUSIC_RUN_MODE"]) && trim((string)$raw["MUSIC_RUN_MODE"]) !== "";
            $had_mobile = isset($raw["MUSIC_RUN_MODE_MOBILE"]) && trim((string)$raw["MUSIC_RUN_MODE_MOBILE"]) !== "";
        }
    }
    if (!$had_run_mode) unset($d["MUSIC_RUN_MODE"]);
    if (!$had_mobile) $d["MUSIC_RUN_MODE_MOBILE"] = "same";
    $mode = mcfg_resolve_run_mode($d);
    $d["MUSIC_RUN_MODE"] = $mode;
    $d["MUSIC_UI"] = $mode;
    $d["MUSIC_DASH_ONLY"] = ($mode === "card") ? "yes" : "no";
    $mm = strtolower(trim((string)($d["MUSIC_RUN_MODE_MOBILE"] ?? "same")));
    $d["MUSIC_RUN_MODE_MOBILE"] = in_array($mm, ["same", "card", "chip", "both"], true) ? $mm : "same";
    return $d;
}

function m_realpath_dir($dir) {
    $dir = trim((string)$dir);
    if ($dir === "") return "";
    // normalize slashes
    $dir = str_replace("\\", "/", $dir);
    $dir = rtrim($dir, "/");
    if ($dir === "" || $dir[0] !== "/") return "";
    // only allow common Unraid mount roots
    $okRoots = ["/mnt/", "/boot/config/plugins/theme.music/"];
    $allowed = false;
    foreach ($okRoots as $r) {
        if (strpos($dir . "/", $r) === 0) { $allowed = true; break; }
    }
    if (!$allowed) return "";
    if (!is_dir($dir)) return "";
    $real = realpath($dir);
    if ($real === false || !is_dir($real)) return "";
    $real = str_replace("\\", "/", $real);
    foreach ($okRoots as $r) {
        if (strpos($real . "/", $r) === 0) return $real;
    }
    return "";
}

function m_ext_ok($name) {
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    return in_array($ext, ["mp3", "flac", "m4a", "aac", "ogg", "opus", "wav", "wma"], true);
}

function m_mime($path) {
    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    $map = [
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "ogg" => "audio/ogg",
        "opus" => "audio/ogg",
        "wav" => "audio/wav",
        "wma" => "audio/x-ms-wma",
    ];
    return $map[$ext] ?? "application/octet-stream";
}

function m_rel_under($root, $file) {
    $root = rtrim(str_replace("\\", "/", $root), "/");
    $file = str_replace("\\", "/", $file);
    if (strpos($file, $root . "/") !== 0 && $file !== $root) return "";
    $rel = substr($file, strlen($root) + 1);
    $rel = str_replace("\\", "/", $rel);
    if ($rel === false || $rel === "" || strpos($rel, "..") !== false) return "";
    return $rel;
}

function m_abs_from_rel($root, $rel) {
    $root = rtrim(str_replace("\\", "/", $root), "/");
    $rel = str_replace("\\", "/", (string)$rel);
    $rel = ltrim($rel, "/");
    if ($rel === "" || strpos($rel, "..") !== false || strpos($rel, "\0") !== false) return "";
    $full = $root . "/" . $rel;
    $real = realpath($full);
    if ($real === false || !is_file($real)) return "";
    $real = str_replace("\\", "/", $real);
    if (strpos($real, $root . "/") !== 0) return "";
    return $real;
}

/**
 * Resolve sidecar LRC path for an audio absolute path.
 * Priority: same stem .lrc (case variants) → lyrics/ or Lyrics/ sibling dir.
 */
function m_find_lrc($audioAbs) {
    $audioAbs = str_replace("\\", "/", (string)$audioAbs);
    if ($audioAbs === "" || !is_file($audioAbs)) return "";
    $dir = str_replace("\\", "/", dirname($audioAbs));
    $stem = pathinfo($audioAbs, PATHINFO_FILENAME);
    if ($stem === "") return "";
    $cands = [
        $dir . "/" . $stem . ".lrc",
        $dir . "/" . $stem . ".LRC",
        $dir . "/lyrics/" . $stem . ".lrc",
        $dir . "/Lyrics/" . $stem . ".lrc",
        $dir . "/lyric/" . $stem . ".lrc",
    ];
    foreach ($cands as $p) {
        if (is_file($p)) {
            $real = realpath($p);
            if ($real !== false && is_file($real)) return str_replace("\\", "/", $real);
        }
    }
    // case-insensitive scan of same directory only (small dirs)
    if (is_dir($dir)) {
        $want = strtolower($stem) . ".lrc";
        $dh = @opendir($dir);
        if ($dh) {
            while (($name = readdir($dh)) !== false) {
                if ($name === "." || $name === "..") continue;
                if (strtolower($name) === $want && is_file($dir . "/" . $name)) {
                    closedir($dh);
                    $real = realpath($dir . "/" . $name);
                    return $real ? str_replace("\\", "/", $real) : ($dir . "/" . $name);
                }
            }
            closedir($dh);
        }
    }
    return "";
}

function m_has_lrc($audioAbs) {
    return m_find_lrc($audioAbs) !== "";
}

/**
 * Normalize title/artist for fuzzy LRC matching.
 */
function m_norm_lyric_key($s) {
    $s = m_strtolower(trim((string)$s));
    if ($s === "") return "";
    $s = str_replace(["　", "–", "—", "－", "_"], [" ", "-", "-", "-", " "], $s);
    $s = preg_replace('/\s*[\(\[（【].*?[\)\]）】]\s*/u', " ", $s);
    $s = preg_replace('/\b(feat\.?|ft\.?|with)\b.*$/iu', "", $s);
    $s = preg_replace('/[^\p{L}\p{N}\s]+/u', "", $s);
    $s = preg_replace('/\s+/u', "", $s);
    return (string)$s;
}

/**
 * Extract non-empty timed lyric body lines (skip credit-ish rows).
 */
function m_lrc_body_texts($text, $limit = 12) {
    $out = [];
    $text = str_replace(["\r\n", "\r"], "\n", (string)$text);
    foreach (explode("\n", $text) as $row) {
        $row = trim($row);
        if ($row === "") continue;
        if (preg_match('/^\[(ti|ar|al|by|offset|re|ve|length):/iu', $row)) continue;
        if (!preg_match_all('/\[(\d{1,3}):(\d{1,2})(?:[\.:](\d{1,3}))?\]/', $row, $ts, PREG_SET_ORDER)) continue;
        $part = $row;
        foreach ($ts as $tm) $part = str_replace($tm[0], "", $part);
        $part = trim($part);
        if ($part === "") continue;
        if (preg_match('/^(作词|作曲|编曲|制作|混音|和声|词[:：]|曲[:：]|编[:：])/u', $part)) continue;
        $out[] = $part;
        if (count($out) >= max(1, (int)$limit)) break;
    }
    return $out;
}

/**
 * Does LRC text plausibly belong to this track?
 * Returns [ok(bool), reason(string)].
 */
function m_lrc_matches_track($text, $artist, $title) {
    $text = (string)$text;
    $title = trim((string)$title);
    $artist = trim((string)$artist);
    if ($text === "" || strpos($text, "[") === false) return [false, "empty"];
    $tKey = m_norm_lyric_key($title);
    if ($tKey === "") return [true, "no-title"];

    [$offset, $meta, $lines] = m_parse_lrc($text);
    unset($offset, $lines);
    $ti = trim((string)($meta["ti"] ?? ""));
    $ar = trim((string)($meta["ar"] ?? ""));
    $tiKey = m_norm_lyric_key($ti);
    $aKey = m_norm_lyric_key($artist);
    $arKey = m_norm_lyric_key($ar);

    if ($tiKey !== "" && $tiKey !== $tKey) {
        $tiHas = ($tKey !== "" && (strpos($tiKey, $tKey) !== false || strpos($tKey, $tiKey) !== false));
        if (!$tiHas) {
            $lenRatio = min(strlen($tiKey), strlen($tKey)) / max(strlen($tiKey), strlen($tKey));
            if ($lenRatio < 0.72) {
                return [false, "ti-mismatch:" . $ti];
            }
        }
    }

    $bodies = m_lrc_body_texts($text, 10);
    if (!count($bodies)) {
        if ($tiKey !== "" && ($tiKey === $tKey || strpos($tiKey, $tKey) !== false || strpos($tKey, $tiKey) !== false)) {
            return [true, "meta-only"];
        }
        return [false, "no-body"];
    }

    $blob = m_norm_lyric_key(implode(" ", $bodies));
    $first = $bodies[0];
    $firstKey = m_norm_lyric_key($first);

    if (preg_match('/^\s*(.+?)\s*[-–—]\s*(.+?)\s*$/u', $first, $bm)) {
        $bannerTitle = m_norm_lyric_key($bm[2]);
        if ($bannerTitle !== "" && $bannerTitle !== $tKey
            && strpos($bannerTitle, $tKey) === false && strpos($tKey, $bannerTitle) === false) {
            if (function_exists("mb_strlen") ? mb_strlen($bm[2], "UTF-8") <= 24 : strlen($bannerTitle) <= 18) {
                return [false, "body-banner:" . $bm[2]];
            }
        }
    }

    $titleInBody = ($tKey !== "" && strpos($blob, $tKey) !== false);
    $titleInFirst = ($tKey !== "" && strpos($firstKey, $tKey) !== false);
    $tiOk = ($tiKey === "" || $tiKey === $tKey || strpos($tiKey, $tKey) !== false || strpos($tKey, $tiKey) !== false);

    if (!$titleInFirst && $aKey !== "" && strlen($firstKey) > strlen($aKey) + 2) {
        if (strpos($firstKey, $aKey) === 0) {
            $rest = substr($firstKey, strlen($aKey));
            if ($rest !== "" && $rest !== $tKey && strpos($rest, $tKey) === false && strpos($tKey, $rest) === false
                && strlen($rest) >= 4 && strlen($rest) <= 24) {
                return [false, "body-glued-title:" . $first];
            }
        }
    }

    // Scan early lines for "歌手-其他歌名" even when [ti] was forged to the filename title
    foreach (array_slice($bodies, 0, 3) as $bline) {
        if (!preg_match('/^\s*(.+?)\s*[-–—]\s*(.+?)\s*$/u', $bline, $bm2)) continue;
        $bt = m_norm_lyric_key($bm2[2]);
        if ($bt === "" || $bt === $tKey) continue;
        if (strpos($bt, $tKey) !== false || strpos($tKey, $bt) !== false) continue;
        $blen = function_exists("mb_strlen") ? mb_strlen($bm2[2], "UTF-8") : strlen($bt);
        if ($blen <= 24) {
            return [false, "early-banner:" . $bm2[2]];
        }
    }

    if ($tiOk) return [true, "ti-ok"];
    if ($titleInBody || $titleInFirst) return [true, "body-has-title"];
    if (strlen($tKey) <= 12) {
        return [false, "title-absent"];
    }
    if ($aKey !== "" && $arKey !== "" && ($arKey === $aKey || strpos($arKey, $aKey) !== false || strpos($aKey, $arKey) !== false)) {
        return [true, "artist-fallback"];
    }
    return [false, "weak-match"];
}

/**
 * Quarantine a bad sidecar/cache LRC so it is not reused.
 */
function m_quarantine_lrc($lrcAbs, $reason = "mismatch") {
    $lrcAbs = str_replace("\\", "/", (string)$lrcAbs);
    if ($lrcAbs === "" || !is_file($lrcAbs)) return "";
    $reason = preg_replace('/[^a-z0-9._-]+/i', "_", (string)$reason);
    if ($reason === "") $reason = "mismatch";
    $dest = $lrcAbs . ".bad-" . $reason . "-" . date("YmdHis");
    if (strlen($dest) > 240) $dest = $lrcAbs . ".bad";
    if (@rename($lrcAbs, $dest)) {
        mlog("lrc-quarantine from={$lrcAbs} to={$dest}");
        return str_replace("\\", "/", $dest);
    }
    if (@unlink($lrcAbs)) {
        mlog("lrc-quarantine-unlink path={$lrcAbs} reason={$reason}");
        return "";
    }
    mlog("lrc-quarantine-fail path={$lrcAbs} reason={$reason}");
    return "";
}

/**
 * Find sidecar LRC only if content matches track meta.
 * On mismatch, quarantine the file and return "".
 */
function m_find_matching_lrc($audioAbs, $rel = "") {
    $path = m_find_lrc($audioAbs);
    if ($path === "") return "";
    [$artist, $title] = m_guess_meta($audioAbs, $rel);
    $raw = @file_get_contents($path);
    if ($raw === false || $raw === "") {
        m_quarantine_lrc($path, "empty");
        return "";
    }
    $text = m_lrc_decode($raw);
    [$ok, $why] = m_lrc_matches_track($text, $artist, $title);
    if ($ok) return $path;
    mlog("lrc-mismatch path={$path} title={$title} reason={$why}");
    m_quarantine_lrc($path, "mismatch");
    return "";
}


/** Resolve Unraid outgoing proxy (same sources as ucwc-update.php). */
function m_outgoing_proxy() {
    static $cached = null;
    if ($cached !== null) return $cached;
    $cached = "";
    foreach (["/var/local/emhttp/proxy.ini", "/usr/local/emhttp/state/proxy.ini", "/usr/local/emhttp/proxy.ini"] as $p) {
        if (!is_file($p)) continue;
        $cfg = @parse_ini_file($p, true);
        if (!is_array($cfg)) $cfg = @parse_ini_file($p, false);
        if (!is_array($cfg)) continue;
        $https = $cfg["https_proxy"] ?? ($cfg["proxy"]["https_proxy"] ?? "");
        $http = $cfg["http_proxy"] ?? ($cfg["proxy"]["http_proxy"] ?? "");
        $url = trim((string)($https !== "" ? $https : $http));
        if ($url !== "") { $cached = $url; break; }
    }
    if ($cached === "") {
        $env = getenv("https_proxy") ?: getenv("HTTPS_PROXY") ?: getenv("http_proxy") ?: getenv("HTTP_PROXY");
        if (is_string($env) && trim($env) !== "") $cached = trim($env);
    }
    if ($cached === "" && is_file("/boot/config/plugins/dynamix/outgoingproxy.cfg")) {
        $op = @parse_ini_file("/boot/config/plugins/dynamix/outgoingproxy.cfg");
        if (is_array($op) && !empty($op["proxy_active"])) {
            $i = (string)$op["proxy_active"];
            $u = trim((string)($op["proxy_url_$i"] ?? ""));
            if ($u !== "") $cached = $u;
        }
    }
    return $cached;
}

/** Simple HTTP GET (curl preferred, proxy-aware). Returns [body|false, err, httpCode]. */
function m_http_get($url, $timeout = 10, $accept = "application/json") {
    $url = trim((string)$url);
    if ($url === "" || !preg_match('#^https?://#i', $url)) return [false, "bad url", 0];
    $accept = trim((string)$accept);
    if ($accept === "") $accept = "*/*";
    $proxy = m_outgoing_proxy();
    $ua = "ThemeMusic/2.6";
    if (function_exists("curl_init")) {
        $ch = curl_init($url);
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 5,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => max(5, (int)$timeout),
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
            CURLOPT_USERAGENT => $ua,
            CURLOPT_HTTPHEADER => ["Accept: $accept"],
            CURLOPT_PROTOCOLS => defined("CURLPROTO_HTTPS") ? (CURLPROTO_HTTP | CURLPROTO_HTTPS) : 3,
            CURLOPT_IPRESOLVE => defined("CURL_IPRESOLVE_V4") ? CURL_IPRESOLVE_V4 : 1,
        ];
        if ($proxy !== "") {
            $opts[CURLOPT_PROXY] = $proxy;
            $opts[CURLOPT_HTTPPROXYTUNNEL] = true;
            if (defined("CURLPROXY_HTTP")) $opts[CURLOPT_PROXYTYPE] = CURLPROXY_HTTP;
        }
        curl_setopt_array($ch, $opts);
        $data = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($data === false || $data === "") {
            $hint = $proxy !== "" ? "" : "（未检测到出站代理）";
            return [false, ($err !== "" ? $err : "empty") . $hint, $code];
        }
        if ($code >= 400) return [false, "HTTP $code", $code];
        return [$data, "", $code];
    }
    $hdr = "Accept: $accept\r\nUser-Agent: $ua\r\n";
    $http = ["timeout" => max(5, (int)$timeout), "header" => $hdr];
    if ($proxy !== "") $http["proxy"] = $proxy;
    $ctx = stream_context_create([
        "http" => $http,
        "ssl" => ["verify_peer" => false, "verify_peer_name" => false],
    ]);
    $data = @file_get_contents($url, false, $ctx);
    if ($data === false || $data === "") return [false, "file_get_contents failed" . ($proxy === "" ? "（无代理）" : ""), 0];
    return [$data, "", 200];
}

/** Plugin-local lyrics cache dir (always writable on Unraid flash). */
function m_lrc_cache_dir() {
    $dir = "/boot/config/plugins/theme.music/lyrics-cache";
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    return is_dir($dir) && is_writable($dir) ? $dir : "";
}

function m_strtolower($s) {
    $s = (string)$s;
    if (function_exists("mb_strtolower")) return mb_strtolower($s, "UTF-8");
    return strtolower($s);
}
function m_lrc_cache_key($artist, $title) {
    return substr(sha1(m_strtolower(trim($artist) . "|" . trim($title))), 0, 24);
}

/** Plugin-local cover cache dir. */
function m_cover_cache_dir() {
    $dir = "/boot/config/plugins/theme.music/cover-cache";
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    return is_dir($dir) && is_writable($dir) ? $dir : "";
}

function m_cover_cache_key($artist, $title, $album = "") {
    return substr(sha1(m_strtolower(trim($artist) . "|" . trim($album) . "|" . trim($title))), 0, 24);
}

/** Common cover basenames (lowercase). */
function m_cover_basenames() {
    return [
        "cover.jpg", "cover.jpeg", "cover.png", "cover.webp", "cover.gif",
        "folder.jpg", "folder.jpeg", "folder.png", "folder.webp",
        "album.jpg", "album.jpeg", "album.png", "album.webp",
        "front.jpg", "front.jpeg", "front.png", "front.webp",
        "artwork.jpg", "artwork.png", "art.jpg", "art.png",
        "albumart.jpg", "albumart.png", "albumartsmall.jpg",
        "scan.jpg", "booklet.jpg",
    ];
}

/**
 * Look for cover image inside one directory (sidecar stem + common names).
 */
function m_find_cover_in_dir($dir, $stem = "") {
    $dir = rtrim(str_replace("\\", "/", (string)$dir), "/");
    if ($dir === "" || !is_dir($dir)) return "";
    $cands = [];
    if ($stem !== "") {
        foreach (["jpg", "jpeg", "png", "webp", "gif"] as $ex) {
            $cands[] = $dir . "/" . $stem . "." . $ex;
        }
    }
    foreach (["Cover.jpg", "Cover.png", "Folder.jpg", "AlbumArt.jpg", "AlbumArtSmall.jpg", "Art.jpg", "Front.jpg"] as $n) {
        $cands[] = $dir . "/" . $n;
    }
    foreach (m_cover_basenames() as $n) {
        $cands[] = $dir . "/" . $n;
    }
    foreach ($cands as $p) {
        if (is_file($p) && @filesize($p) > 64) return str_replace("\\", "/", $p);
    }
    $want = m_cover_basenames();
    $stemL = $stem !== "" ? strtolower($stem) : "";
    $dh = @opendir($dir);
    if ($dh) {
        while (($name = readdir($dh)) !== false) {
            if ($name === "." || $name === "..") continue;
            $ln = strtolower($name);
            $fp = $dir . "/" . $name;
            if (!is_file($fp) || @filesize($fp) <= 64) continue;
            if (in_array($ln, $want, true)) {
                closedir($dh);
                return str_replace("\\", "/", $fp);
            }
            if ($stemL !== "") {
                foreach ([".jpg", ".jpeg", ".png", ".webp", ".gif"] as $ex) {
                    if ($ln === $stemL . $ex) {
                        closedir($dh);
                        return str_replace("\\", "/", $fp);
                    }
                }
            }
            // loose: *cover*.jpg / *front*.png in folder
            if (preg_match('/(cover|folder|front|albumart|artwork)/i', $ln) && preg_match('/\.(jpe?g|png|webp|gif)$/i', $ln)) {
                closedir($dh);
                return str_replace("\\", "/", $fp);
            }
        }
        closedir($dh);
    }
    return "";
}

/**
 * Local cover next to audio, then parent album folder (CD1/CD2 layouts), then grandparent.
 */
function m_find_local_cover($audioAbs) {
    $audioAbs = str_replace("\\", "/", (string)$audioAbs);
    if ($audioAbs === "" || !is_file($audioAbs)) return "";
    $dir = str_replace("\\", "/", dirname($audioAbs));
    $stem = pathinfo($audioAbs, PATHINFO_FILENAME);
    $hit = m_find_cover_in_dir($dir, $stem);
    if ($hit !== "") return $hit;
    // Multi-disc: .../Album/CD1/track.flac → cover often on Album/
    $parent = str_replace("\\", "/", dirname($dir));
    if ($parent !== "" && $parent !== $dir && $parent !== "." && $parent !== "/") {
        $hit = m_find_cover_in_dir($parent, "");
        if ($hit !== "") return $hit;
        $gparent = str_replace("\\", "/", dirname($parent));
        if ($gparent !== "" && $gparent !== $parent && $gparent !== "." && $gparent !== "/") {
            $hit = m_find_cover_in_dir($gparent, "");
            if ($hit !== "") return $hit;
        }
    }
    return "";
}

/**
 * Parse one FLAC METADATA_BLOCK_PICTURE payload into image bytes.
 * Layout: type(4) mimeLen(4) mime descLen(4) desc width(4) height(4) depth(4) colors(4) dataLen(4) data
 */
function m_flac_picture_payload($block) {
    if (!is_string($block) || strlen($block) < 32) return "";
    $n = strlen($block);
    $mimeLen = (ord($block[4]) << 24) | (ord($block[5]) << 16) | (ord($block[6]) << 8) | ord($block[7]);
    if ($mimeLen < 0 || $mimeLen > 128 || 8 + $mimeLen + 4 > $n) return "";
    $o = 8 + $mimeLen;
    $descLen = (ord($block[$o]) << 24) | (ord($block[$o + 1]) << 16) | (ord($block[$o + 2]) << 8) | ord($block[$o + 3]);
    $o += 4;
    if ($descLen < 0 || $descLen > 4096 || $o + $descLen + 20 > $n) return "";
    $o += $descLen; // skip description
    $o += 16; // width/height/depth/colors
    if ($o + 4 > $n) return "";
    $dlen = (ord($block[$o]) << 24) | (ord($block[$o + 1]) << 16) | (ord($block[$o + 2]) << 8) | ord($block[$o + 3]);
    $o += 4;
    if ($dlen < 64 || $dlen > 4 * 1024 * 1024 || $o + $dlen > $n) return "";
    $blob = substr($block, $o, $dlen);
    return m_is_cover_bytes($blob) ? $blob : "";
}

/**
 * Stream-walk FLAC metadata blocks (handles large PICTURE without loading whole file).
 * Prefers picture type 3 (front cover), else first valid image.
 */
function m_extract_flac_picture($fp, $fileSize) {
    if (!$fp) return "";
    @fseek($fp, 0, SEEK_SET);
    $magic = @fread($fp, 4);
    if ($magic !== "fLaC") return "";
    $pos = 4;
    $guard = 0;
    $fallback = "";
    while ($pos + 4 <= $fileSize && $guard++ < 64) {
        @fseek($fp, $pos, SEEK_SET);
        $hdr = @fread($fp, 4);
        if ($hdr === false || strlen($hdr) < 4) break;
        $b0 = ord($hdr[0]);
        $last = ($b0 & 0x80) !== 0;
        $type = $b0 & 0x7F;
        $blen = (ord($hdr[1]) << 16) | (ord($hdr[2]) << 8) | ord($hdr[3]);
        $pos += 4;
        if ($blen < 0 || $blen > 8 * 1024 * 1024 || $pos + $blen > $fileSize) break;
        if ($type === 6 && $blen > 40) {
            $block = @fread($fp, $blen);
            if (is_string($block) && strlen($block) === $blen) {
                $picType = (ord($block[0]) << 24) | (ord($block[1]) << 16) | (ord($block[2]) << 8) | ord($block[3]);
                $img = m_flac_picture_payload($block);
                if ($img !== "") {
                    if ($picType === 3) return $img; // front cover
                    if ($fallback === "") $fallback = $img;
                }
            }
        }
        $pos += $blen;
        if ($last) break;
    }
    return $fallback;
}

/**
 * Best-effort extract embedded JPEG/PNG from audio file into cover-cache.
 */
function m_extract_embedded_cover($audioAbs, $cacheKey = "") {
    $audioAbs = str_replace("\\", "/", (string)$audioAbs);
    if ($audioAbs === "" || !is_file($audioAbs)) return "";
    $size = @filesize($audioAbs);
    if ($size === false || $size < 512 || $size > 200 * 1024 * 1024) return "";
    $fp = @fopen($audioAbs, "rb");
    if (!$fp) return "";

    $img = "";
    // FLAC: stream metadata (covers large PICTURE blocks beyond old 8MB fread cap)
    $head = @fread($fp, 4);
    @fseek($fp, 0, SEEK_SET);
    if ($head === "fLaC") {
        $img = m_extract_flac_picture($fp, $size);
    }

    // MP3/ID3 or generic: scan head + optional tail for JPEG/PNG signatures
    if ($img === "") {
        @fseek($fp, 0, SEEK_SET);
        $readMax = (int)min($size, 12 * 1024 * 1024);
        $data = @fread($fp, $readMax);
        if (is_string($data) && strlen($data) >= 64) {
            $img = m_scan_image_bytes($data);
        }
        // APEv2 / some tags live near EOF — peek last 1.5MB
        if ($img === "" && $size > 2 * 1024 * 1024) {
            $tailN = (int)min($size, 1536 * 1024);
            @fseek($fp, -$tailN, SEEK_END);
            $tail = @fread($fp, $tailN);
            if (is_string($tail) && strlen($tail) >= 64) {
                $img = m_scan_image_bytes($tail);
            }
        }
    }
    fclose($fp);

    if ($img === "" || !m_is_cover_bytes($img)) return "";
    if (strlen($img) > 4 * 1024 * 1024) $img = substr($img, 0, 4 * 1024 * 1024);
    if (!m_is_cover_bytes($img)) return "";

    $outExt = m_cover_ext_from_bytes($img);
    $key = $cacheKey !== "" ? $cacheKey : substr(sha1($audioAbs . "|embed"), 0, 24);
    $cacheDir = m_cover_cache_dir();
    if ($cacheDir !== "") {
        $cp = $cacheDir . "/" . $key . "." . $outExt;
        if (@file_put_contents($cp, $img) !== false) {
            @chmod($cp, 0644);
            if (is_file($cp) && @filesize($cp) > 64) {
                mlog("cover-embed ok dst=$cp bytes=" . strlen($img));
                return str_replace("\\", "/", $cp);
            }
        }
    }
    $tmp = rtrim(str_replace("\\", "/", sys_get_temp_dir()), "/") . "/ucwc-cover-" . $key . "." . $outExt;
    if (@file_put_contents($tmp, $img) !== false && is_file($tmp)) {
        mlog("cover-embed tmp dst=$tmp bytes=" . strlen($img));
        return str_replace("\\", "/", $tmp);
    }
    return "";
}

/** Find first plausible JPEG/PNG inside a binary buffer. */
function m_scan_image_bytes($data) {
    if (!is_string($data) || strlen($data) < 64) return "";
    $n = strlen($data);
    $limit = min($n, 12 * 1024 * 1024);
    for ($i = 0; $i + 3 < $limit; $i++) {
        $b0 = ord($data[$i]);
        if ($b0 === 0xFF && ord($data[$i + 1]) === 0xD8 && ord($data[$i + 2]) === 0xFF) {
            $maxLen = min(3 * 1024 * 1024, $n - $i);
            $blob = substr($data, $i, $maxLen);
            $eoi = false;
            $blen = strlen($blob);
            for ($j = min($blen - 2, 3 * 1024 * 1024); $j > 128; $j--) {
                if (ord($blob[$j]) === 0xFF && ord($blob[$j + 1]) === 0xD9) {
                    $eoi = $j + 2;
                    break;
                }
            }
            if ($eoi !== false) $blob = substr($blob, 0, $eoi);
            if (m_is_cover_bytes($blob) && strlen($blob) > 200) return $blob;
        }
        if ($b0 === 0x89 && $i + 8 < $n && ord($data[$i + 1]) === 0x50 && ord($data[$i + 2]) === 0x4E && ord($data[$i + 3]) === 0x47) {
            $blob = substr($data, $i, min(3 * 1024 * 1024, $n - $i));
            if (m_is_cover_bytes($blob) && strlen($blob) > 200) return $blob;
        }
    }
    return "";
}

function m_is_cover_bytes($data) {
    if ($data === false || $data === null || strlen($data) < 24) return false;
    if (strlen($data) > 4 * 1024 * 1024) return false;
    $h = substr($data, 0, 12);
    if (substr($h, 0, 3) === "\xFF\xD8\xFF") return true;
    if (substr($h, 0, 8) === "\x89PNG\r\n\x1a\n") return true;
    if (substr($h, 0, 4) === "RIFF" && substr($data, 8, 4) === "WEBP") return true;
    if (substr($h, 0, 6) === "GIF87a" || substr($h, 0, 6) === "GIF89a") return true;
    return false;
}

function m_cover_ext_from_bytes($data) {
    $h = substr($data, 0, 12);
    if (substr($h, 0, 3) === "\xFF\xD8\xFF") return "jpg";
    if (substr($h, 0, 8) === "\x89PNG\r\n\x1a\n") return "png";
    if (substr($h, 0, 4) === "RIFF" && substr($data, 8, 4) === "WEBP") return "webp";
    return "jpg";
}

function m_fetch_itunes_cover_url($artist, $title, $album = "") {
    // Try several query shapes — folder noise used to poison a single long term
    $queries = [];
    $a = trim((string)$artist);
    $t = trim((string)$title);
    $al = trim((string)$album);
    if ($a !== "" && $t !== "") $queries[] = $a . " " . $t;
    if ($a !== "" && $al !== "") $queries[] = $a . " " . $al;
    if ($t !== "" && $al !== "") $queries[] = $t . " " . $al;
    if ($t !== "") $queries[] = $t;
    if ($a !== "" && $t !== "" && $al !== "") $queries[] = $a . " " . $al . " " . $t;
    $queries = array_values(array_unique(array_filter($queries)));
    if (!count($queries)) return "";

    $tNorm = m_strtolower($t);
    $aNorm = m_strtolower($a);
    foreach ($queries as $term) {
        $url = "https://itunes.apple.com/search?" . http_build_query([
            "term" => $term,
            "media" => "music",
            "entity" => "song",
            "limit" => 8,
            "country" => "cn",
        ], "", "&", PHP_QUERY_RFC3986);
        [$body, $err, $code] = m_http_get($url, 12);
        if ($body === false || $body === "") {
            // retry without country
            $url2 = "https://itunes.apple.com/search?" . http_build_query([
                "term" => $term,
                "media" => "music",
                "entity" => "song",
                "limit" => 8,
            ], "", "&", PHP_QUERY_RFC3986);
            [$body, $err, $code] = m_http_get($url2, 12);
        }
        if ($body === false || $body === "") {
            mlog("itunes-cover fail term=$term err=$err");
            continue;
        }
        $json = json_decode($body, true);
        $results = $json["results"] ?? null;
        if (!is_array($results) || !count($results)) continue;
        $best = null;
        foreach ($results as $row) {
            if (!is_array($row)) continue;
            $nm = m_strtolower((string)($row["trackName"] ?? ""));
            $ar = m_strtolower((string)($row["artistName"] ?? ""));
            $titleHit = $tNorm === "" || ($nm !== "" && ($nm === $tNorm || strpos($nm, $tNorm) !== false || strpos($tNorm, $nm) !== false));
            $artistHit = $aNorm === "" || ($ar !== "" && ($ar === $aNorm || strpos($ar, $aNorm) !== false || strpos($aNorm, $ar) !== false));
            if ($titleHit && $artistHit) {
                $best = $row;
                break;
            }
            if ($best === null && $titleHit) $best = $row;
        }
        if (!$best) $best = $results[0];
        $art = (string)($best["artworkUrl100"] ?? $best["artworkUrl60"] ?? "");
        if ($art === "") continue;
        $art = preg_replace('/\/\d+x\d+bb/', "/600x600bb", $art);
        $art = str_replace(["100x100", "60x60"], "600x600", $art);
        return $art;
    }
    return "";
}

function m_fetch_netease_cover_url($artist, $title, $album = "") {
    $queries = [];
    $a = trim((string)$artist);
    $t = trim((string)$title);
    $al = trim((string)$album);
    if ($a !== "" && $t !== "") $queries[] = $a . " " . $t;
    if ($t !== "") $queries[] = $t;
    if ($a !== "" && $al !== "") $queries[] = $a . " " . $al;
    $queries = array_values(array_unique(array_filter($queries)));
    if (!count($queries)) return "";
    $tNorm = m_strtolower($t);
    $aNorm = m_strtolower($a);
    foreach ($queries as $q) {
        $searchUrl = "https://music.163.com/api/search/get/web?" . http_build_query([
            "s" => $q,
            "type" => 1,
            "limit" => 8,
            "offset" => 0,
        ], "", "&", PHP_QUERY_RFC3986);
        [$body, $err, $code] = m_http_get($searchUrl, 12, "application/json,text/plain,*/*;q=0.8");
        if ($body === false || $body === "") {
            mlog("netease-cover search fail q=$q err=$err");
            continue;
        }
        $json = json_decode($body, true);
        $songs = $json["result"]["songs"] ?? null;
        if (!is_array($songs) || !count($songs)) continue;
        $song = null;
        foreach ($songs as $s) {
            if (!is_array($s)) continue;
            $nm = m_strtolower((string)($s["name"] ?? ""));
            $ar0 = "";
            if (!empty($s["artists"][0]["name"])) $ar0 = m_strtolower((string)$s["artists"][0]["name"]);
            $titleHit = $tNorm === "" || ($nm !== "" && ($nm === $tNorm || strpos($nm, $tNorm) !== false || strpos($tNorm, $nm) !== false));
            $artistHit = $aNorm === "" || ($ar0 !== "" && (strpos($ar0, $aNorm) !== false || strpos($aNorm, $ar0) !== false));
            if ($titleHit && $artistHit) {
                $song = $s;
                break;
            }
            if ($song === null && $titleHit) $song = $s;
        }
        if (!$song) $song = $songs[0];
        $pic = (string)($song["album"]["picUrl"] ?? "");
        if ($pic === "") continue;
        if (strpos($pic, "?") === false) $pic .= "?param=600y600";
        else $pic = preg_replace('/param=\d+y\d+/', "param=600y600", $pic);
        return $pic;
    }
    return "";
}

/**
 * Resolve cover: local → cache → embedded → network download.
 * When download succeeds but disk write fails, still returns remote URL via third channel:
 * @return array{0:string,1:string,2:string,3?:string} [absPath, source, err, remoteUrl?]
 */
function m_resolve_cover($audioAbs, $rel = "", $doFetch = true) {
    $audioAbs = str_replace("\\", "/", (string)$audioAbs);
    $local = m_find_local_cover($audioAbs);
    if ($local !== "") return [$local, "local", "", ""];

    $meta = m_guess_meta($audioAbs, $rel);
    $artist = $meta[0] ?? "";
    $title = $meta[1] ?? "";
    $album = $meta[2] ?? "";
    // Disc folders must not become album name
    if ($album !== "" && m_is_disc_folder($album)) $album = "";
    $ckey = m_cover_cache_key($artist, $title, $album);
    // Also key by path so embed cache is stable even with empty title
    $ckeyPath = substr(sha1(strtolower($audioAbs)), 0, 24);
    $cacheDir = m_cover_cache_dir();
    if ($cacheDir !== "") {
        foreach ([$ckey, $ckeyPath, $ckeyPath . "-embed"] as $k) {
            if ($k === "") continue;
            foreach (["jpg", "png", "webp"] as $ext) {
                $cp = $cacheDir . "/" . $k . "." . $ext;
                if (is_file($cp) && @filesize($cp) > 64) return [str_replace("\\", "/", $cp), "cache", "", ""];
            }
        }
    }

    // Embedded album art (no network)
    $embed = m_extract_embedded_cover($audioAbs, $ckey !== "" ? $ckey : ($ckeyPath . "-embed"));
    if ($embed !== "") return [$embed, "embedded", "", ""];

    if (!$doFetch) return ["", "none", $title === "" ? "no title" : "no cover", ""];
    // Allow network even if title empty — use filename stem
    $qTitle = $title !== "" ? $title : pathinfo($audioAbs, PATHINFO_FILENAME);
    if ($qTitle === "") return ["", "none", "no title", ""];

    $url = m_fetch_itunes_cover_url($artist, $qTitle, $album);
    $srcTag = "itunes";
    if ($url === "") {
        $url = m_fetch_netease_cover_url($artist, $qTitle, $album);
        $srcTag = "netease";
    }
    if ($url === "") return ["", "none", "未匹配到封面", ""];

    // Image bytes — do NOT send Accept: application/json (CDN may 406 / return HTML)
    [$data, $err, $code] = m_http_get($url, 18, "image/*,*/*;q=0.8");
    if ($data === false || !m_is_cover_bytes($data)) {
        mlog("cover-download fail src=$srcTag err=$err code=$code");
        if ($srcTag === "itunes") {
            $url2 = m_fetch_netease_cover_url($artist, $qTitle, $album);
            if ($url2 !== "" && $url2 !== $url) {
                [$data, $err, $code] = m_http_get($url2, 18, "image/*,*/*;q=0.8");
                $srcTag = "netease";
                if ($data !== false && m_is_cover_bytes($data)) $url = $url2;
            }
        }
        if ($data === false || !m_is_cover_bytes($data)) {
            mlog("cover-download fail2 src=$srcTag err=$err — fallback remote url");
            // Browser may still load CDN directly
            return ["", "remote:" . $srcTag, $err !== "" ? $err : "封面下载失败", $url];
        }
    }
    $ext = m_cover_ext_from_bytes($data);
    $written = "";
    // Prefer plugin cover-cache on flash (always writable)
    if ($cacheDir !== "") {
        $cp = $cacheDir . "/" . ($ckey !== "" ? $ckey : $ckeyPath) . "." . $ext;
        if (@file_put_contents($cp, $data) !== false) {
            @chmod($cp, 0644);
            if (is_file($cp) && @filesize($cp) > 64) $written = str_replace("\\", "/", $cp);
        }
    }
    $dir = str_replace("\\", "/", dirname($audioAbs));
    $stem = pathinfo($audioAbs, PATHINFO_FILENAME);
    $side = $dir . "/" . $stem . "." . $ext;
    if ($written !== "" && is_dir($dir) && is_writable($dir) && !is_file($side)) {
        @file_put_contents($side, $data);
    } elseif ($written === "" && is_dir($dir) && is_writable($dir)) {
        if (@file_put_contents($side, $data) !== false) {
            @chmod($side, 0644);
            if (is_file($side)) $written = str_replace("\\", "/", $side);
        }
    }
    if ($written === "") {
        $tmp = rtrim(str_replace("\\", "/", sys_get_temp_dir()), "/") . "/ucwc-cover-" . ($ckey !== "" ? $ckey : $ckeyPath) . "." . $ext;
        if (@file_put_contents($tmp, $data) !== false && is_file($tmp)) $written = str_replace("\\", "/", $tmp);
    }
    if ($written === "") {
        mlog("cover-write fail — fallback remote url src=$srcTag");
        return ["", "remote:" . $srcTag, "无法写入封面缓存", $url];
    }
    mlog("cover-ok src=$srcTag title=$qTitle dst=$written bytes=" . strlen($data));
    return [$written, "downloaded:" . $srcTag, "", ""];
}

function m_stream_image($abs) {
    $size = @filesize($abs);
    if ($size === false || $size <= 0) {
        http_response_code(404);
        exit;
    }
    $ext = strtolower(pathinfo($abs, PATHINFO_EXTENSION));
    $map = ["jpg" => "image/jpeg", "jpeg" => "image/jpeg", "png" => "image/png", "webp" => "image/webp", "gif" => "image/gif"];
    $mime = $map[$ext] ?? "image/jpeg";
    header("Content-Type: $mime");
    header("Content-Length: $size");
    header("Cache-Control: private, max-age=86400");
    header("X-Content-Type-Options: nosniff");
    if (function_exists("session_status") && session_status() === PHP_SESSION_ACTIVE) @session_write_close();
    readfile($abs);
    exit;
}


/**
 * Clean release-folder noise: "张信哲 - 世纪之声精选辑 (2010) FLAC" → artist/album.
 * @return array{0:string,1:string} [artist, album]
 */
function m_parse_release_folder($name) {
    $name = trim((string)$name);
    if ($name === "") return ["", ""];
    $artist = "";
    $album = $name;
    if (preg_match('/^\s*(.+?)\s+[-–—]\s+(.+?)\s*$/u', $name, $m)) {
        $artist = trim($m[1]);
        $album = trim($m[2]);
    }
    // drop codec / year / disc tags from album side
    $album = preg_replace('/\s*[\(\[\{]?\s*(19|20)\d{2}\s*[\)\]\}]?\s*/u', " ", $album);
    $album = preg_replace('/\b(FLAC|ALAC|WAV|APE|DSD|Hi[- ]?Res|24bit|16bit|44\.1kHz|48kHz|96kHz|CD|CUE|Scan|Vinyl|WEB|MP3|320|CD1|CD2|Disc\s*\d+)\b/iu', " ", $album);
    $album = preg_replace('/\s{2,}/u', " ", $album);
    $album = trim($album, " \t-–—_.");
    $artist = preg_replace('/\b(FLAC|ALAC|WAV|APE|MP3)\b/iu', " ", $artist);
    $artist = preg_replace('/\s{2,}/u', " ", trim($artist));
    return [trim((string)$artist), trim((string)$album)];
}

/** True if folder name looks like disc partition (CD1 / Disc 2). */
function m_is_disc_folder($name) {
    $n = trim((string)$name);
    if ($n === "") return false;
    if (preg_match('/^(CD|Disc|DISK|碟)\s*[-_.]?\s*\d{1,2}$/iu', $n)) return true;
    if (preg_match('/^(CD|Disc)\d{1,2}$/iu', $n)) return true;
    return false;
}

/**
 * Guess title/artist/album from filename + path.
 * Handles: .../Artist - Album (2010) FLAC/CD1/02.Title.flac
 * @return array{0:string,1:string,2:string} [artist, title, album]
 */
function m_guess_meta($audioAbs, $rel = "") {
    $base = pathinfo($audioAbs, PATHINFO_FILENAME);
    $artist = "";
    $title = $base;
    $album = "";
    if (preg_match('/^\s*(.+?)\s+[-–—]\s+(.+?)\s*$/u', $base, $m)) {
        $artist = trim($m[1]);
        $title = trim($m[2]);
    }
    // strip track numbers: "02.从开始到现在" / "02 - Title"
    $title = preg_replace('/^\s*\d{1,3}[\s._\-]+/u', "", $title);
    $title = trim((string)$title);

    $pathForDir = $rel !== "" ? $rel : $audioAbs;
    $dir = str_replace("\\", "/", dirname($pathForDir));
    $parts = [];
    if ($dir !== "" && $dir !== ".") {
        $parts = array_values(array_filter(explode("/", $dir), function ($p) {
            return $p !== "" && $p !== ".";
        }));
    }
    // Walk up: skip disc folders, parse "Artist - Album …" release folder
    for ($i = count($parts) - 1; $i >= 0; $i--) {
        $seg = $parts[$i];
        if (m_is_disc_folder($seg)) continue;
        [$a, $al] = m_parse_release_folder($seg);
        if ($album === "" && $al !== "") $album = $al;
        if ($artist === "" && $a !== "") $artist = $a;
        // If segment had no "Artist - ", treat whole cleaned name as album when still empty
        if ($album === "" && $a === "" && $al === "" && $seg !== "") {
            [, $al2] = m_parse_release_folder($seg);
            if ($al2 !== "") $album = $al2;
            elseif (!m_is_disc_folder($seg)) $album = $seg;
        }
        // One meaningful release folder is enough
        if ($artist !== "" || $album !== "") break;
    }
    // If artist still empty but album folder was pure album name, try parent as artist
    if ($artist === "" && count($parts) >= 2) {
        $idx = count($parts) - 1;
        if (m_is_disc_folder($parts[$idx]) && $idx >= 1) $idx--;
        if ($idx >= 1) {
            $parent = $parts[$idx - 1];
            if (!m_is_disc_folder($parent)) {
                [$pa, $pal] = m_parse_release_folder($parent);
                if ($pa !== "") $artist = $pa;
                elseif ($artist === "" && $pal === "" && $parent !== "") $artist = $parent;
            }
        }
    }
    return [trim((string)$artist), trim((string)$title), trim((string)$album)];
}


/**
 * Netease cloud search → first song id → lyric LRC text.
 * Returns lrc text or "".
 */
/**
 * Netease cloud search → best matching song id → lyric LRC text.
 * Returns [lrcText, resolvedTitle, resolvedArtist] or ["","",""].
 * Never blindly uses the first search hit (avoids wrong sidecar like 回来→别怕我伤心).
 */
function m_fetch_netease_lrc($artist, $title) {
    $q = trim(($artist !== "" ? $artist . " " : "") . $title);
    if ($q === "") return ["", "", ""];
    $searchUrl = "https://music.163.com/api/search/get/web?" . http_build_query([
        "s" => $q,
        "type" => 1,
        "limit" => 8,
        "offset" => 0,
    ], "", "&", PHP_QUERY_RFC3986);
    [$body, $err, $code] = m_http_get($searchUrl, 12);
    if ($body === false || $body === "") {
        mlog("netease-search fail: $err");
        return ["", "", ""];
    }
    $json = json_decode($body, true);
    $songs = $json["result"]["songs"] ?? null;
    if (!is_array($songs) || !count($songs)) return ["", "", ""];
    $tKey = m_norm_lyric_key($title);
    $aKey = m_norm_lyric_key($artist);
    $bestId = 0;
    $bestScore = -1;
    $bestName = "";
    $bestArtist = "";
    foreach ($songs as $s) {
        if (!is_array($s)) continue;
        $nm = trim((string)($s["name"] ?? ""));
        $nmKey = m_norm_lyric_key($nm);
        if ($nmKey === "") continue;
        $score = 0;
        if ($nmKey === $tKey) $score += 100;
        elseif ($tKey !== "" && (strpos($nmKey, $tKey) !== false || strpos($tKey, $nmKey) !== false)) {
            $ratio = min(strlen($nmKey), strlen($tKey)) / max(strlen($nmKey), strlen($tKey));
            if ($ratio >= 0.75) $score += 55;
            else $score += 15;
        } else {
            continue;
        }
        $arts = $s["artists"] ?? ($s["ar"] ?? []);
        $artJoined = "";
        if (is_array($arts)) {
            $names = [];
            foreach ($arts as $a) {
                if (is_array($a) && !empty($a["name"])) $names[] = (string)$a["name"];
                elseif (is_string($a)) $names[] = $a;
            }
            $artJoined = implode(" / ", $names);
        }
        $artKey = m_norm_lyric_key($artJoined);
        if ($aKey !== "" && $artKey !== "") {
            if ($artKey === $aKey || strpos($artKey, $aKey) !== false || strpos($aKey, $artKey) !== false) $score += 40;
            else $score -= 10;
        }
        if ($score > $bestScore) {
            $bestScore = $score;
            $bestId = intval($s["id"] ?? 0);
            $bestName = $nm;
            $bestArtist = $artJoined !== "" ? $artJoined : $artist;
        }
    }
    if ($bestId <= 0 || $bestScore < 55) {
        mlog("netease-search no-strong-match q={$q} bestScore={$bestScore}");
        return ["", "", ""];
    }
    $lyricUrl = "https://music.163.com/api/song/lyric?" . http_build_query([
        "id" => $bestId,
        "lv" => 1,
        "kv" => 1,
        "tv" => -1,
    ], "", "&", PHP_QUERY_RFC3986);
    [$lbody, $lerr, $lcode] = m_http_get($lyricUrl, 12);
    if ($lbody === false || $lbody === "") {
        mlog("netease-lyric fail id=$bestId err=$lerr");
        return ["", "", ""];
    }
    $lj = json_decode($lbody, true);
    $lrc = trim((string)($lj["lrc"]["lyric"] ?? ""));
    if ($lrc === "" || strpos($lrc, "[") === false) return ["", "", ""];
    return [$lrc, $bestName, $bestArtist];
}

function m_fetch_and_save_lrc($audioAbs, $rel = "", $force = false) {
    $audioAbs = str_replace("\\", "/", (string)$audioAbs);
    if ($audioAbs === "" || !is_file($audioAbs)) return [false, "", "no audio", ""];
    // Only reuse existing if content matches this track (quarantines mismatches)
    // force=true skips local reuse so network re-match can run
    if (!$force) {
        $existing = m_find_matching_lrc($audioAbs, $rel);
        if ($existing !== "") return [true, $existing, "", ""];
    }

    [$artist, $title] = m_guess_meta($audioAbs, $rel);
    if ($title === "") return [false, "", "no title", ""];

    // plugin cache hit (validate content; quarantine bad cache entries)
    $cacheDir = m_lrc_cache_dir();
    $ckey = m_lrc_cache_key($artist, $title);
    if ($cacheDir !== "" && !$force) {
        $cpath = $cacheDir . "/" . $ckey . ".lrc";
        if (is_file($cpath) && filesize($cpath) > 8) {
            $craw = @file_get_contents($cpath);
            $ctext = m_lrc_decode($craw !== false ? $craw : "");
            [$cok, $cwhy] = m_lrc_matches_track($ctext, $artist, $title);
            if ($cok) {
                $dir = str_replace("\\", "/", dirname($audioAbs));
                $stem = pathinfo($audioAbs, PATHINFO_FILENAME);
                $side = $dir . "/" . $stem . ".lrc";
                if (is_writable($dir) && !is_file($side)) {
                    @copy($cpath, $side);
                    if (is_file($side)) return [true, str_replace("\\", "/", $side), "", ""];
                }
                return [true, str_replace("\\", "/", $cpath), "", ""];
            }
            mlog("lrc-cache-mismatch key={$ckey} title={$title} reason={$cwhy}");
            m_quarantine_lrc($cpath, "cache-mismatch");
        }
    }

    $queries = [];
    $queries[] = ["track_name" => $title, "artist_name" => $artist !== "" ? $artist : "Unknown"];
    if ($artist !== "") $queries[] = ["q" => $artist . " " . $title];
    $queries[] = ["q" => $title];
    $title2 = preg_replace('/\s*[\(\[].*?[\)\]]\s*/u', " ", $title);
    $title2 = trim(preg_replace('/\s+/u', " ", (string)$title2));
    if ($title2 !== "" && $title2 !== $title) {
        $queries[] = ["track_name" => $title2, "artist_name" => $artist !== "" ? $artist : "Unknown"];
        $queries[] = ["q" => $title2];
    }

    $body = false;
    $err = "";
    $code = 0;
    foreach ($queries as $q) {
        $url = "https://lrclib.net/api/search?" . http_build_query($q, "", "&", PHP_QUERY_RFC3986);
        [$body, $err, $code] = m_http_get($url, 14);
        if ($body !== false && $body !== "") {
            $jsonTry = json_decode($body, true);
            if (is_array($jsonTry) && count($jsonTry)) break;
        }
        $body = false;
    }
    $text = "";
    $srcTag = "lrclib";
    if ($body !== false && $body !== "") {
        $json = json_decode($body, true);
        if (is_array($json) && count($json)) {
            $best = null;
            $bestScore = -1;
            $tKey = m_norm_lyric_key($title);
            $aKey = m_norm_lyric_key($artist);
            foreach ($json as $row) {
                if (!is_array($row)) continue;
                $synced = trim((string)($row["syncedLyrics"] ?? ""));
                if ($synced === "") continue;
                $rt = m_norm_lyric_key(trim((string)($row["trackName"] ?? "")));
                $ra = m_norm_lyric_key(trim((string)($row["artistName"] ?? "")));
                $score = 0;
                if ($rt !== "" && $rt === $tKey) $score += 100;
                elseif ($rt !== "" && $tKey !== "" && (strpos($rt, $tKey) !== false || strpos($tKey, $rt) !== false)) {
                    $ratio = min(strlen($rt), strlen($tKey)) / max(strlen($rt), strlen($tKey));
                    $score += ($ratio >= 0.75) ? 60 : 20;
                } else {
                    continue;
                }
                if ($aKey !== "" && $ra !== "" && ($ra === $aKey || strpos($ra, $aKey) !== false || strpos($aKey, $ra) !== false)) $score += 35;
                if (!empty($row["instrumental"])) $score -= 20;
                if ($score > $bestScore) { $bestScore = $score; $best = $row; }
            }
            if ($best !== null && $bestScore >= 60) {
                $synced = trim((string)$best["syncedLyrics"]);
                $hdr = "";
                $ti = trim((string)($best["trackName"] ?? $title));
                $ar = trim((string)($best["artistName"] ?? $artist));
                $al = trim((string)($best["albumName"] ?? ""));
                if ($ti !== "") $hdr .= "[ti:{$ti}]\n";
                if ($ar !== "") $hdr .= "[ar:{$ar}]\n";
                if ($al !== "") $hdr .= "[al:{$al}]\n";
                $hdr .= "[by:ThemeMusic/lrclib]\n";
                $cand = $hdr . $synced;
                if (substr($cand, -1) !== "\n") $cand .= "\n";
                [$mok, $mwhy] = m_lrc_matches_track($cand, $artist, $title);
                if ($mok) {
                    $text = $cand;
                } else {
                    mlog("lrclib-reject title={$title} reason={$mwhy} score={$bestScore}");
                }
            } elseif ($best !== null) {
                mlog("lrclib-weak-score title={$title} score={$bestScore}");
            }
        }
    }
    // Fallback: NetEase Cloud Music (often reachable in CN)
    if ($text === "" || strpos($text, "[") === false) {
        [$ne, $neTitle, $neArtist] = m_fetch_netease_lrc($artist, $title);
        if ($ne !== "") {
            $hdr = "";
            $tiUse = $neTitle !== "" ? $neTitle : $title;
            $arUse = $neArtist !== "" ? $neArtist : $artist;
            if ($tiUse !== "") $hdr .= "[ti:{$tiUse}]\n";
            if ($arUse !== "") $hdr .= "[ar:{$arUse}]\n";
            $hdr .= "[by:ThemeMusic/netease]\n";
            $cand = $hdr . $ne;
            if (substr($cand, -1) !== "\n") $cand .= "\n";
            [$nok, $nwhy] = m_lrc_matches_track($cand, $artist, $title);
            if ($nok) {
                $text = $cand;
                $srcTag = "netease";
            } else {
                mlog("netease-reject title={$title} resolved={$neTitle} reason={$nwhy}");
            }
        }
    }
    if ($text === "" || strpos($text, "[") === false) {
        $msg = $err !== "" ? "歌词网络请求失败: $err" : "未找到匹配歌词";
        return [false, "", $msg, ""];
    }

    [$fok, $fwhy] = m_lrc_matches_track($text, $artist, $title);
    if (!$fok) {
        mlog("lrc-download final-reject title={$title} reason={$fwhy}");
        return [false, "", "下载到的歌词与曲目不匹配", ""];
    }

    $written = "";
    $writeErrs = [];
    $dir = str_replace("\\", "/", dirname($audioAbs));
    $stem = pathinfo($audioAbs, PATHINFO_FILENAME);
    $dst = $dir . "/" . $stem . ".lrc";
    if (is_dir($dir) && is_writable($dir)) {
        $ok = @file_put_contents($dst, $text);
        if ($ok !== false) {
            @chmod($dst, 0644);
            $written = str_replace("\\", "/", $dst);
        } else {
            $writeErrs[] = "音频同目录写入失败";
        }
    } else {
        $writeErrs[] = "音频目录不可写";
    }
    if ($cacheDir !== "") {
        $cpath = $cacheDir . "/" . $ckey . ".lrc";
        $ok2 = @file_put_contents($cpath, $text);
        if ($ok2 !== false) {
            @chmod($cpath, 0644);
            if ($written === "") $written = str_replace("\\", "/", $cpath);
        } else {
            $writeErrs[] = "插件缓存写入失败";
        }
    }
    if ($written !== "") {
        mlog("lrc-download ok src={$srcTag} title={$title} artist={$artist} dst={$written} bytes=" . strlen($text));
        return [true, $written, "", $text];
    }
    mlog("lrc-download memory-only title={$title} err=" . implode(";", $writeErrs));
    return [true, "", implode("；", $writeErrs) ?: "无法保存 .lrc", $text];
}

/** Decode LRC bytes: UTF-8 / UTF-8 BOM / UTF-16 / GBK fallback. */
function m_lrc_decode($raw) {
    if ($raw === false || $raw === null || $raw === "") return "";
    if (substr($raw, 0, 3) === "\xEF\xBB\xBF") {
        return substr($raw, 3);
    }
    if (substr($raw, 0, 2) === "\xFF\xFE") {
        $s = @mb_convert_encoding($raw, "UTF-8", "UTF-16LE");
        return is_string($s) ? $s : "";
    }
    if (substr($raw, 0, 2) === "\xFE\xFF") {
        $s = @mb_convert_encoding($raw, "UTF-8", "UTF-16BE");
        return is_string($s) ? $s : "";
    }
    if (function_exists("mb_check_encoding") && mb_check_encoding($raw, "UTF-8")) {
        return $raw;
    }
    if (function_exists("mb_convert_encoding")) {
        $try = @mb_convert_encoding($raw, "UTF-8", "GB18030,GBK,GB2312,Big5,UTF-8");
        if (is_string($try) && $try !== "") return $try;
    }
    return $raw;
}

/**
 * Parse standard LRC text → [offset_ms, meta{}, lines[{t,text}]].
 */
function m_parse_lrc($text) {
    $offset = 0;
    $meta = [];
    $lines = [];
    $text = str_replace(["\r\n", "\r"], "\n", (string)$text);
    foreach (explode("\n", $text) as $row) {
        $row = trim($row);
        if ($row === "") continue;
        if (preg_match('/^\[(ti|ar|al|by|offset|re|ve|length):\s*([^\]]*)\]$/iu', $row, $mm)) {
            $key = strtolower($mm[1]);
            $val = trim($mm[2]);
            if ($key === "offset") {
                $offset = intval($val);
            } else {
                $meta[$key] = $val;
            }
            continue;
        }
        // One or more timestamps then text: [mm:ss.xx][mm:ss.xx]text
        if (!preg_match_all('/\[(\d{1,3}):(\d{1,2})(?:[\.:](\d{1,3}))?\]/', $row, $ts, PREG_SET_ORDER)) {
            continue;
        }
        $textPart = $row;
        foreach ($ts as $tmatch) {
            $textPart = str_replace($tmatch[0], "", $textPart);
        }
        $textPart = trim($textPart);
        // skip pure meta-looking leftovers
        if ($textPart === "" && count($ts) === 1) {
            // allow empty lines as beat markers? skip empty text
            continue;
        }
        if ($textPart === "") continue;
        foreach ($ts as $tmatch) {
            $m = intval($tmatch[1]);
            $s = intval($tmatch[2]);
            $frac = isset($tmatch[3]) ? $tmatch[3] : "0";
            if (strlen($frac) === 1) $fracMs = intval($frac) * 100;
            elseif (strlen($frac) === 2) $fracMs = intval($frac) * 10;
            else $fracMs = intval(substr($frac, 0, 3));
            $tMs = $m * 60000 + $s * 1000 + $fracMs;
            $lines[] = ["t" => $tMs, "text" => $textPart];
        }
    }
    usort($lines, function ($a, $b) {
        if ($a["t"] === $b["t"]) return 0;
        return ($a["t"] < $b["t"]) ? -1 : 1;
    });
    return [$offset, $meta, $lines];
}

/**
 * Recursive local library scan.
 * @return array{0:?array,1:string,2:array} [tracks|null, error, meta]
 *   meta: truncated, limit, max_depth, count
 */
function m_scan($root, $max = 2000) {
    $out = [];
    $root = rtrim($root, "/");
    $max = max(100, min(5000, (int)$max));
    $maxDepth = 8;
    $truncated = false;
    try {
        $it = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS | FilesystemIterator::FOLLOW_SYMLINKS),
            RecursiveIteratorIterator::LEAVES_ONLY
        );
        $it->setMaxDepth($maxDepth);
        foreach ($it as $file) {
            if (count($out) >= $max) {
                $truncated = true;
                break;
            }
            if (!$file->isFile()) continue;
            $path = $file->getPathname();
            $base = $file->getFilename();
            if ($base === "" || $base[0] === ".") continue;
            if (!m_ext_ok($base)) continue;
            $rel = m_rel_under($root, str_replace("\\", "/", $path));
            if ($rel === "") continue;
            $absNorm = str_replace("\\", "/", $path);
            $meta = m_guess_meta($absNorm, $rel);
            $artist = $meta[0] ?? "";
            $title = $meta[1] ?? pathinfo($base, PATHINFO_FILENAME);
            $album = $meta[2] ?? "";
            if ($title === "") $title = pathinfo($base, PATHINFO_FILENAME);
            $out[] = [
                "id" => $rel,
                "title" => $title,
                "artist" => $artist,
                "album" => $album,
                "ext" => strtolower(pathinfo($base, PATHINFO_EXTENSION)),
                "size" => (int)$file->getSize(),
                "has_lrc" => m_has_lrc($absNorm),
                "has_cover" => m_find_local_cover($absNorm) !== "",
            ];
        }
    } catch (Throwable $e) {
        mlog("scan error: " . $e->getMessage());
        return [null, $e->getMessage(), ["truncated" => false, "limit" => $max, "max_depth" => $maxDepth, "count" => 0]];
    }
    usort($out, function ($a, $b) {
        $ka = strtolower(($a["artist"] ?? "") . "\0" . ($a["album"] ?? "") . "\0" . ($a["title"] ?? ""));
        $kb = strtolower(($b["artist"] ?? "") . "\0" . ($b["album"] ?? "") . "\0" . ($b["title"] ?? ""));
        return $ka <=> $kb;
    });
    return [$out, "", [
        "truncated" => $truncated,
        "limit" => $max,
        "max_depth" => $maxDepth,
        "count" => count($out),
    ]];
}

/** Delete files under a plugin cache dir (non-recursive flat + one-level quarantine). */
function m_clear_cache_dir($dir, $extAllow = null) {
    $dir = str_replace("\\", "/", (string)$dir);
    if ($dir === "" || !is_dir($dir)) return [0, 0, "missing"];
    $removed = 0;
    $bytes = 0;
    $allow = is_array($extAllow) ? $extAllow : null;
    try {
        $it = new DirectoryIterator($dir);
        foreach ($it as $f) {
            if ($f->isDot()) continue;
            $name = $f->getFilename();
            $path = str_replace("\\", "/", $f->getPathname());
            if ($f->isDir()) {
                // quarantine / bad subdirs: wipe files one level deep only
                if ($name === "" || $name[0] === ".") continue;
                try {
                    $sub = new DirectoryIterator($path);
                    foreach ($sub as $sf) {
                        if ($sf->isDot() || !$sf->isFile()) continue;
                        $sz = (int)$sf->getSize();
                        if (@unlink($sf->getPathname())) {
                            $removed++;
                            $bytes += max(0, $sz);
                        }
                    }
                } catch (Throwable $eSub) {}
                @rmdir($path);
                continue;
            }
            if (!$f->isFile()) continue;
            if ($allow !== null) {
                $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
                if (!in_array($ext, $allow, true)) continue;
            }
            $sz = (int)$f->getSize();
            if (@unlink($path)) {
                $removed++;
                $bytes += max(0, $sz);
            }
        }
    } catch (Throwable $e) {
        return [$removed, $bytes, $e->getMessage()];
    }
    return [$removed, $bytes, ""];
}

function m_stream($abs) {
    $size = filesize($abs);
    if ($size === false) {
        http_response_code(404);
        exit;
    }
    $mime = m_mime($abs);
    $start = 0;
    $end = $size - 1;
    $status = 200;
    if (isset($_SERVER["HTTP_RANGE"]) && preg_match('/bytes=(\d*)-(\d*)/', $_SERVER["HTTP_RANGE"], $m)) {
        if ($m[1] !== "") $start = (int)$m[1];
        if ($m[2] !== "") $end = (int)$m[2];
        if ($end >= $size) $end = $size - 1;
        if ($start > $end || $start < 0) {
            http_response_code(416);
            header("Content-Range: bytes */$size");
            exit;
        }
        $status = 206;
    }
    $length = $end - $start + 1;
    // free session early so concurrent range requests are not serialized on the lock
    if (function_exists("session_status") && session_status() === PHP_SESSION_ACTIVE) {
        @session_write_close();
    }
    // Disable output compression / buffering for media (breaks Content-Length + range)
    if (function_exists("apache_setenv")) {
        @apache_setenv("no-gzip", "1");
    }
    @ini_set("zlib.output_compression", "0");
    while (ob_get_level() > 0) {
        @ob_end_clean();
    }
    http_response_code($status);
    header("Content-Type: $mime");
    header("Accept-Ranges: bytes");
    header("Content-Length: $length");
    if ($status === 206) header("Content-Range: bytes $start-$end/$size");
    // short private cache helps mobile demuxer re-fetch metadata ranges
    header("Cache-Control: private, max-age=120");
    header("X-Content-Type-Options: nosniff");
    header("X-Accel-Buffering: no");
    // free session if any (again, defensive)
    if (function_exists("session_status") && session_status() === PHP_SESSION_ACTIVE) {
        @session_write_close();
    }
    $fp = @fopen($abs, "rb");
    if (!$fp) {
        http_response_code(500);
        exit;
    }
    // Prefer binary + ignore user abort mid-stream (client range cancel is normal)
    @ignore_user_abort(true);
    if ($start > 0) {
        // CIFS: fseek is fine; if it fails, fall back to sequential skip
        if (@fseek($fp, $start) !== 0) {
            $skipped = 0;
            while ($skipped < $start && !feof($fp)) {
                $need = min(81920, $start - $skipped);
                $buf = fread($fp, $need);
                if ($buf === false || $buf === "") break;
                $skipped += strlen($buf);
            }
            if ($skipped < $start) {
                fclose($fp);
                http_response_code(500);
                exit;
            }
        }
    }
    $remaining = $length;
    // Larger chunks reduce SMB round-trips for FLAC demuxer range storms
    $chunkMax = 262144;
    while ($remaining > 0 && !feof($fp)) {
        $chunk = ($remaining > $chunkMax) ? $chunkMax : $remaining;
        $data = fread($fp, $chunk);
        if ($data === false || $data === "") break;
        echo $data;
        $remaining -= strlen($data);
        if (connection_aborted()) break;
    }
    fclose($fp);
    exit;
}

// --- main ---
if (function_exists("session_status") && session_status() === PHP_SESSION_ACTIVE) {
    @session_write_close();
}

$cfg = mcfg_load($fx_path);
$action = strtolower(trim((string)($_GET["action"] ?? $_POST["action"] ?? "")));

if ($action === "config") {
    $root = m_realpath_dir($cfg["MUSIC_LOCAL_DIR"] ?? "");
    $run_mode = mcfg_resolve_run_mode($cfg);
    $mm = strtolower(trim((string)($cfg["MUSIC_RUN_MODE_MOBILE"] ?? "same")));
    if (!in_array($mm, ["same", "card", "chip", "both"], true)) $mm = "same";
    mjson([
        "ok" => true,
        "enable" => (($cfg["MUSIC_ENABLE"] ?? "no") === "yes"),
        "run_mode" => $run_mode,
        "ui" => $run_mode,
        "source" => $cfg["MUSIC_SOURCE"] ?? "local",
        "local_dir" => $cfg["MUSIC_LOCAL_DIR"] ?? "",
        "local_dir_ok" => $root !== "",
        "volume" => intval($cfg["MUSIC_VOLUME"] ?? 70),
        "autoplay" => (($cfg["MUSIC_AUTOPLAY"] ?? "no") === "yes"),
        "shuffle" => (($cfg["MUSIC_SHUFFLE"] ?? "no") === "yes"),
        "repeat" => in_array(($cfg["MUSIC_REPEAT"] ?? "off"), ["off", "one", "all"], true) ? $cfg["MUSIC_REPEAT"] : "off",
        "dash_only" => ($run_mode === "card"),
        "mobile" => [
            "run_mode" => $mm,
            "volume" => intval($cfg["MUSIC_VOLUME_MOBILE"] ?? 70),
            "autoplay" => (($cfg["MUSIC_AUTOPLAY_MOBILE"] ?? "no") === "yes"),
            "shuffle" => (($cfg["MUSIC_SHUFFLE_MOBILE"] ?? "no") === "yes"),
            "repeat" => in_array(($cfg["MUSIC_REPEAT_MOBILE"] ?? "off"), ["off", "one", "all"], true) ? $cfg["MUSIC_REPEAT_MOBILE"] : "off",
        ],
    ]);
}

if ($action === "dash_pos") {
    // Cross-browser / reboot-safe dashboard card placement (localStorage alone is per-browser).
    $method = strtoupper((string)($_SERVER["REQUEST_METHOD"] ?? "GET"));
    if ($method === "POST" || $method === "PUT") {
        $raw = file_get_contents("php://input");
        $o = json_decode((string)$raw, true);
        if (!is_array($o)) {
            // also accept form field
            if (isset($_POST["pos"])) $o = json_decode((string)$_POST["pos"], true);
        }
        if (!is_array($o)) mjson(["ok" => false, "error" => "invalid json"], 400);
        $clean = [
            "index" => isset($o["index"]) ? intval($o["index"]) : 0,
            "total" => isset($o["total"]) ? intval($o["total"]) : 0,
            "parentId" => substr(preg_replace('/[^\w\-.:#]/', '', (string)($o["parentId"] ?? "")), 0, 80),
            "parentTag" => substr(preg_replace('/[^a-z0-9]/', '', strtolower((string)($o["parentTag"] ?? ""))), 0, 32),
            "parentClass" => substr((string)($o["parentClass"] ?? ""), 0, 120),
            "prevId" => substr(preg_replace('/[^\w\-.:#]/', '', (string)($o["prevId"] ?? "")), 0, 80),
            "prevTag" => substr(preg_replace('/[^a-z0-9]/', '', strtolower((string)($o["prevTag"] ?? ""))), 0, 32),
            "nextId" => substr(preg_replace('/[^\w\-.:#]/', '', (string)($o["nextId"] ?? "")), 0, 80),
            "nextTag" => substr(preg_replace('/[^a-z0-9]/', '', strtolower((string)($o["nextTag"] ?? ""))), 0, 32),
            "ts" => isset($o["ts"]) ? intval($o["ts"]) : (int)round(microtime(true) * 1000),
            "v" => 3,
        ];
        // Refuse obvious "snapped to first slot" overwrites of a better prior save
        $prev = null;
        if (is_file($dash_pos_path)) {
            $prev = json_decode((string)@file_get_contents($dash_pos_path), true);
        }
        if (
            is_array($prev)
            && isset($prev["index"])
            && intval($prev["index"]) > 0
            && $clean["index"] === 0
            && ($clean["prevId"] === "" && $clean["nextId"] === "")
            && isset($prev["ts"])
            && ($clean["ts"] - intval($prev["ts"])) < 15000
        ) {
            mjson(["ok" => true, "saved" => false, "pos" => $prev, "reason" => "reject-top-race"]);
        }
        if (!is_dir($persist)) @mkdir($persist, 0755, true);
        $json = json_encode($clean, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $ok = $json !== false && @file_put_contents($dash_pos_path, $json . "\n") !== false;
        mjson(["ok" => $ok, "saved" => $ok, "pos" => $clean]);
    }
    // GET
    $pos = null;
    if (is_file($dash_pos_path)) {
        $pos = json_decode((string)@file_get_contents($dash_pos_path), true);
        if (!is_array($pos)) $pos = null;
    }
    mjson(["ok" => true, "pos" => $pos]);
}

if ($action === "list") {
    if (($cfg["MUSIC_ENABLE"] ?? "no") !== "yes") {
        mjson(["ok" => false, "error" => "音乐组件未开启", "tracks" => []], 400);
    }
    if (($cfg["MUSIC_SOURCE"] ?? "local") !== "local") {
        mjson(["ok" => false, "error" => "当前仅支持本地音源（V1）", "tracks" => []], 400);
    }
    $root = m_realpath_dir($cfg["MUSIC_LOCAL_DIR"] ?? "");
    if ($root === "") {
        mjson([
            "ok" => false,
            "error" => "本地音乐目录无效或不可访问。请在「Theme Music」设置中配置如 /mnt/user/Music",
            "tracks" => [],
            "dir" => $cfg["MUSIC_LOCAL_DIR"] ?? "",
        ], 400);
    }
    $limitIn = isset($_GET["limit"]) ? intval($_GET["limit"]) : 2000;
    [$tracks, $err, $scanMeta] = m_scan($root, $limitIn);
    if ($tracks === null) {
        mjson(["ok" => false, "error" => "扫描失败：$err", "tracks" => []], 500);
    }
    $truncated = !empty($scanMeta["truncated"]);
    $limit = intval($scanMeta["limit"] ?? 2000);
    mjson([
        "ok" => true,
        "dir" => $root,
        "count" => count($tracks),
        "tracks" => $tracks,
        "truncated" => $truncated,
        "limit" => $limit,
        "max_depth" => intval($scanMeta["max_depth"] ?? 8),
        "tip" => $truncated
            ? ("曲库已截断：仅加载前 {$limit} 首（目录可能更深/更多）。可用搜索定位已加载曲目，或缩小本地目录。")
            : "",
    ]);
}

if ($action === "clear_cache") {
    // Settings-page maintenance; allow even if player temporarily disabled.
    $wh = strtolower(trim((string)($_GET["what"] ?? $_POST["what"] ?? "all")));
    if (!in_array($wh, ["lyrics", "cover", "all"], true)) $wh = "all";
    $out = ["ok" => true, "what" => $wh, "lyrics" => null, "cover" => null];
    if ($wh === "lyrics" || $wh === "all") {
        $ld = m_lrc_cache_dir();
        [$n, $b, $e] = m_clear_cache_dir($ld, ["lrc", "txt", "bak", "bad"]);
        $out["lyrics"] = ["dir" => $ld, "removed" => $n, "bytes" => $b, "error" => $e !== "" ? $e : null];
    }
    if ($wh === "cover" || $wh === "all") {
        $cd = m_cover_cache_dir();
        [$n, $b, $e] = m_clear_cache_dir($cd, ["jpg", "jpeg", "png", "webp", "gif", "bin", "img"]);
        $out["cover"] = ["dir" => $cd, "removed" => $n, "bytes" => $b, "error" => $e !== "" ? $e : null];
    }
    mjson($out);
}

if ($action === "stream") {
    if (($cfg["MUSIC_ENABLE"] ?? "no") !== "yes") {
        http_response_code(403);
        header("Content-Type: text/plain; charset=utf-8");
        echo "music disabled";
        exit;
    }
    $root = m_realpath_dir($cfg["MUSIC_LOCAL_DIR"] ?? "");
    if ($root === "") {
        http_response_code(400);
        header("Content-Type: text/plain; charset=utf-8");
        echo "bad music dir";
        exit;
    }
    $rel = (string)($_GET["id"] ?? $_GET["path"] ?? "");
    $abs = m_abs_from_rel($root, $rel);
    if ($abs === "" || !m_ext_ok($abs)) {
        http_response_code(404);
        header("Content-Type: text/plain; charset=utf-8");
        echo "not found";
        exit;
    }
    m_stream($abs);
}

if ($action === "lyrics") {
    if (($cfg["MUSIC_ENABLE"] ?? "no") !== "yes") {
        mjson(["ok" => false, "error" => "音乐组件未开启", "lines" => []], 400);
    }
    $root = m_realpath_dir($cfg["MUSIC_LOCAL_DIR"] ?? "");
    if ($root === "") {
        mjson(["ok" => false, "error" => "本地音乐目录无效", "lines" => []], 400);
    }
    $rel = (string)($_GET["id"] ?? $_GET["path"] ?? "");
    $abs = m_abs_from_rel($root, $rel);
    if ($abs === "" || !m_ext_ok($abs)) {
        mjson(["ok" => false, "error" => "曲目不存在", "lines" => []], 404);
    }
    $doFetch = isset($_GET["fetch"]) && !in_array(strtolower((string)$_GET["fetch"]), ["0", "no", "false", "off"], true);
    $force = isset($_GET["force"]) && !in_array(strtolower((string)$_GET["force"]), ["0", "no", "false", "off"], true);
    $source = "sidecar";
    $mismatchNote = "";
    [$a0, $t0] = m_guess_meta($abs, $rel);
    // force=1: drop plugin cache entry so network re-match can run (sidecar kept if valid)
    if ($force) {
        $cdForce = m_lrc_cache_dir();
        if ($cdForce !== "" && $t0 !== "") {
            $cpForce = $cdForce . "/" . m_lrc_cache_key($a0, $t0) . ".lrc";
            if (is_file($cpForce)) {
                m_quarantine_lrc($cpForce, "force-refetch");
            }
        }
        $doFetch = true;
    }
    // Validate sidecar content against track; quarantine wrong LRC (e.g. 回来.lrc body = 别怕我伤心)
    $lrcAbs = m_find_matching_lrc($abs, $rel);
    // On force, prefer re-download even if a matching sidecar exists (user asked to re-fetch)
    if ($force && $lrcAbs !== "") {
        // Keep valid sidecar as fallback only if network fails later
        $sidecarKeep = $lrcAbs;
        $lrcAbs = "";
        $source = "sidecar";
    } else {
        $sidecarKeep = "";
    }
    // plugin cache by meta (before network), also validated
    if ($lrcAbs === "" && !$force) {
        $cd = m_lrc_cache_dir();
        if ($cd !== "" && $t0 !== "") {
            $cp = $cd . "/" . m_lrc_cache_key($a0, $t0) . ".lrc";
            if (is_file($cp) && filesize($cp) > 8) {
                $craw = @file_get_contents($cp);
                $ctext = m_lrc_decode($craw !== false ? $craw : "");
                [$cok, $cwhy] = m_lrc_matches_track($ctext, $a0, $t0);
                if ($cok) {
                    $lrcAbs = str_replace("\\", "/", $cp);
                    $source = "cache";
                } else {
                    mlog("lyrics-action cache-mismatch title={$t0} reason={$cwhy}");
                    m_quarantine_lrc($cp, "cache-mismatch");
                    $mismatchNote = $cwhy;
                }
            }
        }
    }
    // Auto-download when missing and fetch requested (or force re-fetch)
    if ($lrcAbs === "" && $doFetch) {
        [$okDl, $dlPath, $dlErr, $dlText] = m_fetch_and_save_lrc($abs, $rel, $force);
        if ($okDl && $dlPath !== "") {
            // Prefer freshly downloaded path; if force kept a sidecar identical path, still mark downloaded when from network cache write
            $lrcAbs = $dlPath;
            $source = ($force ? "refetched" : "downloaded");
            if ($sidecarKeep !== "" && str_replace("\\", "/", $dlPath) === str_replace("\\", "/", $sidecarKeep)) {
                $source = "sidecar";
            }
        } elseif ($dlText !== "") {
            // in-memory only (should not happen if write ok)
            $text = m_lrc_decode($dlText);
            [$offset, $meta, $lines] = m_parse_lrc($text);
            mjson([
                "ok" => true,
                "id" => $rel,
                "source" => "downloaded-memory",
                "offset_ms" => $offset,
                "meta" => $meta ?: new stdClass(),
                "lines" => $lines,
                "empty" => count($lines) === 0,
                "download_error" => $dlErr,
                "forced" => $force,
            ]);
        } else {
            // Network miss: fall back to previous valid sidecar if any
            if ($sidecarKeep !== "") {
                $lrcAbs = $sidecarKeep;
                $source = "sidecar";
                $mismatchNote = $dlErr !== "" ? $dlErr : $mismatchNote;
            } else {
                mjson([
                    "ok" => true,
                    "id" => $rel,
                    "source" => "none",
                    "offset_ms" => 0,
                    "meta" => new stdClass(),
                    "lines" => [],
                    "empty" => true,
                    "download_error" => $dlErr !== "" ? $dlErr : "未找到歌词",
                    "mismatch" => $mismatchNote,
                    "forced" => $force,
                ]);
            }
        }
    }
    if ($lrcAbs === "") {
        if ($sidecarKeep !== "") {
            $lrcAbs = $sidecarKeep;
            $source = "sidecar";
        } else {
            mjson([
                "ok" => true,
                "id" => $rel,
                "source" => "none",
                "offset_ms" => 0,
                "meta" => new stdClass(),
                "lines" => [],
                "empty" => true,
                "forced" => $force,
            ]);
        }
    }
    $lrcReal = str_replace("\\", "/", $lrcAbs);
    $rootSlash = rtrim($root, "/") . "/";
    $cacheDirAllow = m_lrc_cache_dir();
    $inRoot = (strpos($lrcReal, $rootSlash) === 0);
    $inCache = ($cacheDirAllow !== "" && strpos($lrcReal, rtrim(str_replace("\\", "/", $cacheDirAllow), "/") . "/") === 0);
    if (!$inRoot && !$inCache) {
        $lrcRp = realpath($lrcAbs);
        $rootRp = realpath($root);
        $ok = false;
        if ($lrcRp !== false) {
            $lrcRp = str_replace("\\", "/", $lrcRp);
            if ($rootRp !== false && strpos($lrcRp, rtrim(str_replace("\\", "/", $rootRp), "/") . "/") === 0) $ok = true;
            if (!$ok && $cacheDirAllow !== "") {
                $cdRp = realpath($cacheDirAllow);
                if ($cdRp !== false && strpos($lrcRp, rtrim(str_replace("\\", "/", $cdRp), "/") . "/") === 0) $ok = true;
            }
        }
        if (!$ok) {
            mjson(["ok" => false, "error" => "歌词路径越权", "lines" => []], 403);
        }
        $lrcAbs = $lrcRp;
    }
    $size = @filesize($lrcAbs);
    if ($size === false || $size <= 0) {
        mjson([
            "ok" => true,
            "id" => $rel,
            "source" => $source,
            "offset_ms" => 0,
            "meta" => new stdClass(),
            "lines" => [],
            "empty" => true,
        ]);
    }
    if ($size > 512 * 1024) {
        mjson(["ok" => false, "error" => "LRC 过大（>512KB）", "lines" => []], 400);
    }
    $raw = @file_get_contents($lrcAbs);
    if ($raw === false) {
        mjson(["ok" => false, "error" => "无法读取 LRC", "lines" => []], 500);
    }
    $text = m_lrc_decode($raw);
    [$offset, $meta, $lines] = m_parse_lrc($text);
    mjson([
        "ok" => true,
        "id" => $rel,
        "source" => $source,
        "offset_ms" => $offset,
        "meta" => $meta ?: new stdClass(),
        "lines" => $lines,
        "empty" => count($lines) === 0,
        "lrc_name" => basename($lrcAbs),
    ]);
}

if ($action === "cover") {
    if (($cfg["MUSIC_ENABLE"] ?? "no") !== "yes") {
        mjson(["ok" => false, "error" => "音乐组件未开启", "url" => ""], 400);
    }
    $root = m_realpath_dir($cfg["MUSIC_LOCAL_DIR"] ?? "");
    if ($root === "") {
        mjson(["ok" => false, "error" => "本地音乐目录无效", "url" => ""], 400);
    }
    $rel = (string)($_GET["id"] ?? $_GET["path"] ?? "");
    $abs = m_abs_from_rel($root, $rel);
    if ($abs === "" || !m_ext_ok($abs)) {
        mjson(["ok" => false, "error" => "曲目不存在", "url" => ""], 404);
    }
    $doFetch = isset($_GET["fetch"]) && !in_array(strtolower((string)$_GET["fetch"]), ["0", "no", "false", "off"], true);
    // raw image stream
    if (isset($_GET["raw"]) && !in_array(strtolower((string)$_GET["raw"]), ["0", "no", "false", "off"], true)) {
        $pack = m_resolve_cover($abs, $rel, $doFetch);
        $cpath = $pack[0] ?? "";
        $src = $pack[1] ?? "";
        $cerr = $pack[2] ?? "";
        $remote = $pack[3] ?? "";
        if (($cpath === "" || !is_file($cpath)) && $remote !== "" && preg_match('#^https?://#i', $remote)) {
            // proxy remote image through API so browser stays same-origin
            [$bytes, $rerr, $rcode] = m_http_get($remote, 18, "image/*,*/*;q=0.8");
            if ($bytes !== false && m_is_cover_bytes($bytes)) {
                $ext = m_cover_ext_from_bytes($bytes);
                $map = ["jpg" => "image/jpeg", "jpeg" => "image/jpeg", "png" => "image/png", "webp" => "image/webp", "gif" => "image/gif"];
                header("Content-Type: " . ($map[$ext] ?? "image/jpeg"));
                header("Content-Length: " . strlen($bytes));
                header("Cache-Control: private, max-age=3600");
                header("X-Content-Type-Options: nosniff");
                header("X-UCWC-Cover-Source: remote-proxy");
                if (function_exists("session_status") && session_status() === PHP_SESSION_ACTIVE) @session_write_close();
                echo $bytes;
                exit;
            }
            http_response_code(404);
            header("Content-Type: text/plain; charset=utf-8");
            echo $rerr !== "" ? $rerr : "no cover";
            exit;
        }
        if ($cpath === "" || !is_file($cpath)) {
            http_response_code(404);
            header("Content-Type: text/plain; charset=utf-8");
            echo $cerr !== "" ? $cerr : "no cover";
            exit;
        }
        $ok = false;
        $cReal = str_replace("\\", "/", realpath($cpath) ?: $cpath);
        $cNorm = str_replace("\\", "/", $cpath);
        $rootSlash = rtrim($root, "/") . "/";
        if (strpos($cReal, $rootSlash) === 0) $ok = true;
        $cacheDir = m_cover_cache_dir();
        if (!$ok && $cacheDir !== "") {
            $cdReal = str_replace("\\", "/", realpath($cacheDir) ?: $cacheDir);
            $cd = rtrim($cdReal, "/") . "/";
            if (strpos($cReal, $cd) === 0) $ok = true;
            $cd2 = rtrim(str_replace("\\", "/", $cacheDir), "/") . "/";
            if (!$ok && strpos($cNorm, $cd2) === 0) {
                $ok = true;
                $cReal = $cNorm;
            }
        }
        if (!$ok && strpos($cReal, "/boot/config/plugins/theme.music/cover-cache/") === 0) $ok = true;
        if (!$ok && strpos($cNorm, "/boot/config/plugins/theme.music/cover-cache/") === 0) { $ok = true; $cReal = $cNorm; }
        // allow tmp extract/write fallback
        $tmpDir = rtrim(str_replace("\\", "/", sys_get_temp_dir()), "/") . "/";
        if (!$ok && strpos($cNorm, $tmpDir . "ucwc-cover-") === 0) { $ok = true; $cReal = $cNorm; }
        if (!$ok && preg_match('#^/tmp/ucwc-cover-[a-f0-9]+\.(jpg|jpeg|png|webp|gif)$#', $cNorm)) { $ok = true; $cReal = $cNorm; }
        if (!$ok) {
            mlog("cover-stream forbid path=$cReal root=$root");
            http_response_code(403);
            exit;
        }
        m_stream_image($cReal);
    }
    $pack = m_resolve_cover($abs, $rel, $doFetch);
    $cpath = $pack[0] ?? "";
    $src = $pack[1] ?? "";
    $cerr = $pack[2] ?? "";
    $remote = $pack[3] ?? "";
    if ($cpath === "" || !is_file($cpath)) {
        if ($remote !== "" && preg_match('#^https?://#i', $remote)) {
            // same-origin proxy URL (avoids mixed-content / CORS on dashboard)
            $url = "/plugins/theme.music/ucwc-music-api.php?action=cover&raw=1&fetch=1&id=" . rawurlencode($rel) . "&_v=" . time();
            mjson([
                "ok" => true,
                "id" => $rel,
                "url" => $url,
                "source" => $src !== "" ? $src : "remote",
                "empty" => false,
                "error" => null,
                "remote" => true,
            ]);
        }
        mjson([
            "ok" => true,
            "id" => $rel,
            "url" => "",
            "source" => $src,
            "empty" => true,
            "error" => $cerr !== "" ? $cerr : null,
        ]);
    }
    $url = "/plugins/theme.music/ucwc-music-api.php?action=cover&raw=1&fetch=0&id=" . rawurlencode($rel) . "&_v=" . (@filemtime($cpath) ?: time());
    mjson([
        "ok" => true,
        "id" => $rel,
        "url" => $url,
        "source" => $src,
        "empty" => false,
        "error" => null,
    ]);
}

mjson(["ok" => false, "error" => "unknown action"], 400);
