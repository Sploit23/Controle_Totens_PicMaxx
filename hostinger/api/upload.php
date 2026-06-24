<?php
require_once __DIR__ . '/helpers.php';
cors();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    error('Metodo nao permitido', 405);
}

jsonHeader();

$code = isset($_POST['code']) ? sanitizeCode($_POST['code']) : '';
if (!$code) {
    error('Codigo obrigatorio');
}

if (!codeExists($code)) {
    error('Codigo invalido', 404);
}

$meta = getCodeMeta($code);
if ($meta['used']) {
    error('Codigo ja utilizado');
}

if (isCodeExpired($code)) {
    error('Codigo expirado');
}

$files = $_FILES['photos'] ?? null;
if (!$files) {
    $files = $_FILES['photo'] ?? null;
}

if (!$files) {
    error('Nenhuma foto enviada');
}

$uploaded = 0;
$maxFileSize = 50 * 1024 * 1024;
$maxFiles = 50;
$targetDir = codeDir($code);

$fileCount = is_array($files['name']) ? count($files['name']) : 1;
if ($fileCount > $maxFiles) {
    error('Maximo de ' . $maxFiles . ' fotos por vez');
}

function isHeic($tmpPath, $origName) {
    $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
    if (in_array($ext, ['heic', 'heif'])) return true;
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime = finfo_file($finfo, $tmpPath);
    finfo_close($finfo);
    return in_array($mime, ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);
}

function convertHeicToJpeg($tmpPath, $destPath) {
    if (extension_loaded('imagick')) {
        try {
            $img = new Imagick($tmpPath);
            $img->setImageFormat('jpeg');
            $img->setImageCompressionQuality(92);
            $img->stripImage();
            $img->writeImage($destPath);
            $img->clear();
            return true;
        } catch (Exception $e) {
            return false;
        }
    }
    return false;
}

for ($i = 0; $i < $fileCount; $i++) {
    $name = is_array($files['name']) ? $files['name'][$i] : $files['name'];
    $tmp = is_array($files['tmp_name']) ? $files['tmp_name'][$i] : $files['tmp_name'];
    $size = is_array($files['size']) ? $files['size'][$i] : $files['size'];
    $error = is_array($files['error']) ? $files['error'][$i] : $files['error'];

    if ($error !== UPLOAD_ERR_OK) continue;
    if ($size > $maxFileSize) continue;

    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));

    if (isHeic($tmp, $name)) {
        $filename = time() . '_' . $uploaded . '_' . bin2hex(random_bytes(4)) . '.jpg';
        $dest = $targetDir . '/' . $filename;
        if (convertHeicToJpeg($tmp, $dest)) {
            $uploaded++;
        } elseif (move_uploaded_file($tmp, $targetDir . '/' . time() . '_' . $uploaded . '_' . bin2hex(random_bytes(4)) . '.heic')) {
            $uploaded++;
        }
        continue;
    }

    $allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime = finfo_file($finfo, $tmp);
    finfo_close($finfo);
    if (!in_array($mime, $allowedMimes)) continue;

    if (!in_array($ext, ['jpg', 'jpeg', 'png', 'webp'])) {
        $ext = match ($mime) {
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
            default => 'jpg',
        };
    }

    $filename = time() . '_' . $uploaded . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
    $dest = $targetDir . '/' . $filename;

    if (move_uploaded_file($tmp, $dest)) {
        $uploaded++;
    }
}

if ($uploaded === 0) {
    error('Nenhuma foto valida foi enviada');
}

json([
    'success' => true,
    'photos' => $uploaded,
    'code' => $code,
]);
