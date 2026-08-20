
// ──────────────────────────────────────────
// API HELPER（公開端點不需 session）
// ──────────────────────────────────────────
function apiCall(action, extra) {
  var payload = Object.assign({ action: action }, extra || {});
  return fetch(CONFIG.CASE_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(function(r){ return r.json(); });
}

// ──────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────
function v(s){ return s ? esc(s) : '<span class="empty">—</span>'; }

var CATE_COLOR = {
  '生活':  { bg:'#E0F7FA', txt:'#006B6B' },
  '校園':  { bg:'#FFF3E0', txt:'#B75D00' },
  '交通':  { bg:'#EBF3FF', txt:'#1A56A8' },
  '環境':  { bg:'#EAF3EB', txt:'#2F6836' },
  '治安':  { bg:'#FEE2E2', txt:'#991B1B' },
  '修繕':  { bg:'#FFF8E1', txt:'#F57F17' },
  '其他':  { bg:'#F0EEEC', txt:'#7A6E66' },
};
var STATUS_COLOR = {
  '處理中':  { bg:'#FFF8E1', txt:'#B75D00' },
  '已結案':  { bg:'#F0EEEC', txt:'#7A6E66' },
};
function statusBadge(status) {
  if (!status) return '';
  var c = STATUS_COLOR[status] || { bg:'#F0EEEC', txt:'#7A6E66' };
  return '<span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700;background:' + c.bg + ';color:' + c.txt + '">' + esc(status) + '</span>';
}
function cateBadge(cat) {
  var c = CATE_COLOR[cat] || { bg:'#F0EEEC', txt:'#7A6E66' };
  return '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:5px;font-size:12px;font-weight:700;background:' + c.bg + ';color:' + c.txt + '">' +
    '<svg width="9" height="9" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/></svg>' +
    esc(cat) + '</span>';
}

function row(lbl, val){
  return '<div class="info-row"><div class="info-lbl">' + lbl + '</div><div class="info-val">' + val + '</div></div>';
}

// ──────────────────────────────────────────
// LIGHTBOX
// ──────────────────────────────────────────
var _lbPhotos = [];
var _lbIdx = 0;

function openLb(photos, idx) {
  _lbPhotos = photos;
  _lbIdx = idx || 0;
  _updateLb();
  document.getElementById('lightbox').classList.add('open');
}
function _updateLb() {
  document.getElementById('lbImg').src = _lbPhotos[_lbIdx];
  var multi = _lbPhotos.length > 1;
  var prev = document.getElementById('lbPrevBtn');
  var next = document.getElementById('lbNextBtn');
  var ctr  = document.getElementById('lbCounter');
  prev.style.display = (multi && _lbIdx > 0) ? 'flex' : 'none';
  next.style.display = (multi && _lbIdx < _lbPhotos.length - 1) ? 'flex' : 'none';
  if (multi) {
    ctr.textContent = (_lbIdx + 1) + ' / ' + _lbPhotos.length;
    ctr.style.display = 'block';
  } else {
    ctr.style.display = 'none';
  }
}
function lbMove(dir) {
  var n = _lbIdx + dir;
  if (n >= 0 && n < _lbPhotos.length) { _lbIdx = n; _updateLb(); }
}
function closeLb() {
  document.getElementById('lightbox').classList.remove('open');
  document.getElementById('lbImg').src = '';
}
document.addEventListener('keydown', function(e){
  if (e.key === 'Escape')     closeLb();
  if (e.key === 'ArrowLeft')  lbMove(-1);
  if (e.key === 'ArrowRight') lbMove(1);
});

// ──────────────────────────────────────────
// DATA LOAD
// ──────────────────────────────────────────
var caseId = new URLSearchParams(location.search).get('id') || '';

function goBack() {
  if (history.length > 1) {
    history.back();
  } else {
    location.href = 'openlist.html';
  }
}

function loadCase() {
  if (!caseId) { showError('缺少案件編號'); return; }

  // 從 sessionStorage 取摘要資料，先立即渲染（不等 GAS）
  var hasPreview = false;
  try {
    var preview = JSON.parse(sessionStorage.getItem('case_preview_' + caseId) || 'null');
    if (preview && preview.caseId) { renderCase(preview); hasPreview = true; }
  } catch(e) {}

  // 背景呼叫 GAS 取完整資料（repPhoto2-10）
  apiCall('getPublicCase', { caseId: caseId })
    .then(function(json){
      if (!json.success) {
        if (!hasPreview) showError(json.error || '找不到此案件');
        return;
      }
      renderCase(json.case || json.caseData);
    })
    .catch(function(){
      if (!hasPreview) showError('載入失敗，請稍後再試');
    });
}

// ──────────────────────────────────────────
// RENDER
// ──────────────────────────────────────────
function renderCase(d) {
  var repPhotos = [d.repPhoto1, d.repPhoto2, d.repPhoto3, d.repPhoto4, d.repPhoto5,
                   d.repPhoto6, d.repPhoto7, d.repPhoto8, d.repPhoto9, d.repPhoto10].filter(Boolean);
  // 尚未填寫處理照片時，改顯示通報時上傳的照片（案件已公開即代表照片可對外顯示）
  if (!repPhotos.length) {
    repPhotos = [d.photo1, d.photo2, d.photo3, d.photo4, d.photo5].filter(Boolean);
  }
  var title = d.publicTitle || '公開案件詳情';

  document.getElementById('pageTitle').textContent = title;

  var html = '';

  // ── Title card ──
  html += '<div class="case-title-card">';
  html += '<div class="case-meta">';
  if (d.status) html += statusBadge(d.status);
  if (d.publicCate) html += cateBadge(d.publicCate);
  html += '</div>';
  html += '<div class="case-main-title">' + esc(title) + '</div>';
  html += '</div>';

  // ── 處理資訊 ──
  html += '<div class="card">';
  html += '<div class="card-header">';
  html += '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  html += ' 處理資訊</div>';
  html += '<div class="info-table">';
  if (d.replyTime) html += row('處理時間', v(d.replyTime));
  if (d.publicLoc) html += row('地點', v(d.publicLoc));
  if (d.publicSummary) html += row('處理摘要', '<span class="desc">' + esc(d.publicSummary) + '</span>');
  html += '</div>';

  if (repPhotos.length) {
    _lbPhotos = repPhotos;
    html += '<div class="photo-grid-wrap">';
    html += '<div style="font-size:12px;color:var(--lbl);font-weight:600;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">處理照片</div>';
    html += '<div class="photo-grid">';
    repPhotos.forEach(function(p, i){
      html += '<img src="' + esc(p) + '" alt="" loading="lazy" onclick="openLb(_lbPhotos,' + i + ')">';
    });
    html += '</div></div>';
  }

  html += '</div>';

  document.getElementById('mainContent').innerHTML = html;
}

function showError(msg) {
  document.getElementById('mainContent').innerHTML =
    '<div class="state-wrap">' +
    '<svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
    '<h3>無法顯示</h3><p>' + esc(msg) + '</p></div>';
}

// ──────────────────────────────────────────
// INIT
// ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  // Prev / Next 按鈕不冒泡，否則會觸發 lightbox 的 closeLb
  document.getElementById('lbPrevBtn').addEventListener('click', function(e){ e.stopPropagation(); lbMove(-1); });
  document.getElementById('lbNextBtn').addEventListener('click', function(e){ e.stopPropagation(); lbMove(1); });

  // 左右滑動切換照片（Android / iOS 通用）
  var lb = document.getElementById('lightbox');
  var sx = 0;
  lb.addEventListener('touchstart', function(e){ sx = e.touches[0].clientX; }, {passive: true});
  lb.addEventListener('touchend', function(e){
    var dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 50) {
      e.preventDefault(); // 攔截，不觸發後續 click（不關閉 lightbox）
      dx < 0 ? lbMove(1) : lbMove(-1);
    }
  }, {passive: false});

  loadCase();
});
