
var CASE_ACTIONS = { getPublicCases: 1, getPublicCase: 1, getViewStats: 1, recordCardView: 1 };
function apiCall(action, extra) {
  var payload = Object.assign({ action: action }, extra || {});
  var url = CASE_ACTIONS[action] ? CONFIG.CASE_API_URL : CONFIG.SCRIPT_URL;
  var isCaseApi = !!CASE_ACTIONS[action];
  return fetch(url, {
    method: 'POST',
    redirect: isCaseApi ? undefined : 'follow',
    headers: { 'Content-Type': isCaseApi ? 'application/json' : 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  })
  .then(function(r) { return r.json(); });
}

var CATE_COLOR = {
  '生活': { bg:'#e0f7fa', txt:'#006b6b' },
  '校園': { bg:'#fff3e0', txt:'#b75d00' },
  '交通': { bg:'#ebf3ff', txt:'#1a56a8' },
  '環境': { bg:'#eaf3eb', txt:'#2f6836' },
  '治安': { bg:'#fee2e2', txt:'#991b1b' },
  '修繕': { bg:'#fff8e1', txt:'#f57f17' },
  '其他': { bg:'#f0eeec', txt:'#7a6e66' }
};

var STATUS_COLOR = {
  '處理中': { bg:'#fff8e1', txt:'#b75d00' },
  '已結案': { bg:'#f0eeec', txt:'#7a6e66' }
};

function statusBadge(status) {
  if (!status) return '';
  var color = STATUS_COLOR[status] || { bg:'#f0eeec', txt:'#7a6e66' };
  return '<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:' + color.bg + ';color:' + color.txt + '">' + esc(status) + '</span>';
}

function cateBadge(cat) {
  if (!cat) return '';
  var color = CATE_COLOR[cat] || { bg:'#f0eeec', txt:'#7a6e66' };
  return '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:5px;font-size:11px;font-weight:700;background:' + color.bg + ';color:' + color.txt + '">' +
    '<svg width="9" height="9" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/></svg>' +
    esc(cat) + '</span>';
}

var allCases = [];
var currentCategoryFilter = 'all';
var vcData = {};
var vcNamesMap = {};
var EYE_SVG = '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="display:inline;vertical-align:-1px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';

function fmtNum(n) {
  return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function loadViewStats() {
  apiCall('getViewStats', { page: 'openlist' })
    .then(function(json) {
      if (!json.success) return;
      vcData = json.cardCounts || {};
      document.getElementById('statsRow').style.display = 'flex';
      document.getElementById('pageViewCount').textContent = fmtNum(json.pageCount);
      updateViewBadges();
    })
    .catch(function() {});
}

function updateViewBadges() {
  Object.keys(vcData).forEach(function(id) {
    var el = document.getElementById('vc-' + id);
    if (el) el.innerHTML = EYE_SVG + ' ' + fmtNum(vcData[id]);
  });
}

function recordCardView(id) {
  apiCall('recordCardView', { page: 'openlist', itemId: id }).catch(function() {});
}

function openVmModal() {
  var entries = Object.keys(vcData).map(function(id) {
    return { id: id, name: vcNamesMap[id] || id, count: vcData[id] };
  });
  entries.sort(function(a, b) { return b.count - a.count; });
  var top5 = entries.slice(0, 5);
  var cls = ['r1', 'r2', 'r3', '', ''];
  var html = top5.length
    ? top5.map(function(item, i) {
        return '<div class="rank-row">' +
          '<div class="rank-num ' + (cls[i] || '') + '">' + (i + 1) + '</div>' +
          '<div class="rank-name">' + esc(item.name) + '</div>' +
          '<div class="rank-cnt">' + EYE_SVG + ' ' + fmtNum(item.count) + '</div>' +
          '</div>';
      }).join('')
    : '<div class="vm-empty">尚無點閱資料</div>';
  document.getElementById('vmBody').innerHTML = html;
  document.getElementById('vmBackdrop').classList.add('open');
}

function closeVmModal(e) {
  if (e.target === document.getElementById('vmBackdrop')) closeVmModalDirect();
}
function closeVmModalDirect() {
  document.getElementById('vmBackdrop').classList.remove('open');
}

function applySnapshot(cases) {
  allCases = cases;
  allCases.forEach(function(item) {
    vcNamesMap[item.caseId] = item.publicTitle || item.caseId;
  });
  buildCategoryChips();
  applyFilters();
  document.getElementById('headerSubtitle').textContent = CONFIG.VILLAGE_NAME + ' ' + CONFIG.SYSTEM_NAME;
}

function loadAll() {
  // 先從 sessionStorage 即時渲染（返回時不等 GAS）
  try {
    var cached = JSON.parse(sessionStorage.getItem('pub_cases_cache') || 'null');
    if (cached && Array.isArray(cached) && cached.length) {
      applySnapshot(cached);
      loadViewStats();
    }
  } catch(e) {}

  // 背景更新最新資料
  apiCall('getPublicCases')
    .then(function(json) {
      if (!json.success) {
        if (!allCases.length) showError(json.error || '載入案件失敗');
        return;
      }
      try { sessionStorage.setItem('pub_cases_cache', JSON.stringify(json.cases || [])); } catch(e) {}
      applySnapshot(json.cases || []);
      loadViewStats();
    })
    .catch(function() {
      if (!allCases.length) showError('載入失敗，請稍後再試');
    });
}

function toggleDropdown(id) {
  var root = document.getElementById(id);
  var panel = root.querySelector('.dropdown-panel');
  var btn = root.querySelector('.dropdown-btn');
  var wasOpen = panel.classList.contains('open');
  closeAllDropdowns();
  if (!wasOpen) {
    panel.classList.add('open');
    btn.classList.add('open');
  }
}

function closeAllDropdowns() {
  document.querySelectorAll('.dropdown-panel').forEach(function(p) { p.classList.remove('open'); });
  document.querySelectorAll('.dropdown-btn').forEach(function(b) { b.classList.remove('open'); });
}

document.addEventListener('click', function(e) {
  if (!e.target.closest('.dropdown')) closeAllDropdowns();
});

function selectCategory(el) {
  currentCategoryFilter = el.dataset.value;
  document.querySelectorAll('#categoryList .dropdown-item').forEach(function(item) {
    item.classList.remove('selected');
  });
  el.classList.add('selected');
  document.getElementById('categoryLabel').textContent = currentCategoryFilter === 'all' ? '全部類別' : el.textContent.trim();
  document.getElementById('categoryBtn').classList.toggle('active', currentCategoryFilter !== 'all');
  closeAllDropdowns();
  applyFilters();
}

function buildCategoryChips() {
  var cats = {};
  allCases.forEach(function(item) {
    if (item.publicCate) cats[item.publicCate] = true;
  });

  var keys = Object.keys(cats).sort();
  var html = '<div class="dropdown-item selected" data-value="all" onclick="selectCategory(this)">全部類別</div>';

  keys.forEach(function(cat) {
    html += '<div class="dropdown-item" data-value="' + esc(cat) + '" onclick="selectCategory(this)">' + esc(cat) + '</div>';
  });

  document.getElementById('categoryList').innerHTML = html;
}

function applyFilters() {
  var q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  var filtered = allCases.filter(function(item) {
    if (currentCategoryFilter !== 'all' && (item.publicCate || '') !== currentCategoryFilter) return false;
    if (!q) return true;
    var haystack = [item.publicTitle, item.publicCate, item.publicLoc, item.publicSummary].join(' ').toLowerCase();
    return haystack.indexOf(q) !== -1;
  });

  renderGrid(filtered);
  updateViewBadges();
  document.getElementById('resultBar').innerHTML = '共 <strong>' + filtered.length + '</strong> 筆公開案件' +
    (allCases.length !== filtered.length ? '，全部 ' + allCases.length + ' 筆' : '');
}

function renderGrid(cases) {
  var grid = document.getElementById('cardGrid');
  if (!cases.length) {
    grid.innerHTML = '<div class="state-wrap">' +
      '<svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">' +
      '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
      '<h3>沒有符合的案件</h3><p>請嘗試調整搜尋條件</p></div>';
    return;
  }

  grid.innerHTML = cases.map(renderCard).join('');
}

function imgFallback(img) {
  img.parentNode.innerHTML = '<div class="card-thumb-placeholder">' +
    '<svg width="28" height="28" fill="none" stroke="#b8a898" stroke-width="1.5" viewBox="0 0 24 24">' +
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>' +
    '<polyline points="21 15 16 10 5 21"/></svg></div>';
}

function formatReplyDate(replyTime) {
  if (!replyTime) return '';
  var date = new Date(replyTime);
  if (isNaN(date.getTime())) return String(replyTime).slice(0, 10);
  return date.getFullYear() + '/' + (date.getMonth() + 1) + '/' + date.getDate();
}

function renderCard(item) {
  // 尚未填寫處理照片時，改用通報時上傳的照片
  var thumbSrc = item.repPhoto1 || item.photo1;
  var thumb = thumbSrc
    ? '<div class="card-thumb"><img src="' + esc(thumbSrc) + '" alt="" loading="lazy" onerror="imgFallback(this)"></div>'
    : '<div class="card-thumb"><div class="card-thumb-placeholder">' +
      '<svg width="28" height="28" fill="none" stroke="#b8a898" stroke-width="1.5" viewBox="0 0 24 24">' +
      '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>' +
      '<polyline points="21 15 16 10 5 21"/></svg></div></div>';

  var html = '<div class="case-card" onclick="openCase(\'' + esc(item.caseId) + '\')">';
  html += thumb;
  html += '<div class="card-body">';
  html += '<div class="card-top">';
  html += '<span class="card-date">';
  if (item.replyTime) {
    html += '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="display:inline;vertical-align:-1px;margin-right:3px"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' + esc(formatReplyDate(item.replyTime));
  }
  html += '</span>';
  html += '<span class="vc-badge" id="vc-' + esc(item.caseId) + '">' + EYE_SVG + ' –</span>';
  html += '</div>';
  html += '<div class="card-title">' + esc(item.publicTitle || '（無標題）') + '</div>';
  html += '<div class="card-location">';
  if (item.publicLoc) {
    html += '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="display:inline;vertical-align:-1px;margin-right:3px"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' + esc(item.publicLoc);
  }
  html += '</div>';
  html += '<div class="card-tags">';
  if (item.publicCate) html += cateBadge(item.publicCate);
  if (item.status) html += statusBadge(item.status);
  html += '</div></div></div>';
  return html;
}

function openCase(id) {
  recordCardView(id);
  vcData[id] = (vcData[id] || 0) + 1;
  for (var i = 0; i < allCases.length; i++) {
    if (allCases[i].caseId === id) {
      try { sessionStorage.setItem('case_preview_' + id, JSON.stringify(allCases[i])); } catch(e) {}
      break;
    }
  }
  window.location.href = 'opendetail.html?id=' + encodeURIComponent(id);
}

function showError(message) {
  document.getElementById('resultBar').textContent = '載入失敗';
  document.getElementById('cardGrid').innerHTML = '<div class="state-wrap">' +
    '<svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">' +
    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
    '<h3>無法載入案件</h3><p>' + esc(message) + '</p></div>';
}

loadAll();
