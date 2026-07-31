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

function tm_resolve_run_mode($d) {
    $mode = strtolower(trim((string)($d["MUSIC_RUN_MODE"] ?? "")));
    if (in_array($mode, ["card", "chip", "both"], true)) return $mode;
    /* Legacy MUSIC_UI was forced to card — derive from ENABLE + DASH_ONLY only. */
    if (($d["MUSIC_ENABLE"] ?? "no") !== "yes") return "card";
    return (($d["MUSIC_DASH_ONLY"] ?? "yes") === "no") ? "both" : "card";
}

function tm_apply_run_mode(&$d, $mode, $force_enable = false) {
    $mode = strtolower(trim((string)$mode));
    if (!in_array($mode, ["card", "chip", "both"], true)) $mode = "card";
    $d["MUSIC_RUN_MODE"] = $mode;
    $d["MUSIC_UI"] = $mode;
    if ($mode === "card") {
        $d["MUSIC_DASH_ONLY"] = "yes";
    } else {
        $d["MUSIC_DASH_ONLY"] = "no";
    }
    if ($force_enable) {
        $d["MUSIC_ENABLE"] = "yes";
    }
}

function tm_clamp_vol($v) {
    $vol = intval($v);
    if ($vol < 0) $vol = 0;
    if ($vol > 100) $vol = 100;
    return (string)$vol;
}

function tm_yn($v) {
    return ($v === "yes") ? "yes" : "no";
}

function tm_repeat($v) {
    $rp = strtolower(trim((string)$v));
    return in_array($rp, ["off", "one", "all"], true) ? $rp : "off";
}

function tm_mobile_run_mode($v) {
    $m = strtolower(trim((string)$v));
    return in_array($m, ["same", "card", "chip", "both"], true) ? $m : "same";
}

function tm_normalize(&$fx) {
    $fx["MUSIC_ENABLE"] = (($fx["MUSIC_ENABLE"] ?? "no") === "yes") ? "yes" : "no";
    $mode = tm_resolve_run_mode($fx);
    tm_apply_run_mode($fx, $mode, false);
    $src = strtolower(trim((string)($fx["MUSIC_SOURCE"] ?? "local")));
    $fx["MUSIC_SOURCE"] = in_array($src, ["local", "navidrome", "emby", "jellyfin"], true) ? $src : "local";
    if ($fx["MUSIC_SOURCE"] !== "local") $fx["MUSIC_SOURCE"] = "local";
    $fx["MUSIC_LOCAL_DIR"] = tm_music_dir_ok($fx["MUSIC_LOCAL_DIR"] ?? "");
    $fx["MUSIC_VOLUME"] = tm_clamp_vol($fx["MUSIC_VOLUME"] ?? 70);
    $fx["MUSIC_AUTOPLAY"] = tm_yn($fx["MUSIC_AUTOPLAY"] ?? "no");
    $fx["MUSIC_SHUFFLE"] = tm_yn($fx["MUSIC_SHUFFLE"] ?? "no");
    $fx["MUSIC_REPEAT"] = tm_repeat($fx["MUSIC_REPEAT"] ?? "off");
    $fx["MUSIC_RUN_MODE_MOBILE"] = tm_mobile_run_mode($fx["MUSIC_RUN_MODE_MOBILE"] ?? "same");
    $fx["MUSIC_VOLUME_MOBILE"] = tm_clamp_vol($fx["MUSIC_VOLUME_MOBILE"] ?? ($fx["MUSIC_VOLUME"] ?? 70));
    $fx["MUSIC_AUTOPLAY_MOBILE"] = tm_yn($fx["MUSIC_AUTOPLAY_MOBILE"] ?? "no");
    $fx["MUSIC_SHUFFLE_MOBILE"] = tm_yn($fx["MUSIC_SHUFFLE_MOBILE"] ?? "no");
    $fx["MUSIC_REPEAT_MOBILE"] = tm_repeat($fx["MUSIC_REPEAT_MOBILE"] ?? "off");
}

