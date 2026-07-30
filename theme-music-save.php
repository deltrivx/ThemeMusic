<?php
/**
 * ThemeMusic AJAX save endpoint (JSON).
 * Plugin id: theme.music
 */
header("Content-Type: application/json; charset=utf-8");
header("Cache-Control: no-store");

if (function_exists("session_status") && session_status() === PHP_SESSION_ACTIVE) {
    @session_write_close();
} elseif (function_exists("session_write_close")) {
    @session_write_close();
}

$persist = "/boot/config/plugins/theme.music";
$fx_path = "$persist/theme-music.cfg";
$svc_path = "$persist/theme.music.cfg";
$log_path = "/tmp/theme-music-save.log";

function tm_json($payload, $http = 200) {
    if (!headers_sent()) {
        http_response_code($http);
        header("Content-Type: application/json; charset=utf-8");
        header("Cache-Control: no-store");
    }
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function tm_log($path, $line) {
    @file_put_contents($path, date("c") . " " . $line . "\n", FILE_APPEND);
}

function tm_defaults() {
    return [
        "MUSIC_ENABLE" => "no",
        "MUSIC_UI" => "card",
        "MUSIC_SOURCE" => "local",
        "MUSIC_LOCAL_DIR" => "",
        "MUSIC_VOLUME" => "70",
        "MUSIC_AUTOPLAY" => "no",
        "MUSIC_SHUFFLE" => "no",
        "MUSIC_REPEAT" => "off",
        "MUSIC_DASH_ONLY" => "yes",
    ];
}

function tm_music_dir_ok($v) {
    $v = trim(str_replace("\\", "/", (string)$v));
    $v = rtrim($v, "/");
    if ($v === "") return "";
    if ($v[0] !== "/") return "";
    if (strpos($v, "..") !== false) return "";
    if (strpos($v . "/", "/mnt/") !== 0 && strpos($v . "/", "/boot/config/plugins/theme.music/") !== 0) {
        return "";
    }
    if (strlen($v) > 512) $v = substr($v, 0, 512);
    return $v;
}

function tm_normalize(&$fx) {
    $fx["MUSIC_ENABLE"] = (($fx["MUSIC_ENABLE"] ?? "no") === "yes") ? "yes" : "no";
    $ui = strtolower(trim((string)($fx["MUSIC_UI"] ?? "card")));
    $fx["MUSIC_UI"] = in_array($ui, ["card", "float", "statusbar"], true) ? $ui : "card";
    if ($fx["MUSIC_UI"] !== "card") $fx["MUSIC_UI"] = "card";
    $src = strtolower(trim((string)($fx["MUSIC_SOURCE"] ?? "local")));
    $fx["MUSIC_SOURCE"] = in_array($src, ["local", "navidrome", "emby", "jellyfin"], true) ? $src : "local";
    if ($fx["MUSIC_SOURCE"] !== "local") $fx["MUSIC_SOURCE"] = "local";
    $fx["MUSIC_LOCAL_DIR"] = tm_music_dir_ok($fx["MUSIC_LOCAL_DIR"] ?? "");
    $vol = intval($fx["MUSIC_VOLUME"] ?? 70);
    if ($vol < 0) $vol = 0;
    if ($vol > 100) $vol = 100;
    $fx["MUSIC_VOLUME"] = (string)$vol;
    $fx["MUSIC_AUTOPLAY"] = (($fx["MUSIC_AUTOPLAY"] ?? "no") === "yes") ? "yes" : "no";
    $fx["MUSIC_SHUFFLE"] = (($fx["MUSIC_SHUFFLE"] ?? "no") === "yes") ? "yes" : "no";
    $rp = strtolower(trim((string)($fx["MUSIC_REPEAT"] ?? "off")));
    $fx["MUSIC_REPEAT"] = in_array($rp, ["off", "one", "all"], true) ? $rp : "off";
    $fx["MUSIC_DASH_ONLY"] = (($fx["MUSIC_DASH_ONLY"] ?? "yes") === "no") ? "no" : "yes";
}

function tm_load($path) {
    $d = tm_defaults();
    if (is_file($path)) {
        $raw = @parse_ini_file($path);
        if (is_array($raw)) {
            foreach ($d as $k => $v) {
                if (isset($raw[$k]) && $raw[$k] !== "") $d[$k] = (string)$raw[$k];
            }
        }
    }
    tm_normalize($d);
    return $d;
}

function tm_save($path, $fx) {
    tm_normalize($fx);
    $lines = [];
    foreach (tm_defaults() as $k => $_) {
        $val = (string)($fx[$k] ?? "");
        $val = str_replace(['"', "\r", "\n"], ['', '', ''], $val);
        $lines[] = $k . '="' . $val . '"';
    }
    @mkdir(dirname($path), 0755, true);
    $ok = @file_put_contents($path, implode("\n", $lines) . "\n") !== false;
    if ($ok) @chmod($path, 0644);
    return $ok;
}

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    tm_json(["ok" => false, "error" => "POST required"], 405);
}

