const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Envio de Fotos</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    :root {
      --cyan: #00BCD4;
      --cyan-dark: #0097A7;
      --yellow: #FFD500;
      --yellow-dark: #FFC107;
      --pink: #FF3B7A;
      --dark: #1a1a2e;
      --gray-50: #f8f9fa;
      --gray-100: #f1f3f5;
      --gray-200: #e9ecef;
      --gray-300: #dee2e6;
      --gray-600: #868e96;
      --gray-800: #343a40;
      --gray-900: #212529;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--gray-50);
      min-height: 100vh;
      color: var(--gray-900);
      -webkit-font-smoothing: antialiased;
    }

    /* Hero Header */
    .hero {
      background: linear-gradient(135deg, #006064 0%, #00838F 30%, #00BCD4 70%, #26C6DA 100%);
      padding: 48px 24px 56px;
      text-align: center;
      position: relative;
      overflow: hidden;
    }
    .hero::before {
      content: '';
      position: absolute;
      top: -60%;
      left: -20%;
      width: 140%;
      height: 140%;
      background: radial-gradient(ellipse at 30% 50%, rgba(255,213,0,0.12) 0%, transparent 60%);
      pointer-events: none;
    }
    .hero::after {
      content: '';
      position: absolute;
      bottom: -30%;
      right: -20%;
      width: 120%;
      height: 120%;
      background: radial-gradient(ellipse at 70% 50%, rgba(255,59,122,0.08) 0%, transparent 50%);
      pointer-events: none;
    }
    .hero-icon {
      width: 64px; height: 64px;
      background: rgba(255,255,255,0.2);
      backdrop-filter: blur(8px);
      border-radius: 20px;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 18px;
      position: relative;
    }
    .hero-icon svg { width: 30px; height: 30px; stroke: #fff; }
    .hero h1 {
      font-size: 28px;
      font-weight: 800;
      color: #fff;
      letter-spacing: -0.5px;
      position: relative;
    }
    .hero p {
      font-size: 15px;
      color: rgba(255,255,255,0.75);
      margin-top: 8px;
      line-height: 1.5;
      position: relative;
    }

    /* Content */
    .content {
      padding: 0 20px 32px;
      margin-top: -24px;
      position: relative;
      z-index: 2;
    }

    .card {
      background: #fff;
      border-radius: 20px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.06);
      padding: 28px 24px;
      margin-bottom: 16px;
    }

    /* Upload Area */
    .upload-area {
      border: 2px dashed var(--gray-300);
      border-radius: 16px;
      padding: 40px 20px;
      text-align: center;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      background: var(--gray-50);
      position: relative;
    }
    .upload-area:hover, .upload-area.dragover {
      border-color: var(--cyan);
      background: rgba(0,188,212,0.04);
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0,188,212,0.1);
    }
    .upload-area.has-files {
      border-color: #4CAF50;
      background: rgba(76,175,80,0.04);
      padding: 24px 20px;
    }
    .upload-icon {
      width: 64px; height: 64px;
      background: linear-gradient(135deg, var(--cyan), var(--cyan-dark));
      border-radius: 18px;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 16px;
      transition: transform 0.3s;
      box-shadow: 0 4px 12px rgba(0,188,212,0.25);
    }
    .upload-area:hover .upload-icon {
      transform: scale(1.05);
    }
    .upload-icon svg { width: 28px; height: 28px; stroke: #fff; }
    .upload-area .label {
      font-size: 16px;
      font-weight: 600;
      color: var(--gray-800);
    }
    .upload-area .hint {
      font-size: 13px;
      color: var(--gray-600);
      margin-top: 6px;
    }
    .upload-area .browse-link {
      color: var(--cyan);
      font-weight: 600;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    input[type="file"] { display: none; }

    /* Photo Grid */
    .photo-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
      gap: 8px;
      margin-top: 0;
    }
    .photo-thumb {
      position: relative;
      aspect-ratio: 1;
      border-radius: 10px;
      overflow: hidden;
      background: var(--gray-100);
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }
    .photo-thumb img {
      width: 100%; height: 100%;
      object-fit: cover;
    }
    .photo-thumb .remove {
      position: absolute;
      top: 4px; right: 4px;
      width: 22px; height: 22px;
      background: rgba(0,0,0,0.6);
      border: none;
      border-radius: 50%;
      color: #fff;
      font-size: 14px;
      line-height: 22px;
      text-align: center;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.2s;
      padding: 0;
    }
    .photo-thumb:hover .remove { opacity: 1; }
    .photo-thumb .remove:hover { background: var(--pink); }
    .photo-count {
      font-size: 13px;
      font-weight: 500;
      color: var(--gray-600);
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* Upload Button */
    .btn-upload {
      width: 100%;
      padding: 18px 24px;
      border: none;
      border-radius: 14px;
      font-size: 17px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      background: linear-gradient(135deg, var(--yellow), var(--yellow-dark));
      color: var(--dark);
      box-shadow: 0 4px 16px rgba(255,213,0,0.3);
    }
    .btn-upload:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(255,213,0,0.4);
    }
    .btn-upload:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }
    .btn-upload svg { width: 20px; height: 20px; }

    /* Progress */
    .progress-wrap {
      width: 100%;
      height: 6px;
      background: var(--gray-100);
      border-radius: 3px;
      overflow: hidden;
      margin: 16px 0 0;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--cyan), var(--yellow));
      width: 0%;
      transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      border-radius: 3px;
    }
    .progress-text {
      font-size: 13px;
      color: var(--gray-600);
      font-weight: 500;
      text-align: center;
      margin-top: 8px;
    }

    /* Result Screen */
    .result {
      text-align: center;
      padding: 16px 0;
    }
    .result-check {
      width: 72px; height: 72px;
      background: linear-gradient(135deg, #4CAF50, #43A047);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 20px;
      box-shadow: 0 8px 24px rgba(76,175,80,0.3);
      animation: popIn 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
    }
    .result-check svg { width: 34px; height: 34px; stroke: #fff; }
    .result h2 {
      font-size: 14px;
      color: var(--gray-600);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 2px;
      margin-bottom: 8px;
    }
    .result-code {
      font-size: 48px;
      font-weight: 900;
      letter-spacing: 10px;
      font-family: 'Inter', monospace;
      background: linear-gradient(135deg, var(--cyan), var(--cyan-dark));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin: 0 -8px;
      animation: popIn 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55) 0.1s both;
    }
    .result-info {
      font-size: 14px;
      color: var(--gray-600);
      margin-top: 16px;
      line-height: 1.5;
    }
    .result-info strong { color: var(--gray-800); }
    .result-tip {
      margin-top: 20px;
      padding: 16px;
      background: rgba(0,188,212,0.06);
      border-radius: 12px;
      font-size: 13px;
      color: var(--gray-600);
      line-height: 1.5;
    }
    .result-tip strong { color: var(--cyan); }

    /* Error */
    .error {
      background: rgba(244,67,54,0.08);
      border: 1px solid rgba(244,67,54,0.15);
      border-radius: 12px;
      padding: 14px 18px;
      color: #c62828;
      margin-bottom: 16px;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    /* Spinner */
    .spinner {
      display: inline-block;
      width: 20px; height: 20px;
      border: 2px solid rgba(26,26,46,0.15);
      border-top-color: var(--dark);
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }

    /* Animations */
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes popIn {
      0% { transform: scale(0); opacity: 0; }
      100% { transform: scale(1); opacity: 1; }
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes pulse {
      0%, 100% { box-shadow: 0 4px 12px rgba(0,188,212,0.25); }
      50% { box-shadow: 0 4px 24px rgba(0,188,212,0.4); }
    }
    .slide-up { animation: slideUp 0.4s ease both; }
    .hidden { display: none !important; }

    /* Spacing helpers */
    .mt-16 { margin-top: 16px; }

    /* Footer */
    .footer {
      text-align: center;
      font-size: 12px;
      color: var(--gray-600);
      padding: 8px 0 4px;
    }

    /* Responsive */
    @media (min-width: 480px) {
      .hero { padding: 56px 32px 64px; }
      .hero h1 { font-size: 32px; }
      .content { padding: 0 24px 40px; }
      .card { padding: 32px 28px; }
      .photo-grid { grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); }
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --gray-50: #1a1a2e;
        --gray-100: #222240;
        --gray-200: #2a2a4a;
        --gray-300: #3a3a5a;
        --gray-600: #9a9ab0;
        --gray-800: #d0d0e0;
        --gray-900: #eeeef8;
      }
      body { background: var(--gray-50); }
      .card { background: #252545; box-shadow: 0 4px 24px rgba(0,0,0,0.2); }
      .upload-area { background: rgba(255,255,255,0.03); }
      .upload-area:hover, .upload-area.dragover { background: rgba(0,188,212,0.06); }
      .progress-wrap { background: var(--gray-200); }
      .photo-thumb { background: var(--gray-200); }
      .error { background: rgba(244,67,54,0.12); color: #ef9a9a; }
      .result-tip { background: rgba(0,188,212,0.08); }
    }
  </style>
</head>
<body>
  <div class="hero">
    <div class="hero-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
    </div>
    <h1>Envie suas Fotos</h1>
    <p>Escolha as fotos do seu celular e receba um código para usar no totem</p>
  </div>

  <div class="content">
    <div id="step-upload" class="card" style="animation: slideUp 0.4s ease both;">
      <div id="error" class="error hidden">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        <span id="errorText"></span>
      </div>

      <div class="upload-area" id="dropzone">
        <div class="upload-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <div class="label">Arraste as fotos aqui ou <span class="browse-link">busque no celular</span></div>
        <div class="hint">Até 50 fotos · Máx 50MB cada · Formatos JPG e PNG</div>
      </div>
      <input type="file" id="fileInput" multiple accept="image/*" />

      <div id="fileSection" class="hidden mt-16">
        <div class="photo-count" id="photoCount"></div>
        <div class="photo-grid" id="photoGrid"></div>
      </div>

      <div class="progress-wrap hidden" id="progressWrap">
        <div class="progress-fill" id="progressFill"></div>
      </div>
      <div class="progress-text hidden" id="progressText"></div>

      <button class="btn-upload mt-16" id="btnUpload" disabled>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        Enviar Fotos
      </button>
    </div>

    <div id="step-result" class="card hidden" style="animation: slideUp 0.4s ease both;">
      <div class="result">
        <div class="result-check">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <h2>Fotos recebidas!</h2>
        <div class="result-code" id="codigoDisplay">------</div>
        <div class="result-info" id="codigoExpire"></div>
        <div class="result-tip">
          <strong>💡 Dica:</strong> Digite este código no teclado do totem para imprimir suas fotos
        </div>
      </div>
    </div>

    <div class="footer">Kiosk Fotos &mdash; Maxx Revelar</div>
  </div>

  <script>
    const fileInput = document.getElementById('fileInput');
    const dropzone = document.getElementById('dropzone');
    const fileSection = document.getElementById('fileSection');
    const photoGrid = document.getElementById('photoGrid');
    const photoCount = document.getElementById('photoCount');
    const btnUpload = document.getElementById('btnUpload');
    const progressFill = document.getElementById('progressFill');
    const progressWrap = document.getElementById('progressWrap');
    const progressText = document.getElementById('progressText');
    const errorEl = document.getElementById('error');
    const errorText = document.getElementById('errorText');
    let selectedFiles = [];

    function showError(msg) { errorText.textContent = msg; errorEl.classList.remove('hidden'); }
    function hideError() { errorEl.classList.add('hidden'); }

    fileInput.addEventListener('change', handleFiles);
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault(); dropzone.classList.remove('dragover');
      fileInput.files = e.dataTransfer.files;
      handleFiles();
    });
    dropzone.addEventListener('click', () => fileInput.click());

    function handleFiles() {
      selectedFiles = Array.from(fileInput.files).slice(0, 50);
      if (selectedFiles.length === 0) {
        fileSection.classList.add('hidden');
        dropzone.classList.remove('has-files');
        btnUpload.disabled = true;
        restoreBtnText();
        return;
      }
      dropzone.classList.add('has-files');
      fileSection.classList.remove('hidden');
      photoCount.textContent = '📸 ' + selectedFiles.length + ' foto' + (selectedFiles.length > 1 ? 's' : '') + ' selecionada' + (selectedFiles.length > 1 ? 's' : '');
      renderThumbs();
      btnUpload.disabled = false;
    }

    function renderThumbs() {
      photoGrid.innerHTML = '';
      selectedFiles.forEach((f, i) => {
        const thumb = document.createElement('div');
        thumb.className = 'photo-thumb';
        thumb.style.animationDelay = (i * 0.05) + 's';
        thumb.style.animation = 'slideUp 0.3s ease both';
        thumb.style.animationDelay = (i * 0.03) + 's';
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        img.alt = f.name;
        const btn = document.createElement('button');
        btn.className = 'remove';
        btn.textContent = '×';
        btn.onclick = (e) => {
          e.stopPropagation();
          removeFile(i);
        };
        thumb.appendChild(img);
        thumb.appendChild(btn);
        photoGrid.appendChild(thumb);
      });
    }

    function removeFile(i) {
      selectedFiles.splice(i, 1);
      const dt = new DataTransfer();
      selectedFiles.forEach(f => dt.items.add(f));
      fileInput.files = dt.files;
      handleFiles();
    }

    function setProgress(pct) {
      progressWrap.classList.remove('hidden');
      progressText.classList.remove('hidden');
      progressFill.style.width = pct + '%';
      progressText.textContent = pct < 100 ? 'Enviando... ' + Math.round(pct) + '%' : 'Finalizando...';
    }

    function restoreBtnText() {
      btnUpload.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Enviar Fotos';
    }

    btnUpload.addEventListener('click', startUpload);

    async function startUpload() {
      hideError();
      if (selectedFiles.length === 0) return;
      btnUpload.disabled = true;
      btnUpload.innerHTML = '<span class="spinner"></span> Enviando...';
      setProgress(0);

      try {
        const startRes = await fetch('/api/upload/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}'
        });
        const startData = await startRes.json();
        if (!startData.success) { throw new Error(startData.error || 'Erro ao iniciar upload'); }

        const code = startData.code;
        setProgress(15);

        const formData = new FormData();
        formData.append('code', code);
        selectedFiles.forEach(f => formData.append('photos', f));

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/upload/photos', true);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(15 + (e.loaded / e.total) * 75);
        };

        const result = await new Promise((resolve, reject) => {
          xhr.onload = () => {
            try { resolve(JSON.parse(xhr.responseText)); }
            catch { reject(new Error('Erro ao processar resposta do servidor')); }
          };
          xhr.onerror = () => reject(new Error('Erro de conexão com o servidor'));
          xhr.send(formData);
        });

        if (!result.success) { throw new Error(result.error || 'Erro ao enviar fotos'); }

        setProgress(100);
        progressText.textContent = '✔ Enviado!';
        setTimeout(() => showCode(code, startData.expiresInMinutes), 300);
      } catch (e) {
        showError(e.message || 'Erro ao enviar fotos. Tente novamente.');
        btnUpload.disabled = false;
        restoreBtnText();
        progressWrap.classList.add('hidden');
        progressText.classList.add('hidden');
        progressFill.style.width = '0%';
      }
    }

    function showCode(code, expiresMin) {
      document.getElementById('step-upload').classList.add('hidden');
      document.getElementById('step-result').classList.remove('hidden');
      document.getElementById('codigoDisplay').textContent = code;
      document.getElementById('codigoExpire').innerHTML = 'Código válido por <strong>' + expiresMin + ' minutos</strong>';
      // Cleanup object URLs
      selectedFiles.forEach(f => { try { URL.revokeObjectURL(f); } catch(e) {} });
    }
  </script>
</body>
</html>`);
});

module.exports = router;
