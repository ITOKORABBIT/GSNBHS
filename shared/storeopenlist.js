
var CATE_COLOR = {
  '美食地圖': { bg:'#E6F7F0', txt:'#0F7A5C' },
  '飲料冰品': { bg:'#EFF6FF', txt:'#1D4ED8' },
  '健康醫療': { bg:'#F3EBFF', txt:'#6B28A8' },
  '生活便利': { bg:'#E0F7FA', txt:'#036672' },
  '住宅相關': { bg:'#FFF3E0', txt:'#B75D00' },
  '寵物專區': { bg:'#FFF1F4', txt:'#B4235A' },
  '其他': { bg:'#F0EEEC', txt:'#7A6E66' },
};
var FOOD_CATES = ['美食地圖', '飲料冰品', '健康醫療', '生活便利', '住宅相關', '寵物專區'];

function brandTags(d){ var raw = Array.isArray(d.brandTags) && d.brandTags.length ? d.brandTags : [d.brandTag]; return raw.map(function(tag){ return String(tag || '').trim(); }).filter(Boolean).slice(0,3); }
var storeBrandTagDefs = [];
var BRAND_TAG_PALETTE = {
  gold:{ bg:'#FFF3E0', txt:'#B75D00', bd:'#F5D7A2' }, mint:{ bg:'#EAF3EB', txt:'#2F6836', bd:'#CFE2D3' },
  blue:{ bg:'#EFF6FF', txt:'#2563EB', bd:'#BFDBFE' }, rose:{ bg:'#FFF1F4', txt:'#B4235A', bd:'#F7C1CF' },
  violet:{ bg:'#F5F0FF', txt:'#6B28A8', bd:'#DCCBFF' }, stone:{ bg:'#F0EEEC', txt:'#7A6E66', bd:'#D8D0C8' }
};
function brandTagStyle(tag) {
  var def = storeBrandTagDefs.find(function(item){ return item.name === tag; }) || { color:'gold' };
  var color = BRAND_TAG_PALETTE[def.color] || BRAND_TAG_PALETTE.gold;
  return 'background:' + color.bg + ';color:' + color.txt + ';border-color:' + color.bd;
}
function loadStoreBrandTagDefs() {
  apiCall('getPublicStoreTaxonomy').then(function(json){
    storeBrandTagDefs = json.success && json.taxonomy && Array.isArray(json.taxonomy.brandTagDefs) ? json.taxonomy.brandTagDefs : [];
    if (allStores.length) applyFilters();
  }).catch(function(){});
}

function cateBadge(cat) {
  var c = CATE_COLOR[cat] || { bg:'#F0EEEC', txt:'#7A6E66' };
  return '<span class="cate-badge" style="background:' + c.bg + ';color:' + c.txt + '">' + esc(cat) + '</span>';
}

var allStores = [];
var currentCate = 'all';
var vcData = {};
var vcNamesMap = {};
var EYE_SVG = '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="display:inline;vertical-align:-1px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';

