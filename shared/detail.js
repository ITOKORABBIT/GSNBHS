
(function(){
  if (/Line\//i.test(navigator.userAgent)) {
    var url = new URL(location.href);
    if (!url.searchParams.has('openExternalBrowser')) {
      url.searchParams.set('openExternalBrowser', '1');
      location.replace(url.toString());
    }
  }
})();

// ────────────────────────────────────────────────────────────
// CONFIG
// ────────────────────────────────────────────────────────────
var PUBLIC_CATES = ['生活','校園','交通','環境','治安','修繕','其他'];

var _sess = getSession();
if (!_sess) {
  location.replace('admin.html?redirect=' + encodeURIComponent(location.href));
}
var gName  = _sess ? _sess.name  : '';
var gEmail = _sess ? _sess.email : '';
var isAdmin = true;

// ────────────────────────────────────────────────────────────
// API HELPER
// ────────────────────────────────────────────────────────────
function apiCall(action, extra) {
  var sess = getSession();
  var payload = Object.assign({ action: action }, extra || {});
  if (sess) {
    payload.sessionToken = sess.sessionToken;
    if (sess.id_token) payload.id_token = sess.id_token;
  }
  return fetch(CONFIG.CASE_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(function(r){ return r.json(); })
  .then(function(json){
    if (json.code === 401) { clearSession(); location.href = 'admin.html?redirect=' + encodeURIComponent(location.href); }
    return json;
  });
}

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('lbPrevBtn').addEventListener('click', function(e){ e.stopPropagation(); lbMove(-1); });
  document.getElementById('lbNextBtn').addEventListener('click', function(e){ e.stopPropagation(); lbMove(1); });
  var lb = document.getElementById('lightbox');
  var sx = 0;
  lb.addEventListener('touchstart', function(e){ sx = e.touches[0].clientX; }, {passive: true});
  lb.addEventListener('touchend', function(e){
    var dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 50){ e.preventDefault(); dx < 0 ? lbMove(1) : lbMove(-1); }
  }, {passive: false});
  loadCase();
});

// ────────────────────────────────────────────────────────────
// DATA LOAD
// ────────────────────────────────────────────────────────────
var caseId = new URLSearchParams(location.search).get('id') || '';
var caseData = null;
var caseDataFull = false;

function loadCase() {
  if (!caseId) {
    showError('缺少案件編號', '請確認網址是否正確（需包含 ?id=案件編號）');
    return;
  }
  var hasPreview = false;
  try {
    var preview = JSON.parse(sessionStorage.getItem('admin_case_preview_' + caseId) || 'null');
    if (preview && preview.caseId) {
      caseData = preview;
      caseDataFull = false;
      renderCase();
      hasPreview = true;
    }
  } catch(e) {}
  // 背景 GAS fetch：確保顯示最新資料（含新上傳照片）
  // modal 已開啟時不覆蓋畫面，避免干擾正在填寫的表單
  apiCall('getCase', { caseId: caseId })
    .then(function(json){
      if (!json.success) {
        if (!hasPreview) showError('找不到案件', json.error || '案件編號「' + caseId + '」不存在或尚未建立');
        return;
      }
      caseData = json.case || json.caseData;
      caseDataFull = true;
      if (!document.getElementById('replyModal').classList.contains('open')) {
        renderCase();
      }
    })
    .catch(function(){
      if (!hasPreview) showError('載入失敗', '無法讀取資料，請稍後再試');
    });
}

// ────────────────────────────────────────────────────────────
// RENDER
// ────────────────────────────────────────────────────────────
function v(s){ return s ? esc(s) : '<span class="empty">—</span>'; }

// ── 類別彩色標籤 ──
var CATE_COLOR = {
  '生活':  { bg:'#E0F7FA', txt:'#006B6B' },
  '校園':  { bg:'#FFF3E0', txt:'#B75D00' },
  '交通':  { bg:'#EBF3FF', txt:'#1A56A8' },
  '環境':  { bg:'#EAF3EB', txt:'#2F6836' },
  '治安':  { bg:'#FEE2E2', txt:'#991B1B' },
  '修繕':  { bg:'#FFF8E1', txt:'#F57F17' },
  '其他':  { bg:'#F0EEEC', txt:'#7A6E66' },
};
function cateBadge(cat) {
  var c = CATE_COLOR[cat] || { bg:'#F0EEEC', txt:'#7A6E66' };
  return '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:5px;font-size:12px;font-weight:700;background:' + c.bg + ';color:' + c.txt + '">' +
    '<svg width="9" height="9" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/></svg>' +
    esc(cat) + '</span>';
}

