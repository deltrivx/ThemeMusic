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

$action = isset($_REQUEST["action"]) ? strtolower(trim((string)$_REQUEST["action"])) : "";
$method = isset($_SERVER["REQUEST_METHOD"]) ? strtoupper((string)$_SERVER["REQUEST_METHOD"]) : "GET";
if ($action === "" && $method === "POST") {
    $raw = (string)file_get_contents("php://input");
    if ($raw !== "") {
        $j = json_decode($raw, true);
        if (is_array($j) && isset($j["action"])) $action = strtolower(trim((string)$j["action"]));
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
    if ($user === "" || $password === "" || !function_exists("curl_init")) return "";
    $url = rtrim($base, "/") . "/user/password-login";
    $payload = json_encode([
        "username" => $user,
        "password" => hash("sha256", $password),
        "deviceId" => "theme-music",
    ], JSON_UNESCAPED_SLASHES);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_HTTPHEADER => [
            "Accept: application/json",
            "Content-Type: application/json",
            "authx: " . m_fnos_authx("POST", m_fnos_auth_path($url), $payload, ""),
            "User-Agent: ThemeMusic/1.3.0",
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => max(5, (int)$timeout),
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
    ]);
    $raw = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $headerSize = (int)curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($raw === false || $err !== "" || $code < 200 || $code >= 400) return "";
    $raw = (string)$raw;
    $headers = substr($raw, 0, $headerSize);
    $body = substr($raw, $headerSize);
    $j = json_decode($body, true);
    $token = is_array($j) ? (string)($j["userToken"] ?? $j["token"] ?? $j["accessToken"] ?? $j["data"]["userToken"] ?? $j["data"]["token"] ?? $j["data"]["accessToken"] ?? "") : "";
    if ($token === "" && preg_match('/(?:^|\r?\n)Set-Cookie:\s*music-token=([^;\r\n]+)/i', $headers, $m)) $token = trim($m[1]);
    return $token;
}

function m_fnos_token_cache_file() {
    return sys_get_temp_dir() . "/theme-music-fnos-token.json";
}

function m_fnos_cached_token($base, $user, $password, $timeout = 12, $force = false) {
    if ($base === "" || $user === "" || $password === "") return "";
    $file = m_fnos_token_cache_file();
    $key = hash("sha256", rtrim($base, "/") . "\n" . $user . "\n" . hash("sha256", $password));
    if (!$force && is_file($file) && is_readable($file)) {
        $row = @json_decode((string)@file_get_contents($file), true);
        if (is_array($row) && ($row["key"] ?? "") === $key && !empty($row["token"]) && (int)($row["expires"] ?? 0) > time()) return (string)$row["token"];
    }
    $token = m_fnos_login($base, $user, $password, $timeout);
    if ($token !== "") {
        @file_put_contents($file, json_encode(["key" => $key, "token" => $token, "expires" => time() + 300]), LOCK_EX);
        @chmod($file, 0600);
    }
    return $token;
}

function m_fnos_invalidate_token($base, $user, $password) {
    $file = m_fnos_token_cache_file();
    if (!is_file($file)) return;
    $row = @json_decode((string)@file_get_contents($file), true);
    $key = hash("sha256", rtrim($base, "/") . "\n" . $user . "\n" . hash("sha256", $password));
    if (is_array($row) && ($row["key"] ?? "") === $key) @unlink($file);
}

function m_fnos_request_once($url, $method, $body, $headers, $timeout) {
    $ch = curl_init();
    curl_setopt_array($ch, [CURLOPT_URL => $url, CURLOPT_CUSTOMREQUEST => strtoupper($method), CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => max(5, (int)$timeout), CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => 0, CURLOPT_HTTPHEADER => $headers]);
    if (strtoupper($method) !== "GET" && $body !== "") curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $resp = curl_exec($ch);
    $errno = curl_errno($ch);
    $err = $errno ? curl_error($ch) : "";
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$resp, $code, $errno, $err];
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
    $token = ($user !== "" && $pwd !== "") ? m_fnos_cached_token($url, $user, $pwd, $timeout) : "";
    if ($user !== "" && $pwd !== "" && $token === "") return [null, "飞牛音乐认证失败"];
    if ($token !== "") $headers[] = "Cookie: music-token=" . $token;
    [$resp, $code, $errno, $errStr] = m_fnos_request_once($fullUrl, $method, $body, $headers, $timeout);
    if ((int)$code === 401 && $user !== "" && $pwd !== "") {
        m_fnos_invalidate_token($url, $user, $pwd);
        $headers = array_values(array_filter($headers, function ($h) { return stripos($h, "Cookie: music-token=") !== 0; }));
        $fresh = m_fnos_cached_token($url, $user, $pwd, $timeout, true);
        if ($fresh === "") return [null, "飞牛音乐认证失败（HTTP 401）"];
        $headers[] = "Cookie: music-token=" . $fresh;
        [$resp, $code, $errno, $errStr] = m_fnos_request_once($fullUrl, $method, $body, $headers, $timeout);
    }
    if ($errno !== 0 || $resp === false) return [null, "网络错误：" . ($errStr ?: ("errno=" . $errno))];
    if ((int)$code >= 400) return [null, "HTTP " . (int)$code];
    $j = json_decode((string)$resp, true);
    if (!is_array($j)) return [null, "响应非 JSON"]; 
    return [$j, ""];
}

