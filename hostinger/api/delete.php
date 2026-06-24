<?php
require_once __DIR__ . '/helpers.php';
cors();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    error('Metodo nao permitido', 405);
}

jsonHeader();

// Suporta tanto JSON body quanto form-encoded
$input = json_decode(file_get_contents('php://input'), true);
$code = '';

if ($input && isset($input['code'])) {
    $code = sanitizeCode($input['code']);
} elseif (isset($_POST['code'])) {
    $code = sanitizeCode($_POST['code']);
}

if (!$code) {
    error('Codigo obrigatorio');
}

if (!codeExists($code)) {
    json(['success' => true, 'deleted' => false, 'message' => 'Codigo nao encontrado']);
    exit;
}

deleteCodeDir($code);

json([
    'success' => true,
    'deleted' => true,
    'code' => $code,
]);
