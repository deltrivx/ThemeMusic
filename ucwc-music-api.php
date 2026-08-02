<?php
/**
 * ThemeMusic music API
 * Local directory and Navidrome/OpenSubsonic library, media, cover and lyrics proxy.
 */
header("X-Content-Type-Options: nosniff");

$persist = "/boot/config/plugins/theme.music/theme.music.cfg";
$rawCfgText = is_file($persist) ? (string)file_get_contents($persist) : "";
$persistDefault = "/boot/config/plugins/theme.music/theme-music.cfg";
$rawDefaultText = is_file($persistDefault) ? (string)file_get_contents($persistDefault) : "";

$cfg = [];
foreach ([$rawDefaultText, $rawCfgText] as $blob) {
    foreach (preg_split('/\r?\n/', (string)$blob) as $line) {
        $line = trim((string)$line);
        if ($line === "" || str_starts_with($line, "#")) continue;
        $eq = strpos($line, "=");
        if ($eq === false) continue;
        $k = trim(substr($line, 0, $eq));
        $v = trim(substr($line, $eq + 1), " \t\"'");
        $cfg[$k] = $v;
    }
}

$action = isset($_REQUEST["action"]) ? (string)$_REQUEST["action"] : "";
$method = isset($_SERVER["REQUEST_METHOD"]) ? strtoupper((string)$_SERVER["REQUEST_METHOD"]) : "GET";
if ($action === "" && $method === "POST") {
    $raw = (string)file_get_contents("php://input");
    if ($raw !== "") {
        $j = json_decode($raw, true);
        if (is_array($j) && isset($j["action"])) $action = (string)$j["action"];
    }
}

