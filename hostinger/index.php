<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Revele Agora | Maxx Print</title>
<style>
*{ margin:0; padding:0; box-sizing:border-box; }
body{
  font-family: Arial, Helvetica, sans-serif;
  background:#ffffff;
  color:#222;
  min-height:100vh;
  display:flex;
  flex-direction:column;
  align-items:center;
}
.topbar{
  width:100%; max-width:700px; padding:20px 24px 0;
  display:flex; align-items:center; justify-content:space-between;
}
.logo{ max-width:220px; width:100%; }
.lang-wrap{ position:relative; }
.lang-btn{
  padding:8px 14px; font-size:13px; font-weight:600;
  border:1.5px solid #ddd; border-radius:20px; cursor:pointer;
  background:#fff; color:#555; display:flex; align-items:center; gap:6px;
  transition:0.2s;
}
.lang-btn:hover{ border-color:#d8232a; }
.lang-dropdown{
  position:absolute; top:calc(100% + 4px); right:0;
  background:#fff; border-radius:10px;
  box-shadow:0 8px 24px rgba(0,0,0,0.1);
  overflow:hidden; min-width:130px; z-index:100; display:none;
}
.lang-dropdown.open{ display:block; }
.lang-dropdown button{
  width:100%; padding:10px 16px; font-size:13px; font-weight:600;
  border:none; cursor:pointer; text-align:left; background:#fff;
  color:#555; transition:0.15s;
}
.lang-dropdown button:hover{ background:#fff5f5; }
.lang-dropdown button.active{ background:#fff5f5; color:#d8232a; }
.container{ max-width:700px; padding:20px 40px 40px; width:100%; text-align:center; }
h1{
  font-size:36px; color:#111; margin-bottom:8px;
  font-weight:bold;
}
.subtitle{
  font-size:18px; color:#d8232a; font-weight:bold;
  margin-bottom:30px;
}
.card{
  background:#fff; border-radius:16px;
  box-shadow:0 2px 16px rgba(0,0,0,0.06);
  padding:28px 24px; margin-bottom:16px; text-align:left;
}
.upload-area{
  border:2px dashed #ddd; border-radius:14px;
  padding:36px 20px; text-align:center; cursor:pointer;
  transition:0.3s; background:#fafafa; position:relative;
}
.upload-area:hover, .upload-area.dragover{
  border-color:#d8232a; background:#fff5f5;
  transform:translateY(-1px);
}
.upload-area.has-files{
  border-color:#4CAF50; background:rgba(76,175,80,0.04);
  padding:20px;
}
.upload-icon{
  width:56px; height:56px;
  background:#d8232a; border-radius:16px;
  display:flex; align-items:center; justify-content:center;
  margin:0 auto 14px;
  box-shadow:0 4px 12px rgba(216,35,42,0.2);
}
.upload-icon svg{ width:24px; height:24px; stroke:#fff; }
.upload-area .label{ font-size:15px; font-weight:600; color:#333; }
.upload-area .hint{ font-size:13px; color:#888; margin-top:6px; }
.upload-area .browse-link{ color:#d8232a; font-weight:600; text-decoration:underline; text-underline-offset:2px; }
input[type="file"]{ display:none; }
.photo-grid{
  display:grid;
  grid-template-columns:repeat(auto-fill, minmax(76px, 1fr));
  gap:8px; margin-top:0;
}
.photo-thumb{
  position:relative; aspect-ratio:1; border-radius:10px;
  overflow:hidden; background:#f0f0f0;
}
.photo-thumb img{ width:100%; height:100%; object-fit:cover; }
.photo-thumb .remove{
  position:absolute; top:3px; right:3px;
  width:20px; height:20px; background:rgba(0,0,0,0.5);
  border:none; border-radius:50%; color:#fff;
  font-size:13px; line-height:20px; text-align:center;
  cursor:pointer; opacity:0; transition:opacity 0.2s; padding:0;
}
.photo-thumb:hover .remove{ opacity:1; }
.photo-thumb .remove:hover{ background:#d8232a; }
.photo-count{
  font-size:13px; font-weight:500; color:#888;
  margin-bottom:10px;
}
.btn-upload{
  width:100%; padding:16px 24px; border:none; border-radius:12px;
  font-size:16px; font-weight:700; cursor:pointer;
  display:flex; align-items:center; justify-content:center; gap:8px;
  background:#d8232a; color:#fff;
  transition:0.2s;
}
.btn-upload:hover:not(:disabled){
  background:#c41e24; transform:translateY(-1px);
}
.btn-upload:disabled{ opacity:0.4; cursor:not-allowed; transform:none; }
.btn-upload svg{ width:18px; height:18px; }
.progress-wrap{
  width:100%; height:5px; background:#f0f0f0;
  border-radius:3px; overflow:hidden; margin:14px 0 0;
}
.progress-fill{
  height:100%; background:#d8232a;
  width:0%; transition:width 0.4s; border-radius:3px;
}
.progress-text{
  font-size:13px; color:#888; font-weight:500;
  text-align:center; margin-top:8px;
}
.result{ text-align:center; padding:4px 0; }
.result-check{
  width:64px; height:64px; background:#4CAF50; border-radius:50%;
  display:flex; align-items:center; justify-content:center;
  margin:0 auto 18px;
  box-shadow:0 6px 20px rgba(76,175,80,0.3);
  animation:popIn 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
}
.result-check svg{ width:30px; height:30px; stroke:#fff; }
.result h2{
  font-size:13px; color:#888; font-weight:600;
  text-transform:uppercase; letter-spacing:2px; margin-bottom:8px;
}
@keyframes neonGlow {
  0%, 100% { box-shadow: 0 0 8px #d8232a, 0 0 16px #d8232a, 0 0 32px rgba(216,35,42,0.4); border-color:#d8232a; }
  50% { box-shadow: 0 0 16px #d8232a, 0 0 32px #d8232a, 0 0 48px rgba(216,35,42,0.6); border-color:#ff4d4d; }
}
.result-code{
  font-size:56px; font-weight:900; letter-spacing:12px;
  font-family:Arial, monospace;
  color:#fff;
  background:#111; border:2px solid #d8232a; border-radius:16px;
  padding:20px 32px; display:inline-block;
  margin:0 auto;
  animation:popIn 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55) 0.1s both, neonGlow 2s ease-in-out infinite;
}
.result-info{ font-size:14px; color:#888; margin-top:14px; line-height:1.5; }
.result-info strong{ color:#333; }
.result-count{ font-size:18px; color:var(--accent); font-weight:700; margin-bottom:4px; }
.result-tip{
  margin-top:18px; padding:14px;
  background:#fff5f5; border-radius:10px;
  font-size:13px; color:#666; line-height:1.5;
}
.result-tip strong{ color:#d8232a; }
.error{
  background:#fff5f5; border:1px solid rgba(216,35,42,0.15);
  border-radius:10px; padding:12px 16px; color:#c62828;
  margin-bottom:14px; font-size:13px;
  display:flex; align-items:center; gap:8px;
}
.spinner{
  display:inline-block; width:18px; height:18px;
  border:2px solid rgba(255,255,255,0.3);
  border-top-color:#fff; border-radius:50%;
  animation:spin 0.6s linear infinite;
}
@keyframes spin{ to{ transform:rotate(360deg); } }
@keyframes popIn{
  0%{ transform:scale(0); opacity:0; }
  100%{ transform:scale(1); opacity:1; }
}
@keyframes slideUp{
  from{ opacity:0; transform:translateY(16px); }
  to{ opacity:1; transform:translateY(0); }
}
.hidden{ display:none !important; }
.mt-14{ margin-top:14px; }
.links{ margin-top:24px; font-size:13px; color:#888; }
.links a{ color:#888; text-decoration:none; margin:0 10px; transition:0.3s; }
.links a:hover{ color:#d8232a; }
footer{ font-size:13px; color:#888; margin-top:20px; padding-bottom:10px; }
footer strong{ color:#333; }
.new-upload{
  display:inline-block; margin-top:18px; padding:12px 24px;
  font-size:14px; font-weight:700; border:2px solid #d8232a;
  border-radius:24px; background:transparent; color:#d8232a;
  cursor:pointer; transition:0.2s;
}
.new-upload:hover{ background:#d8232a; color:#fff; }
@media(max-width:480px){
  .container{ padding:16px 20px 24px; }
  h1{ font-size:28px; }
  .logo{ max-width:160px; }
  .card{ padding:20px 16px; }
  .photo-grid{ grid-template-columns:repeat(auto-fill, minmax(64px, 1fr)); }
  .result-code{ font-size:40px; letter-spacing:8px; padding:14px 20px; }
  @keyframes neonGlow {
    0%, 100% { box-shadow: 0 0 6px #d8232a, 0 0 12px #d8232a; border-color:#d8232a; }
    50% { box-shadow: 0 0 12px #d8232a, 0 0 24px #d8232a; border-color:#ff4d4d; }
  }
}
</style>
</head>
<body>

<div class="topbar">
  <img src="logo.png" alt="Maxx Print" class="logo" onerror="this.style.display='none'">
  <div class="lang-wrap">
    <button class="lang-btn" onclick="toggleLang()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      <span id="langLabel">Português</span>
      <span style="font-size:10px">▼</span>
    </button>
    <div class="lang-dropdown" id="langDropdown">
      <button onclick="setLang('pt')" class="active" data-lang="pt">Português</button>
      <button onclick="setLang('en')" data-lang="en">English</button>
      <button onclick="setLang('es')" data-lang="es">Español</button>
    </div>
  </div>
</div>

<div class="container">
  <h1 id="heroTitle">Envie suas Fotos</h1>
  <div class="subtitle" id="heroSub">Escolha as fotos e receba um código para usar no totem</div>

  <div id="step-upload" class="card" style="animation:slideUp 0.4s ease both;">
    <div id="error" class="error hidden">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
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
      <div class="label" id="dropLabel">Arraste as fotos aqui ou <span class="browse-link" id="browseLink">busque no celular</span></div>
      <div class="hint" id="dropHint">Até 50 fotos · Máx 50MB cada · Formatos JPG, PNG, WEBP e HEIC</div>
    </div>
    <input type="file" id="fileInput" multiple accept="image/*,.heic,.heif" />

    <div id="fileSection" class="hidden mt-14">
      <div class="photo-count" id="photoCount"></div>
      <div class="photo-grid" id="photoGrid"></div>
    </div>

    <div class="progress-wrap hidden" id="progressWrap">
      <div class="progress-fill" id="progressFill"></div>
    </div>
    <div class="progress-text hidden" id="progressText"></div>

    <button class="btn-upload mt-14" id="btnUpload" disabled>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      <span id="btnLabel">Enviar Fotos</span>
    </button>
  </div>

  <div id="step-result" class="card hidden" style="animation:slideUp 0.4s ease both;">
    <div class="result">
      <div class="result-check">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <h2 id="resultHeading">Fotos recebidas!</h2>
      <div class="result-code" id="codigoDisplay">------</div>
      <div class="result-count" id="codigoCount"></div>
      <div class="result-info" id="codigoExpire"></div>
      <div class="result-tip" id="resultTip">
        <strong id="tipLabel">Dica:</strong> <span id="tipText">Digite este código no teclado do totem para imprimir suas fotos</span>
      </div>
      <button class="new-upload" id="newUploadBtn">Enviar mais fotos</button>
      <button class="new-upload" id="resetUploadBtn" style="margin-top:8px;background:transparent;color:var(--accent);border:1px solid var(--accent);">Recomeçar (novo código)</button>
    </div>
  </div>

  <div class="links">
    <a href="Termo/termos.html">Termos de Uso</a>
    |
    <a href="Termo/privacidade.html">Política de Privacidade</a>
  </div>

  <footer>
    &copy; 2026 <strong>Maxx Print</strong><br>
    reveleagora.com.br
  </footer>
</div>

<script>
const LANG_NATIVE = { pt:'Portugu\u00eas', en:'English', es:'Espa\u00f1ol' };
const LANG_DATA = {
  pt:{
    heroTitle:'Envie suas Fotos',
    heroSub:'Escolha as fotos e receba um c\u00f3digo para usar no totem',
    dropLabel:'Arraste as fotos aqui ou',
    browseLink:'busque no celular',
    dropHint:'At\u00e9 50 fotos \u00b7 M\u00e1x 50MB cada \u00b7 Formatos JPG, PNG, WEBP e HEIC',
    btnLabel:'Enviar Fotos',
    uploading:'Enviando...',
    finalizing:'Finalizando...',
    sent:'Enviado!',
    resultHeading:'Fotos recebidas!',
    resultExpire:'C\u00f3digo v\u00e1lido por <strong>24 horas</strong>',
    tipLabel:'Dica:',
    tipText:'Digite este c\u00f3digo no teclado do totem para imprimir suas fotos',
    newUpload:'Enviar mais fotos',
    photosSelected:function(n){return n+' foto'+(n>1?'s':'')+' selecionada'+(n>1?'s':'')},
    errorGeneric:'Erro ao enviar fotos. Tente novamente.',
    errorStart:'Erro ao iniciar upload',
    errorServer:'Erro ao processar resposta do servidor',
    errorConnection:'Erro de conex\u00e3o com o servidor',
  },
  en:{
    heroTitle:'Send your Photos',
    heroSub:'Pick photos and get a code to use at the kiosk',
    dropLabel:'Drag photos here or',
    browseLink:'browse your phone',
    dropHint:'Up to 50 photos \u00b7 Max 50MB each \u00b7 JPG, PNG, WEBP, HEIC',
    btnLabel:'Send Photos',
    uploading:'Uploading...',
    finalizing:'Finalizing...',
    sent:'Sent!',
    resultHeading:'Photos received!',
    resultExpire:'Code valid for <strong>24 hours</strong>',
    tipLabel:'Tip:',
    tipText:'Type this code on the kiosk keyboard to print your photos',
    newUpload:'Send more photos',
    photosSelected:function(n){return n+' photo'+(n>1?'s':'')+' selected'},
    errorGeneric:'Error uploading photos. Try again.',
    errorStart:'Error starting upload',
    errorServer:'Error processing server response',
    errorConnection:'Connection error',
  },
  es:{
    heroTitle:'Env\u00eda tus Fotos',
    heroSub:'Elige las fotos y recibe un c\u00f3digo para usar en el t\u00f3tem',
    dropLabel:'Arrastra las fotos aqu\u00ed o',
    browseLink:'busca en el celular',
    dropHint:'Hasta 50 fotos \u00b7 M\u00e1x 50MB cada \u00b7 Formatos JPG, PNG, WEBP y HEIC',
    btnLabel:'Enviar Fotos',
    uploading:'Enviando...',
    finalizing:'Finalizando...',
    sent:'\u00a1Enviado!',
    resultHeading:'\u00a1Fotos recibidas!',
    resultExpire:'C\u00f3digo v\u00e1lido por <strong>24 horas</strong>',
    tipLabel:'Consejo:',
    tipText:'Escribe este c\u00f3digo en el teclado del t\u00f3tem para imprimir tus fotos',
    newUpload:'Enviar m\u00e1s fotos',
    photosSelected:function(n){return n+' foto'+(n>1?'s':'')+' seleccionada'+(n>1?'s':'')},
    errorGeneric:'Error al enviar fotos. Intente de nuevo.',
    errorStart:'Error al iniciar la subida',
    errorServer:'Error al procesar la respuesta del servidor',
    errorConnection:'Error de conexi\u00f3n con el servidor',
  }
};

let currentLang='pt';
function toggleLang(){ document.getElementById('langDropdown').classList.toggle('open'); }
function setLang(code){
  currentLang=code;
  document.getElementById('langLabel').textContent=LANG_NATIVE[code];
  document.querySelectorAll('#langDropdown button').forEach(function(b){
    b.classList.toggle('active',b.dataset.lang===code);
  });
  document.getElementById('langDropdown').classList.remove('open');
  applyLang();
}
function applyLang(){
  var t=LANG_DATA[currentLang];
  document.getElementById('heroTitle').textContent=t.heroTitle;
  document.getElementById('heroSub').textContent=t.heroSub;
  document.getElementById('dropLabel').innerHTML=t.dropLabel+' <span class="browse-link" id="browseLink">'+t.browseLink+'</span>';
  document.getElementById('dropHint').textContent=t.dropHint;
  document.getElementById('btnLabel').textContent=t.btnLabel;
  document.getElementById('resultHeading').textContent=t.resultHeading;
  document.getElementById('tipLabel').textContent=t.tipLabel;
  document.getElementById('tipText').textContent=t.tipText;
  document.getElementById('newUploadBtn').textContent=t.newUpload;
  updatePhotoCount();
}
document.addEventListener('click',function(e){
  var dd=document.getElementById('langDropdown'),btn=document.getElementById('langBtn').querySelector('.lang-btn')||document.querySelector('.lang-btn');
  if(!e.target.closest('.lang-wrap')) document.getElementById('langDropdown').classList.remove('open');
});
window.addEventListener('load',function(){setLang('pt');});

const API_BASE='/api';
const fileInput=document.getElementById('fileInput');
const dropzone=document.getElementById('dropzone');
const fileSection=document.getElementById('fileSection');
const photoGrid=document.getElementById('photoGrid');
const photoCount=document.getElementById('photoCount');
const btnUpload=document.getElementById('btnUpload');
const progressFill=document.getElementById('progressFill');
const progressWrap=document.getElementById('progressWrap');
const progressText=document.getElementById('progressText');
const errorEl=document.getElementById('error');
const errorText=document.getElementById('errorText');
var selectedFiles=[];
var currentCode=null;

function showError(msg){errorText.textContent=msg;errorEl.classList.remove('hidden');}
function hideError(){errorEl.classList.add('hidden');}

fileInput.addEventListener('change',handleFiles);
dropzone.addEventListener('dragover',function(e){e.preventDefault();dropzone.classList.add('dragover');});
dropzone.addEventListener('dragleave',function(){dropzone.classList.remove('dragover');});
dropzone.addEventListener('drop',function(e){
  e.preventDefault();dropzone.classList.remove('dragover');
  fileInput.files=e.dataTransfer.files;
  handleFiles();
});
dropzone.addEventListener('click',function(){fileInput.click();});

function handleFiles(){
  selectedFiles=Array.from(fileInput.files).slice(0,50);
  if(selectedFiles.length===0){
    fileSection.classList.add('hidden');dropzone.classList.remove('has-files');
    btnUpload.disabled=true;restoreBtnText();return;
  }
  dropzone.classList.add('has-files');fileSection.classList.remove('hidden');
  updatePhotoCount();renderThumbs();btnUpload.disabled=false;
}
function updatePhotoCount(){
  if(selectedFiles.length>0) photoCount.textContent=LANG_DATA[currentLang].photosSelected(selectedFiles.length);
}
function renderThumbs(){
  photoGrid.innerHTML='';
  selectedFiles.forEach(function(f,i){
    var thumb=document.createElement('div');
    thumb.className='photo-thumb';
    thumb.style.animation='slideUp 0.3s ease both';
    thumb.style.animationDelay=(i*0.03)+'s';
    var img=document.createElement('img');
    img.src=URL.createObjectURL(f);img.alt=f.name;
    var btn=document.createElement('button');
    btn.className='remove';btn.textContent='\u00d7';
    btn.onclick=function(e){e.stopPropagation();removeFile(i);};
    thumb.appendChild(img);thumb.appendChild(btn);
    photoGrid.appendChild(thumb);
  });
}
function removeFile(i){
  selectedFiles.splice(i,1);
  var dt=new DataTransfer();
  selectedFiles.forEach(function(f){dt.items.add(f);});
  fileInput.files=dt.files;handleFiles();
}
function setProgress(pct){
  progressWrap.classList.remove('hidden');progressText.classList.remove('hidden');
  progressFill.style.width=pct+'%';
  progressText.textContent=pct<100?LANG_DATA[currentLang].uploading+' '+Math.round(pct)+'%':LANG_DATA[currentLang].finalizing;
}
function restoreBtnText(){
  btnUpload.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> <span id="btnLabel"></span>';
  document.getElementById('btnLabel').textContent=LANG_DATA[currentLang].btnLabel;
}
btnUpload.addEventListener('click',startUpload);
document.getElementById('newUploadBtn').addEventListener('click',addMorePhotos);
document.getElementById('resetUploadBtn').addEventListener('click',resetUpload);
async function startUpload(){
  hideError();
  if(selectedFiles.length===0) return;
  btnUpload.disabled=true;
  btnUpload.innerHTML='<span class="spinner"></span> '+LANG_DATA[currentLang].uploading;
  setProgress(0);
  try{
    var code;
    if(currentCode){
      code=currentCode;
      setProgress(15);
    }else{
      var startRes=await fetch(API_BASE+'/start.php',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      var startData=await startRes.json();
      if(!startData.success){throw new Error(LANG_DATA[currentLang].errorStart+': '+(startData.error||''));}
      code=startData.code;
      currentCode=code;
      setProgress(15);
    }
    var formData=new FormData();formData.append('code',code);
    selectedFiles.forEach(function(f){formData.append('photos[]',f);});
    var xhr=new XMLHttpRequest();
    xhr.open('POST',API_BASE+'/upload.php',true);
    xhr.upload.onprogress=function(e){if(e.lengthComputable) setProgress(15+(e.loaded/e.total)*75);};
    var result=await new Promise(function(resolve,reject){
      xhr.onload=function(){try{resolve(JSON.parse(xhr.responseText));}catch{reject(new Error(LANG_DATA[currentLang].errorServer));}};
      xhr.onerror=function(){reject(new Error(LANG_DATA[currentLang].errorConnection));};
      xhr.send(formData);
    });
    if(!result.success){throw new Error(result.error||LANG_DATA[currentLang].errorGeneric);}
    setProgress(100);progressText.textContent=LANG_DATA[currentLang].sent;
    setTimeout(function(){showCode(code);},300);
  }catch(e){
    showError(e.message||LANG_DATA[currentLang].errorGeneric);
    btnUpload.disabled=false;restoreBtnText();
    progressWrap.classList.add('hidden');progressText.classList.add('hidden');
    progressFill.style.width='0%';
  }
}
function showCode(code){
  document.getElementById('step-upload').classList.add('hidden');
  document.getElementById('step-result').classList.remove('hidden');
  document.getElementById('codigoDisplay').textContent=code;
  document.getElementById('codigoExpire').innerHTML=LANG_DATA[currentLang].resultExpire;
  selectedFiles.forEach(function(f){try{URL.revokeObjectURL(f);}catch(e){}});
  // mostra quantas fotos ja foram enviadas para este codigo
  fetch(API_BASE+'/photos.php?code='+code).then(function(r){return r.json();}).then(function(d){
    if(d.success&&d.photoCount>0){
      var el=document.getElementById('codigoCount');
      if(el) el.textContent=d.photoCount+' '+(d.photoCount>1?LANG_DATA[currentLang].photosPlural||'fotos':LANG_DATA[currentLang].photosSingular||'foto');
    }
  }).catch(function(){});
}
function addMorePhotos(){
  document.getElementById('step-result').classList.add('hidden');
  document.getElementById('step-upload').classList.remove('hidden');
  selectedFiles=[];document.getElementById('fileInput').value='';
  fileSection.classList.add('hidden');dropzone.classList.remove('has-files');
  btnUpload.disabled=true;restoreBtnText();
  progressWrap.classList.add('hidden');progressText.classList.add('hidden');
  progressFill.style.width='0%';hideError();
}
function resetUpload(){
  currentCode=null;
  document.getElementById('step-result').classList.add('hidden');
  document.getElementById('step-upload').classList.remove('hidden');
  selectedFiles=[];document.getElementById('fileInput').value='';
  fileSection.classList.add('hidden');dropzone.classList.remove('has-files');
  btnUpload.disabled=true;restoreBtnText();
  progressWrap.classList.add('hidden');progressText.classList.add('hidden');
  progressFill.style.width='0%';hideError();
}
</script>
</body>
</html>