function m_fnos_response(array $cfg, $pathQ, $params = [], $timeout = 15) {
    return m_fnos_request($cfg, $pathQ, $params, "GET", "", $timeout);
}

function m_fnos_base_url(array $cfg) {
    $url = rtrim(trim((string)m_cfg_get($cfg, "MUSIC_FNOS_URL", "")), "/");
    if ($url === "") return "";
    $url = preg_replace('#(/api/v[0-9]+).*$#i', '$1', $url);
    if (!preg_match('#/api/v[0-9]+$#i', $url)) {
        $url .= preg_match('#/music$#i', $url) ? "/api/v1" : "/music/api/v1";
    }
    return rtrim($url, "/");
}

function m_fnos_api_url(array $cfg, $pathQ, array $params = []) {
    $url = m_fnos_base_url($cfg);
    if ($url === "") return "";
    if ($params) {
        ksort($params);
        $url .= "/" . ltrim((string)$pathQ, "/") . "?" . http_build_query($params, "", "&", PHP_QUERY_RFC3986);
    } else {
        $url .= "/" . ltrim((string)$pathQ, "/");
    }
    return $url;
}

function m_fnos_auth_path($url) {
    $path = (string)parse_url((string)$url, PHP_URL_PATH);
    if (preg_match('#/api/v[0-9]+/(.+)$#i', $path, $m)) return "/" . ltrim($m[1], "/");
    return "/" . ltrim($path, "/");
}

function m_fnos_fetch_binary(array $cfg, $url, $accept = "image/*,*/*;q=0.2", $timeout = 12) {
    $url = (string)$url;
    if ($url === "") return ["", "", 0];
    $apiBase = m_fnos_base_url($cfg);
    $user = trim((string)m_cfg_get($cfg, "MUSIC_FNOS_USER", ""));
    $pwd = m_fnos_password($cfg);
    $token = ($user !== "" && $pwd !== "") ? m_fnos_cached_token($apiBase, $user, $pwd, $timeout) : "";
    if ($user !== "" && $pwd !== "" && $token === "") return ["", "", 401];
    $query = (string)parse_url($url, PHP_URL_QUERY);
    $path = m_fnos_auth_path($url);
    $headers = ["Accept: " . $accept, "User-Agent: ThemeMusic/1.3.0", "authx: " . m_fnos_authx("GET", $path, "", $query)];
    if ($token !== "") $headers[] = "Cookie: music-token=" . $token;
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
    curl_setopt($ch, CURLOPT_TIMEOUT, (int)$timeout);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
    $bin = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $ct = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);
    if ($code === 401 && $user !== "" && $pwd !== "") {
        m_fnos_invalidate_token($apiBase, $user, $pwd);
        $fresh = m_fnos_cached_token($apiBase, $user, $pwd, $timeout, true);
        if ($fresh !== "") {
            $headers = array_values(array_filter($headers, function ($h) {
                return stripos($h, "Cookie: music-token=") !== 0;
            }));
            $headers[] = "Cookie: music-token=" . $fresh;
            $ch = curl_init($url);
            curl_setopt_array($ch, [CURLOPT_HTTPHEADER => $headers, CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => max(5, (int)$timeout), CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => 0]);
            $bin = curl_exec($ch);
            $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $ct = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
            curl_close($ch);
        }
    }
    return [is_string($bin) ? $bin : "", $ct, $code];
}