function mjson($data, $status = 200) {
    http_response_code($status);
    header("Content-Type: application/json; charset=utf-8");
    header("Cache-Control: no-store, no-cache, must-revalidate");
    header("Pragma: no-cache");
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function m_cfg_get(array $cfg, $key, $default = "") {
    if (array_key_exists($key, $cfg)) {
        $v = $cfg[$key];
        if (is_string($v)) {
            $stripped = trim($v, " \t\"'");
            if ($stripped !== "" || $v === "") return $stripped;
        }
        return $v;
    }
    return $default;
}

function m_version_parts($id) {
    $s = strtolower(ltrim(trim((string)$id), "v"));
    if (!preg_match('/^(\d+)\.(\d+)(?:\.(\d+))?(?:[-_.]?(alpha|beta|rc|b)(\d*))?$/', $s, $m)) return null;
    $kind = $m[4] ?? "";
    $rank = $kind === "alpha" ? 1 : ($kind === "beta" || $kind === "b" ? 2 : ($kind === "rc" ? 3 : 100));
    return [(int)$m[1], (int)$m[2], (int)($m[3] ?? 0), $rank, $rank < 100 ? (int)($m[5] ?? 0) : 0];
}

function m_version_compare($a, $b) {
    $pa = m_version_parts($a);
    $pb = m_version_parts($b);
    if (!$pa || !$pb) return 0;
    for ($i = 0; $i < 5; $i++) {
        if ($pa[$i] !== $pb[$i]) return $pa[$i] <=> $pb[$i];
    }
    return 0;
}

function m_installed_version() {
    $base = "/boot/config/plugins/theme.music";
    foreach (["$base/ThemeMusic.options", "$base/ThemeMusic.state"] as $path) {
        if (!is_file($path)) continue;
        $lines = @file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if (!is_array($lines)) continue;
        foreach ($lines as $line) {
            if (preg_match('/^\\s*version\\s*=\\s*[\"\']?([^\"\'\\s]+)\\s*$/i', (string)$line, $m)) return trim($m[1]);
        }
    }
    return "";
}

function m_glob_first($pattern) {
    $items = glob($pattern);
    if (!is_array($items) || !count($items)) return "";
    return (string)$items[0];
}

function m_emit_json_file($path) {
    if (!is_file($path)) return false;
    $fp = fopen($path, "rb");
    if (!$fp) return false;
    $size = filesize($path);
    if ($size === false) { fclose($fp); return false; }
    $head = fread($fp, 1);
    if ($head !== "{") { fclose($fp); return false; }
    $body = $head . ($size > 1 ? fread($fp, $size - 1) : "");
    fclose($fp);
    $arr = json_decode($body, true);
    if (!is_array($arr)) return false;
    header("Content-Type: application/json; charset=utf-8");
    header("Cache-Control: no-store, no-cache, must-revalidate");
    header("Pragma: no-cache");
    echo json_encode($arr, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function m_emit_cover_empty() {
    http_response_code(404);
    header("Content-Type: application/json; charset=utf-8");
    header("Cache-Control: no-store, no-cache, must-revalidate");
    echo json_encode(["ok" => false, "empty" => true], JSON_UNESCAPED_UNICODE);
    exit;
}

function m_normalize_path($p) {
    $p = (string)$p;
    $p = str_replace("\\", "/", $p);
    while (preg_match('#/\\./#', $p)) $p = preg_replace('#/\\./#', '/', $p);
    $parts = [];
    foreach (explode("/", $p) as $seg) {
        if ($seg === "" || $seg === ".") continue;
        if ($seg === "..") { array_pop($parts); continue; }
        $parts[] = $seg;
    }
    return "/" . implode("/", $parts);
}

function m_safe_path_under($root, $candidate) {
    $root = rtrim((string)$root, "/");
    $cand = m_normalize_path($candidate);
    $base = m_normalize_path($root);
    if ($base === "/" || $base === "") return $cand;
    if (str_starts_with($cand, $base . "/") || $cand === $base) return $cand;
    return "";
}

function m_match_ext($name, array $exts) {
    $name = strtolower((string)$name);
    $dot = strrpos($name, ".");
    if ($dot === false) return false;
    $ext = substr($name, $dot + 1);
    foreach ($exts as $e) if (strtolower($e) === $ext) return true;
    return false;
}

function m_dir_is_listable($dir) {
    $d = (string)$dir;
    if ($d === "" || !is_dir($d)) return false;
    $test = @opendir($d);
    if ($test === false) return false;
    @closedir($test);
    return true;
}

function m_storage_label($strategy) {
    switch ((string)$strategy) {
        case "local_disk":   return "本地磁盘：已唤醒 / 可播放";
        case "local_share":  return "Unraid 用户共享：已就绪";
        case "smb":          return "SMB 远端存储：已就绪";
        case "nfs":          return "NFS 远端存储：已就绪";
        case "fnos":         return "飞牛音乐：已连接";
        case "navidrome":    return "Navidrome 远端 API：已连接";
        case "invalid":      return "本地音乐目录不可访问";
        case "empty":        return "本地音乐目录为空";
        default:             return "等待播放自动检测";
    }
}

function m_detect_storage_source(array $cfg) {
    $selected = strtolower(trim((string)m_cfg_get($cfg, "MUSIC_SOURCE", "local")));
    if ($selected === "fnos") return ["strategy" => "fnos", "label" => m_storage_label("fnos"), "info" => ["path" => m_cfg_get($cfg, "MUSIC_FNOS_URL", "")]];
    if ($selected === "navidrome") return ["strategy" => "navidrome", "label" => m_storage_label("navidrome"), "info" => ["path" => m_cfg_get($cfg, "MUSIC_NAVIDROME_URL", "")]];
    $cfgStr = m_cfg_get($cfg, "MUSIC_LOCAL_DIR", "");
    if ($cfgStr === "") $cfgStr = m_cfg_get($cfg, "MUSIC_DIR", "/mnt/user/music");
    $userShare = m_cfg_get($cfg, "MUSIC_SHARE", "/mnt/user/music");
    $disks = m_cfg_get($cfg, "MUSIC_DISKS", "/mnt/disk1/music,/mnt/disk2/music");
    $strategy = "invalid";
    $label = "";
    $info = [];
    $candidates = [];
    $candidates[] = ["path" => $cfgStr, "kind" => "auto", "share" => $userShare];
    foreach (preg_split('/\s*,\s*/', (string)$disks) as $d) {
        $d = trim((string)$d);
        if ($d === "") continue;
        $candidates[] = ["path" => $d, "kind" => "disk", "share" => $userShare];
    }
    foreach ($candidates as $c) {
        $p = (string)$c["path"];
        if ($p === "" || !m_dir_is_listable($p)) continue;
        if (!empty($c["share"])) {
            $strategy = "local_share";
            $label = "Unraid 用户共享：" . $p;
        } else {
            $strategy = "local_disk";
            $label = "本地磁盘：" . $p;
        }
        $info = ["path" => $p];
        return ["strategy" => $strategy, "label" => $label, "info" => $info];
    }
    if ($selected === "local") return ["strategy" => "invalid", "label" => m_storage_label("invalid"), "info" => []];
    $smb = trim((string)m_cfg_get($cfg, "MUSIC_SMB", "") );
    $nfs = trim((string)m_cfg_get($cfg, "MUSIC_NFS", ""));
    if ($smb !== "" || $nfs !== "") {
        $strategy = $smb !== "" ? "smb" : "nfs";
        $label = $strategy === "smb" ? "SMB 远端存储默认挂载" : "NFS 远端存储默认挂载";
    }
    $fnos = trim((string)m_cfg_get($cfg, "MUSIC_FNOS_URL", ""));
    $navidrome = trim((string)m_cfg_get($cfg, "MUSIC_NAVIDROME_URL", ""));
    if ($fnos !== "") {
        $strategy = "fnos";
        $label = "飞牛音乐";
    } else if ($navidrome !== "") {
        $strategy = "navidrome";
        $label = "Navidrome 远端 API";
    }
    if ($strategy === "invalid") {
        $label = "本地音乐目录不可访问";
    }
    return ["strategy" => $strategy, "label" => $label, "info" => $info];
}

function m_wake_source_path(array $cfg) {
    $selected = strtolower(trim((string)m_cfg_get($cfg, "MUSIC_SOURCE", "local")));
    if ($selected === "fnos") return ["ok" => true, "strategy" => "fnos", "label" => m_storage_label("fnos"), "path" => m_cfg_get($cfg, "MUSIC_FNOS_URL", "")];
    if ($selected === "navidrome") return ["ok" => true, "strategy" => "navidrome", "label" => m_storage_label("navidrome"), "path" => m_cfg_get($cfg, "MUSIC_NAVIDROME_URL", "")];
    $cfgStr = m_cfg_get($cfg, "MUSIC_LOCAL_DIR", "");
    if ($cfgStr === "") $cfgStr = m_cfg_get($cfg, "MUSIC_DIR", "/mnt/user/music");
    $userShare = m_cfg_get($cfg, "MUSIC_SHARE", "/mnt/user/music");
    $disks = m_cfg_get($cfg, "MUSIC_DISKS", "/mnt/disk1/music,/mnt/disk2/music");
    $candidates = [];
    $candidates[] = ["path" => $cfgStr, "kind" => "auto", "share" => $userShare];
    foreach (preg_split('/\s*,\s*/', (string)$disks) as $d) {
        $d = trim((string)$d);
        if ($d === "") continue;
        $candidates[] = ["path" => $d, "kind" => "disk", "share" => $userShare];
    }
    foreach ($candidates as $c) {
        $p = (string)$c["path"];
        if ($p === "") continue;
        if (!empty($c["share"])) {
            $strat = "local_share";
        } else {
            $strat = "local_disk";
        }
        if (m_dir_is_listable($p)) {
            $entries = @scandir($p);
            $hasFiles = false;
            if (is_array($entries)) {
                foreach ($entries as $name) {
                    if ($name === "." || $name === "..") continue;
                    $hasFiles = true;
                    break;
                }
            }
            return [
                "ok" => true,
                "strategy" => $strat,
                "label" => m_storage_label($strat),
                "path" => $p,
                "empty" => !$hasFiles,
            ];
        }
        $emcmd = trim((string)m_cfg_get($cfg, "MUSIC_EMCMD", "/usr/local/sbin/emcmd"));
        if (!empty($c["share"])) {
            $strat = "local_share";
        } else if (is_file($emcmd) && is_executable($emcmd)) {
            $rc = 0;
            $out = [];
            @exec(escapeshellcmd($emcmd) . " cmdWOL /boot/config/plugins/dynamix/include/cmdWOL.php '" . escapeshellarg($p) . "' 2>&1", $out, $rc);
            usleep(800000);
            if (m_dir_is_listable($p)) {
                return [
                    "ok" => true,
                    "strategy" => $strat,
                    "label" => m_storage_label($strat),
                    "path" => $p,
                    "empty" => false,
                    "woken" => true,
                ];
            }
        }
    }
    if ($selected === "local") return ["ok" => false, "strategy" => "invalid", "label" => m_storage_label("invalid")];
    $smb = trim((string)m_cfg_get($cfg, "MUSIC_SMB", ""));
    $nfs = trim((string)m_cfg_get($cfg, "MUSIC_NFS", ""));
    if ($smb !== "") {
        return [
            "ok" => true,
            "strategy" => "smb",
            "label" => m_storage_label("smb"),
            "path" => $smb,
        ];
    }
    if ($nfs !== "") {
        return [
            "ok" => true,
            "strategy" => "nfs",
            "label" => m_storage_label("nfs"),
            "path" => $nfs,
        ];
    }
    $fnos = trim((string)m_cfg_get($cfg, "MUSIC_FNOS_URL", ""));
    if ($fnos !== "") {
        return [
            "ok" => true,
            "strategy" => "fnos",
            "label" => m_storage_label("fnos"),
            "path" => $fnos,
        ];
    }
    $navidrome = trim((string)m_cfg_get($cfg, "MUSIC_NAVIDROME_URL", ""));
    if ($navidrome !== "") {
        return [
            "ok" => true,
            "strategy" => "navidrome",
            "label" => m_storage_label("navidrome"),
            "path" => $navidrome,
        ];
    }
    return [
        "ok" => false,
        "strategy" => "invalid",
        "label" => m_storage_label("invalid"),
    ];
}

function m_fnos_secret_path() {
    $candidates = [
        "/boot/config/plugins/theme.music/fnos.secret",
        "/boot/config/plugins/theme.music/.fnos.secret",
    ];
    foreach ($candidates as $c) {
        if (is_file($c)) return $c;
    }
    return "";
}

function m_fnos_password(array $cfg) {
    $inline = trim((string)m_cfg_get($cfg, "MUSIC_FNOS_PASSWORD", ""));
    if ($inline !== "") return $inline;
    $sp = m_fnos_secret_path();
    if ($sp !== "" && is_file($sp) && is_readable($sp)) {
        $raw = (string)@file_get_contents($sp);
        $raw = preg_replace('/\s+/', '', $raw);
        if ($raw !== "") return $raw;
    }
    return "";
}

function m_fnos_authx($method, $pathQ, $body = "", $query = "") {
    $nonce = (string)random_int(100000, 999999);
    $timestamp = (string)round(microtime(true) * 1000);
    $payloadHash = hash("sha256", strtoupper($method) === "GET" ? (string)$query : (string)$body);
    $apiKey = "6D5602D4-A342-4799-A0F0-BB795E7167D0";
    $raw = "NDzZTVxnRKP8Z0jXg1VAMonaG8akvh_" . $pathQ . "_" . $nonce . "_" . $timestamp . "_" . $payloadHash . "_" . $apiKey;
    return "nonce=" . $nonce . "&timestamp=" . $timestamp . "&sign=" . hash("sha256", $raw);
}

function m_fnos_login($base, $user, $password, $timeout = 12) {
    if ($user === "" || $password === "") return "";
    $path = rtrim($base, "/") . "/user/password-login";
    $payload = json_encode([
        "username" => $user,
        "password" => hash("sha256", $password),
        "deviceId" => "theme-music",
    ], JSON_UNESCAPED_SLASHES);
    $url = $path;
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        "Accept: application/json",
        "Content-Type: application/json",
        "authx: " . m_fnos_authx("POST", parse_url($url, PHP_URL_PATH), $payload, ""),
        "User-Agent: ThemeMusic/1.3.0",
    ]);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HEADER, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
    curl_setopt($ch, CURLOPT_TIMEOUT, (int)$timeout);
    $raw = curl_exec($ch);
    $headerSize = (int)curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    $raw = (string)$raw;
    $headers = substr($raw, 0, $headerSize);
    $body = substr($raw, $headerSize);
    $j = json_decode($body, true);
    $token = is_array($j) ? (string)($j["userToken"] ?? $j["data"]["userToken"] ?? "") : "";
    if ($token === "" && preg_match('/(?:^|\r?\n)Set-Cookie:\s*music-token=([^;\r\n]+)/i', $headers, $m)) {
        $token = trim($m[1]);
    }
    return $token;
}

function m_fnos_request(array $cfg, $pathQ, $params = [], $method = "GET", $body = "", $timeout = 15) {
    $url = trim((string)m_cfg_get($cfg, "MUSIC_FNOS_URL", ""));
    if ($url === "") return [null, "未配置飞牛音乐地址"];
    $url = rtrim($url, "/");
    /* FnOS Music exposes its JSON API below /music/api/v1. Accept either
     * the service root or a URL already ending in /music or /api/v1. */
    if (!preg_match('#/api/v[0-9]+$#i', $url)) {
        $url .= preg_match('#/music$#i', $url) ? "/api/v1" : "/music/api/v1";
    }
    $apiBase = $url;
    $user = trim((string)m_cfg_get($cfg, "MUSIC_FNOS_USER", ""));
    $pwd = m_fnos_password($cfg);
    if (strtolower($method) === "get" && !empty($params)) {
        ksort($params);
        $query = http_build_query($params, "", "&", PHP_QUERY_RFC3986);
    } else {
        $query = "";
    }
    $fullPath = "/" . ltrim($pathQ, "/") . ($query !== "" ? "?" . $query : "");
    $fullUrl = $url . $fullPath;
    $headers = [
        "Accept: application/json",
        "User-Agent: ThemeMusic/1.3.0",
        "authx: " . m_fnos_authx($method, "/" . ltrim($pathQ, "/"), $body, $query),
    ];
    if ($user !== "" && $pwd !== "") {
        $token = m_fnos_login($url, $user, $pwd, $timeout);
        if ($token !== "") $headers[] = "Cookie: music-token=" . $token;
    }
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $fullUrl);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, strtoupper($method));
    if (strtoupper($method) !== "GET" && $body !== "") {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
    curl_setopt($ch, CURLOPT_TIMEOUT, (int)$timeout);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
    $resp = curl_exec($ch);
    $errno = curl_errno($ch);
    $errStr = $errno ? curl_error($ch) : "";
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($errno !== 0 || $resp === false) {
        return [null, "网络错误：" . ($errStr ?: ("errno=" . $errno))];
    }
    if ((int)$code >= 400) {
        return [null, "HTTP " . (int)$code];
    }
    $j = json_decode((string)$resp, true);
    if (!is_array($j)) return [null, "响应非 JSON"];
    return [$j, ""];
}

