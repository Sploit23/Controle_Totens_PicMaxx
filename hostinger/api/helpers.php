<?php
define('UPLOAD_DIR', __DIR__ . '/../uploads');
define('CODE_EXPIRE_MINUTES', 1440); // 24 horas

function jsonHeader() {
    header('Content-Type: application/json');
}

function cors() {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

function json($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function error($msg, $code = 400) {
    json(['success' => false, 'error' => $msg], $code);
}

function sanitizeCode($code) {
    return preg_replace('/[^0-9]/', '', substr($code, 0, 6));
}

function generateCode() {
    for ($attempt = 0; $attempt < 20; $attempt++) {
        $code = '';
        for ($i = 0; $i < 6; $i++) {
            $code .= random_int(0, 9);
        }
        $dir = UPLOAD_DIR . '/' . $code;
        if (!is_dir($dir)) {
            return $code;
        }
    }
    error('Erro ao gerar codigo unico', 500);
}

function codeDir($code) {
    return UPLOAD_DIR . '/' . $code;
}

function codeExists($code) {
    return is_dir(codeDir($code));
}

function isCodeExpired($code) {
    $meta = codeDir($code) . '/.meta.json';
    if (!file_exists($meta)) return true;
    $data = json_decode(file_get_contents($meta), true);
    if (!$data || !isset($data['expires_at'])) return true;
    return time() > $data['expires_at'];
}

function createCodeMeta($code) {
    $dir = codeDir($code);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    $meta = [
        'created_at' => time(),
        'expires_at' => time() + (CODE_EXPIRE_MINUTES * 60),
        'used' => false,
    ];
    file_put_contents($dir . '/.meta.json', json_encode($meta));
}

function markCodeUsed($code) {
    $metaFile = codeDir($code) . '/.meta.json';
    if (file_exists($metaFile)) {
        $data = json_decode(file_get_contents($metaFile), true);
        $data['used'] = true;
        $data['used_at'] = time();
        file_put_contents($metaFile, json_encode($data));
    }
}

function getCodeMeta($code) {
    $metaFile = codeDir($code) . '/.meta.json';
    if (!file_exists($metaFile)) return null;
    return json_decode(file_get_contents($metaFile), true);
}

function listPhotos($code) {
    $dir = codeDir($code);
    if (!is_dir($dir)) return [];
    $files = array_diff(scandir($dir), ['.', '..', '.meta.json']);
    $photos = [];
    $idx = 0;
    foreach ($files as $f) {
        $path = $dir . '/' . $f;
        if (!is_file($path)) continue;
        $photos[] = [
            'id' => $idx++,
            'filename' => $f,
            'originalName' => $f,
            'size' => filesize($path),
            'url' => '/uploads/' . $code . '/' . $f,
        ];
    }
    return $photos;
}

function deleteCodeDir($code) {
    $dir = codeDir($code);
    if (!is_dir($dir)) return;
    $files = array_diff(scandir($dir), ['.', '..']);
    foreach ($files as $f) {
        $path = $dir . '/' . $f;
        is_file($path) ? unlink($path) : deleteCodeDir($code . '/' . $f);
    }
    rmdir($dir);
}

function cleanupExpired() {
    $dirs = array_diff(scandir(UPLOAD_DIR), ['.', '..']);
    $count = 0;
    foreach ($dirs as $d) {
        $metaFile = UPLOAD_DIR . '/' . $d . '/.meta.json';
        if (!file_exists($metaFile)) continue;
        $data = json_decode(file_get_contents($metaFile), true);
        if ($data && time() > $data['expires_at']) {
            deleteCodeDir($d);
            $count++;
        }
    }
    return $count;
}
