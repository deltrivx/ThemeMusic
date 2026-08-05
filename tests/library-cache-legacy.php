<?php

$api = file_get_contents(__DIR__ . '/../ucwc-music-api.php');
if ($api === false) {
    fwrite(STDERR, "Unable to read ucwc-music-api.php\n");
    exit(1);
}

$start = strpos($api, 'function m_library_cache_path(');
$end = strpos($api, 'function m_library_cache_write(', $start);
if ($start === false || $end === false) {
    fwrite(STDERR, "Unable to isolate cache helpers\n");
    exit(1);
}
eval(substr($api, $start, $end - $start));

$scope = 'theme-music-legacy-cache-test-' . getmypid();
$path = m_library_cache_path($scope);
@unlink($path);

try {
    file_put_contents($path, json_encode(['tracks' => [['id' => 'legacy-track']]]));
    touch($path, time() - 60);
    $recent = m_library_cache_read($scope);
    if (!is_array($recent) || !isset($recent['created_at']) || time() - (int)$recent['created_at'] > 120) {
        throw new RuntimeException('Recent legacy cache did not inherit file mtime');
    }

    touch($path, time() - 21601);
    $stale = m_library_cache_read($scope);
    if (!is_array($stale) || time() - (int)$stale['created_at'] <= 21600) {
        throw new RuntimeException('Old legacy cache did not inherit stale file mtime');
    }

    file_put_contents($path, json_encode(['tracks' => [], 'created_at' => 1234567890]));
    $current = m_library_cache_read($scope);
    if (!is_array($current) || (int)$current['created_at'] !== 1234567890) {
        throw new RuntimeException('Explicit cache creation time was changed');
    }

    echo "Legacy remote library cache compatibility passed.\n";
} finally {
    @unlink($path);
}