function m_fnos_media_proxy(array $cfg, $pathQ, array $params, $timeout = 0, $retry = 0) {
    $isAbsolute = preg_match('#^https?://#i', (string)$pathQ);
    $url = $isAbsolute ? (string)$pathQ : m_fnos_api_url($cfg, $pathQ, $params);
    if ($url === "") mjson(["ok" => false, "error" => "未配置飞牛音乐地址"], 502);
    $requestMethod = "GET";
    $requestBody = "";
    $user = trim((string)m_cfg_get($cfg, "MUSIC_FNOS_USER", ""));
    $pwd = m_fnos_password($cfg);
    $apiBase = m_fnos_base_url($cfg);
    $token = ($user !== "" && $pwd !== "") ? m_fnos_cached_token($apiBase, $user, $pwd, 15) : "";
    if ($user !== "" && $pwd !== "" && $token === "") mjson(["ok" => false, "error" => "飞牛音乐认证失败"], 502);
    $query = (string)parse_url($url, PHP_URL_QUERY);
    $path = m_fnos_auth_path($url);
    $headers = [
        "Accept: audio/*,application/json;q=0.5,*/*;q=0.1",
        "User-Agent: ThemeMusic/1.3.0",
        "authx: " . m_fnos_authx($requestMethod, $path, $requestBody, $query),
    ];
    if ($token !== "") $headers[] = "Cookie: music-token=" . $token;
    $range = isset($_SERVER["HTTP_RANGE"]) ? trim((string)$_SERVER["HTTP_RANGE"]) : "";
    if ($range !== "") $headers[] = "Range: " . $range;
    $sent = false;
    $contentType = "";
    $body = "";
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, false);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 8);
    curl_setopt($ch, CURLOPT_TIMEOUT, (int)$timeout);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
    curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($curl, $line) use (&$contentType) {
        $rawLine = (string)$line;
        $line = trim($rawLine);
        if (preg_match('/^HTTP\\/[^ ]+\\s+(\\d+)/i', $line, $m)) {
            $code = (int)$m[1];
            if ($code >= 200 && $code < 400) http_response_code($code);
        } elseif (preg_match('/^Content-Type:\\s*(.+)$/i', $line, $m)) {
            $contentType = trim((string)$m[1]);
            if (stripos($contentType, "json") === false && stripos($contentType, "text/") !== 0) {
                header("Content-Type: " . $contentType);
            }
        } elseif (preg_match('/^(Content-Length|Content-Range|Accept-Ranges|Cache-Control|ETag):\\s*(.+)$/i', $line, $m)) {
            header($m[1] . ": " . $m[2]);
        }
        return strlen($rawLine);
    });
    curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($curl, $chunk) use (&$sent, &$body, &$contentType) {
        $sent = true;
        if (stripos($contentType, "json") !== false || stripos($contentType, "text/") === 0) {
            $body .= $chunk;
        } else {
            echo $chunk;
            flush();
        }
        return strlen($chunk);
    });
    $ok = curl_exec($ch);
    $errno = curl_errno($ch);
    $err = curl_error($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $ct = $contentType !== "" ? $contentType : (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    $bodyIsJson = $body !== "" && stripos($ct, "json") !== false;
    curl_close($ch);
    if ($code === 401 && $retry < 1 && $user !== "" && $pwd !== "") {
        m_fnos_invalidate_token($apiBase, $user, $pwd);
        return m_fnos_media_proxy($cfg, $pathQ, $params, $timeout, $retry + 1);
    }
    if ($bodyIsJson) {
        $json = json_decode($body, true);
        $mediaRoot = is_array($json) ? ($json["data"] ?? $json) : [];
        $mediaUrl = is_array($mediaRoot) ? (string)($mediaRoot["url"] ?? $mediaRoot["streamUrl"] ?? $mediaRoot["audioUrl"] ?? "") : "";
        if ($mediaUrl !== "") {
            if (!preg_match('#^https?://#i', $mediaUrl)) {
                $base = m_fnos_base_url($cfg);
                $mediaUrl = $base . "/" . ltrim($mediaUrl, "/");
            }
            m_fnos_media_proxy($cfg, $mediaUrl, [], $timeout);
        }
        mjson(["ok" => false, "error" => "飞牛音乐未返回可播放音频"], 502);
    }
    if ($ok === false || $errno !== 0 || $code < 200 || $code >= 400 || !$sent) {
        mjson(["ok" => false, "error" => $err ?: ("飞牛音乐音频 HTTP " . $code)], 502);
    }
    if (stripos($ct, "audio/") === false && stripos($ct, "application/octet-stream") === false) {
        mjson(["ok" => false, "error" => "飞牛音乐返回的不是音频"], 502);
    }
    exit;
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
    if (($strat["strategy"] ?? "") !== "fnos" && !empty($strat["info"]["path"])) {
        return (string)$strat["info"]["path"];
    }
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

function m_track_duration_seconds(array $item) {
    $keys = ["duration", "durationSeconds", "duration_seconds", "durationMs", "duration_ms", "length", "lengthMs", "playtime", "playTime"];
    foreach ($keys as $key) {
        if (!array_key_exists($key, $item) || !is_numeric($item[$key])) continue;
        $value = (float)$item[$key];
        if ($value <= 0) continue;
        if (stripos($key, "ms") !== false || $value > 100000) $value /= 1000;
        if ($value > 0 && $value < 86400) return round($value, 3);
    }
    return 0;
}

function m_track_first_text(array $item, array $keys) {
    foreach ($keys as $key) {
        if (!array_key_exists($key, $item)) continue;
        $value = $item[$key];
        if (is_array($value)) continue;
        $value = m_track_text($value);
        if ($value !== "") return $value;
    }
    return "";
}

function m_track_normalize(array $item, $source, $fallbackId = "") {
    $source = strtolower(trim((string)$source));
    $audioSpec = is_array($item["audioSpec"] ?? null) ? $item["audioSpec"] : [];
    $idKeys = $source === "fnos"
        ? ["guid", "id", "trackId", "path", "url"]
        : ["id", "guid", "trackId", "path", "url"];
    $id = m_track_first_text($item, $idKeys);
    if ($id === "") $id = m_track_first_text($audioSpec, ["id", "guid", "path"]);
    if ($id === "") $id = m_track_text($fallbackId);
    $path = m_track_first_text($item, ["path", "filePath", "url"]);
    if ($path === "") $path = m_track_first_text($audioSpec, ["path", "filePath"]);
    if ($path === "") $path = $id;
    $title = m_track_first_text($item, ["title", "name", "trackName", "songName"]);
    $artist = m_track_first_text($item, ["artist", "artistName", "singer", "author"]);
    if ($artist === "" && is_array($item["artists"] ?? null)) {
        $names = [];
        foreach ($item["artists"] as $artistItem) {
            if (is_array($artistItem)) $name = m_track_first_text($artistItem, ["name", "title", "artist"]);
            else $name = m_track_text($artistItem);
            if ($name !== "") $names[] = $name;
        }
        $artist = implode(" / ", $names);
    }
    $album = m_track_first_text($item, ["album", "albumName", "collectionName"]);
    if (strcasecmp($album, "Array") === 0) $album = "";
    if ($album === "" && is_array($item["album"] ?? null)) $album = m_track_first_text($item["album"], ["name", "title"]);
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
    if (is_array($cover)) $cover = m_track_first_text($cover, ["url", "path", "coverUrl", "imageUrl", "id"]);
    if ($cover === "") {
        foreach (["metadata", "meta", "album"] as $coverNest) {
            $nestedCover = is_array($item[$coverNest] ?? null) ? ($item[$coverNest]["coverArt"] ?? $item[$coverNest]["coverUrl"] ?? $item[$coverNest]["cover"] ?? $item[$coverNest]["artwork"] ?? "") : "";
            if (is_array($nestedCover)) $nestedCover = m_track_first_text($nestedCover, ["url", "path", "coverUrl", "imageUrl", "id"]);
            if ($nestedCover !== "") { $cover = $nestedCover; break; }
        }
    }
    $durationItem = $item;
    foreach (["audioSpec", "meta", "metadata"] as $nested) {
        if (is_array($item[$nested] ?? null)) $durationItem = array_merge($durationItem, $item[$nested]);
    }
    $duration = m_track_duration_seconds($durationItem);
    $out = $item;
    unset($out["_root"]);
    $out["id"] = $id;
    $out["path"] = $path;
    $out["source"] = $source;
    $out["title"] = $title;
    $out["artist"] = $artist;
    $out["album"] = $album;
    $out["ext"] = $ext;
    $out["duration"] = $duration;
    if ($cover !== "") $out["coverArt"] = $cover;
    $out["has_cover"] = !empty($item["has_cover"]) || !empty($item["hasCover"]) || $cover !== "";
    return $out;
}


if ($action === "config") {
    $auto = m_detect_storage_source($cfg);
    $selected = strtolower(trim((string)m_cfg_get($cfg, "MUSIC_SOURCE", "local")));
    $sourceReady = false;
    $sourceReason = "音源未配置";
    if ($selected === "local") {
        $sourceReady = ($auto["strategy"] ?? "") !== "invalid";
        $sourceReason = $sourceReady ? "" : "本地音乐目录不可访问";
    } elseif ($selected === "navidrome") {
        $hasUrl = trim((string)m_cfg_get($cfg, "MUSIC_NAVIDROME_URL", "")) !== "";
        $hasUser = trim((string)m_cfg_get($cfg, "MUSIC_NAVIDROME_USER", "")) !== "";
        $hasPassword = m_navidrome_password($cfg) !== "";
        $sourceReady = $hasUrl && $hasUser && $hasPassword;
        if (!$hasUrl) $sourceReason = "未配置 Navidrome 地址";
        elseif (!$hasUser || !$hasPassword) $sourceReason = "Navidrome 用户名或密码未配置";
        else $sourceReason = "";
    } elseif ($selected === "fnos") {
        $hasUrl = trim((string)m_cfg_get($cfg, "MUSIC_FNOS_URL", "")) !== "";
        $hasUser = trim((string)m_cfg_get($cfg, "MUSIC_FNOS_USER", "")) !== "";
        $hasPassword = m_fnos_password($cfg) !== "";
        $sourceReady = $hasUrl && $hasUser && $hasPassword;
        if (!$hasUrl) $sourceReason = "未配置飞牛音乐地址";
        elseif (!$hasUser || !$hasPassword) $sourceReason = "飞牛音乐用户名或密码未配置";
        else $sourceReason = "";
    }
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
        "source" => $selected,
        "source_configured" => $sourceReady,
        "source_reason" => $sourceReason,
    ];
    mjson($out);
}

if ($action === "storage_status") {
    $st = m_wake_source_path($cfg);
    mjson(["ok" => true, "detected" => $st["label"] ?? "等待播放自动检测", "status" => $st["label"] ?? "等待播放", "strategy" => $st["strategy"] ?? "invalid", "label" => $st["label"] ?? "", "path" => $st["path"] ?? ""]);
}

if ($action === "list") {
    $auto = m_detect_storage_source($cfg);
    $selected = strtolower(trim((string)m_cfg_get($cfg, "MUSIC_SOURCE", "local")));
    if ($selected === "navidrome" && (
        trim((string)m_cfg_get($cfg, "MUSIC_NAVIDROME_URL", "")) === "" ||
        trim((string)m_cfg_get($cfg, "MUSIC_NAVIDROME_USER", "")) === "" ||
        m_navidrome_password($cfg) === ""
    )) {
        mjson(["ok" => false, "source_configured" => false, "source" => "navidrome", "error" => "Navidrome 音源未配置完整"], 200);
    }
    if ($selected === "fnos" && (
        trim((string)m_cfg_get($cfg, "MUSIC_FNOS_URL", "")) === "" ||
        trim((string)m_cfg_get($cfg, "MUSIC_FNOS_USER", "")) === "" ||
        m_fnos_password($cfg) === ""
    )) {
        mjson(["ok" => false, "source_configured" => false, "source" => "fnos", "error" => "飞牛音乐音源未配置完整"], 200);
    }
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
        $pageSize = 200;
        $page = 1;
        $total = 0;
        $tracks = [];
        $seen = [];
        while ($page <= 100) {
            [$resp, $err] = m_fnos_response($cfg, "track/list", ["page" => $page, "pageSize" => $pageSize], 20);
            if (!is_array($resp)) {
                if ($page === 1) mjson(["ok" => false, "error" => $err], 502);
                break;
            }
            $data = $resp["data"] ?? $resp;
            if (is_array($data) && array_is_list($data)) $items = $data;
            else $items = is_array($data) ? ($data["list"] ?? $data["items"] ?? $data["tracks"] ?? []) : [];
            if (!is_array($items) || !$items) break;
            $before = count($tracks);
            foreach ($items as $item) {
                if (!is_array($item)) continue;
                $id = (string)($item["id"] ?? $item["path"] ?? $item["url"] ?? "");
                if ($id === "" || isset($seen[$id])) continue;
                $seen[$id] = true;
                $tracks[] = m_track_normalize($item, "fnos", $id);
            }
            if (is_array($data)) {
                $reported = (int)($data["total"] ?? $data["totalCount"] ?? $data["count"] ?? 0);
                if ($reported > $total) $total = $reported;
            }
            if (count($items) < $pageSize || count($tracks) === $before || ($total > 0 && count($tracks) >= $total)) break;
            $page++;
        }
        if ($total < count($tracks)) $total = count($tracks);
        mjson(["ok" => true, "strategy" => "fnos", "items" => $tracks, "tracks" => $tracks, "count" => $total, "truncated" => false, "limit" => count($tracks), "tip" => ""]);
    }
    if ($strat === "navidrome") {
        $pageSize = 500;
        $offset = 0;
        $tracks = [];
        $seen = [];
        while ($offset < 100000) {
            [$resp, $err] = m_navidrome_request($cfg, "rest/search3", ["query" => "", "songOffset" => $offset, "songCount" => $pageSize], "GET", "", 20);
            if (!is_array($resp)) {
                if ($offset === 0) mjson(["ok" => false, "error" => $err], 502);
                break;
            }
            $data = $resp["subsonic-response"] ?? $resp;
            $search = $data["searchResult3"] ?? $data["searchResult"] ?? $data;
            $items = $search["song"] ?? [];
            if (!is_array($items) || !$items) break;
            $before = count($tracks);
            foreach ($items as $item) {
                if (!is_array($item)) continue;
                $id = (string)($item["id"] ?? $item["path"] ?? "");
                if ($id === "" || isset($seen[$id])) continue;
                $seen[$id] = true;
                $tracks[] = m_track_normalize($item, "navidrome");
            }
            if (count($items) < $pageSize || count($tracks) === $before) break;
            $offset += count($items);
        }
        mjson(["ok" => true, "strategy" => "navidrome", "tracks" => $tracks, "items" => $tracks, "count" => count($tracks), "truncated" => false, "limit" => count($tracks), "tip" => ""]);
    }
    mjson(["ok" => false, "error" => "非远端音源策略"], 400);
}

