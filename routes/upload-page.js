const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Envio de Fotos - Kiosk</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --yellow: #FFD500;
      --cyan: #00A6C0;
      --pink: #FF3B7A;
      --dark: #1A1A2E;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: #fff;
    }
    .container {
      background: rgba(255,255,255,0.06);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 24px;
      padding: 36px 28px;
      width: 100%;
      max-width: 460px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4);
    }
    .logo {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .logo-icon {
      width: 44px; height: 44px;
      background: linear-gradient(135deg, var(--yellow), #FFC300);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .logo-icon svg { width: 24px; height: 24px; }
    .logo-text {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.5px;
      background: linear-gradient(90deg, var(--yellow), #FFC300);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    h1 {
      font-size: 24px;
      font-weight: 800;
      margin-bottom: 6px;
      color: #fff;
    }
    .subtitle {
      font-size: 14px;
      color: rgba(255,255,255,0.6);
      margin-bottom: 28px;
      line-height: 1.5;
    }
    .upload-area {
      border: 2px dashed rgba(255,255,255,0.2);
      border-radius: 16px;
      padding: 36px 20px;
      margin-bottom: 20px;
      cursor: pointer;
      transition: all 0.3s;
      background: rgba(255,255,255,0.03);
    }
    .upload-area:hover, .upload-area.dragover {
      border-color: var(--yellow);
      background: rgba(255,213,0,0.06);
    }
    .upload-area.has-files {
      border-color: #4CAF50;
      background: rgba(76,175,80,0.08);
    }
    .upload-icon-wrap {
      width: 56px; height: 56px;
      background: rgba(255,255,255,0.08);
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 14px;
    }
    .upload-area p { color: rgba(255,255,255,0.6); font-size: 14px; margin: 0; }
    .upload-area .hint { font-size: 12px; color: rgba(255,255,255,0.35); margin-top: 6px; }
    input[type="file"] { display: none; }
    .file-list { text-align: left; margin-bottom: 16px; }
    .file-item {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px;
      background: rgba(255,255,255,0.06);
      border-radius: 10px;
      margin-bottom: 6px;
      font-size: 13px;
    }
    .file-item .name { color: #e0e0e0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px; }
    .file-item .size { color: rgba(255,255,255,0.4); font-size: 11px; margin-left: 8px; }
    .file-item .remove {
      color: var(--pink); cursor: pointer; font-weight: 700; font-size: 18px;
      line-height: 1; padding: 0 4px; opacity: 0.7; transition: opacity 0.2s;
    }
    .file-item .remove:hover { opacity: 1; }
    .btn {
      width: 100%; padding: 16px; border: none; border-radius: 14px;
      font-size: 16px; font-weight: 700; cursor: pointer;
      transition: all 0.2s;
      display: flex; align-items: center; justify-content: center; gap: 10px;
    }
    .btn-primary {
      background: linear-gradient(135deg, var(--yellow), #FFC300);
      color: #1A1A2E;
    }
    .btn-primary:hover { opacity: 0.9; transform: translateY(-1px); }
    .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
    .progress-bar {
      width: 100%; height: 4px;
      background: rgba(255,255,255,0.1);
      border-radius: 2px;
      margin: 12px 0;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--yellow), #FFC300);
      width: 0%;
      transition: width 0.3s;
      border-radius: 2px;
    }
    .result-box {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 20px;
      padding: 28px 24px;
      margin-top: 20px;
    }
    .result-box .check {
      width: 56px; height: 56px;
      background: linear-gradient(135deg, #4CAF50, #45a049);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 14px;
    }
    .result-box h2 {
      font-size: 14px; color: rgba(255,255,255,0.6);
      font-weight: 600; text-transform: uppercase; letter-spacing: 1px;
      margin-bottom: 4px;
    }
    .codigo {
      font-size: 44px; font-weight: 800; letter-spacing: 8px;
      color: var(--yellow); font-family: monospace;
    }
    .codigo-info { font-size: 13px; color: rgba(255,255,255,0.5); margin-top: 10px; }
    .hidden { display: none; }
    .error {
      background: rgba(244,67,54,0.12);
      border: 1px solid rgba(244,67,54,0.25);
      border-radius: 10px;
      padding: 12px 16px;
      color: #ef9a9a;
      margin-bottom: 16px;
      font-size: 14px;
    }
    .loading-spinner {
      display: inline-block;
      width: 18px; height: 18px;
      border: 2px solid rgba(26,26,46,0.2);
      border-top-color: #1A1A2E;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .footer { margin-top: 24px; font-size: 12px; color: rgba(255,255,255,0.2); }
  </style>
</head>
<body>
  <div class="container" id="app">
    <div class="logo">
      <div class="logo-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="#1A1A2E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
      </div>
      <span class="logo-text">Kiosk Fotos</span>
    </div>

    <h1>Envie suas Fotos</h1>
    <p class="subtitle">Selecione as fotos e receba um código para usar no totem</p>

    <div id="error" class="error hidden"></div>

    <div id="step-upload">
      <div class="upload-area" id="dropzone">
        <div class="upload-icon-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <p>Clique ou arraste as fotos aqui</p>
        <p class="hint">Até 50 fotos · Máx 50MB cada</p>
      </div>
      <input type="file" id="fileInput" multiple accept="image/*" />
      <div class="file-list" id="fileList"></div>
      <div class="progress-bar" id="progressBar">
        <div class="progress-fill" id="progressFill"></div>
      </div>
      <button class="btn btn-primary" id="btnUpload" disabled>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        Enviar Fotos
      </button>
    </div>

    <div id="step-result" class="hidden">
      <div class="result-box">
        <div class="check">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="28" height="28">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <h2>Seu código</h2>
        <div class="codigo" id="codigoDisplay">------</div>
        <p class="codigo-info" id="codigoExpire"></p>
      </div>
      <p style="margin-top: 20px; font-size: 13px; color: rgba(255,255,255,0.4);">
        Digite este código no totem para continuar
      </p>
    </div>

    <div class="footer">Kiosk Fotos &copy; 2026</div>
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
      if (selectedFiles.length === 0) {
        fileList.innerHTML = '';
        dropzone.classList.remove('has-files');
        btnUpload.disabled = true;
        restoreBtnText();
        return;
      }
      dropzone.classList.add('has-files');
      fileList.innerHTML = selectedFiles.map((f, i) =>
        '<div class="file-item"><span class="name">' + escHtml(f.name) + '</span><span class="size">' + formatSize(f.size) + '</span><span class="remove" onclick="removeFile(' + i + ')">&times;</span></div>'
      ).join('');
      btnUpload.disabled = false;
    }

    function escHtml(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
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

    function restoreBtnText() {
      btnUpload.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Enviar Fotos';
    }

    async function startUpload() {
      hideError();
      if (selectedFiles.length === 0) return;
      btnUpload.disabled = true;
      btnUpload.innerHTML = '<span class="loading-spinner"></span> Enviando...';
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
        restoreBtnText();
        setProgress(0);
      }
    }

    function showResult(code, expiresMin) {
      document.getElementById('step-upload').classList.add('hidden');
      document.getElementById('step-result').classList.remove('hidden');
      document.getElementById('codigoDisplay').textContent = code;
      document.getElementById('codigoExpire').textContent = 'C\u00f3digo v\u00e1lido por ' + expiresMin + ' minutos';
    }
  </script>
</body>
</html>`);
});

module.exports = router;