function badgeCls(s){
  if (!s) return 'badge-proc';
  if (s.indexOf('新案件') !== -1) return 'badge-new';
  if (s.indexOf('結案') !== -1)   return 'badge-done';
  if (s.indexOf('不受理') !== -1) return 'badge-grey';
  return 'badge-proc';
}

function row(lbl, val){ return '<div class="info-row"><div class="info-lbl">' + lbl + '</div><div class="info-val">' + val + '</div></div>'; }

function renderCase(){
  var d = caseData;
  var photos    = [d.photo1, d.photo2, d.photo3, d.photo4, d.photo5].filter(Boolean);
  var repPhotos = [d.repPhoto1, d.repPhoto2, d.repPhoto3, d.repPhoto4, d.repPhoto5,
                   d.repPhoto6, d.repPhoto7, d.repPhoto8, d.repPhoto9, d.repPhoto10].filter(Boolean);

  document.getElementById('pageTitle').textContent = d.title || '案件詳情';

  var html = '';

  // ── Title card ──
  html += '<div class="case-title-card">';
  html += '<div class="case-meta">';
  html += '<span class="case-id-tag">' + esc(d.caseId) + '</span>';
  html += '<span class="badge ' + badgeCls(d.status) + '">' + esc(d.status) + '</span>';
  html += '</div>';
  html += '<div class="case-main-title">' + esc(d.title) + '</div>';
  html += '</div>';

  // ── 通報資訊 ──
  html += '<div class="card">';
  html += '<div class="card-header">';
  html += icon('file') + ' 通報資訊';
  html += '</div>';
  html += '<div class="info-table">';
  html += row('通報時間', v(fmtDateTime(d.reportTime)));
  html += row('通報類別', d.category ? cateBadge(d.category) : '<span class="empty">—</span>');
  html += row('發生地點', d.addr ? (esc(d.addr) + (d.mapUrl ? ' <a href="' + esc(d.mapUrl) + '" target="_blank" rel="noopener">地圖 ↗</a>' : '')) : '<span class="empty">—</span>');
  if (d.case1999) html += row('1999案號', esc(d.case1999));
  if (d.desc || d.description) html += row('問題描述', '<span class="desc">' + esc(d.desc || d.description) + '</span>');
  html += '</div>';
  if (photos.length) {
    _lbCasePhotos = photos;
    html += '<div class="photo-grid-wrap">';
    html += '<div style="font-size:12px;color:var(--lbl);font-weight:600;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">通報照片</div>';
    html += '<div class="photo-grid">';
    photos.forEach(function(p,i){ html += renderPhotoCard(p, '照片' + (i+1), '_lbCasePhotos', i); });
    html += '</div></div>';
  }
  html += '</div>';

  // ── 通報人資訊（需登入後才顯示，防個資外洩）──
  html += '<div id="contactCard"></div>';

  // ── 里長回覆 ──
  html += '<div class="card">';
  html += '<div class="card-header">' + icon('reply') + ' 里長回覆</div>';
  if (d.replyContent) {
    html += '<div class="info-table">';
    html += row('回覆時間', v(fmtDateTime(d.replyTime)));
    html += row('回覆內容', '<span class="desc">' + esc(d.replyContent) + '</span>');
    if (d.note) html += row('備註', esc(d.note));
    html += row('承辦人',   v(d.handler));
    if (d.replyNotify && d.replyNotify.status) {
      var n = d.replyNotify;
      var notifyText = n.status === 'sent'
        ? '已用 LINE 通知 ' + esc(d.lineDisplayName || '通報人') + '（' + esc(n.at || '') + '）'
        : (n.status === 'skipped' ? '未通知：' : '通知失敗：') + esc(n.error || '原因不明');
      html += row('通知通報人', notifyText);
    }
    var pubLbl = (d.publicFlag === true || d.publicFlag === 'TRUE' || d.publicFlag === '是') ? '是' : '否';
    html += row('公開顯示', pubLbl);
    if (d.publicTitle)   html += row('公開主旨', esc(d.publicTitle));
    if (d.publicCate)    html += row('公開類別', cateBadge(d.publicCate));
    if (d.publicLoc)     html += row('公開地點', esc(d.publicLoc));
    if (d.publicSummary) html += row('公開摘要', '<span class="desc">' + esc(d.publicSummary) + '</span>');
    html += '</div>';
    if (repPhotos.length) {
      _lbRepPhotos = repPhotos;
      html += '<div class="photo-grid-wrap">';
      html += '<div style="font-size:12px;color:var(--lbl);font-weight:600;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">處理照片</div>';
      html += '<div class="photo-grid">';
      repPhotos.forEach(function(p,i){ html += renderPhotoCard(p, '處理照片' + (i+1), '_lbRepPhotos', i); });
      html += '</div></div>';
    }
  } else {
    html += '<div class="no-reply">尚未填寫回覆</div>';
  }
  html += '</div>';

  document.getElementById('mainContent').innerHTML = html;
  // 只有管理員才顯示「編輯回覆」按鈕
  document.getElementById('actionBar').style.display = isAdmin ? 'flex' : 'none';
  renderContactCard();
}

