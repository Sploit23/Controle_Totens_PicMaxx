<?php
require_once __DIR__ . '/helpers.php';
cors();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    error('Metodo nao permitido', 405);
}

jsonHeader();

$code = generateCode();
createCodeMeta($code);

json([
    'success' => true,
    'code' => $code,
    'expiresInMinutes' => CODE_EXPIRE_MINUTES,
]);