if ($action === "stream") {
    $auto = m_detect_storage_source($cfg);
    $remoteId = (string)($_GET["id"] ?? $_GET["guid"] ?? $_GET["path"] ?? "");
    if (($auto["strategy"] ?? "") === "fnos") {
        m_fnos_media_proxy($cfg, "track/stream", ["guid" => $remoteId], 0);
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

function m_extract_lyrics_text($value, $depth = 0) {
    if ($depth > 4 || $value === null) return "";
    if (is_string($value) || is_numeric($value)) return trim((string)$value);
    if (!is_array($value)) return "";
    foreach (["lyrics", "lyric", "lrc", "content", "text", "value"] as $key) {
        if (array_key_exists($key, $value)) {
            $text = m_extract_lyrics_text($value[$key], $depth + 1);
            if ($text !== "") return $text;
        }
    }
    foreach ($value as $child) {
        $text = m_extract_lyrics_text($child, $depth + 1);
        if ($text !== "") return $text;
    }
    return "";
}

function m_parse_lyrics_text($text) {
    $text = str_replace(["\r\n", "\r"], "\n", (string)$text);
    $offsetMs = 0;
    if (preg_match('/(?:^|\n)\s*\[offset\s*:\s*([+-]?\d+)\s*\]/i', $text, $offsetMatch)) {
        $offsetMs = (int)$offsetMatch[1];
    }
    $lines = [];
    $unsynced = [];
    foreach (preg_split('/\n/u', $text) as $raw) {
        $raw = trim((string)$raw);
        if ($raw === "") continue;
        $matched = false;
        if (preg_match_all('/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/u', $raw, $matches, PREG_SET_ORDER)) {
            $textPart = trim(preg_replace('/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/u', '', $raw));
            if ($textPart !== "") {
                foreach ($matches as $m) {
                    $fraction = isset($m[3]) ? (float)("0." . str_pad(substr($m[3], 0, 3), 3, "0")) : 0;
                    $lines[] = ["t" => ((int)$m[1] * 60 + (int)$m[2] + $fraction) * 1000, "text" => $textPart];
                }
                $matched = true;
            }
        }
        if (!$matched && !preg_match('/^\[[a-z]+:/i', $raw)) $unsynced[] = preg_replace('/^\[[^\]]+\]\s*/u', '', $raw);
    }
    if (count($lines)) {
        usort($lines, function ($a, $b) { return $a["t"] <=> $b["t"]; });
        return ["lines" => $lines, "unsynced" => false, "offset_ms" => $offsetMs];
    }
    $textLines = [];
    foreach ($unsynced as $textLine) if ($textLine !== "") $textLines[] = ["t" => count($textLines) * 4000, "text" => $textLine];
    return ["lines" => $textLines, "unsynced" => count($textLines) > 0, "offset_ms" => $offsetMs];
}

function m_fnos_local_path($path, $root) {
    $path = str_replace("\\", "/", trim((string)$path));
    $root = rtrim(str_replace("\\", "/", (string)$root), "/");
    if ($path === "" || $root === "") return "";
    $safe = m_safe_path_under($root, $path);
    if ($safe !== "") return $safe;
    if (preg_match('#/Music/(.+)$#i', $path, $m)) {
        $candidate = $root . "/" . ltrim($m[1], "/");
        return m_safe_path_under($root, $candidate);
    }
    return "";
}

function m_local_lyrics_text($path, $root, $fnosPath = false) {
    $path = $fnosPath ? m_fnos_local_path($path, $root) : m_safe_path_under($root !== "" ? $root : "/", $path);
    if ($path === "") return "";
    $dir = dirname($path);
    $base = pathinfo($path, PATHINFO_FILENAME);
    $candidates = [$dir . "/" . $base . ".lrc", $dir . "/" . $base . ".txt", $dir . "/lyrics.lrc", $dir . "/lyrics.txt"];
    $rootBase = pathinfo($path, PATHINFO_FILENAME);
    $candidates[] = rtrim($root, "/") . "/" . $rootBase . ".lrc";
    $candidates[] = rtrim($root, "/") . "/" . $rootBase . ".txt";
    foreach ($candidates as $candidate) if (is_file($candidate) && is_readable($candidate)) {
        $body = (string)@file_get_contents($candidate);
        if ($body !== "") return $body;
    }
    return "";
}

function m_navidrome_structured_lyrics($data) {
    if (!is_array($data)) return ["lines" => [], "unsynced" => false, "meta" => []];
    $root = $data["subsonic-response"] ?? $data;
    $sets = $root["lyricsList"]["structuredLyrics"] ?? $root["lyrics"]["structuredLyrics"] ?? [];
    if (!is_array($sets)) return ["lines" => [], "unsynced" => false, "meta" => []];
    $sets = array_values($sets);
    $chosen = null;
    foreach ($sets as $set) {
        if (!is_array($set)) continue;
        if ($chosen === null || !empty($set["synced"])) $chosen = $set;
        if (!empty($set["synced"])) break;
    }
    if (!is_array($chosen)) return ["lines" => [], "unsynced" => false, "meta" => []];
    $lines = [];
    $rawLines = $chosen["line"] ?? $chosen["lines"] ?? [];
    if (is_array($rawLines)) foreach (array_values($rawLines) as $i => $line) {
        if (!is_array($line)) continue;
        $text = trim((string)($line["value"] ?? $line["text"] ?? ""));
        if ($text === "") continue;
        $start = $line["start"] ?? $line["startTimeMs"] ?? $i * 4000;
        $lines[] = ["t" => is_numeric($start) ? (float)$start : $i * 4000, "text" => $text];
    }
    return [
        "lines" => $lines,
        "unsynced" => empty($chosen["synced"]),
        "meta" => ["lang" => (string)($chosen["lang"] ?? ""), "display_artist" => (string)($chosen["displayArtist"] ?? ""), "display_title" => (string)($chosen["displayTitle"] ?? "")],
    ];
}

if ($action === "lyrics") {
    $auto = m_detect_storage_source($cfg);
    $remoteId = (string)($_GET["id"] ?? $_GET["path"] ?? "");
    $remotePath = (string)($_GET["path"] ?? $remoteId);
    if (($auto["strategy"] ?? "") === "navidrome") {
        [$resp, $err] = m_navidrome_request($cfg, "rest/getLyricsBySongId.view", ["id" => $remoteId], "GET", "", 15);
        $structured = m_navidrome_structured_lyrics($resp);
        $lines = $structured["lines"];
        $unsynced = $structured["unsynced"];
        $offsetMs = 0;
        $lyrics = "";
        if (!$lines) {
            [$resp2, $err2] = m_navidrome_request($cfg, "rest/getLyrics.view", ["id" => $remoteId], "GET", "", 15);
            $data2 = is_array($resp2) ? ($resp2["subsonic-response"] ?? $resp2) : [];
            $lyrics = is_array($data2) ? (string)($data2["lyrics"]["value"] ?? "") : "";
            if ($lyrics !== "") {
                $parsed = m_parse_lyrics_text($lyrics);
                $lines = $parsed["lines"];
                $unsynced = $parsed["unsynced"];
                $offsetMs = $parsed["offset_ms"];
            }
            $err = $err2;
        }
        if (!$lines && $err !== "") {
            mjson(["ok" => false, "strategy" => "navidrome", "source" => "", "error" => $err, "lines" => [], "unsynced" => false, "offset_ms" => 0, "empty" => true], 502);
        }
        mjson(["ok" => true, "strategy" => "navidrome", "source" => $lyrics !== "" ? "remote" : "", "lyrics" => $lyrics, "lines" => $lines, "unsynced" => $unsynced, "offset_ms" => $offsetMs, "empty" => empty($lines)]);
    }
    if (($auto["strategy"] ?? "") === "fnos") {
        $fnosParams = ["guid" => $remoteId];
        [$resp, $err] = m_fnos_response($cfg, "track/lyric", $fnosParams, 12);
        $data = is_array($resp) ? ($resp["data"] ?? $resp) : [];
        $apiCode = is_array($data) ? (int)($data["code"] ?? 0) : 0;
        $lyrics = $apiCode > 0 ? "" : m_extract_lyrics_text($data);
        $source = $lyrics !== "" ? "remote" : "";
        if ($lyrics === "") {
            $root = m_local_music_root($cfg);
            $lyrics = m_local_lyrics_text($remotePath, $root, true);
            if ($lyrics !== "") $source = "local";
        }
        $parsed = m_parse_lyrics_text($lyrics);
        if ($lyrics === "" && $err !== "") {
            mjson(["ok" => false, "strategy" => "fnos", "source" => "", "error" => $err, "lines" => [], "unsynced" => false, "offset_ms" => 0, "empty" => true], 502);
        }
        mjson(["ok" => true, "strategy" => "fnos", "source" => $source, "lyrics" => $lyrics, "lines" => $parsed["lines"], "unsynced" => $parsed["unsynced"], "offset_ms" => $parsed["offset_ms"], "empty" => empty($parsed["lines"])]);
    }
    $strat = (string)($auto["strategy"] ?? "");
    $rel = isset($_GET["path"]) ? (string)$_GET["path"] : "";
    $root = m_local_music_root($cfg);
    $rel = $strat === "fnos" ? m_fnos_local_path($rel, $root) : m_safe_path_under($root !== "" ? $root : "/", $rel);
    $basename = $rel !== "" ? pathinfo($rel, PATHINFO_FILENAME) : "";
    $lyrics = $rel !== "" ? m_local_lyrics_text($rel, $root, false) : "";
    $source = $lyrics !== "" ? "local" : "";
    $parsed = m_parse_lyrics_text($lyrics);
    mjson([
        "ok" => true,
        "strategy" => $strat,
        "source" => $source,
        "lyrics" => $lyrics,
        "lines" => $parsed["lines"],
        "unsynced" => $parsed["unsynced"],
    ]);
}

if ($action === "cover") {
    $auto = m_detect_storage_source($cfg);
    $remoteId = (string)($_GET["id"] ?? $_GET["path"] ?? "");
    $remotePath = (string)($_GET["path"] ?? $remoteId);
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
        [$resp, $err] = m_fnos_response($cfg, "track/cover", ["guid" => $remoteId], 12);
        $data = is_array($resp) ? ($resp["data"] ?? $resp) : [];
        $coverData = is_array($data) ? $data : [];
        $url = (string)($coverData["url"] ?? $coverData["cover"] ?? $coverData["coverUrl"] ?? $coverData["imageUrl"] ?? $coverData["path"] ?? "");
        $b64 = (string)($coverData["base64"] ?? $coverData["b64"] ?? $coverData["image"] ?? $coverData["content"] ?? "");
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
            if (!preg_match('#^https?://#i', $url)) {
                $base = m_fnos_base_url($cfg);
                $url = $base . "/" . ltrim($url, "/");
            }
            [$bin, $ct, $code] = m_fnos_fetch_binary($cfg, $url, "image/*,*/*;q=0.2", 12);
            if ($bin !== "" && $code >= 200 && $code < 300) {
                header("Content-Type: " . (strpos($ct, "image/") === 0 ? $ct : "image/jpeg"));
                header("Cache-Control: private, max-age=300");
                echo $bin;
                exit;
            }
        }
        if ($url !== "" && !isset($_GET["fetch"])) {
            if (!preg_match('#^https?://#i', $url)) $url = m_fnos_base_url($cfg) . "/" . ltrim($url, "/");
            mjson(["ok" => true, "url" => $url, "source" => "remote"]);
        }
    }
    $strat = (string)($auto["strategy"] ?? "");
    $rel = isset($_GET["path"]) ? (string)$_GET["path"] : "";
    $root = m_local_music_root($cfg);
    $rel = $strat === "fnos" ? m_fnos_local_path($rel, $root) : m_safe_path_under($root !== "" ? $root : "/", $rel);
    $basename = $rel !== "" ? pathinfo($rel, PATHINFO_FILENAME) : "";
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
    m_emit_cover_empty();
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

mjson([
    "ok" => false,
    "error" => "unknown action",
    "action" => $action,
    "status" => 400,
], 400);