// ────────────────────────────────────────────────────────────
// CONTACT CARD（需登入才顯示個資）
// ────────────────────────────────────────────────────────────
function renderContactCard() {
  var el = document.getElementById('contactCard');
  if (!el || !caseData) return;
  var d = caseData;
  // 已是管理員，直接顯示通報人資訊
  var html = '<div class="card">';
  html += '<div class="card-header">' + icon('user') + ' 通報人資訊</div>';
  html += '<div class="info-table">';
  html += row('姓名', v(d.name));
  html += row('電話', d.phone ? '<a href="tel:' + esc(d.phone) + '">' + esc(d.phone) + '</a>' : '<span class="empty">—</span>');
  if (d.lineId) html += row('LINE ID', esc(d.lineId));
  // 從 LINE 進來通報才會有；瀏覽器直接開表單的案件沒有這一列
  if (d.lineDisplayName) html += row('LINE 名稱', esc(d.lineDisplayName));
  html += '</div>';
  html += '</div>';
  el.innerHTML = html;
}

function icon(name){
  var icons = {
    file:  '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    user:  '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    reply: '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>',
  };
  return icons[name] || '';
}

function showError(t, m){
  document.getElementById('mainContent').innerHTML =
    '<div class="card"><div class="state-box"><h3>' + t + '</h3><p>' + m + '</p></div></div>';
}

var replyPhotos = [];
var replyPhotoIdSeq = 0;
var photoSortable = null;