function fmtNum(n) {
  return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function loadViewStats() {
  apiCall('getViewStats', { page: 'storelist' })
    .then(function(json) {
      if (!json.success) return;
      vcData = json.cardCounts || {};
      document.getElementById('statsRow').style.display = 'flex';
      document.getElementById('pageViewCount').textContent = fmtNum(json.pageCount);
      updateViewBadges();
    })
    .catch(function() {});
}

function recordCardView(id) {
  apiCall('recordCardView', { page: 'storelist', itemId: id }).catch(function() {});
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

function apiCall(action, extra) {
  var payload = Object.assign({ action: action }, extra || {});
  var storeApiActions = { getPublicStores: true, getPublicStore: true, getPublicStoreTaxonomy: true, getViewStats: true, recordCardView: true };
  var endpoint = (CONFIG.STORE_API_URL && storeApiActions[action]) ? CONFIG.STORE_API_URL : CONFIG.SCRIPT_URL;
  return fetch(endpoint, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  })
  .then(function(r){ return r.text(); })
  .then(function(t){ return JSON.parse(t); });
}

function applySnapshot(stores) {
  allStores = stores;
  allStores.forEach(function(d) {
    vcNamesMap[d.storeId] = d.pubName || d.storeId;
  });
  buildCateChips();
  applyFilters();
  document.getElementById('headerSubtitle').textContent =
    CONFIG.VILLAGE_NAME + '・' + CONFIG.SYSTEM_NAME;
}

function loadStores() {
  // 先從 sessionStorage 即時渲染（返回時不等 GAS）
  try {
    var cached = JSON.parse(sessionStorage.getItem('pub_stores_cache') || 'null');
    if (cached && Array.isArray(cached) && cached.length) {
      applySnapshot(cached);
      loadViewStats();
    }
  } catch(e) {}

  // 背景更新最新資料
  apiCall('getPublicStores')
    .then(function(json){
      if (!json.success) {
        if (!allStores.length) showError(json.error || '無法取得資料');
        return;
      }
      try { sessionStorage.setItem('pub_stores_cache', JSON.stringify(json.stores || [])); } catch(e) {}
      applySnapshot(json.stores || []);
      loadViewStats();
    })
    .catch(function(){
      if (!allStores.length) showError('資料載入失敗，請稍後再試');
    });
}

function buildCateChips() {
  var cats = {};
  allStores.forEach(function(d){ if (d.pubCate) cats[d.pubCate] = true; });
  var keys = Object.keys(cats).sort(function(a,b){
    var order = ['美食地圖','飲料冰品','健康醫療','生活便利','住宅相關','寵物專區','其他'];
    var ia = order.indexOf(a), ib = order.indexOf(b);
    if (ia === -1) ia = 999; if (ib === -1) ib = 999;
    return ia - ib;
  });
  var wrap = document.getElementById('cateChips');
  var html = '<span class="cate-chip active" data-cate="all" onclick="selectCate(this)">全部類別</span>';
  keys.forEach(function(c){
    var col = CATE_COLOR[c] || { bg:'#F0EEEC', txt:'#7A6E66' };
    html += '<span class="cate-chip" data-cate="' + esc(c) + '" onclick="selectCate(this)"' +
      ' style="--chip-bg:' + col.bg + ';--chip-txt:' + col.txt + '">' + esc(c) + '</span>';
  });
  wrap.innerHTML = html;
}

function selectCate(el) {
  currentCate = el.dataset.cate;
  document.querySelectorAll('.cate-chip').forEach(function(c){ c.classList.remove('active'); });
  el.classList.add('active');
  applyFilters();
}

function categoryWeight(d) {
  var idx = FOOD_CATES.indexOf(d.pubCate || '');
  if (idx !== -1) return idx + 1;
  return 4;
}

function applyFilters() {
  var q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  var filtered = allStores.filter(function(d){
    if (currentCate !== 'all' && (d.pubCate || '') !== currentCate) return false;
    if (q) {
      var hay = [d.pubName, d.pubCate, brandTags(d).join(' '), d.pubAddr, d.pubDesc, d.pubOffer].join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });

  filtered.sort(function(a, b) {
    var wa = categoryWeight(a), wb = categoryWeight(b);
    if (wa !== wb) return wa - wb;
    var ha = a.sortOrder > 0, hb = b.sortOrder > 0;
    if (ha !== hb) return ha ? 1 : -1;
    if (!ha) return b.storeId.localeCompare(a.storeId);
    return a.sortOrder - b.sortOrder;
  });

  renderGrid(filtered);
  document.getElementById('resultBar').innerHTML =
    '共 <strong>' + filtered.length + '</strong> 家商店' +
    (allStores.length !== filtered.length ? '・全部 ' + allStores.length + ' 家' : '');
}

function sectionHeader(label) {
  return '<div class="section-header"><span class="section-header-label">' + label + '</span>' +
    '<div class="section-header-line"></div></div>';
}

function renderGrid(stores) {
  var grid = document.getElementById('cardGrid');
  if (!stores.length) {
    grid.innerHTML = '<div class="state-wrap">' +
      '<svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">' +
      '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
      '<h3>沒有符合的商店</h3><p>請嘗試調整搜尋條件</p></div>';
    return;
  }

  var groups = FOOD_CATES.map(function(c){ return { key: c, label: c, stores: [] }; });
  groups.push({ key: 'other', label: '其他各行各業', stores: [] });

  stores.forEach(function(d) {
    var idx = FOOD_CATES.indexOf(d.pubCate || '');
    groups[idx === -1 ? 3 : idx].stores.push(d);
  });

  var html = '';
  groups.forEach(function(group) {
    if (!group.stores.length) return;
    html += sectionHeader(group.label + ' <span style="color:var(--muted);font-weight:600"> ' + group.stores.length + ' 間</span>');
    group.stores.forEach(function(d) {
      html += renderCard(d);
    });
  });
  grid.innerHTML = html;
}

function imgFallback(img) {
  var wrap = img.parentNode;
  var badge = wrap.querySelector('.thumb-view-badge');
  wrap.innerHTML = '<div class="card-thumb-placeholder">' +
    '<svg width="32" height="32" fill="none" stroke="#4A92C4" stroke-width="1.5" opacity=".5" viewBox="0 0 24 24">' +
    '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>' +
    (badge ? badge.outerHTML : '');
}

function renderCard(d) {
  var thumb = d.photo1
    ? '<div class="card-thumb"><img src="' + esc(d.photo1) + '" alt="" loading="lazy" onerror="imgFallback(this)">' + viewBadgeHtml(d.storeId) + '</div>'
    : '<div class="card-thumb"><div class="card-thumb-placeholder">' +
      '<svg width="32" height="32" fill="none" stroke="#4A92C4" stroke-width="1.5" opacity=".5" viewBox="0 0 24 24">' +
      '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>' +
      viewBadgeHtml(d.storeId) + '</div>';

  var html = '<div class="store-card" onclick="openStore(\'' + esc(d.storeId) + '\')" style="cursor:pointer">';
  html += thumb;
  html += '<div class="card-body">';
  html += '<div class="card-name">' + esc(d.pubName || '（未命名）') + '</div>';
  if (d.pubPhone) {
    html += '<div class="card-phone">' +
      '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.41 2 2 0 0 1 3.6 1.25h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.85a16 16 0 0 0 6.29 6.29l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' +
      '<a href="tel:' + esc(d.pubPhone) + '" onclick="event.stopPropagation()" style="color:var(--primary);text-decoration:none">' + esc(d.pubPhone) + '</a></div>';
  }
  if (d.pubAddr) {
    html += '<div class="card-address">' +
      '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
      (d.pubMapUrl
        ? '<a href="' + esc(d.pubMapUrl) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()" class="card-address-text" style="color:var(--primary);text-decoration:none">' + esc(d.pubAddr) + '</a>'
        : '<span class="card-address-text">' + esc(d.pubAddr) + '</span>') +
      '</div>';
  }
  html += '<div class="card-meta">';
  if (d.pubCate) html += cateBadge(d.pubCate);
  brandTags(d).forEach(function(tag){ html += '<span class="brand-tag" style="' + brandTagStyle(tag) + '">' + esc(tag) + '</span>'; });
  html += '</div>';
  html += '<div class="card-offer-divider"></div>';
  if (d.pubOffer) html += '<div class="card-offer-label">優惠活動</div><div class="card-desc">' + esc(d.pubOffer) + '</div>';
  html += '</div>';
  html += '</div>';
  return html;
}

function viewBadgeHtml(storeId) {
  return '<span class="thumb-view-badge" id="vc-' + esc(storeId) + '">' + EYE_SVG + '<span>' + fmtNum(vcData[storeId] || 0) + '</span></span>';
}

function updateViewBadges() {
  Object.keys(vcData).forEach(function(id) {
    var el = document.getElementById('vc-' + id);
    if (el) el.innerHTML = EYE_SVG + '<span>' + fmtNum(vcData[id] || 0) + '</span>';
  });
}

function showError(msg) {
  document.getElementById('cardGrid').innerHTML =
    '<div class="state-wrap">' +
    '<svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
    '<h3>載入失敗</h3><p>' + esc(msg) + '</p></div>';
  document.getElementById('resultBar').textContent = '載入失敗';
}

function openStore(id) {
  recordCardView(id);
  vcData[id] = (vcData[id] || 0) + 1;
  for (var i = 0; i < allStores.length; i++) {
    if (allStores[i].storeId === id) {
      try { sessionStorage.setItem('store_preview_' + id, JSON.stringify(allStores[i])); } catch(e) {}
      break;
    }
  }
  window.location.href = 'storeopendetail.html?id=' + encodeURIComponent(id);
}

loadStoreBrandTagDefs();
loadStores();
setInterval(function(){ loadStores(); }, 60000);