function m_fnos_response(array $cfg, $pathQ, $params = [], $timeout = 15) {
    return m_fnos_request($cfg, $pathQ, $params, "GET", "", $timeout);
}

function m_navidrome_password(array $cfg) {
    $inline = trim((string)m_cfg_get($cfg, "MUSIC_NAVIDROME_PASSWORD", ""));
    if ($inline !== "") return $inline;
    $path = "/boot/config/plugins/theme.music/navidrome.secret";
    return is_readable($path) ? trim((string)@file_get_contents($path)) : "";
}

function m_navidrome_request(array $cfg, $pathQ, $params = [], $method = "GET", $body = "", $timeout = 15) {
    $url = trim((string)m_cfg_get($cfg, "MUSIC_NAVIDROME_URL", ""));
    if ($url === "") return [null, "未配置 Navidrome 地址"];
    $url = rtrim($url, "/");
    $user = trim((string)m_cfg_get($cfg, "MUSIC_NAVIDROME_USER", ""));
    $pwd = m_navidrome_password($cfg);
    $client = trim((string)m_cfg_get($cfg, "MUSIC_NAVIDROME_CLIENT", "theme-music"));
    $version = trim((string)m_cfg_get($cfg, "MUSIC_NAVIDROME_VERSION", "1.16.1"));
    $fmt = trim((string)m_cfg_get($cfg, "MUSIC_NAVIDROME_FORMAT", "json"));
    $sep = (strpos($pathQ, "?") === false) ? "?" : "&";
    $auth = [
        "u" => $user,
        "c" => $client,
        "v" => $version,
        "f" => $fmt,
    ];
    if ($user !== "" && $pwd !== "") {
        $tok = "enc:" . bin2hex(md5($pwd, true));
        $auth["t"] = substr(md5($auth["t"] = "" . $tok, true), 0, 0);
        $salt = bin2hex(random_bytes(6));
        $auth["s"] = $salt;
        $auth["t"] = md5($pwd . $salt);
    }
    $fullUrl = $url . "/" . ltrim($pathQ, "/") . $sep . http_build_query(array_merge($auth, $params));
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $fullUrl);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, strtoupper($method));
    if (strtoupper($method) !== "GET" && $body !== "") {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ["Content-Type: application/json"]);
    }
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
    curl_setopt($ch, CURLOPT_TIMEOUT, (int)$timeout);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
    $resp = curl_exec($ch);
    $errno = curl_errno($ch);
    $errStr = $errno ? curl_error($ch) : "";
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($errno !== 0 || $resp === false) {
        return [null, "网络错误：" . ($errStr ?: ("errno=" . $errno))];
    }
    if ((int)$code >= 400) {
        return [null, "HTTP " . (int)$code];
    }
    $j = json_decode((string)$resp, true);
    if (!is_array($j)) return [null, "响应非 JSON"];
    return [$j, ""];
}

