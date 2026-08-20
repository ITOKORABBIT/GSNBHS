
(function(){
  if (/Line\//i.test(navigator.userAgent)) {
    var url = new URL(location.href);
    if (!url.searchParams.has('openExternalBrowser')) {
      url.searchParams.set('openExternalBrowser', '1');
      location.replace(url.toString());
    }
  }
})();

(function(){
  if (!getSession()) { location.href = 'admin.html?redirect=' + encodeURIComponent(location.href); }
})();

// ──────────────────────────────────────────
// CONFIG & CONSTANTS
// ──────────────────────────────────────────
var DETAIL_PAGE = 'detail.html';

// ──────────────────────────────────────────
// API HELPER
// ──────────────────────────────────────────
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

// Status sort weight (lower = shown first)
var STATUS_WEIGHT = {
  '1.新案件': 1,
  '2.處理中': 2,
  '3.已轉交相關單位': 3,
  '4.已結案': 4,
  '5.不受理': 5
};
// Fallback: check substring
function statusWeight(s) {
  if (!s) return 9;
  if (STATUS_WEIGHT[s] !== undefined) return STATUS_WEIGHT[s];
  if (s.indexOf('新案件') !== -1) return 1;
  if (s.indexOf('處理中') !== -1) return 2;
  if (s.indexOf('轉交') !== -1)   return 3;
  if (s.indexOf('結案') !== -1)   return 4;
  if (s.indexOf('不受理') !== -1) return 5;
  return 9;
}

function statusGroupLabel(s) {
  if (!s) return '其他';
  if (s.indexOf('新案件') !== -1)  return '🔵 新案件';
  if (s.indexOf('處理中') !== -1)  return '🟠 處理中';
  if (s.indexOf('轉交') !== -1)    return '🟣 已轉交相關單位';
  if (s.indexOf('結案') !== -1)    return '🟢 已結案';
  if (s.indexOf('不受理') !== -1)  return '⚪ 不受理';
  return s;
}

function statusGroupKey(s) {
  if (!s) return 'other';
  if (s.indexOf('新案件') !== -1) return '新案件';
  if (s.indexOf('處理中') !== -1) return '處理中';
  if (s.indexOf('轉交')   !== -1) return '已轉交';
  if (s.indexOf('結案')   !== -1) return '已結案';
  if (s.indexOf('不受理') !== -1) return '不受理';
  return s;
}

function badgeCls(s) {
  if (!s) return 'badge-proc';
  if (s.indexOf('新案件') !== -1)  return 'badge-new';
  if (s.indexOf('處理中') !== -1)  return 'badge-proc';
  if (s.indexOf('轉交') !== -1)    return 'badge-fwd';
  if (s.indexOf('結案') !== -1)    return 'badge-done';
  if (s.indexOf('不受理') !== -1)  return 'badge-grey';
  return 'badge-proc';
}

function cardStatusCls(s) {
  if (!s) return 'status-proc';
  if (s.indexOf('新案件') !== -1)  return 'status-new';
  if (s.indexOf('處理中') !== -1)  return 'status-proc';
  if (s.indexOf('轉交') !== -1)    return 'status-fwd';
  if (s.indexOf('結案') !== -1)    return 'status-done';
  if (s.indexOf('不受理') !== -1)  return 'status-grey';
  return 'status-proc';
}

function isPublicCase(d) {
  return d && (d.publicFlag === true || d.publicFlag === 'TRUE' || d.publicFlag === '是' || d.publicFlag === 1 || d.publicFlag === '1');
}

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
  return '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:5px;font-size:11px;font-weight:700;background:' + c.bg + ';color:' + c.txt + '">' +
    '<svg width="9" height="9" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/></svg>' +
    esc(cat) + '</span>';
}

// Extract numeric part from caseId for sort (e.g. "HP-00123" → 123)
function caseIdNum(id) {
  if (!id) return 0;
  var m = String(id).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

// ──────────────────────────────────────────
// STATE
// ──────────────────────────────────────────
var allCases = [];
var currentStatusFilter   = 'all';
var currentCategoryFilter = 'all';
var CASES_CACHE_KEY = new URL(CONFIG.BASE_URL).hostname.split('.')[0] + '_admin_cases_cache_v1';
var chartsDrawn = false;
var chartInstances = [];
var sortableInstances = [];
var GROUP_SORT_OFFSET = { pinned: 0, '新案件': 10000, '處理中': 20000, '已轉交': 30000, '已結案': 40000, '不受理': 50000 };
var vcData = {};
var EYE_SVG = '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';

// ── 批量操作狀態 ──
var batchMode = false;
var selectedCaseIds = new Set();

// ──────────────────────────────────────────
// LOAD DATA
// ──────────────────────────────────────────
function saveCasesCache() {
  try {
    sessionStorage.setItem(CASES_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), cases: allCases || [] }));
  } catch(e) {}
}