// ────────────────────────────────────────────────────────────
// MODAL
// ────────────────────────────────────────────────────────────
function openModal(){
  if (!caseData) return;
  if (!isAdmin) { alert('您沒有權限執行此操作。'); return; }
  if (!caseDataFull) {
    var btn = document.querySelector('#actionBar .btn-primary');
    var origHtml = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 載入中…'; }
    apiCall('getCase', { caseId: caseId })
      .then(function(json){
        if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
        if (!json.success) { alert('載入失敗，請稍後再試'); return; }
        caseData = json.case || json.caseData;
        caseDataFull = true;
        renderCase();
        openModal();
      })
      .catch(function(){
        if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
        alert('載入失敗，請稍後再試');
      });
    return;
  }
  var d = caseData;
  var isPublic = d.publicFlag === true || d.publicFlag === 'TRUE' || d.publicFlag === '是';

  var handlerVal  = gName || d.handler || '';
  var handlerHint = '<div class="field-hint" style="color:var(--primary)">✓ 已登入為 ' + esc(gName) + '</div>';

  var cateOptions = PUBLIC_CATES.map(function(c){
    return '<option value="' + c + '"' + (d.publicCate === c ? ' selected' : '') + '>' + c + '</option>';
  }).join('');

  var html = '';

  // 案件狀態
  html += '<div class="field">';
  html += '<div class="field-label">案件狀態 <span class="req">*</span></div>';
  html += '<select id="m_status">';
  html += '<option value="">請選擇</option>';
  ['1.新案件','2.處理中','3.已轉交相關單位','4.已結案','5.不受理'].forEach(function(s){
    html += '<option value="' + s + '"' + (d.status === s ? ' selected' : '') + '>' + s + '</option>';
  });
  html += '</select></div>';

  // 1999案號 (readonly)
  if (d.case1999) {
    html += '<div class="field">';
    html += '<div class="field-label">1999案號</div>';
    html += '<input type="text" value="' + esc(d.case1999) + '" readonly>';
    html += '</div>';
  }

  // 完整回覆內容
  html += '<div class="field">';
  html += '<div class="field-label">完整回覆內容 <span class="req">*</span></div>';
  html += '<textarea id="m_content" rows="5" placeholder="請輸入處理情況與回覆內容…">' + esc(d.replyContent) + '</textarea>';
  html += '</div>';

  // 處理照片
  html += '<div class="field">';
  html += '<div class="field-label">處理照片 <span style="color:var(--muted);font-size:11px;font-weight:400">（最多 10 張，可拖曳調整順序）</span></div>';
  html += '<div class="photo-upload-area" id="photoUploadArea">';
  html += '<div class="photo-preview-grid" id="photoPreviewGrid"></div>';
  html += '<label class="photo-add-btn" id="photoAddBtn">';
  html += '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  html += '新增照片';
  html += '<input type="file" accept="image/*" multiple id="photoFileInput" style="display:none" onchange="handleMultiPhotoAdd(this)">';
  html += '</label>';
  html += '</div></div>';

  // 備註
  html += '<div class="field">';
  html += '<div class="field-label">備註</div>';
  html += '<input type="text" id="m_note" placeholder="內部備註（不對外顯示）" value="' + esc(d.note) + '">';
  html += '</div>';

  // 承辦人（移至公開設定上方）
  html += '<div class="field">';
  html += '<div class="field-label">承辦人 <span class="req">*</span></div>';
  html += '<input type="text" id="m_handler" placeholder="承辦人姓名" value="' + esc(handlerVal) + '" readonly>';
  html += handlerHint;
  html += '</div>';

  // 通知通報人（只有從 LINE 通報的案件才推得動，沒有身分就不顯示這一格）
  if (d.lineUserId) {
    html += '<div class="field">';
    html += '<div class="field-label">通知通報人</div>';
    html += '<div class="toggle-field on" id="notifyToggle" onclick="toggleNotify()">';
    html += '<div class="toggle-track"></div>';
    html += '<input type="checkbox" id="m_notify" checked style="display:none">';
    html += '<span class="toggle-text">用 LINE 通知 ' + esc(d.lineDisplayName || '通報人') + '</span>';
    html += '</div>';
    html += '</div>';
  }

  // 公開顯示
  html += '<div class="field">';
  html += '<div class="field-label">公開設定</div>';
  html += '<div class="toggle-field' + (isPublic ? ' on' : '') + '" id="pubToggle" onclick="togglePub()">';
  html += '<div class="toggle-track"></div>';
  html += '<input type="checkbox" id="m_public"' + (isPublic ? ' checked' : '') + ' style="display:none">';
  html += '<span class="toggle-text">公開顯示此案件處理結果</span>';
  html += '</div>';
  html += '</div>';

  // 公開欄位
  html += '<div class="collapsible' + (isPublic ? ' open' : '') + '" id="pubFields">';

  html += '<div class="field"><div class="field-label">公開主旨</div>';
  html += '<input type="text" id="m_pub_title" placeholder="對外顯示的標題" value="' + esc(d.publicTitle) + '"></div>';

  html += '<div class="field"><div class="field-label">公開類別</div>';
  html += '<select id="m_pub_cate"><option value="">請選擇</option>' + cateOptions + '</select></div>';

  html += '<div class="field"><div class="field-label">公開地點</div>';
  html += '<input type="text" id="m_pub_loc" placeholder="對外顯示的地點" value="' + esc(d.publicLoc) + '"></div>';

  html += '<div class="field"><div class="field-label">公開回覆摘要</div>';
  html += '<textarea id="m_pub_summary" rows="3" placeholder="簡短對外說明（不含個人資訊）">' + esc(d.publicSummary) + '</textarea></div>';

  html += '</div>'; // collapsible

  document.getElementById('modalBody').innerHTML = html;
  initReplyPhotos(d);
  document.getElementById('replyModal').classList.add('open');
  document.body.style.overflow = 'hidden';

}

