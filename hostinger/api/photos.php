<?php
require_once __DIR__ . '/helpers.php';
cors();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    error('Metodo nao permitido', 405);
}

jsonHeader();

$code = isset($_GET['code']) ? sanitizeCode($_GET['code']) : '';
if (!$code) {
    error('Codigo obrigatorio');
}

if (!codeExists($code)) {
    json([
        'success' => false,
        'error' => 'Codigo invalido',
        'code' => $code,
        'photos' => [],
        'photoCount' => 0,
    ]);
    exit;
}

if (isCodeExpired($code)) {
    json([
        'success' => false,
        'error' => 'Codigo expirado',
        'code' => $code,
        'photos' => [],
        'photoCount' => 0,
    ]);
    exit;
}

$photos = listPhotos($code);

json([
    'success' => true,
    'code' => $code,
    'totemId' => null,
    'photos' => $photos,
    'photoCount' => count($photos),
]);