function renderCachedCases() {
  try {
    var raw = sessionStorage.getItem(CASES_CACHE_KEY);
    if (!raw) return false;
    var cache = JSON.parse(raw);
    if (!cache || !Array.isArray(cache.cases)) return false;
    allCases = cache.cases;
    buildCategoryChips();
    applyFilters();
    loadViewStats();
    document.getElementById('headerSubtitle').textContent =
      CONFIG.VILLAGE_NAME + '・' + CONFIG.SYSTEM_NAME + '（背景同步中）';
    return true;
  } catch(e) {
    sessionStorage.removeItem(CASES_CACHE_KEY);
    return false;
  }
}

function loadAll() {
  apiCall('getCases')
    .then(function(json){
      if (!json.success) { showError(json.error || '無法取得資料'); return; }
      allCases = json.cases || [];
      saveCasesCache();
      buildCategoryChips();
      applyFilters();
      loadViewStats();
      document.getElementById('headerSubtitle').textContent =
        CONFIG.VILLAGE_NAME + '・' + CONFIG.SYSTEM_NAME;
    })
    .catch(function(){
      showError('資料載入失敗，請稍後再試');
    });
}

function loadViewStats() {
  apiCall('getViewStats', { page: 'openlist' })
    .then(function(json) {
      if (!json.success) return;
      vcData = json.cardCounts || {};
      updateViewBadges();
    })
    .catch(function() {});
}

// ──────────────────────────────────────────
// FILTER & RENDER
// ──────────────────────────────────────────
// ── Dropdown helpers ──
function toggleDropdown(id) {
  var panel = document.getElementById(id).querySelector('.dropdown-panel');
  var btn   = document.getElementById(id).querySelector('.dropdown-btn');
  var wasOpen = panel.classList.contains('open');
  closeAllDropdowns();
  if (!wasOpen) {
    panel.classList.add('open');
    btn.classList.add('open');
    var s = panel.querySelector('.dropdown-search');
    if (s) { s.value = ''; filterDropdown(panel.querySelector('.dropdown-list').id, ''); setTimeout(function(){ s.focus(); }, 50); }
  }
}

function closeAllDropdowns() {
  document.querySelectorAll('.dropdown-panel').forEach(function(p){ p.classList.remove('open'); });
  document.querySelectorAll('.dropdown-btn').forEach(function(b){ b.classList.remove('open'); });
}

document.addEventListener('click', function(e) {
  if (!e.target.closest('.dropdown')) closeAllDropdowns();
});

function filterDropdown(listId, q) {
  var items = document.getElementById(listId).querySelectorAll('.dropdown-item');
  q = (q || '').toLowerCase();
  items.forEach(function(item){
    item.style.display = item.textContent.toLowerCase().indexOf(q) !== -1 ? '' : 'none';
  });
}

function selectStatus(el) {
  currentStatusFilter = el.dataset.value;
  document.querySelectorAll('#statusList .dropdown-item').forEach(function(i){ i.classList.remove('selected'); });
  el.classList.add('selected');
  var label = currentStatusFilter === 'all' ? '案件狀態' : el.querySelector('.item-dot') ? el.textContent.trim() : el.textContent.trim();
  document.getElementById('statusLabel').textContent = label;
  document.getElementById('statusBtn').classList.toggle('active', currentStatusFilter !== 'all');
  closeAllDropdowns();
  applyFilters();
}

function selectCategory(el) {
  currentCategoryFilter = el.dataset.value;
  document.querySelectorAll('#categoryList .dropdown-item').forEach(function(i){ i.classList.remove('selected'); });
  el.classList.add('selected');
  document.getElementById('categoryLabel').textContent = currentCategoryFilter === 'all' ? '通報類別' : el.textContent.trim();
  document.getElementById('categoryBtn').classList.toggle('active', currentCategoryFilter !== 'all');
  closeAllDropdowns();
  applyFilters();
}

function buildCategoryChips() {
  var cats = {};
  allCases.forEach(function(d){ if (d.category) cats[d.category] = true; });
  var keys = Object.keys(cats).sort();
  var list = document.getElementById('categoryList');
  var html = '<div class="dropdown-item selected" data-value="all" onclick="selectCategory(this)">全部類別</div>';
  keys.forEach(function(c){
    html += '<div class="dropdown-item" data-value="' + esc(c) + '" onclick="selectCategory(this)">' + esc(c) + '</div>';
  });
  list.innerHTML = html;
}