function closeModal(){
  document.getElementById('replyModal').classList.remove('open');
  document.body.style.overflow = '';
}

function toggleNotify(){
  var wrap = document.getElementById('notifyToggle');
  document.getElementById('m_notify').checked = wrap.classList.toggle('on');
}

function togglePub(){
  var wrap   = document.getElementById('pubToggle');
  var cb     = document.getElementById('m_public');
  var fields = document.getElementById('pubFields');
  var on = wrap.classList.toggle('on');
  cb.checked = on;
  fields.classList.toggle('open', on);

  // 第一次開啟公開設定時，自動帶入原始通報資料（欄位有值則保留不覆蓋）
  if (on && caseData) {
    var titleEl = document.getElementById('m_pub_title');
    var cateEl  = document.getElementById('m_pub_cate');
    var locEl   = document.getElementById('m_pub_loc');
    if (!titleEl.value && caseData.title)    titleEl.value = caseData.title;
    if (!cateEl.value  && caseData.category) cateEl.value  = caseData.category;
    if (!locEl.value   && caseData.addr)     locEl.value   = caseData.addr;
  }
}

// ────────────────────────────────────────────────────────────
// MULTI-PHOTO UPLOAD WIDGET
// ────────────────────────────────────────────────────────────
function initReplyPhotos(d) {
  replyPhotos = [];
  replyPhotoIdSeq = 0;
  if (photoSortable) { photoSortable.destroy(); photoSortable = null; }
  [d.repPhoto1, d.repPhoto2, d.repPhoto3, d.repPhoto4, d.repPhoto5,
   d.repPhoto6, d.repPhoto7, d.repPhoto8, d.repPhoto9, d.repPhoto10].forEach(function(url) {
    if (url) replyPhotos.push({ id: replyPhotoIdSeq++, src: url, file: null, origUrl: url });
  });
  renderPhotoPreviewGrid();
}

function renderPhotoPreviewGrid() {
  var grid   = document.getElementById('photoPreviewGrid');
  var addBtn = document.getElementById('photoAddBtn');
  if (!grid) return;

  grid.innerHTML = '';
  replyPhotos.forEach(function(p) {
    var div = document.createElement('div');
    div.className = 'photo-preview-item';
    div.setAttribute('data-sort-id', String(p.id));
    var img = document.createElement('img');
    img.src = p.src;
    img.alt = '照片';
    var rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.className = 'item-remove';
    rmBtn.textContent = '✕';
    rmBtn.setAttribute('data-pid', String(p.id));
    rmBtn.addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation();
      var pid = parseInt(this.getAttribute('data-pid'));
      syncPhotosFromDOM();
      replyPhotos = replyPhotos.filter(function(x) { return x.id !== pid; });
      renderPhotoPreviewGrid();
    });
    var hint = document.createElement('span');
    hint.className = 'drag-hint';
    hint.textContent = '拖曳排序';
    div.appendChild(img);
    div.appendChild(rmBtn);
    if (p.origUrl) {
      var dlBtn = document.createElement('button');
      dlBtn.type = 'button';
      dlBtn.className = 'item-download';
      dlBtn.title = '下載';
      dlBtn.textContent = '↓';
      dlBtn.setAttribute('data-url', p.origUrl);
      dlBtn.addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        downloadPhoto(this.getAttribute('data-url'), 'photo', e);
      });
      div.appendChild(dlBtn);
    }
    if (replyPhotos.length > 1) div.appendChild(hint);
    grid.appendChild(div);
  });

  if (addBtn) addBtn.classList.toggle('hidden', replyPhotos.length >= 10);

  if (photoSortable) { photoSortable.destroy(); photoSortable = null; }
  if (replyPhotos.length > 1) {
    photoSortable = new SortableOrder(grid, {
      selector: '.photo-preview-item',
      onReorder: function(ids) {
        var idMap = {};
        replyPhotos.forEach(function(p) { idMap[p.id] = p; });
        replyPhotos = ids.map(function(id) { return idMap[parseInt(id)]; }).filter(Boolean);
      }
    });
  }
}