function m_local_music_root(array $cfg) {
    $strat = m_detect_storage_source($cfg);
    if (!empty($strat["info"]["path"])) return (string)$strat["info"]["path"];
    $cfgStr = m_cfg_get($cfg, "MUSIC_LOCAL_DIR", "");
    if ($cfgStr === "") $cfgStr = m_cfg_get($cfg, "MUSIC_DIR", "/mnt/user/music");
    if (m_dir_is_listable($cfgStr)) return $cfgStr;
    foreach (preg_split('/\s*,\s*/', (string)m_cfg_get($cfg, "MUSIC_DISKS", "")) as $d) {
        $d = trim((string)$d);
        if ($d !== "" && m_dir_is_listable($d)) return $d;
    }
    return "";
}

function m_local_scan_files($root, $maxDepth = 6) {
    $root = rtrim((string)$root, "/");
    if ($root === "" || !is_dir($root)) return [];
    $audio = ["mp3","flac","m4a","aac","ogg","wav","opus","wma"];
    $out = [];
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::LEAVES_ONLY
    );
    $it->setMaxDepth((int)$maxDepth);
    foreach ($it as $info) {
        $name = (string)$info->getFilename();
        if (m_match_ext($name, $audio)) $out[] = (string)$info->getPathname();
    }
    return $out;
}

function m_track_text($value) {
    $value = trim((string)$value);
    return preg_replace('/\\s+/u', ' ', $value);
}

function m_track_title_from_path($path) {
    $name = pathinfo((string)$path, PATHINFO_FILENAME);
    $name = preg_replace('/^[0-9]+[.\\-_ ]+/u', '', $name);
    $name = preg_replace('/[.\\-_]+/u', ' ', $name);
    return m_track_text($name) ?: "未知曲目";
}

function m_local_path_tags($path, $root = "") {
    $path = str_replace("\\", "/", (string)$path);
    $root = rtrim(str_replace("\\", "/", (string)$root), "/");
    $rel = $root !== "" && strpos($path, $root . "/") === 0 ? substr($path, strlen($root) + 1) : basename($path);
    $parts = array_values(array_filter(explode("/", trim($rel, "/")), function ($v) {
        return trim((string)$v) !== "";
    }));
    $dirs = count($parts) > 1 ? array_slice($parts, 0, -1) : [];
    $dirs = array_values(array_filter($dirs, function ($v) {
        return !preg_match('/^(cd|disc|disk)\\s*[-_]?\\s*\\d+$/i', trim((string)$v));
    }));
    $artist = "";
    $album = "";
    if (count($dirs) >= 2) {
        $artist = m_track_text($dirs[count($dirs) - 2]);
        $album = m_track_text($dirs[count($dirs) - 1]);
    } elseif (count($dirs) === 1) {
        $album = m_track_text($dirs[0]);
    }
    $pairSource = $artist !== "" ? $artist : $album;
    $pair = preg_split('/\s+-\s+/u', $pairSource, 2);
    if (count($pair) === 2 && trim($pair[0]) !== "" && trim($pair[1]) !== "") {
        $artist = m_track_text($pair[0]);
        $album = m_track_text($pair[1]);
    }

    return ["artist" => $artist, "album" => $album];
}

function m_track_normalize(array $item, $source, $fallbackId = "") {
    $source = strtolower(trim((string)$source));
    $id = m_track_text($item["id"] ?? $item["path"] ?? $item["url"] ?? $fallbackId);
    $path = m_track_text($item["path"] ?? $id);
    $title = m_track_text($item["title"] ?? $item["name"] ?? $item["trackName"] ?? $item["songName"] ?? "");
    $artist = m_track_text($item["artist"] ?? $item["artistName"] ?? $item["singer"] ?? $item["author"] ?? "");
    $album = m_track_text($item["album"] ?? $item["albumName"] ?? $item["collectionName"] ?? "");
    if ($source === "local") {
        $tags = m_local_path_tags($path, $item["_root"] ?? "");
            if ($artist === "") $artist = $tags["artist"];
        if ($album === "") $album = $tags["album"];
        $album = preg_replace('/\s+(?:FLAC|MP3|CD|DISC)\s*$/iu', '', $album);
    }
    if ($title === "" && $source === "local") $title = m_track_title_from_path($path !== "" ? $path : $id);
    if ($title === "") $title = "未知曲目";
    $ext = strtolower(pathinfo($path !== "" ? $path : $id, PATHINFO_EXTENSION));
    if ($ext === "" && !empty($item["format"])) $ext = strtolower((string)$item["format"]);
    $cover = $item["coverArt"] ?? $item["coverUrl"] ?? $item["cover"] ?? $item["artwork"] ?? "";
    $out = $item;
    unset($out["_root"]);
    $out["id"] = $id;
    $out["path"] = $path;
    $out["source"] = $source;
    $out["title"] = $title;
    $out["artist"] = $artist;
    $out["album"] = $album;
    $out["ext"] = $ext;
    if ($cover !== "") $out["coverArt"] = $cover;
    $out["has_cover"] = !empty($item["has_cover"]) || !empty($item["hasCover"]) || $cover !== "";
    return $out;
}


if ($action === "config") {
    $auto = m_detect_storage_source($cfg);
    $out = [
        "ok" => true,
        "config" => [
            "MUSIC_DIR" => m_cfg_get($cfg, "MUSIC_DIR", "/mnt/user/music"),
            "MUSIC_SHARE" => m_cfg_get($cfg, "MUSIC_SHARE", "/mnt/user/music"),
            "MUSIC_DISKS" => m_cfg_get($cfg, "MUSIC_DISKS", "/mnt/disk1/music,/mnt/disk2/music"),
            "MUSIC_SMB" => m_cfg_get($cfg, "MUSIC_SMB", ""),
            "MUSIC_NFS" => m_cfg_get($cfg, "MUSIC_NFS", ""),
            "MUSIC_FNOS_URL" => m_cfg_get($cfg, "MUSIC_FNOS_URL", ""),
            "MUSIC_FNOS_USER" => m_cfg_get($cfg, "MUSIC_FNOS_USER", ""),
            "MUSIC_NAVIDROME_URL" => m_cfg_get($cfg, "MUSIC_NAVIDROME_URL", ""),
            "MUSIC_NAVIDROME_USER" => m_cfg_get($cfg, "MUSIC_NAVIDROME_USER", ""),
            "MUSIC_NAVIDROME_PASSWORD" => "",
            "MUSIC_CARD_MODE" => m_cfg_get($cfg, "MUSIC_CARD_MODE", "card"),
            "MUSIC_CHIP_MODE" => m_cfg_get($cfg, "MUSIC_CHIP_MODE", "chip"),
        ],
        "storage" => $auto,
    ];
    mjson($out);
}

