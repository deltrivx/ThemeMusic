<?php

$api = file_get_contents(__DIR__ . '/../ucwc-music-api.php');
if ($api === false) {
    fwrite(STDERR, "Unable to read ucwc-music-api.php\n");
    exit(1);
}

$start = strpos($api, 'function m_fnos_url_normalize(');
$end = strpos($api, 'function m_fnos_login(', $start);
$baseStart = strpos($api, 'function m_fnos_base_url(');
$baseEnd = strpos($api, 'function m_fnos_auth_path(', $baseStart);
if ($start === false || $end === false || $baseStart === false || $baseEnd === false) {
    fwrite(STDERR, "Unable to isolate FnOS URL helpers\n");
    exit(1);
}
function m_cfg_get(array $cfg, $key, $default = "") {
    return array_key_exists($key, $cfg) ? $cfg[$key] : $default;
}
eval(substr($api, $start, $end - $start));
eval(substr($api, $baseStart, $baseEnd - $baseStart));

$normalize = [
    ' http://FNOS.local:5080/music/ ' => 'http://fnos.local:5080/music',
    'https://[2001:db8::1]:5443/music' => 'https://[2001:db8::1]:5443/music',
    'http://fnos.local' => 'http://fnos.local',
    'ftp://fnos.local/music' => '',
    'http://user:pass@fnos.local/music' => '',
    'http://fnos.local/music?token=secret' => '',
    'http://fnos.local/music#fragment' => '',
    'not-a-url' => '',
];
foreach ($normalize as $input => $expected) {
    $actual = m_fnos_url_normalize($input);
    if ($actual !== $expected) throw new RuntimeException("Unexpected normalized URL for {$input}");
}

$cfg = ['MUSIC_FNOS_URL' => 'http://fnos.local:5080/music'];
if (m_fnos_base_url($cfg) !== 'http://fnos.local:5080/music/api/v1') throw new RuntimeException('FnOS service root did not become API base');
if (m_fnos_media_url($cfg, '/media/cover.jpg') !== 'http://fnos.local:5080/media/cover.jpg') throw new RuntimeException('Same-origin absolute media path was not accepted');
if (m_fnos_media_url($cfg, 'track/file?guid=a') !== 'http://fnos.local:5080/music/api/v1/track/file?guid=a') throw new RuntimeException('Relative media path was not resolved against API base');
if (m_fnos_media_url($cfg, 'https://cdn.example.invalid/audio.mp3') !== '') throw new RuntimeException('Cross-origin media URL was accepted');
if (m_fnos_media_url($cfg, 'http://fnos.local:5080/redirected.mp3') === '') throw new RuntimeException('Same-origin absolute media URL was rejected');

if (m_fnos_response_error(['ok' => false, 'message' => 'denied']) !== 'denied') throw new RuntimeException('ok=false error envelope was accepted');
if (m_fnos_response_error(['code' => 500, 'error' => 'failed']) !== 'failed') throw new RuntimeException('non-zero error envelope was accepted');
if (m_fnos_response_error(['status' => 'error']) === '') throw new RuntimeException('error status envelope was accepted');
if (m_fnos_response_error(['code' => 0, 'data' => []]) !== '') throw new RuntimeException('success envelope was rejected');

echo "FnOS URL, origin, and error-envelope regression passed.\n";