function applyFilters() {
  var q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  var statusF   = currentStatusFilter;
  var categoryF = currentCategoryFilter;

  var filtered = allCases.filter(function(d){
    // Category filter
    if (categoryF !== 'all') {
      if ((d.category || '') !== categoryF) return false;
    }
    // Status filter
    if (statusF !== 'all') {
      var s = d.status || '';
      var matched = false;
      if (statusF === '新案件'  && s.indexOf('新案件') !== -1) matched = true;
      if (statusF === '處理中'  && s.indexOf('處理中') !== -1) matched = true;
      if (statusF === '已轉交'  && s.indexOf('轉交')   !== -1) matched = true;
      if (statusF === '已結案'  && s.indexOf('結案')   !== -1) matched = true;
      if (statusF === '不受理'  && s.indexOf('不受理') !== -1) matched = true;
      if (!matched) return false;
    }
    // Text search（涵蓋所有可查詢欄位）
    if (q) {
      var hay = [
        d.caseId, d.title, d.addr, d.category,
        d.desc || d.description, d.name, d.phone, d.lineId,
        d.replyContent, d.case1999, d.note
      ].join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });

  // 排序：置頂優先，再依狀態群組，未手動排序的排最前（新案優先），已排序的依 sortOrder 升冪
  filtered.sort(function(a, b){
    var isPinnedA = a.pinOrder > 0 ? 0 : 1;
    var isPinnedB = b.pinOrder > 0 ? 0 : 1;
    if (isPinnedA !== isPinnedB) return isPinnedA - isPinnedB;
    if (isPinnedA === 1) { // 非置頂：先按狀態群組
      var wa = statusWeight(a.status), wb = statusWeight(b.status);
      if (wa !== wb) return wa - wb;
    }
    var hasA = a.sortOrder > 0, hasB = b.sortOrder > 0;
    if (hasA !== hasB) return hasA ? 1 : -1;
    if (!hasA) return caseIdNum(b.caseId) - caseIdNum(a.caseId);
    return a.sortOrder - b.sortOrder;
  });

  renderGrid(filtered);

  // Update result bar
  var bar = document.getElementById('resultBar');
  var isFiltered = statusF !== 'all' || categoryF !== 'all' || q;
  var tags = '';
  if (statusF   !== 'all') tags += ' <span style="background:var(--primary-light);color:var(--primary);padding:1px 6px;border-radius:4px;font-size:11px">' + statusF + '</span>';
  if (categoryF !== 'all') tags += ' <span style="background:#FFF3E0;color:#B75D00;padding:1px 6px;border-radius:4px;font-size:11px">' + categoryF + '</span>';
  if (q)                   tags += ' <span style="background:#F3EBFF;color:#6B28A8;padding:1px 6px;border-radius:4px;font-size:11px">「' + esc(q) + '」</span>';
  bar.innerHTML =
    '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
    '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> ' +
    '共 <strong>' + filtered.length + '</strong> 筆' +
    (isFiltered ? tags : '・共 ' + allCases.length + ' 筆案件');
}

function renderGrid(cases) {
  var grid = document.getElementById('cardGrid');

  // 銷毀舊的 Sortable 實例
  sortableInstances.forEach(function(s){ try{ s.destroy(); }catch(e){} });
  sortableInstances = [];

  if (!cases.length) {
    grid.innerHTML = '<div class="state-wrap">' +
      '<svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">' +
      '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
      '<h3>沒有符合的案件</h3><p>請嘗試調整搜尋條件或篩選項目</p></div>';
    return;
  }

  // 依群組收集卡片（保留 applyFilters 排序後的順序）
  var groupOrder = ['pinned', '新案件', '處理中', '已轉交', '已結案', '不受理', 'other'];
  var groups = {};
  cases.forEach(function(d){
    var gKey = d.pinOrder > 0 ? 'pinned' : statusGroupKey(d.status);
    if (!groups[gKey]) groups[gKey] = [];
    groups[gKey].push(d);
  });

  var html = '';
  groupOrder.forEach(function(gKey){
    var cards = groups[gKey];
    if (!cards || !cards.length) return;
    var label = gKey === 'pinned' ? '📌 置頂案件' : statusGroupLabel(cards[0].status);
    html += '<div class="group-header">' +
      '<span class="group-label">' + label + '</span>' +
      '<span class="group-count">' + cards.length + ' 筆</span>' +
      '<div class="group-line"></div></div>';
    html += '<div class="group-cards" id="grp-' + gKey + '">';
    cards.forEach(function(d){ html += renderCard(d); });
    html += '</div>';
  });

  grid.innerHTML = html;

  // 初始化 SortableJS
  if (typeof Sortable !== 'undefined') {
    groupOrder.forEach(function(gKey){
      var el = document.getElementById('grp-' + gKey);
      if (!el) return;
      (function(key, container){
        var inst = Sortable.create(container, {
          animation: 150,
          delay: 200,
          delayOnTouchOnly: true,
          filter: '.pin-btn',
          preventOnFilter: false,
          ghostClass: 'sortable-ghost',
          dragClass: 'sortable-drag',
          onEnd: function(){ onSortEnd(key, container); }
        });
        sortableInstances.push(inst);
      })(gKey, el);
    });
  }
}

function onSortEnd(groupKey, el) {
  var offset = GROUP_SORT_OFFSET[groupKey] !== undefined ? GROUP_SORT_OFFSET[groupKey] : 60000;
  var cards = el.querySelectorAll('[data-case-id]');
  var orders = [];
  for (var i = 0; i < cards.length; i++) {
    var cid = cards[i].getAttribute('data-case-id');
    var so = offset + (i + 1) * 10;
    orders.push({ caseId: cid, sortOrder: so });
    for (var j = 0; j < allCases.length; j++) {
      if (allCases[j].caseId === cid) { allCases[j].sortOrder = so; break; }
    }
  }
  apiCall('reorderCases', { orders: orders }).catch(function(){});
}

function imgFallback(img) {
  var wrap = img.closest ? img.closest('.card-thumb-media') : img.parentNode;
  wrap.innerHTML = '<div class="card-thumb-placeholder">' + noPhotoHtml() + '</div>';
}

function fmtNum(n) {
  n = Number(n || 0);
  return n.toLocaleString ? n.toLocaleString('zh-TW') : String(n);
}

function viewBadgeHtml(caseId) {
  return '<span class="thumb-view-badge" id="vc-' + esc(caseId) + '">' + EYE_SVG + '<span>' + fmtNum(vcData[caseId] || 0) + '</span></span>';
}

function shouldShowHandler(d) {
  var handler = String(d.handler || '').trim();
  if (!handler) return false;
  if (/^\d+$/.test(handler)) return false;
  return String(d.status || '').indexOf('新案件') === -1;
}

function updateViewBadges() {
  Object.keys(vcData).forEach(function(id) {
    var el = document.getElementById('vc-' + id);
    if (el) el.innerHTML = EYE_SVG + '<span>' + fmtNum(vcData[id] || 0) + '</span>';
  });
}

function renderCard(d) {
  var hasPhoto = !!d.photo1;
  var thumb = hasPhoto
    ? '<div class="card-thumb"><div class="card-thumb-media"><img src="' + esc(driveImgUrl(d.photo1)) + '" alt="" loading="lazy" onerror="imgFallback(this)"></div>' + viewBadgeHtml(d.caseId) + '</div>'
    : '<div class="card-thumb"><div class="card-thumb-media"><div class="card-thumb-placeholder">' + noPhotoHtml() + '</div></div>' + viewBadgeHtml(d.caseId) + '</div>';

  // Format date
  var dateStr = '';
  if (d.reportTime) {
    var dd = new Date(d.reportTime);
    if (!isNaN(dd.getTime())) {
      dateStr = (dd.getMonth()+1) + '/' + dd.getDate();
    } else {
      dateStr = String(d.reportTime).slice(0,10);
    }
  }

  var isPinned = d.pinOrder > 0;
  var cardCls = 'case-card ' + cardStatusCls(d.status) + (isPinned ? ' is-pinned' : '');
  var html = '<div class="' + cardCls + '" data-case-id="' + esc(d.caseId) + '" onclick="cardClick(event,\'' + esc(d.caseId) + '\')">';
  html += thumb;
  html += '<div class="card-body">';
  html += '<div class="card-top">';
  html += '<label class="batch-cb-wrap" onclick="event.stopPropagation()"><input type="checkbox" class="batch-cb" value="' + esc(d.caseId) + '" onchange="toggleBatchSelect(\'' + esc(d.caseId) + '\')"></label>';
  html += '<span class="card-id">#' + esc(d.caseId) + '</span>';
  if (dateStr) {
    html += '<span class="card-top-info">' +
      '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
      esc(dateStr) + '</span>';
  }
  if (shouldShowHandler(d)) {
    html += '<span class="card-top-info">' +
      '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
      esc(d.handler) + '</span>';
  }
  html += '<div class="card-actions">';
  html += '<button class="pin-btn' + (isPinned ? ' pinned' : '') + '" title="' + (isPinned ? '取消置頂' : '設為置頂') + '" aria-label="' + (isPinned ? '取消置頂' : '設為置頂') + '" onclick="event.stopPropagation();togglePin(\'' + esc(d.caseId) + '\',' + (d.pinOrder || 0) + ')"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15 3a2 2 0 0 1 2 2v2.17c0 .53.21 1.04.59 1.41l1.83 1.83A1 1 0 0 1 18.71 12H13v8a1 1 0 1 1-2 0v-8H5.29a1 1 0 0 1-.71-1.71l1.83-1.83A2 2 0 0 0 7 7.17V5a2 2 0 0 1 2-2h6Z"/></svg></button>';
  html += '<button class="del-btn" title="刪除案件" aria-label="刪除案件" onclick="event.stopPropagation();confirmDeleteCase(\'' + esc(d.caseId) + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>';
  html += '</div>';
  html += '</div>';
  html += '<div class="card-separator"></div>';
  html += '<div class="card-title">' + esc(d.title || '（無標題）') + '</div>';
  html += '<div class="card-location">' +
    '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
    '<span>' + esc(d.addr || '—') + '</span></div>';

  // Meta tags
  html += '<div class="card-meta">';
  if (d.category) {
    html += cateBadge(d.category);
  }
  html += '<span class="badge ' + badgeCls(d.status) + '">' + esc(d.status) + '</span>';
  if (isPublicCase(d)) {
    html += '<span class="badge badge-public">已公開</span>';
  }
  html += '</div>';

  html += '</div></div>'; // .card-body .case-card
  return html;
}

function noPhotoHtml() {
  return '<div class="no-photo-content">' +
    '<span class="no-photo-emoji">📷</span>' +
    '<span class="no-photo-text">尚無照片</span>' +
    '</div>';
}

function openCase(id) {
  for (var i = 0; i < allCases.length; i++) {
    if (allCases[i].caseId === id) {
      try { sessionStorage.setItem('admin_case_preview_' + id, JSON.stringify(allCases[i])); } catch(e) {}
      break;
    }
  }
  window.location.href = DETAIL_PAGE + '?id=' + encodeURIComponent(id);
}

function cardClick(event, caseId) {
  if (event.target.closest('.batch-cb-wrap')) return;
  if (batchMode) {
    toggleBatchSelect(caseId);
  } else {
    openCase(caseId);
  }
}

// ──────────────────────────────────────────
// 批量操作
// ──────────────────────────────────────────
function toggleBatchMode() {
  if (batchMode) { exitBatchMode(); } else { enterBatchMode(); }
}

function enterBatchMode() {
  batchMode = true;
  document.body.classList.add('batch-mode');
  document.getElementById('batchToggleBtn').classList.add('active');
  document.getElementById('batchBar').classList.add('open');
  selectedCaseIds.clear();
  updateBatchBar();
}

function exitBatchMode() {
  batchMode = false;
  document.body.classList.remove('batch-mode');
  document.getElementById('batchToggleBtn').classList.remove('active');
  document.getElementById('batchBar').classList.remove('open');
  selectedCaseIds.clear();
  document.querySelectorAll('.case-card.batch-selected').forEach(function(el){
    el.classList.remove('batch-selected');
    var cb = el.querySelector('.batch-cb');
    if (cb) cb.checked = false;
  });
  document.getElementById('batchStatus').value = '';
  document.getElementById('batchPublicCb').checked = false;
  document.getElementById('batchPublicSummary').value = '';
  document.getElementById('batchReplyContent').value = '';
}

function toggleBatchSelect(caseId) {
  var card = document.querySelector('[data-case-id="' + caseId + '"]');
  var cb = card ? card.querySelector('.batch-cb') : null;
  if (selectedCaseIds.has(caseId)) {
    selectedCaseIds.delete(caseId);
    if (card) card.classList.remove('batch-selected');
    if (cb) cb.checked = false;
  } else {
    selectedCaseIds.add(caseId);
    if (card) card.classList.add('batch-selected');
    if (cb) cb.checked = true;
  }
  updateBatchBar();
}

function selectAllFiltered() {
  document.querySelectorAll('.case-card[data-case-id]').forEach(function(card) {
    var caseId = card.getAttribute('data-case-id');
    selectedCaseIds.add(caseId);
    card.classList.add('batch-selected');
    var cb = card.querySelector('.batch-cb');
    if (cb) cb.checked = true;
  });
  updateBatchBar();
}

function clearBatchSelection() {
  selectedCaseIds.clear();
  document.querySelectorAll('.case-card.batch-selected').forEach(function(el){
    el.classList.remove('batch-selected');
    var cb = el.querySelector('.batch-cb');
    if (cb) cb.checked = false;
  });
  updateBatchBar();
}

function updateBatchBar() {
  var count = selectedCaseIds.size;
  document.getElementById('batchCount').textContent = count;
  var btn = document.getElementById('batchApplyBtn');
  if (btn) btn.disabled = count === 0;
}

function batchApply() {
  var ids = Array.from(selectedCaseIds);
  if (!ids.length) { alert('請先勾選要操作的案件。'); return; }

  var status         = document.getElementById('batchStatus').value;
  var publicFlag     = document.getElementById('batchPublicCb').checked;
  var publicSummary  = document.getElementById('batchPublicSummary').value.trim();
  var replyContent   = document.getElementById('batchReplyContent').value.trim();

  if (!status && !publicFlag && !publicSummary && !replyContent) {
    alert('請至少設定一個要更新的欄位。');
    return;
  }

  var payload = { caseIds: ids };
  if (status)        payload.status        = status;
  if (publicFlag)    payload.publicFlag    = true;
  if (publicSummary) payload.publicSummary = publicSummary;
  if (replyContent)  payload.replyContent  = replyContent;

  var btn = document.getElementById('batchApplyBtn');
  btn.textContent = '套用中…';
  btn.disabled = true;

  apiCall('batchUpdateCases', payload)
    .then(function(json) {
      if (!json.success) {
        alert('批量更新失敗：' + (json.error || '請稍後再試'));
        btn.textContent = '套用到已選案件';
        btn.disabled = false;
        return;
      }
      var updatedMap = {};
      (json.cases || []).forEach(function(c){ updatedMap[c.caseId] = c; });
      allCases = allCases.map(function(c){ return updatedMap[c.caseId] ? updatedMap[c.caseId] : c; });
      saveCasesCache();
      exitBatchMode();
      buildCategoryChips();
      applyFilters();
    })
    .catch(function() {
      alert('網路錯誤，請稍後再試。');
      btn.textContent = '套用到已選案件';
      btn.disabled = false;
    });
}

// ──────────────────────────────────────────
// 置頂功能
// ──────────────────────────────────────────
function togglePin(caseId, currentPinOrder) {
  var newOrder;
  if (currentPinOrder > 0) {
    newOrder = 0; // 取消置頂
  } else {
    // 自動找到最大 pin_order + 1
    var maxPin = 0;
    allCases.forEach(function(c){ if (c.pinOrder > maxPin) maxPin = c.pinOrder; });
    newOrder = maxPin + 1;
  }
  apiCall('pinCase', { caseId: caseId, pinOrder: newOrder })
    .then(function(json) {
      if (!json.success) { alert('置頂操作失敗：' + (json.error || '')); return; }
      var idx = allCases.findIndex(function(c){ return c.caseId === caseId; });
      if (idx !== -1) allCases[idx].pinOrder = newOrder;
      applyFilters();
    })
    .catch(function() { alert('網路錯誤，請稍後再試'); });
}

// ──────────────────────────────────────────
// 刪除案件
// ──────────────────────────────────────────
function confirmDeleteCase(caseId) {
  if (!confirm('確定刪除案件 #' + caseId + '？\n此操作無法復原。')) return;
  apiCall('deleteCase', { caseId: caseId })
    .then(function(json) {
      if (!json.success) { alert('刪除失敗：' + (json.error || '')); return; }
      var idx = allCases.findIndex(function(c){ return c.caseId === caseId; });
      if (idx !== -1) allCases.splice(idx, 1);
      saveCasesCache();
      applyFilters();
    })
    .catch(function() { alert('網路錯誤，請稍後再試'); });
}

function showError(msg) {
  document.getElementById('cardGrid').innerHTML =
    '<div class="state-wrap">' +
    '<svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
    '<h3>載入失敗</h3><p>' + esc(msg) + '</p></div>';
  document.getElementById('resultBar').textContent = '載入失敗';
}

// ──────────────────────────────────────────
// SIDEBAR TOGGLE
// ──────────────────────────────────────────
var sidebarOpen = false;

function toggleSidebar() {
  sidebarOpen ? closeSidebar() : openSidebar();
}

function openSidebar() {
  sidebarOpen = true;
  document.getElementById('statsSidebar').classList.add('open');
  document.getElementById('backdrop').classList.add('open');
  document.getElementById('statsToggleBtn').classList.add('active');
  if (!chartsDrawn && allCases.length) {
    renderStats();
  }
}

function closeSidebar() {
  sidebarOpen = false;
  document.getElementById('statsSidebar').classList.remove('open');
  document.getElementById('backdrop').classList.remove('open');
  document.getElementById('statsToggleBtn').classList.remove('active');
}

// ──────────────────────────────────────────
// STATS & CHARTS
// ──────────────────────────────────────────
function renderStats() {
  var now = new Date();
  var thisYear  = now.getFullYear();
  var thisMonth = now.getMonth(); // 0-based

  // Parse reportTime
  function parseDate(ts) {
    if (!ts) return null;
    var d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  }

  var monthCount = 0, yearCount = 0;
  var catMap = {}, statusMap = {}, monthlyMap = {};

  // Build last-6-months keys
  var last6 = [];
  for (var i = 5; i >= 0; i--) {
    var d = new Date(thisYear, thisMonth - i, 1);
    var key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
    last6.push(key);
    monthlyMap[key] = 0;
  }

  // Unresolved > 7 days
  var overdueCount = 0;
  var totalResolveDays = 0, resolvedCount = 0;

  allCases.forEach(function(d){
    var dt = parseDate(d.reportTime);
    var s  = d.status || '';
    var c  = d.category || '其他';

    // Monthly / yearly
    if (dt) {
      if (dt.getFullYear() === thisYear) {
        yearCount++;
        if (dt.getMonth() === thisMonth) monthCount++;
        var mk = dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0');
        if (monthlyMap[mk] !== undefined) monthlyMap[mk]++;
      }
    }

    // Category map
    catMap[c] = (catMap[c] || 0) + 1;

    // Status map
    var sl = s.indexOf('新案件') !== -1 ? '新案件'
           : s.indexOf('處理中') !== -1 ? '處理中'
           : s.indexOf('轉交')   !== -1 ? '已轉交'
           : s.indexOf('結案')   !== -1 ? '已結案'
           : s.indexOf('不受理') !== -1 ? '不受理'
           : (s || '其他');
    statusMap[sl] = (statusMap[sl] || 0) + 1;

    // Overdue: not closed and > 7 days
    if (s.indexOf('結案') === -1 && s.indexOf('不受理') === -1 && dt) {
      var daysDiff = Math.floor((now - dt) / 86400000);
      if (daysDiff > 7) overdueCount++;
    }

    // Avg resolve days
    if (s.indexOf('結案') !== -1 && dt) {
      var replyDt = parseDate(d.replyTime);
      if (replyDt) {
        totalResolveDays += Math.max(0, Math.floor((replyDt - dt) / 86400000));
        resolvedCount++;
      }
    }
  });

  var avgDays = resolvedCount ? Math.round(totalResolveDays / resolvedCount) : null;

  // Category pie colors
  var CAT_COLORS = ['#4B7A52','#6FAB76','#F4A261','#E76F51','#457B9D','#A8DADC','#B5838D','#6B7C93'];
  var catKeys = Object.keys(catMap);
  var catVals = catKeys.map(function(k){ return catMap[k]; });
  var catColors = catKeys.map(function(_,i){ return CAT_COLORS[i % CAT_COLORS.length]; });

  // Status bar colors
  var statusOrder = ['新案件','處理中','已轉交','已結案','不受理'];
  var statusColors = {
    '新案件': '#1A56A8', '處理中': '#B75D00',
    '已轉交': '#6B28A8', '已結案': '#2F6836', '不受理': '#7A6E66'
  };
  var statusKeys = statusOrder.filter(function(k){ return statusMap[k]; });
  var statusVals = statusKeys.map(function(k){ return statusMap[k] || 0; });
  var statusColors2 = statusKeys.map(function(k){ return statusColors[k] || '#aaa'; });

  // Monthly line
  var lineLabels = last6.map(function(k){ return k.slice(5) + '月'; });
  var lineVals   = last6.map(function(k){ return monthlyMap[k] || 0; });

  // HTML
  var html = '';

  // Big summary boxes
  html += '<div style="margin-bottom:8px;font-size:11px;font-weight:700;color:var(--lbl);letter-spacing:.5px;text-transform:uppercase">本月 / 本年概覽</div>';

  html += '<div class="stat-grid">';
  html += '<div class="stat-box"><div class="stat-num">' + monthCount + '</div><div class="stat-lbl">本月案件</div></div>';
  html += '<div class="stat-box"><div class="stat-num">' + yearCount  + '</div><div class="stat-lbl">本年案件</div></div>';
  html += '</div>';

  // Extra metrics
  html += '<div style="margin-bottom:20px">';
  html += '<div class="stat-row"><span class="stat-row-lbl">⏰ 超過7天未結案</span><span class="stat-row-val' + (overdueCount > 0 ? ' warn' : ' ok') + '">' + overdueCount + ' 件</span></div>';
  if (avgDays !== null) {
    html += '<div class="stat-row"><span class="stat-row-lbl">📅 平均結案天數</span><span class="stat-row-val">' + avgDays + ' 天</span></div>';
  }
  html += '<div class="stat-row"><span class="stat-row-lbl">📁 總案件數</span><span class="stat-row-val">' + allCases.length + ' 件</span></div>';
  html += '</div>';

  // Charts
  html += '<div class="chart-section"><div class="chart-title">' +
    '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
    '案件類別分布</div>' +
    '<div class="chart-wrap pie-wrap"><canvas id="catPieChart"></canvas></div></div>';

  html += '<div class="chart-section"><div class="chart-title">' +
    '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>' +
    '各狀態分布</div>' +
    '<div class="chart-wrap bar-wrap"><canvas id="statusBarChart"></canvas></div></div>';

  html += '<div class="chart-section"><div class="chart-title">' +
    '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>' +
    '近6個月新增趨勢</div>' +
    '<div class="chart-wrap line-wrap"><canvas id="trendLineChart"></canvas></div></div>';

  document.getElementById('sidebarBody').innerHTML = html;

  // Destroy old charts
  chartInstances.forEach(function(c){ try{ c.destroy(); }catch(e){} });
  chartInstances = [];

  var fontDef = { family: "'Noto Sans TC', sans-serif", size: 11 };

  // Pie chart
  var pie = new Chart(document.getElementById('catPieChart'), {
    type: 'doughnut',
    data: {
      labels: catKeys,
      datasets: [{ data: catVals, backgroundColor: catColors, borderWidth: 2, borderColor: '#fff' }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { font: fontDef, boxWidth: 12, padding: 8 } },
        tooltip: { callbacks: {
          label: function(ctx){
            var total = ctx.dataset.data.reduce(function(a,b){return a+b;},0);
            return ctx.label + ': ' + ctx.raw + ' (' + Math.round(ctx.raw/total*100) + '%)';
          }
        }}
      }
    }
  });
  chartInstances.push(pie);

  // Bar chart
  var bar = new Chart(document.getElementById('statusBarChart'), {
    type: 'bar',
    data: {
      labels: statusKeys,
      datasets: [{
        data: statusVals,
        backgroundColor: statusColors2.map(function(c){ return c + 'CC'; }),
        borderColor: statusColors2,
        borderWidth: 1.5, borderRadius: 5,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        label: function(ctx){ return ' ' + ctx.raw + ' 件'; }
      }}},
      scales: {
        x: { beginAtZero: true, ticks: { font: fontDef, stepSize: 1 }, grid: { color: '#EDE7DF' } },
        y: { ticks: { font: fontDef }, grid: { display: false } }
      }
    }
  });
  chartInstances.push(bar);

  // Line chart
  var line = new Chart(document.getElementById('trendLineChart'), {
    type: 'line',
    data: {
      labels: lineLabels,
      datasets: [{
        label: '新增案件',
        data: lineVals,
        borderColor: '#4B7A52',
        backgroundColor: 'rgba(75,122,82,.12)',
        borderWidth: 2,
        pointBackgroundColor: '#4B7A52',
        pointRadius: 4,
        fill: true, tension: 0.4
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        label: function(ctx){ return ' ' + ctx.raw + ' 件'; }
      }}},
      scales: {
        x: { ticks: { font: fontDef }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { font: fontDef, stepSize: 1 }, grid: { color: '#EDE7DF' } }
      }
    }
  });
  chartInstances.push(line);

  chartsDrawn = true;
}