if (empty($_POST["SAVE_THEME_MUSIC"]) && empty($_POST["SAVE_THEME_FX"])) {
    tm_json(["ok" => false, "error" => "missing SAVE flag"], 400);
}

$fx = tm_load($fx_path);

if (isset($_POST["MUSIC_ENABLE"])) {
    $fx["MUSIC_ENABLE"] = (($_POST["MUSIC_ENABLE"] ?? "no") === "yes") ? "yes" : "no";
}
if (isset($_POST["MUSIC_UI"])) {
    $ui = strtolower(trim((string)($_POST["MUSIC_UI"] ?? "card")));
    $fx["MUSIC_UI"] = in_array($ui, ["card", "float", "statusbar"], true) ? $ui : "card";
}
if (isset($_POST["MUSIC_SOURCE"])) {
    $src = strtolower(trim((string)($_POST["MUSIC_SOURCE"] ?? "local")));
    $fx["MUSIC_SOURCE"] = in_array($src, ["local", "navidrome", "emby", "jellyfin"], true) ? $src : "local";
}
if (isset($_POST["MUSIC_LOCAL_DIR"])) {
    $fx["MUSIC_LOCAL_DIR"] = tm_music_dir_ok($_POST["MUSIC_LOCAL_DIR"] ?? "");
}
if (isset($_POST["MUSIC_VOLUME_COMMIT"]) || isset($_POST["MUSIC_VOLUME"])) {
    $vol = intval($_POST["MUSIC_VOLUME_COMMIT"] ?? ($_POST["MUSIC_VOLUME"] ?? ($fx["MUSIC_VOLUME"] ?? 70)));
    if ($vol < 0) $vol = 0;
    if ($vol > 100) $vol = 100;
    $fx["MUSIC_VOLUME"] = (string)$vol;
}
if (isset($_POST["MUSIC_AUTOPLAY"])) {
    $fx["MUSIC_AUTOPLAY"] = (($_POST["MUSIC_AUTOPLAY"] ?? "no") === "yes") ? "yes" : "no";
}
if (isset($_POST["MUSIC_SHUFFLE"])) {
    $fx["MUSIC_SHUFFLE"] = (($_POST["MUSIC_SHUFFLE"] ?? "no") === "yes") ? "yes" : "no";
}
if (isset($_POST["MUSIC_REPEAT"])) {
    $rp = strtolower(trim((string)($_POST["MUSIC_REPEAT"] ?? "off")));
    $fx["MUSIC_REPEAT"] = in_array($rp, ["off", "one", "all"], true) ? $rp : "off";
}
if (isset($_POST["MUSIC_DASH_ONLY"])) {
    $fx["MUSIC_DASH_ONLY"] = (($_POST["MUSIC_DASH_ONLY"] ?? "yes") === "no") ? "no" : "yes";
}

/* Optional master SERVICE toggle from settings */
if (isset($_POST["SERVICE"])) {
    $svc = strtolower(trim((string)$_POST["SERVICE"]));
    $svc = in_array($svc, ["enabled", "enable", "1", "yes"], true) ? "enabled" : "disabled";
    @mkdir($persist, 0755, true);
    @file_put_contents($svc_path, 'SERVICE="' . $svc . "\"\n");
    @chmod($svc_path, 0644);
}

tm_normalize($fx);
$ok = tm_save($fx_path, $fx);
tm_log($log_path, "save ok=" . ($ok ? "1" : "0") . " enable=" . $fx["MUSIC_ENABLE"] . " dir=" . $fx["MUSIC_LOCAL_DIR"]);

if (!$ok) {
    tm_json(["ok" => false, "error" => "write failed"], 500);
}

tm_json([
    "ok" => true,
    "message" => "已保存",
    "music" => [
        "enable" => $fx["MUSIC_ENABLE"] === "yes",
        "local_dir" => $fx["MUSIC_LOCAL_DIR"],
        "volume" => intval($fx["MUSIC_VOLUME"]),
        "autoplay" => $fx["MUSIC_AUTOPLAY"] === "yes",
        "shuffle" => $fx["MUSIC_SHUFFLE"] === "yes",
        "repeat" => $fx["MUSIC_REPEAT"],
        "dash_only" => $fx["MUSIC_DASH_ONLY"] !== "no",
    ],
]);
