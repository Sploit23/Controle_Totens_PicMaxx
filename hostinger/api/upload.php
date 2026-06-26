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
$failed = [];
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
    if (!extension_loaded('fileinfo')) return false;
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    if (!$finfo) return false;
    $mime = finfo_file($finfo, $tmpPath);
    finfo_close($finfo);
    return $mime && in_array($mime, ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);
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

function guessMimeType($tmpPath) {
    if (extension_loaded('fileinfo')) {
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        if ($finfo) {
            $mime = finfo_file($finfo, $tmpPath);
            finfo_close($finfo);
            if ($mime) return $mime;
        }
    }
    // fallback: tenta pela extensão original
    return null;
}

for ($i = 0; $i < $fileCount; $i++) {
    $name = is_array($files['name']) ? $files['name'][$i] : $files['name'];
    $tmp = is_array($files['tmp_name']) ? $files['tmp_name'][$i] : $files['tmp_name'];
    $size = is_array($files['size']) ? $files['size'][$i] : $files['size'];
    $error = is_array($files['error']) ? $files['error'][$i] : $files['error'];

    $reason = null;

    if ($error !== UPLOAD_ERR_OK) {
        $reason = 'upload_error_' . $error;
        $failed[] = ['file' => $name, 'reason' => $reason];
        continue;
    }
    if ($size > $maxFileSize) {
        $reason = 'arquivo_excede_50MB';
        $failed[] = ['file' => $name, 'reason' => $reason];
        continue;
    }

    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));

    if (isHeic($tmp, $name)) {
        $filename = time() . '_' . $uploaded . '_' . bin2hex(random_bytes(4)) . '.jpg';
        $dest = $targetDir . '/' . $filename;
        if (convertHeicToJpeg($tmp, $dest)) {
            $uploaded++;
        } elseif (move_uploaded_file($tmp, $targetDir . '/' . time() . '_' . $uploaded . '_' . bin2hex(random_bytes(4)) . '.heic')) {
            $uploaded++;
        } else {
            $failed[] = ['file' => $name, 'reason' => 'falha_ao_salvar_heic'];
        }
        continue;
    }

    $allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    $mime = guessMimeType($tmp);

    if ($mime && !in_array($mime, $allowedMimes)) {
        $failed[] = ['file' => $name, 'reason' => 'tipo_nao_suportado:' . $mime];
        continue;
    }

    if (!in_array($ext, ['jpg', 'jpeg', 'png', 'webp'])) {
        if ($mime) {
            $ext = match ($mime) {
                'image/jpeg' => 'jpg',
                'image/png' => 'png',
                'image/webp' => 'webp',
                default => 'jpg',
            };
        } else {
            $ext = 'jpg';
        }
    }

    $filename = time() . '_' . $uploaded . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
    $dest = $targetDir . '/' . $filename;

    if (move_uploaded_file($tmp, $dest)) {
        $uploaded++;
    } else {
        $failed[] = ['file' => $name, 'reason' => 'falha_ao_mover'];
    }
}

if ($uploaded === 0) {
    error('Nenhuma foto valida foi enviada');
}

json([
    'success' => true,
    'received' => $fileCount,
    'photos' => $uploaded,
    'failed' => $failed,
    'code' => $code,
]);