if ($action === "storage_status") {
    $st = m_wake_source_path($cfg);
    mjson(["ok" => true, "detected" => $st["label"] ?? "等待播放自动检测", "status" => $st["label"] ?? "等待播放", "strategy" => $st["strategy"] ?? "invalid", "label" => $st["label"] ?? "", "path" => $st["path"] ?? ""]);
}

if ($action === "list") {
    $auto = m_detect_storage_source($cfg);
    $strat = (string)($auto["strategy"] ?? "");
    if ($strat !== "fnos" && $strat !== "navidrome") {
        $root = m_local_music_root($cfg);
        $files = $root !== "" ? m_local_scan_files($root, 6) : [];
        $tracks = [];
        foreach ($files as $path) {
            $tracks[] = m_track_normalize(["id" => $path, "path" => $path, "_root" => $root, "size" => @filesize($path)], "local", $path);
        }
        mjson(["ok" => true, "tracks" => $tracks, "count" => count($tracks), "source" => "local"]);
    }
}

if ($action === "library") {
    $auto = m_detect_storage_source($cfg);
    $strat = (string)($auto["strategy"] ?? "");
    $root = (string)($auto["info"]["path"] ?? "");
    $files = [];
    $source = "";
    if ($strat === "fnos" || $strat === "navidrome") {
        mjson([
            "ok" => true,
            "strategy" => $strat,
            "label" => $auto["label"] ?? "",
            "files" => [],
            "message" => "远端音源使用 library_remote action 拉取",
        ]);
    }
    if ($root === "") {
        mjson(["ok" => false, "strategy" => $strat, "label" => $auto["label"] ?? "", "error" => "无可用本地音乐目录"], 200);
    }
    $files = m_local_scan_files($root, 6);
    $source = $root;
    mjson([
        "ok" => true,
        "strategy" => $strat,
        "label" => $auto["label"] ?? "",
        "source" => $source,
        "count" => count($files),
        "files" => array_slice($files, 0, 5000),
    ]);
}

if ($action === "list" && (m_detect_storage_source($cfg)["strategy"] ?? "") === "fnos") $action = "library_remote";
if ($action === "list" && (m_detect_storage_source($cfg)["strategy"] ?? "") === "navidrome") $action = "library_remote";

if ($action === "library_remote") {
    $auto = m_detect_storage_source($cfg);
    $strat = (string)($auto["strategy"] ?? "");
    if ($strat === "fnos") {
        [$resp, $err] = m_fnos_response($cfg, "track/list", ["page" => 1, "pageSize" => 200], 20);
        if (!is_array($resp)) {
            mjson(["ok" => false, "error" => $err], 502);
        }
        $data = $resp["data"] ?? $resp;
        $items = is_array($data) ? ($data["list"] ?? $data["items"] ?? $data["tracks"] ?? []) : [];
        $tracks = [];
        foreach ($items as $item) {
            if (!is_array($item)) continue;
            $id = (string)($item["id"] ?? $item["path"] ?? $item["url"] ?? "");
            $path = (string)($item["path"] ?? $id);
            $tracks[] = m_track_normalize($item, "fnos", $id);
        }
        mjson(["ok" => true, "strategy" => "fnos", "items" => $tracks, "tracks" => $tracks, "count" => count($tracks)]);
    }
    if ($strat === "navidrome") {
        [$resp, $err] = m_navidrome_request($cfg, "rest/search3", ["query" => "", "songCount" => 500], "GET", "", 15);
        if (!is_array($resp)) {
            mjson(["ok" => false, "error" => $err], 502);
        }
        $data = $resp["subsonic-response"] ?? $resp;
        $search = $data["searchResult3"] ?? $data["searchResult"] ?? $data;
        $tracks = $search["song"] ?? [];
        if (!is_array($tracks)) $tracks = [];
        foreach ($tracks as &$item) {
            if (!is_array($item)) continue;
            $item = m_track_normalize($item, "navidrome");
        }
        unset($item);
        mjson(["ok" => true, "strategy" => "navidrome", "tracks" => $tracks, "items" => $tracks, "count" => count($tracks)]);
    }
    mjson(["ok" => false, "error" => "非远端音源策略"], 400);
}