function syncPhotosFromDOM() {
  var grid = document.getElementById('photoPreviewGrid');
  if (!grid) return;
  var items = grid.querySelectorAll('[data-sort-id]');
  var idMap = {};
  replyPhotos.forEach(function(p) { idMap[p.id] = p; });
  var ordered = Array.prototype.map.call(items, function(el) {
    return idMap[parseInt(el.getAttribute('data-sort-id'))];
  }).filter(Boolean);
  if (ordered.length === replyPhotos.length) replyPhotos = ordered;
}

function handleMultiPhotoAdd(input) {
  if (!input.files || !input.files.length) return;
  var slots = 10 - replyPhotos.length;
  if (slots <= 0) return;
  var files = Array.prototype.slice.call(input.files, 0, slots);
  var pending = files.length;
  files.forEach(function(file) {
    var id = replyPhotoIdSeq++;
    var reader = new FileReader();
    reader.onload = function(e) {
      replyPhotos.push({ id: id, src: e.target.result, file: file, origUrl: '' });
      pending--;
      if (pending === 0) renderPhotoPreviewGrid();
    };
    reader.readAsDataURL(file);
  });
  input.value = '';
}

function renderPhotoCard(url, label, groupVar, idx){
  var safeUrl = esc(driveImgUrl(url));
  var safeLabel = esc(label);
  return '<div class="photo-item">'
    + '<img src="' + safeUrl + '" alt="' + safeLabel + '" loading="lazy" onerror="retryLh3Img(this)" data-orig="' + safeUrl + '" onclick="openLb(' + groupVar + ',' + idx + ')">'
    + '<div class="photo-actions">'
    + '<button type="button" class="photo-action-btn" title="下載" onclick="downloadPhoto(\'' + safeUrl + '\', \'' + safeLabel + '\', event)"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 3v12M8 11l4 4 4-4M4 19h16"/></svg></button>'
    + '</div></div>';
}