openSidebar = function() {
  sidebarOpen = true;
  document.getElementById('statsSidebar').classList.add('open');
  document.getElementById('backdrop').classList.add('open');
  document.getElementById('statsToggleBtn').classList.add('active');
  if (allCases.length) {
    // Always re-render to reflect current data
    chartsDrawn = false;
    chartInstances.forEach(function(c){ try{ c.destroy(); }catch(e){} });
    chartInstances = [];
    renderStats();
  }
};

// ──────────────────────────────────────────
// AUTO REFRESH（每 60 秒靜默背景更新）
// ──────────────────────────────────────────
var _refreshing = false;
function silentRefresh() {
  if (_refreshing) return;
  _refreshing = true;
  apiCall('getCases')
    .then(function(json){
      if (!json.success) return;
      var fresh = json.cases || [];
      // 比較總筆數 + 最後一筆 ID，有差異才重繪
      var changed = fresh.length !== allCases.length ||
        (fresh.length && allCases.length &&
         fresh[0].caseId !== allCases[0].caseId) ||
        (fresh.length && allCases.length &&
         fresh[fresh.length-1].lastUpdate !== allCases[allCases.length-1].lastUpdate);
      if (changed) {
        allCases = fresh;
        saveCasesCache();
        buildCategoryChips();
        applyFilters();
        if (sidebarOpen) { chartsDrawn = false; renderStats(); }
      }
    })
    .catch(function(){})
    .finally(function(){ _refreshing = false; });
}

// ──────────────────────────────────────────
// INIT
// ──────────────────────────────────────────
renderCachedCases();
loadAll();
setInterval(silentRefresh, 60000);
['click','keydown','mousedown','touchstart','scroll'].forEach(function(eventName){
  window.addEventListener(eventName, function(){ touchSession(); }, { passive: true });
});
