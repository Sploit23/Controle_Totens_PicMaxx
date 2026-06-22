const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Envio de Fotos</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: system-ui, sans-serif; background:#f0f2f5; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; }
    .container { background:#fff; border-radius:16px; padding:40px; box-shadow:0 2px 20px rgba(0,0,0,0.1); width:100%; max-width:480px; text-align:center; }
    h1 { font-size:24px; margin-bottom:8px; color:#1a1a1a; }
    p { color:#666; margin-bottom:24px; font-size:15px; }
    .upload-area { border:2px dashed #ccc; border-radius:12px; padding:40px 20px; margin-bottom:20px; cursor:pointer; transition:all .2s; }
    .upload-area:hover, .upload-area.dragover { border-color:#007bff; background:#f0f7ff; }
    .upload-area.has-files { border-color:#28a745; background:#f0fff4; }
    .upload-icon { font-size:48px; margin-bottom:12px; }
    .upload-area p { color:#888; font-size:14px; margin:0; }
    .file-list { text-align:left; margin-bottom:16px; }
    .file-item { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:#f8f9fa; border-radius:6px; margin-bottom:6px; font-size:14px; }
    .file-item .name { color:#333; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:280px; }
    .file-item .size { color:#999; font-size:12px; margin-left:8px; }
    .file-item .remove { color:#dc3545; cursor:pointer; font-weight:700; font-size:18px; line-height:1; padding:0 4px; }
    input[type="file"] { display:none; }
    .btn { width:100%; padding:14px; border:none; border-radius:8px; font-size:16px; font-weight:600; cursor:pointer; transition:all .2s; }
    .btn-primary { background:#007bff; color:#fff; }
    .btn-primary:hover { background:#0056b3; }
    .btn-primary:disabled { background:#99c9ff; cursor:not-allowed; }
    .btn-success { background:#28a745; color:#fff; }
    .btn-success:hover { background:#1e7e34; }
    .codigo-box { background:#e8f5e9; border-radius:12px; padding:24px; margin-top:20px; }
    .codigo-box h2 { font-size:14px; color:#2e7d32; margin-bottom:8px; }
    .codigo { font-size:42px; font-weight:800; letter-spacing:6px; color:#1a5e1a; font-family:monospace; }
    .codigo-info { font-size:13px; color:#4a7c4a; margin-top:8px; }
    .hidden { display:none; }
    .error { background:#fde8e8; border-radius:8px; padding:12px; color:#c53030; margin-bottom:16px; font-size:14px; }
    .loading { display:inline-block; width:20px; height:20px; border:2px solid #fff; border-top-color:transparent; border-radius:50%; animation:spin .6s linear infinite; margin-right:8px; vertical-align:middle; }
    @keyframes spin { to { transform:rotate(360deg); } }
    .progress-bar { width:100%; height:4px; background:#e0e0e0; border-radius:2px; margin:12px 0; overflow:hidden; }
    .progress-fill { height:100%; background:#007bff; width:0%; transition:width .3s; border-radius:2px; }
  </style>
</head>
<body>
  <div class="container" id="app">
    <h1>Envie suas Fotos</h1>
    <p>Selecione as fotos para enviar e receba um codigo para usar no totem</p>

    <div id="error" class="error hidden"></div>

    <div id="step-upload">
      <div class="upload-area" id="dropzone" onclick="document.getElementById('fileInput').click()">
        <div class="upload-icon">📸</div>
        <p>Clique ou arraste as fotos aqui</p>
        <p style="font-size:12px;color:#aaa;margin-top:4px;">ate 50 fotos · max 50MB cada</p>
      </div>
      <input type="file" id="fileInput" multiple accept="image/*" />
      <div class="file-list" id="fileList"></div>
      <div class="progress-bar" id="progressBar">
        <div class="progress-fill" id="progressFill"></div>
      </div>
      <button class="btn btn-primary" id="btnUpload" disabled onclick="startUpload()">Enviar Fotos</button>
    </div>

    <div id="step-result" class="hidden">
      <div style="font-size:64px;margin-bottom:12px;">✅</div>
      <h2 style="color:#2e7d32;margin-bottom:4px;">Fotos enviadas com sucesso!</h2>
      <p style="color:#666;margin-bottom:20px;">Use o codigo abaixo no totem para imprimir suas fotos</p>
      <div class="codigo-box">
        <h2>SEU CODIGO</h2>
        <div class="codigo" id="codigoDisplay">------</div>
        <p class="codigo-info" id="codigoExpire"></p>
      </div>
      <p style="margin-top:20px;font-size:13px;color:#999;">Digite este codigo no totem para continuar</p>
    </div>
  </div>

  <script>
    const fileInput = document.getElementById('fileInput');
    const fileList = document.getElementById('fileList');
    const dropzone = document.getElementById('dropzone');
    const btnUpload = document.getElementById('btnUpload');
    const progressFill = document.getElementById('progressFill');
    const progressBar = document.getElementById('progressBar');
    const errorEl = document.getElementById('error');
    let selectedFiles = [];

    function showError(msg) { errorEl.textContent = msg; errorEl.classList.remove('hidden'); }
    function hideError() { errorEl.classList.add('hidden'); }

    fileInput.addEventListener('change', updateFiles);
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault(); dropzone.classList.remove('dragover');
      fileInput.files = e.dataTransfer.files;
      updateFiles();
    });

    function updateFiles() {
      selectedFiles = Array.from(fileInput.files).slice(0, 50);
      if (selectedFiles.length === 0) { fileList.innerHTML = ''; dropzone.classList.remove('has-files'); btnUpload.disabled = true; return; }
      dropzone.classList.add('has-files');
      fileList.innerHTML = selectedFiles.map((f, i) =>
        '<div class="file-item"><span class="name">' + f.name + '</span><span class="size">' + formatSize(f.size) + '</span><span class="remove" onclick="removeFile(' + i + ')">&times;</span></div>'
      ).join('');
      btnUpload.disabled = false;
    }

    function removeFile(i) {
      selectedFiles.splice(i, 1);
      const dt = new DataTransfer();
      selectedFiles.forEach(f => dt.items.add(f));
      fileInput.files = dt.files;
      updateFiles();
    }

    function formatSize(bytes) {
      if (bytes < 1024) return bytes + 'B';
      if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB';
      return (bytes / 1048576).toFixed(1) + 'MB';
    }

    function setProgress(pct) {
      progressFill.style.width = pct + '%';
    }

    async function startUpload() {
      hideError();
      if (selectedFiles.length === 0) return;
      btnUpload.disabled = true;
      btnUpload.innerHTML = '<span class="loading"></span> Enviando...';
      setProgress(0);

      try {
        const startRes = await fetch('/api/upload/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}'
        });
        const startData = await startRes.json();
        if (!startData.success) { throw new Error(startData.error); }

        const code = startData.code;
        setProgress(20);

        const formData = new FormData();
        formData.append('code', code);
        selectedFiles.forEach(f => formData.append('photos', f));

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/upload/photos', true);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(20 + (e.loaded / e.total) * 70);
        };

        const result = await new Promise((resolve, reject) => {
          xhr.onload = () => {
            try { resolve(JSON.parse(xhr.responseText)); }
            catch { reject(new Error('Erro ao processar resposta')); }
          };
          xhr.onerror = () => reject(new Error('Erro de conexao'));
          xhr.send(formData);
        });

        if (!result.success) { throw new Error(result.error); }

        setProgress(100);
        showResult(code, startData.expiresInMinutes);
      } catch (e) {
        showError(e.message || 'Erro ao enviar fotos');
        btnUpload.disabled = false;
        btnUpload.textContent = 'Enviar Fotos';
        setProgress(0);
      }
    }

    function showResult(code, expiresMin) {
      document.getElementById('step-upload').classList.add('hidden');
      document.getElementById('step-result').classList.remove('hidden');
      document.getElementById('codigoDisplay').textContent = code;
      document.getElementById('codigoExpire').textContent = 'Codigo valido por ' + expiresMin + ' minutos';
    }
  </script>
</body>
</html>`);
});

module.exports = router;