function downloadPhoto(url, label, event){
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (!url) return;
  var a = document.createElement('a');
  a.href = url;
  a.download = String(label || 'photo').replace(/[\\/:*?"<>|]+/g, '_') + '.jpg';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  a.remove();
}


// ────────────────────────────────────────────────────────────
// IMAGE COMPRESS + UPLOAD
// ────────────────────────────────────────────────────────────
function compressImage(file){
  return new Promise(function(resolve, reject){
    var done = false;
    var LIMIT = 1.75 * 1024 * 1024;
    var MAX_EDGE = 1600;
    var qualities = [0.82, 0.76, 0.70, 0.64];
    var timer = setTimeout(function(){
      finish(function(){ reject(new Error('照片處理逾時，請改選較小的照片')); });
    }, 30000);
    function finish(fn){
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    }
    var reader = new FileReader();
    reader.onload = function(e){
      var img = new Image();
      img.onload = function(){
        try {
          var canvas = document.createElement('canvas');
          var edgeScale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
          var sizeScale = Math.min(1, Math.sqrt(LIMIT / Math.max(file.size, 1)));
          var scale = Math.min(edgeScale, sizeScale);
          var w = Math.max(1, Math.floor(img.width * scale));
          var h = Math.max(1, Math.floor(img.height * scale));
          var dataUrl = '';
          for (var round = 0; round < 4; round++) {
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            for (var qi = 0; qi < qualities.length; qi++) {
              dataUrl = canvas.toDataURL('image/jpeg', qualities[qi]);
              if (dataUrl.length * 0.75 <= LIMIT) {
                finish(function(){ resolve(dataUrl); });
                return;
              }
            }
            w = Math.max(1, Math.floor(w * 0.85));
            h = Math.max(1, Math.floor(h * 0.85));
          }
          finish(function(){ resolve(dataUrl); });
        } catch(err) {
          finish(function(){ reject(new Error('照片壓縮失敗，請換一張照片再試')); });
        }
      };
      img.onerror = function(){
        finish(function(){ reject(new Error('照片格式無法讀取，請換成一般 JPG/PNG 照片')); });
      };
      img.src = e.target.result;
    };
    reader.onerror = function(){
      finish(function(){ reject(new Error('照片讀取失敗，請重新選取照片')); });
    };
    reader.readAsDataURL(file);
  });
}

async function uploadPhotoFile(file){
  if (!file) return '';
  var dataUrl = await compressImage(file);
  var b64 = dataUrl.indexOf(',') !== -1 ? dataUrl.split(',')[1] : dataUrl;
  var sess = getSession();
  var payload = { action: 'uploadCasePhoto', imageBase64: b64, mimeType: file.type || 'image/jpeg' };
  if (sess) {
    if (sess.sessionToken) payload.sessionToken = sess.sessionToken;
    if (sess.id_token) payload.id_token = sess.id_token;
  }
  var res = await fetch(CONFIG.CASE_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  var json;
  try {
    json = await res.json();
  } catch(parseErr) {
    throw new Error('照片上傳回應格式錯誤 (HTTP ' + res.status + ')');
  }
  if (json.code === 401) {
    clearSession();
    throw new Error('登入已逾時，請重新登入後再上傳');
  }
  if (!res.ok || !json.success) throw new Error(json.error || ('照片上傳失敗 (HTTP ' + res.status + ')'));
  if (!json.url) throw new Error('照片上傳完成但未取得連結');
  return json.url;
}

// ────────────────────────────────────────────────────────────
// SUBMIT
// ────────────────────────────────────────────────────────────
async function submitReply(){
  if (!isAdmin) { alert('您沒有權限執行此操作。'); return; }
  var status  = document.getElementById('m_status').value;
  var content = (document.getElementById('m_content').value || '').trim();
  var handler = (document.getElementById('m_handler').value || '').trim();

  // Validate
  var ok = true;
  if (!status)  { hilite('m_status');  ok = false; }
  if (!content) { hilite('m_content'); ok = false; }
  if (!handler) { hilite('m_handler'); ok = false; }
  if (!ok) return;

  var btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 上傳照片…';

  // Sync DOM order (in case user dragged without triggering onReorder)
  syncPhotosFromDOM();

  // 循序上傳（避免並發導致部分失敗）；已有 URL 的保留原值
  var photos = [];
  var newFileCount = replyPhotos.filter(function(p){ return !!p.file; }).length;
  var uploaded = 0;
  try {
    for (var pi = 0; pi < replyPhotos.length; pi++) {
      var p = replyPhotos[pi];
      if (p.file) {
        uploaded++;
        btn.innerHTML = '<span class="spinner"></span> 上傳照片 ' + uploaded + ' / ' + newFileCount + '…';
        photos.push(await uploadPhotoFile(p.file));
      } else {
        photos.push(p.origUrl || '');
      }
    }
  } catch(uploadErr) {
    alert('照片上傳失敗，已停止送出。\n錯誤：' + uploadErr.message);
    btn.disabled = false;
    btn.innerHTML = '更新';
    return;
  }
  while (photos.length < 10) photos.push('');

  btn.innerHTML = '<span class="spinner"></span> 送出中…';

  var isPublic = document.getElementById('m_public').checked;
  var notifyEl = document.getElementById('m_notify');
  var payload = {
    caseId:          caseId,
    status:          status,
    reply_content:   content,
    notifyReporter:  !!(notifyEl && notifyEl.checked),
    handler:         handler,
    PS:              (document.getElementById('m_note').value || '').trim(),
    public:          isPublic,
    public_title:    (document.getElementById('m_pub_title')   ? document.getElementById('m_pub_title').value.trim()   : ''),
    public_category: (document.getElementById('m_pub_cate')    ? document.getElementById('m_pub_cate').value            : ''),
    public_location: (document.getElementById('m_pub_loc')     ? document.getElementById('m_pub_loc').value.trim()     : ''),
    public_content:  (document.getElementById('m_pub_summary') ? document.getElementById('m_pub_summary').value.trim() : ''),
    reply_photo1:    photos[0],
    reply_photo2:    photos[1],
    reply_photo3:    photos[2],
    reply_photo4:    photos[3],
    reply_photo5:    photos[4],
    reply_photo6:    photos[5],
    reply_photo7:    photos[6],
    reply_photo8:    photos[7],
    reply_photo9:    photos[8],
    reply_photo10:   photos[9],
  };

  try {
    var sess = getSession();
    var scriptPayload = Object.assign({
      action: 'updateReply',
      sessionToken: sess ? sess.sessionToken : '',
      id_token: sess ? (sess.id_token || '') : ''
    }, payload);
    var res = await fetch(CONFIG.CASE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scriptPayload)
    });
    var json = await res.json();
    if (!json.success) throw new Error(json.error || '寫入失敗');

    try { sessionStorage.removeItem('admin_case_preview_' + caseId); } catch(e) {}

    // Scenario B：官方LINE回覆推播（best effort，不擋主流程）
    if (CONFIG.REPLY_WEBHOOK_URL) {
      fetch(CONFIG.REPLY_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId:        payload.caseId,
          status:        payload.status,
          handler:       payload.handler,
          reply_content: payload.reply_content,
          public:        payload.public,
          public_title:  payload.public_title || ''
        })
      }).catch(function(){});
    }

    Object.assign(caseData, {
      status: payload.status,
      replyContent: payload.reply_content,
      handler: payload.handler,
      note: payload.PS,
      publicFlag: payload.public ? '是' : '否',
      publicTitle: payload.public_title,
      publicCate: payload.public_category,
      publicLoc: payload.public_location,
      publicSummary: payload.public_content,
      replyTime: fmtDateTime(new Date().toISOString())
    });
    for (var ri = 0; ri < 10; ri++) caseData['repPhoto' + (ri + 1)] = photos[ri] || '';
    caseDataFull = true;
    try { sessionStorage.setItem('admin_case_preview_' + caseId, JSON.stringify(caseData)); } catch(e) {}
    closeModal();
    renderCase();
    btn.disabled = false;
    btn.innerHTML = '更新';
    document.getElementById('successOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
    var _cdEl = document.getElementById('successCountdown');
    if (_cdEl) _cdEl.textContent = '已更新畫面，不需重新載入。';
    setTimeout(closeSuccessOverlay, 900);
  } catch(err){
    alert('送出失敗，請稍後再試。\n錯誤：' + err.message);
    btn.disabled = false;
    btn.innerHTML = '更新';
  }
}