if ($action === "stream") {
    $auto = m_detect_storage_source($cfg);
    $remoteId = (string)($_GET["id"] ?? $_GET["path"] ?? "");
    if (($auto["strategy"] ?? "") === "fnos") {
        [$resp, $err] = m_fnos_response($cfg, "track/stream", ["id" => $remoteId, "path" => $remoteId], 30);
        $url = is_array($resp) ? (string)(($resp["data"] ?? $resp)["url"] ?? "") : "";
        if ($url !== "") { header("Location: " . $url, true, 302); exit; }
        mjson(["ok" => false, "error" => $err ?: "飞牛音乐无法提供音频"], 502);
    }
    if (($auto["strategy"] ?? "") === "navidrome") {
        $url = rtrim((string)m_cfg_get($cfg, "MUSIC_NAVIDROME_URL", ""), "/") . "/rest/stream";
        $params = ["id" => $remoteId, "u" => m_cfg_get($cfg, "MUSIC_NAVIDROME_USER", ""), "c" => "theme-music", "v" => "1.16.1", "f" => "" ];
        $pwd = m_navidrome_password($cfg);
        if ($params["u"] !== "" && $pwd !== "") { $salt = bin2hex(random_bytes(6)); $params["s"] = $salt; $params["t"] = md5($pwd . $salt); }
        $sep = strpos($url, "?") === false ? "?" : "&";
        $streamUrl = $url . $sep . http_build_query($params);
        $range = isset($_SERVER["HTTP_RANGE"]) ? trim((string)$_SERVER["HTTP_RANGE"]) : "";
        $ch = curl_init($streamUrl);
        $sentHeaders = false;
        curl_setopt($ch, CURLOPT_HTTPHEADER, array_filter([
            "Accept: audio/*",
            $range !== "" ? "Range: " . $range : null,
            "User-Agent: ThemeMusic/1.3.0",
        ]));
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, false);
        curl_setopt($ch, CURLOPT_HEADER, false);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 8);
        curl_setopt($ch, CURLOPT_TIMEOUT, 0);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
        curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($curl, $line) use (&$sentHeaders) {
            $line = trim((string)$line);
            if ($line === "") return strlen($line) + 2;
            if (preg_match('/^HTTP\\/[^ ]+\\s+(\\d+)/i', $line, $m)) {
                $code = (int)$m[1];
                if ($code >= 200 && $code < 400) http_response_code($code);
                return strlen($line) + 2;
            }
            if (preg_match('/^(Content-Type|Content-Length|Content-Range|Accept-Ranges|Cache-Control|ETag):\\s*(.+)$/i', $line, $m)) {
                header($m[1] . ": " . $m[2]);
            }
            return strlen($line) + 2;
        });
        curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($curl, $chunk) use (&$sentHeaders) {
            $sentHeaders = true;
            echo $chunk;
            if (function_exists("fastcgi_finish_request")) @ob_flush();
            flush();
            return strlen($chunk);
        });
        $ok = curl_exec($ch);
        $errno = curl_errno($ch);
        $err = curl_error($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($ok === false || $errno !== 0 || $code >= 400 || $code < 200) {
            if (!$sentHeaders) mjson(["ok" => false, "error" => $err ?: ("Navidrome HTTP " . $code)], 502);
        }
        exit;
    }
    $strat = (string)($auto["strategy"] ?? "");
    $root = (string)($auto["info"]["path"] ?? "");
    $rel = isset($_GET["path"]) ? (string)$_GET["path"] : "";
    $rel = m_safe_path_under($root !== "" ? $root : "/", $rel);
    if ($rel === "" || !is_file($rel)) {
        mjson(["ok" => false, "error" => "文件不存在"], 404);
    }
    $size = filesize($rel);
    $ext = strtolower(pathinfo($rel, PATHINFO_EXTENSION));
    $mime = "application/octet-stream";
    $map = [
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        "ogg" => "audio/ogg",
        "opus" => "audio/ogg",
        "wav" => "audio/wav",
        "wma" => "audio/x-ms-wma",
    ];
    if (isset($map[$ext])) $mime = $map[$ext];
    header("Content-Type: " . $mime);
    header("Content-Length: " . (int)$size);
    header("Accept-Ranges: bytes");
    header("Cache-Control: public, max-age=600");
    $fp = fopen($rel, "rb");
    $start = 0;
    $end = (int)$size - 1;
    $code = 200;
    if (isset($_SERVER["HTTP_RANGE"]) && preg_match('/bytes=(\d*)-(\d*)/', (string)$_SERVER["HTTP_RANGE"], $m)) {
        $rs = $m[1] === "" ? null : (int)$m[1];
        $re = $m[2] === "" ? null : (int)$m[2];
        if ($rs !== null) $start = $rs;
        if ($re !== null) $end = $re;
        if ($start > $end) $start = $end;
        $code = 206;
        header("HTTP/1.1 206 Partial Content");
        header("Content-Range: bytes " . $start . "-" . $end . "/" . (int)$size);
        header("Content-Length: " . ((int)$end - (int)$start + 1));
    }
    $sent = 0;
    $len = (int)$end - (int)$start + 1;
    fseek($fp, (int)$start);
    while ($sent < $len && !feof($fp)) {
        $buf = fread($fp, 8192);
        if ($buf === false) break;
        $echoed = strlen($buf);
        if ($sent + $echoed > $len) {
            $buf = substr($buf, 0, $len - $sent);
            $echoed = strlen($buf);
        }
        echo $buf;
        flush();
        $sent += $echoed;
    }
    fclose($fp);
    exit;
}

if ($action === "lyrics") {
    $auto = m_detect_storage_source($cfg);
    $remoteId = (string)($_GET["id"] ?? $_GET["path"] ?? "");
    if (($auto["strategy"] ?? "") === "navidrome") {
        [$resp, $err] = m_navidrome_request($cfg, "rest/getLyrics", ["id" => $remoteId], "GET", "", 15);
        $data = is_array($resp) ? ($resp["subsonic-response"] ?? $resp) : [];
        $lyrics = (string)(($data["lyrics"]["value"] ?? $data["lyrics"] ?? ""));
        mjson(["ok" => true, "strategy" => "navidrome", "source" => "remote", "lyrics" => $lyrics]);
    }
    if (($auto["strategy"] ?? "") === "fnos") {
        [$resp, $err] = m_fnos_response($cfg, "track/lyric", ["id" => $remoteId, "path" => $remoteId], 12);
        $data = is_array($resp) ? ($resp["data"] ?? $resp) : [];
        $lyrics = is_array($data) ? (string)($data["lyric"] ?? $data["lrc"] ?? $data["lyrics"] ?? "") : "";
        mjson(["ok" => true, "strategy" => "fnos", "source" => "remote", "lyrics" => $lyrics]);
    }
    $strat = (string)($auto["strategy"] ?? "");
    $rel = isset($_GET["path"]) ? (string)$_GET["path"] : "";
    $root = m_local_music_root($cfg);
    $rel = m_safe_path_under($root !== "" ? $root : "/", $rel);
    $basename = $rel !== "" ? pathinfo($rel, PATHINFO_FILENAME) : "";
    $lyrics = "";
    $source = "";
    if ($strat === "fnos" && $rel !== "") {
        [$resp, $err] = m_fnos_response($cfg, "track/lyric", ["path" => $rel], 12);
        if (is_array($resp)) {
            $data = $resp["data"] ?? $resp;
            $lyrics = (string)($data["lyric"] ?? $data["lrc"] ?? $data["lyrics"] ?? "");
            $source = "fnos";
        }
    }
    if ($lyrics === "" && $rel !== "") {
        $candidates = [];
        if ($basename !== "") {
            $candidates[] = $root . "/" . $basename . ".lrc";
            $candidates[] = $root . "/" . $basename . ".txt";
        }
        foreach ($candidates as $c) {
            if (is_file($c) && is_readable($c)) {
                $lyrics = (string)@file_get_contents($c);
                if ($lyrics !== "") { $source = "local"; break; }
            }
        }
    }
    mjson([
        "ok" => true,
        "strategy" => $strat,
        "source" => $source,
        "lyrics" => $lyrics,
    ]);
}