function tm_load($path) {
    $d = tm_defaults();
    $had_run_mode = false;
    $had_mobile_mode = false;
    if (is_file($path)) {
        $raw = @parse_ini_file($path);
        if (is_array($raw)) {
            foreach ($d as $k => $v) {
                if (isset($raw[$k]) && $raw[$k] !== "") $d[$k] = (string)$raw[$k];
            }
            $had_run_mode = isset($raw["MUSIC_RUN_MODE"]) && trim((string)$raw["MUSIC_RUN_MODE"]) !== "";
            $had_mobile_mode = isset($raw["MUSIC_RUN_MODE_MOBILE"]) && trim((string)$raw["MUSIC_RUN_MODE_MOBILE"]) !== "";
        }
    }
    if (!$had_run_mode) unset($d["MUSIC_RUN_MODE"]);
    if (!$had_mobile_mode) $d["MUSIC_RUN_MODE_MOBILE"] = "same";
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

if (isset($_POST["MUSIC_RUN_MODE"])) {
    $mode = strtolower(trim((string)($_POST["MUSIC_RUN_MODE"] ?? "card")));
    if (!in_array($mode, ["card", "chip", "both"], true)) $mode = "card";
    tm_apply_run_mode($fx, $mode, true);
} elseif (isset($_POST["MUSIC_ENABLE"]) || isset($_POST["MUSIC_DASH_ONLY"]) || isset($_POST["MUSIC_UI"])) {
    if (isset($_POST["MUSIC_ENABLE"])) {
        $fx["MUSIC_ENABLE"] = (($_POST["MUSIC_ENABLE"] ?? "no") === "yes") ? "yes" : "no";
    }
    if (isset($_POST["MUSIC_DASH_ONLY"])) {
        $fx["MUSIC_DASH_ONLY"] = (($_POST["MUSIC_DASH_ONLY"] ?? "yes") === "no") ? "no" : "yes";
    }
    if (isset($_POST["MUSIC_UI"])) {
        $ui = strtolower(trim((string)($_POST["MUSIC_UI"] ?? "card")));
        if (in_array($ui, ["card", "chip", "both"], true)) {
            $fx["MUSIC_RUN_MODE"] = $ui;
        } elseif (($fx["MUSIC_ENABLE"] ?? "no") === "yes") {
            $fx["MUSIC_RUN_MODE"] = (($fx["MUSIC_DASH_ONLY"] ?? "yes") === "no") ? "both" : "card";
        }
    } elseif (isset($_POST["MUSIC_ENABLE"]) || isset($_POST["MUSIC_DASH_ONLY"])) {
        if (($fx["MUSIC_ENABLE"] ?? "no") === "yes") {
            $fx["MUSIC_RUN_MODE"] = (($fx["MUSIC_DASH_ONLY"] ?? "yes") === "no") ? "both" : "card";
        }
    }
}
if (isset($_POST["MUSIC_SOURCE"])) {
    $src = strtolower(trim((string)($_POST["MUSIC_SOURCE"] ?? "local")));
    $fx["MUSIC_SOURCE"] = in_array($src, ["local", "navidrome", "emby", "jellyfin"], true) ? $src : "local";
}
if (isset($_POST["MUSIC_LOCAL_DIR"])) {
    $fx["MUSIC_LOCAL_DIR"] = tm_music_dir_ok($_POST["MUSIC_LOCAL_DIR"] ?? "");
}
if (isset($_POST["MUSIC_VOLUME_COMMIT"]) || isset($_POST["MUSIC_VOLUME"])) {
    $fx["MUSIC_VOLUME"] = tm_clamp_vol($_POST["MUSIC_VOLUME_COMMIT"] ?? ($_POST["MUSIC_VOLUME"] ?? ($fx["MUSIC_VOLUME"] ?? 70)));
}
if (isset($_POST["MUSIC_AUTOPLAY"])) {
    $fx["MUSIC_AUTOPLAY"] = tm_yn(($_POST["MUSIC_AUTOPLAY"] ?? "no") === "yes" ? "yes" : "no");
}
if (isset($_POST["MUSIC_SHUFFLE"])) {
    $fx["MUSIC_SHUFFLE"] = tm_yn(($_POST["MUSIC_SHUFFLE"] ?? "no") === "yes" ? "yes" : "no");
}
if (isset($_POST["MUSIC_REPEAT"])) {
    $fx["MUSIC_REPEAT"] = tm_repeat($_POST["MUSIC_REPEAT"] ?? "off");
}
if (isset($_POST["MUSIC_RUN_MODE_MOBILE"])) {
    $fx["MUSIC_RUN_MODE_MOBILE"] = tm_mobile_run_mode($_POST["MUSIC_RUN_MODE_MOBILE"] ?? "same");
    if ($fx["MUSIC_RUN_MODE_MOBILE"] !== "same") {
        $fx["MUSIC_ENABLE"] = "yes";
    }
}
if (isset($_POST["MUSIC_VOLUME_MOBILE_COMMIT"]) || isset($_POST["MUSIC_VOLUME_MOBILE"])) {
    $fx["MUSIC_VOLUME_MOBILE"] = tm_clamp_vol($_POST["MUSIC_VOLUME_MOBILE_COMMIT"] ?? ($_POST["MUSIC_VOLUME_MOBILE"] ?? ($fx["MUSIC_VOLUME_MOBILE"] ?? 70)));
}
if (isset($_POST["MUSIC_AUTOPLAY_MOBILE"])) {
    $fx["MUSIC_AUTOPLAY_MOBILE"] = tm_yn(($_POST["MUSIC_AUTOPLAY_MOBILE"] ?? "no") === "yes" ? "yes" : "no");
}
if (isset($_POST["MUSIC_SHUFFLE_MOBILE"])) {
    $fx["MUSIC_SHUFFLE_MOBILE"] = tm_yn(($_POST["MUSIC_SHUFFLE_MOBILE"] ?? "no") === "yes" ? "yes" : "no");
}
if (isset($_POST["MUSIC_REPEAT_MOBILE"])) {
    $fx["MUSIC_REPEAT_MOBILE"] = tm_repeat($_POST["MUSIC_REPEAT_MOBILE"] ?? "off");
}

/* Optional master SERVICE toggle from settings / title switch */
$svc_out = null;
if (isset($_POST["SERVICE"])) {
    $svc = strtolower(trim((string)$_POST["SERVICE"]));
    $svc = in_array($svc, ["enabled", "enable", "1", "yes"], true) ? "enabled" : "disabled";
    @mkdir($persist, 0755, true);
    $svc_ok = @file_put_contents($svc_path, 'SERVICE="' . $svc . "\"\n") !== false;
    if ($svc_ok) @chmod($svc_path, 0644);
    $svc_out = $svc;
    $section = strtolower(trim((string)($_POST["UCWC_SECTION"] ?? "")));
    /* Title switch only toggles SERVICE — skip music cfg write. */
    if ($section === "service" || (count($_POST) <= 4 && !isset($_POST["MUSIC_RUN_MODE"]) && !isset($_POST["MUSIC_RUN_MODE_MOBILE"]) && !isset($_POST["MUSIC_ENABLE"]) && !isset($_POST["MUSIC_LOCAL_DIR"]))) {
        if (!$svc_ok) {
            tm_json(["ok" => false, "error" => "service write failed", "message" => "无法写入运行开关"], 500);
        }
        tm_log($log_path, "service-only ok svc=" . $svc);
        tm_json([
            "ok" => true,
            "message" => $svc === "enabled" ? "已启用" : "已停用",
            "service" => $svc,
        ]);
    }
}

tm_normalize($fx);
$ok = tm_save($fx_path, $fx);
tm_log($log_path, "save ok=" . ($ok ? "1" : "0") . " mode=" . $fx["MUSIC_RUN_MODE"] . " mobile=" . $fx["MUSIC_RUN_MODE_MOBILE"] . " enable=" . $fx["MUSIC_ENABLE"] . " dir=" . $fx["MUSIC_LOCAL_DIR"] . ($svc_out ? " svc=" . $svc_out : ""));

if (!$ok) {
    tm_json(["ok" => false, "error" => "write failed"], 500);
}

$payload = [
    "ok" => true,
    "message" => "已保存",
    "music" => [
        "enable" => $fx["MUSIC_ENABLE"] === "yes",
        "run_mode" => $fx["MUSIC_RUN_MODE"],
        "ui" => $fx["MUSIC_UI"],
        "local_dir" => $fx["MUSIC_LOCAL_DIR"],
        "volume" => intval($fx["MUSIC_VOLUME"]),
        "autoplay" => $fx["MUSIC_AUTOPLAY"] === "yes",
        "shuffle" => $fx["MUSIC_SHUFFLE"] === "yes",
        "repeat" => $fx["MUSIC_REPEAT"],
        "dash_only" => $fx["MUSIC_DASH_ONLY"] !== "no",
        "run_mode_mobile" => $fx["MUSIC_RUN_MODE_MOBILE"],
        "volume_mobile" => intval($fx["MUSIC_VOLUME_MOBILE"]),
        "autoplay_mobile" => $fx["MUSIC_AUTOPLAY_MOBILE"] === "yes",
        "shuffle_mobile" => $fx["MUSIC_SHUFFLE_MOBILE"] === "yes",
        "repeat_mobile" => $fx["MUSIC_REPEAT_MOBILE"],
    ],
];
if ($svc_out !== null) $payload["service"] = $svc_out;
tm_json($payload);