function hilite(id){
  var el = document.getElementById(id);
  if (!el) return;
  el.style.borderColor = 'var(--warn)';
  el.addEventListener('input', function(){ el.style.borderColor = ''; }, { once: true });
}

function closeSuccessOverlay(){
  var el = document.getElementById('successOverlay');
  if (el) el.classList.remove('open');
  document.body.style.overflow = '';
}

// ────────────────────────────────────────────────────────────
// LIGHTBOX
// ────────────────────────────────────────────────────────────
var _lbPhotos = [], _lbIdx = 0;
var _lbCasePhotos = [], _lbRepPhotos = [];

function openLb(photos, idx){
  _lbPhotos = photos; _lbIdx = idx || 0;
  _updateLb();
  document.getElementById('lightbox').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function _updateLb(){
  document.getElementById('lbImg').src = driveImgUrl(_lbPhotos[_lbIdx]);
  var multi = _lbPhotos.length > 1;
  var prev = document.getElementById('lbPrevBtn');
  var next = document.getElementById('lbNextBtn');
  var ctr  = document.getElementById('lbCounter');
  prev.style.display = (multi && _lbIdx > 0) ? 'flex' : 'none';
  next.style.display = (multi && _lbIdx < _lbPhotos.length - 1) ? 'flex' : 'none';
  if (multi) { ctr.textContent = (_lbIdx+1) + ' / ' + _lbPhotos.length; ctr.style.display = 'block'; }
  else { ctr.style.display = 'none'; }
}
function lbMove(dir){
  var n = _lbIdx + dir;
  if (n >= 0 && n < _lbPhotos.length){ _lbIdx = n; _updateLb(); }
}
function closeLb(){
  document.getElementById('lightbox').classList.remove('open');
  document.body.style.overflow = '';
}
document.addEventListener('keydown', function(e){
  if (e.key === 'Escape'){ closeLb(); closeModal(); }
  if (e.key === 'ArrowLeft')  lbMove(-1);
  if (e.key === 'ArrowRight') lbMove(1);
});

// ────────────────────────────────────────────────────────────
// NAVIGATION
// ────────────────────────────────────────────────────────────
function goBack(){
  if (history.length > 1) { history.back(); return; }
  location.href = CONFIG.BASE_URL + '/list.html';
}
['click','keydown','mousedown','touchstart','scroll'].forEach(function(eventName){
  window.addEventListener(eventName, function(){ touchSession(); }, { passive: true });
});