if ($action === "cover") {
    $auto = m_detect_storage_source($cfg);
    $remoteId = (string)($_GET["id"] ?? $_GET["path"] ?? "");
    if (($auto["strategy"] ?? "") === "navidrome") {
        $url = rtrim((string)m_cfg_get($cfg, "MUSIC_NAVIDROME_URL", ""), "/") . "/rest/getCoverArt";
        $params = ["id" => $remoteId, "u" => m_cfg_get($cfg, "MUSIC_NAVIDROME_USER", ""), "c" => "theme-music", "v" => "1.16.1", "f" => "" ];
        $pwd = m_navidrome_password($cfg);
        if ($params["u"] !== "" && $pwd !== "") { $salt = bin2hex(random_bytes(6)); $params["s"] = $salt; $params["t"] = md5($pwd . $salt); }
        $coverUrl = $url . "?" . http_build_query($params);
        if (isset($_GET["fetch"]) && (string)$_GET["fetch"] === "2") {
            $ch = curl_init($coverUrl);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
            curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
            curl_setopt($ch, CURLOPT_TIMEOUT, 15);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
            curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
            $bin = curl_exec($ch);
            $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $ct = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
            curl_close($ch);
            if (is_string($bin) && $bin !== "" && $code >= 200 && $code < 300) {
                header("Content-Type: " . (strpos($ct, "image/") === 0 ? $ct : "image/jpeg"));
                header("Cache-Control: private, max-age=300");
                echo $bin;
                exit;
            }
        }
        mjson(["ok" => true, "url" => $coverUrl, "source" => "remote"]);
    }
    if (($auto["strategy"] ?? "") === "fnos") {
        [$resp, $err] = m_fnos_response($cfg, "track/cover", ["id" => $remoteId, "path" => $remoteId], 12);
        $data = is_array($resp) ? ($resp["data"] ?? $resp) : [];
        $url = is_array($data) ? (string)($data["url"] ?? $data["cover"] ?? $data["coverUrl"] ?? "") : "";
        $b64 = is_array($data) ? (string)($data["base64"] ?? $data["b64"] ?? "") : "";
        if ($b64 !== "" && isset($_GET["fetch"]) && (string)$_GET["fetch"] === "2") {
            $bin = base64_decode(preg_replace('/^data:image\\/[^;]+;base64,/', '', $b64), true);
            if ($bin !== false && $bin !== "") {
                header("Content-Type: image/jpeg");
                header("Cache-Control: private, max-age=300");
                echo $bin;
                exit;
            }
        }
        if ($url !== "" && isset($_GET["fetch"]) && (string)$_GET["fetch"] === "2") {
            $ch = curl_init($url);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
            curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
            curl_setopt($ch, CURLOPT_TIMEOUT, 12);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
            curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
            $bin = curl_exec($ch);
            $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $ct = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
            curl_close($ch);
            if (is_string($bin) && $bin !== "" && $code >= 200 && $code < 300) {
                header("Content-Type: " . (strpos($ct, "image/") === 0 ? $ct : "image/jpeg"));
                header("Cache-Control: private, max-age=300");
                echo $bin;
                exit;
            }
        }
        if ($url !== "") mjson(["ok" => true, "url" => $url, "source" => "remote"]);
    }
    $strat = (string)($auto["strategy"] ?? "");
    $rel = isset($_GET["path"]) ? (string)$_GET["path"] : "";
    $root = m_local_music_root($cfg);
    $rel = m_safe_path_under($root !== "" ? $root : "/", $rel);
    $basename = $rel !== "" ? pathinfo($rel, PATHINFO_FILENAME) : "";
    if ($strat === "fnos" && $rel !== "") {
        [$resp, $err] = m_fnos_response($cfg, "track/cover", ["path" => $rel], 12);
        if (is_array($resp)) {
            $data = $resp["data"] ?? $resp;
            $url = (string)($data["url"] ?? $data["cover"] ?? "");
            $b64 = (string)($data["base64"] ?? $data["b64"] ?? "");
            if ($b64 !== "") {
                $bin = base64_decode($b64, true);
                if ($bin !== false) {
                    header("Content-Type: image/jpeg");
                    echo $bin;
                    exit;
                }
            }
            if ($url !== "") {
                $ch = curl_init();
                curl_setopt($ch, CURLOPT_URL, $url);
                curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
                curl_setopt($ch, CURLOPT_TIMEOUT, 12);
                $bin = curl_exec($ch);
                curl_close($ch);
                if (is_string($bin) && $bin !== "") {
                    header("Content-Type: image/jpeg");
                    echo $bin;
                    exit;
                }
            }
        }
    }
    if ($rel === "") {
        m_emit_cover_empty();
    }
    $candidates = [];
    if ($basename !== "") {
        $trackDir = dirname($rel);
        foreach (["jpg", "jpeg", "png", "webp"] as $artExt) {
            $candidates[] = rtrim($trackDir, "/") . "/" . $basename . "." . $artExt;
            $candidates[] = $root . "/" . $basename . "." . $artExt;
        }
    }
    /* Album artwork is commonly stored beside the track rather than beside
     * the full library root. Prefer same-name art, then walk up to the track
     * directory and check standard album-art filenames. */
    if ($rel !== "") {
        $dir = dirname($rel);
        $artNames = ["cover.jpg", "cover.jpeg", "cover.png", "cover.webp", "folder.jpg", "folder.jpeg", "folder.png", "album.jpg", "album.jpeg", "album.png", "front.jpg", "front.jpeg", "front.png"];
        foreach ($artNames as $name) {
            $candidates[] = rtrim($dir, "/") . "/" . $name;
        }
        $parent = dirname($dir);
        if ($parent !== $dir && $parent !== ".") {
            foreach ($artNames as $name) $candidates[] = rtrim($parent, "/") . "/" . $name;
        }
    }
    foreach ($candidates as $c) {
        if (is_file($c) && is_readable($c)) {
            $size = filesize($c);
            $ext = strtolower(pathinfo($c, PATHINFO_EXTENSION));
            $mime = $ext === "png" ? "image/png" : ($ext === "webp" ? "image/webp" : "image/jpeg");
            header("Content-Type: " . $mime);
            header("Content-Length: " . (int)$size);
            header("Cache-Control: public, max-age=3600");
            readfile($c);
            exit;
        }
    }
    m_emit_json_file("/usr/local/emhttp/plugins/theme.music/assets/img/cover_empty.json");
    exit;
}

if ($action === "navidrome_test") {
    $testCfg = $cfg;
    $urlInput = rtrim(trim((string)($_POST["url"] ?? "")), "/");
    $userInput = trim(str_replace(["\0", "\r", "\n"], "", (string)($_POST["user"] ?? "")));
    $passwordInput = substr(str_replace(["\0", "\r", "\n"], "", (string)($_POST["password"] ?? "")), 0, 256);
    if ($urlInput === "") {
        mjson(["ok" => false, "error" => "Navidrome 地址无效"], 400);
    }
    if (!preg_match('#^https?://#i', $urlInput) || !is_array(@parse_url($urlInput)) || empty(parse_url($urlInput)["host"])) {
        mjson(["ok" => false, "error" => "Navidrome 地址无效"], 400);
    }
    $testCfg["MUSIC_NAVIDROME_URL"] = substr($urlInput, 0, 512);
    if ($userInput !== "") $testCfg["MUSIC_NAVIDROME_USER"] = substr($userInput, 0, 128);
    if ($passwordInput !== "") $testCfg["MUSIC_NAVIDROME_PASSWORD"] = $passwordInput;
    [$resp, $err] = m_navidrome_request($testCfg, "rest/ping", [], "GET", "", 12);
    if (!is_array($resp)) {
        mjson(["ok" => false, "error" => $err !== "" ? $err : "Navidrome 连接失败"], 400);
    }
    mjson([
        "ok" => true,
        "server_type" => "navidrome",
        "library_access" => true,
    ]);
}

