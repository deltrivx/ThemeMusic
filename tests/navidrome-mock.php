<?php
$path = parse_url($_SERVER["REQUEST_URI"] ?? "/", PHP_URL_PATH);
$method = basename((string)$path);
header("X-Mock-Navidrome: 1");

if ($method === "stream.view") {
    $body = "ID3MOCK-AUDIO-DATA";
    $start = 0;
    if (!empty($_SERVER["HTTP_RANGE"]) && preg_match('/bytes=(\d+)-/', $_SERVER["HTTP_RANGE"], $m)) {
        $start = min(strlen($body) - 1, intval($m[1]));
        http_response_code(206);
        header("Content-Range: bytes $start-" . (strlen($body) - 1) . "/" . strlen($body));
    }
    $body = substr($body, $start);
    header("Content-Type: audio/mpeg");
    header("Accept-Ranges: bytes");
    header("Content-Length: " . strlen($body));
    echo $body;
    exit;
}

if ($method === "getCoverArt.view") {
    $png = base64_decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
    header("Content-Type: image/png");
    header("Content-Length: " . strlen($png));
    echo $png;
    exit;
}

header("Content-Type: application/json; charset=utf-8");
$base = [
    "status" => "ok",
    "version" => "1.16.1",
    "type" => "navidrome",
    "serverVersion" => "0.63.2-mock",
    "openSubsonic" => true,
];

if ($method === "search3.view") {
    $offset = intval($_GET["songOffset"] ?? 0);
    $all = [
        [
            "id" => "song-a",
            "title" => "测试歌曲 A",
            "artist" => "测试歌手",
            "album" => "测试专辑",
            "suffix" => "mp3",
            "duration" => 180,
            "size" => 18,
            "coverArt" => "cover-a",
        ],
        [
            "id" => "song-b",
            "title" => "测试歌曲 B",
            "artist" => "测试歌手",
            "album" => "测试专辑",
            "suffix" => "flac",
            "duration" => 210,
            "size" => 32,
        ],
    ];
    $count = intval($_GET["songCount"] ?? 20);
    $base["searchResult3"] = ["song" => array_slice($all, $offset, $count)];
} elseif ($method === "getSong.view") {
    $base["song"] = [
        "id" => (string)($_GET["id"] ?? "song-a"),
        "title" => "测试歌曲 A",
        "artist" => "测试歌手",
        "album" => "测试专辑",
        "coverArt" => "cover-a",
    ];
} elseif ($method === "getLyricsBySongId.view") {
    $base["lyricsList"] = [
        "structuredLyrics" => [[
            "lang" => "zh",
            "synced" => true,
            "displayArtist" => "测试歌手",
            "displayTitle" => "测试歌曲 A",
            "line" => [
                ["start" => 0, "value" => "第一句"],
                ["start" => 1250, "value" => "第二句"],
            ],
        ]],
    ];
} elseif ($method === "getLyrics.view") {
    $base["lyrics"] = ["value" => "[00:00.00]第一句\n[00:01.25]第二句"];
}

echo json_encode(["subsonic-response" => $base], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