if ($action === "fnos_test") {
    $testCfg = $cfg;
    $urlInput = rtrim(trim((string)($_POST["url"] ?? "")), "/");
    $userInput = trim(str_replace(["\0", "\r", "\n"], "", (string)($_POST["user"] ?? "")));
    $passwordInput = substr(str_replace(["\0", "\r", "\n"], "", (string)($_POST["password"] ?? "")), 0, 256);
    if ($urlInput === "") {
        mjson(["ok" => false, "error" => "飞牛音乐地址无效"], 400);
    }
    if (!preg_match('#^https?://#i', $urlInput) || !is_array(@parse_url($urlInput)) || empty(parse_url($urlInput)["host"])) {
        mjson(["ok" => false, "error" => "飞牛音乐地址无效"], 400);
    }
    $testCfg["MUSIC_FNOS_URL"] = substr($urlInput, 0, 512);
    if ($userInput !== "") $testCfg["MUSIC_FNOS_USER"] = substr($userInput, 0, 128);
    if ($passwordInput !== "") $testCfg["MUSIC_FNOS_PASSWORD"] = $passwordInput;
    [$resp, $err] = m_fnos_response($testCfg, "track/list", ["page" => 1, "pageSize" => 1], 12);
    if (!is_array($resp)) {
        mjson(["ok" => false, "error" => $err !== "" ? $err : "飞牛音乐连接失败"], 400);
    }
    $data = $resp["data"] ?? $resp;
    $items = is_array($data) ? ($data["list"] ?? $data["items"] ?? $data["tracks"] ?? []) : [];
    $libraryAccess = is_array($items);
    mjson([
        "ok" => true,
        "server_type" => "fnos",
        "library_access" => $libraryAccess,
    ]);
}

if ($action === "set_service") {
    $service = strtolower(trim((string)($_POST["service"] ?? $_REQUEST["service"] ?? "disabled")));
    $service = in_array($service, ["enabled", "enable", "1", "yes"], true) ? "enabled" : "disabled";
    $serviceFile = "/boot/config/plugins/theme.music/theme.music.cfg";
    $old = is_file($serviceFile) ? (string)@file_get_contents($serviceFile) : "";
    $old = preg_replace('/^SERVICE=.*$(\r?\n)?/m', '', $old);
    @mkdir(dirname($serviceFile), 0755, true);
    $ok = @file_put_contents($serviceFile, 'SERVICE="' . $service . "\"\n" . ltrim((string)$old), LOCK_EX) !== false;
    mjson($ok ? ["ok" => true, "service" => $service] : ["ok" => false, "error" => "无法保存服务状态"], $ok ? 200 : 500);
}

if ($action === "check_update") {
    $indexPath = "/boot/config/plugins/theme.music/versions/index.json";
    if (!is_file($indexPath)) $indexPath = dirname(__FILE__) . "/versions/index.json";
    $j = is_file($indexPath) ? json_decode((string)@file_get_contents($indexPath), true) : [];
    $current = m_installed_version();
    if ($current === "") $current = trim((string)m_cfg_get($cfg, "VERSION", ""));
    $latest = is_array($j) ? (string)($j["latest_version"] ?? "") : "";
    if ($current === "") $current = $latest;
    $update = $current !== "" && $latest !== ""
        && m_version_parts($current) !== null
        && m_version_parts($latest) !== null
        && m_version_compare($latest, $current) > 0;
    mjson(["ok" => true, "current" => $current, "latest" => $latest, "update_available" => $update, "note" => $update ? "有可用更新" : "已是最新版本"]);
}

if ($action === "changelog") {
    $path = dirname(__FILE__) . "/CHANGELOG.md";
    $text = is_file($path) ? (string)@file_get_contents($path) : "";
    mjson(["ok" => true, "text" => $text]);
}

if ($action === "dash_pos") {
    // Cross-browser / reboot-safe dashboard card placement (localStorage alone is per-browser).
    $file = "/boot/config/plugins/theme.music/dash_pos.json";
    $method = $method;
    if ($method === "GET") {
        if (!is_file($file)) mjson(["ok" => true, "pos" => null]);
        $raw = (string)@file_get_contents($file);
        $j = json_decode($raw, true);
        if (!is_array($j)) mjson(["ok" => true, "pos" => null]);
        mjson(["ok" => true, "pos" => $j]);
    }
    $raw = (string)file_get_contents("php://input");
    $j = json_decode($raw, true);
    if (!is_array($j)) mjson(["ok" => false, "error" => "无效请求体"], 400);
    $pos = $j["pos"] ?? null;
    if (!is_array($pos)) mjson(["ok" => false, "error" => "pos 缺失"], 400);
    @file_put_contents($file, json_encode($pos, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    mjson(["ok" => true]);
}

if ($action === "runtime") {
    $file = "/boot/config/plugins/theme.music/runtime.json";
    $method = $method;
    if ($method === "GET") {
        if (!is_file($file)) mjson(["ok" => true, "state" => null]);
        $raw = (string)@file_get_contents($file);
        $j = json_decode($raw, true);
        if (!is_array($j)) mjson(["ok" => true, "state" => null]);
        mjson(["ok" => true, "state" => $j]);
    }
    $raw = (string)file_get_contents("php://input");
    $j = json_decode($raw, true);
    if (!is_array($j)) mjson(["ok" => false, "error" => "无效请求体"], 400);
    @file_put_contents($file, json_encode($j, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    mjson(["ok" => true]);
}

if ($action === "save_cfg") {
    $raw = (string)file_get_contents("php://input");
    $j = json_decode($raw, true);
    if (!is_array($j)) mjson(["ok" => false, "error" => "无效请求体"], 400);
    $lines = [];
    foreach ($j as $k => $v) {
        $k = (string)$k;
        $v = (string)$v;
        if (!preg_match('/^[A-Z0-9_]{1,64}$/', $k)) continue;
        $v = str_replace(["\r", "\n"], ["\\r", "\\n"], $v);
        $lines[] = $k . "=\"" . $v . "\"";
    }
    @file_put_contents($persist, implode("\n", $lines) . "\n");
    mjson(["ok" => true]);
}

if ($action === "clear_cache") {
    $what = isset($_REQUEST["what"]) ? (string)$_REQUEST["what"] : "all";
    $root = m_local_music_root($cfg);
    $removed = 0;
    $bytes = 0;
    $errParts = [];
    $lyrics = ["removed" => 0, "bytes" => 0];
    $cover = ["removed" => 0, "bytes" => 0];
    $candidates = [
        "/boot/config/plugins/theme.music/cache",
        "/tmp/theme.music.cache",
    ];
    foreach ($candidates as $dir) {
        if (!is_dir($dir)) continue;
        $it = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::LEAVES_ONLY
        );
        foreach ($it as $info) {
            $f = (string)$info->getPathname();
            $ext = strtolower($info->getExtension());
            $ok = false;
            if ($what === "lyrics" && $ext === "lrc") $ok = true;
            else if ($what === "cover" && in_array($ext, ["jpg","jpeg","png","webp"])) $ok = true;
            else if ($what === "all" || $what === "legacy") $ok = in_array($ext, ["lrc","jpg","jpeg","png","webp"]);
            if (!$ok) continue;
            $sz = (int)$info->getSize();
            if (@unlink($f)) {
                $removed++;
                $bytes += $sz;
                if ($ext === "lrc") $lyrics["removed"]++;
                else $cover["removed"]++;
                if ($ext === "lrc") $lyrics["bytes"] += $sz;
                else $cover["bytes"] += $sz;
            } else {
                $errParts[] = $f;
            }
        }
    }
    mjson([
        "ok" => true,
        "what" => $what,
        "removed" => $removed,
        "bytes" => $bytes,
        "lyrics" => $lyrics,
        "cover" => $cover,
        "errors" => $errParts,
    ]);
}

mjson(["ok" => false, "error" => "unknown action"], 400);
