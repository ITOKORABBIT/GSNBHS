
(function(){
  if (/Line\//i.test(navigator.userAgent)) {
    var url = new URL(location.href);
    if (!url.searchParams.has('openExternalBrowser')) {
      url.searchParams.set('openExternalBrowser', '1');
      location.replace(url.toString());
    }
  }
})();

function showLogin(message) {
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  var el = document.getElementById('loginError');
  if (message) {
    el.textContent = message;
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}
function enterApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'block';
  var redirect = new URLSearchParams(location.search).get('redirect') || '';
  if (redirect) {
    try {
      var url = new URL(redirect, location.origin);
      if (url.origin === location.origin && url.pathname !== location.pathname) {
        location.href = redirect;
        return;
      }
    } catch (e) {}
  }
  renderCachedStores();
  loadStoreBrandTagDefs();
  loadAll();
}
function initGoogle() {
  var sess = getSession();
  if (sess) { enterApp(); return; }
  showLogin();
  if (!CONFIG.GOOGLE_CLIENT_ID) return;
  if (typeof google === 'undefined') { setTimeout(initGoogle, 300); return; }
  google.accounts.id.initialize({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    callback: onGoogleSignIn,
    auto_select: true
  });
  google.accounts.id.renderButton(
    document.getElementById('loginBtnWrap'),
    { type: 'standard', theme: 'filled_blue', size: 'large', text: 'signin_with', locale: 'zh-TW', width: 280 }
  );
  google.accounts.id.prompt();
}
function onGoogleSignIn(resp) {
  document.getElementById('loginError').style.display = 'none';
  fetch(CONFIG.STORE_API_URL || CONFIG.SCRIPT_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'login', id_token: resp.credential })
  })
  .then(function(r){ return r.text(); })
  .then(function(t){ return JSON.parse(t); })
  .then(function(json){
    if (!json.success) { showLogin(json.error || '此帳號沒有管理員權限，請聯絡系統管理員。'); return; }
    setSession(json.sessionToken, json.email, json.name || '', '', resp.credential);
    enterApp();
  })
  .catch(function(){ showLogin('登入失敗，請稍後再試。'); });
}

// ── API ──
function apiCall(action, extra) {
  var sess = getSession();
  var payload = Object.assign({ action: action }, extra || {});
  if (sess) payload.sessionToken = sess.sessionToken;
  var storeApiActions = { getStores: true, getStore: true, getStoreTaxonomy: true, updateStore: true, updateStoreTaxonomy: true, reorderStores: true, deleteStore: true, getViewStats: true };
  if (sess && sess.id_token && storeApiActions[action]) payload.id_token = sess.id_token;
  var endpoint = (CONFIG.STORE_API_URL && storeApiActions[action]) ? CONFIG.STORE_API_URL : CONFIG.SCRIPT_URL;
  return fetch(endpoint, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  })
  .then(function(r){ return r.text(); })
  .then(function(t){ return JSON.parse(t); })
  .then(function(json){
    if (json.code === 401) {
      clearSession();
      if (typeof google !== 'undefined') google.accounts.id.disableAutoSelect();
      showLogin('登入已失效，請重新登入。');
    }
    return json;
  });
}

// ── STATE ──
var allStores = [];
var currentStatusFilter   = 'all';
var currentCategoryFilter = 'all';
var STORES_CACHE_KEY = new URL(CONFIG.BASE_URL).hostname.split('.')[0] + '_admin_stores_cache_v1';
var sidebarOpen = false;
var chartsDrawn = false;
var chartInstances = [];
var sortableInstances = [];
// ── Multi-select state ──
var selectMode = false;
var selectedIds = {};
var vcData = {};
var EYE_SVG = '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
var managedTaxonomy = { categories: [], brandTags: [] };
var effectiveTaxonomy = { categories: [], brandTags: [], brandTagDefs: [] };
var BRAND_TAG_COLORS = ['gold','mint','blue','rose','violet','stone'];
var storeBrandTagDefs = [];
var BRAND_TAG_PALETTE = {
  gold:{ bg:'#FFF3E0', txt:'#B75D00', bd:'#F5D7A2' }, mint:{ bg:'#EAF3EB', txt:'#2F6836', bd:'#CFE2D3' },
  blue:{ bg:'#EFF6FF', txt:'#2563EB', bd:'#BFDBFE' }, rose:{ bg:'#FFF1F4', txt:'#B4235A', bd:'#F7C1CF' },
  violet:{ bg:'#F5F0FF', txt:'#6B28A8', bd:'#DCCBFF' }, stone:{ bg:'#F0EEEC', txt:'#7A6E66', bd:'#D8D0C8' }
};
var FOOD_CATES = ['美食地圖', '飲料冰品', '健康醫療', '生活便利', '住宅相關', '寵物專區'];
var CATEGORY_GROUPS = FOOD_CATES.concat(['其他各行各業']);
var CATEGORY_SORT_OFFSET = {
  '美食地圖': 0,
  '飲料冰品': 10000,
  '健康醫療': 20000,
  '生活便利': 30000,
  '住宅相關': 40000,
  '寵物專區': 50000,
  '其他各行各業': 60000
};

// ── CATEGORY COLORS ──
var CATE_COLOR = {
  '美食地圖': { bg:'#E6F7F0', txt:'#0F7A5C' },
  '飲料冰品': { bg:'#EFF6FF', txt:'#1D4ED8' },
  '健康醫療': { bg:'#F3EBFF', txt:'#6B28A8' },
  '生活便利': { bg:'#E0F7FA', txt:'#036672' },
  '住宅相關': { bg:'#FFF3E0', txt:'#B75D00' },
  '寵物專區': { bg:'#FFF1F4', txt:'#B4235A' },
  '其他': { bg:'#F0EEEC', txt:'#7A6E66' },
};
function cateBadge(cat) {
  var c = CATE_COLOR[cat] || { bg:'#F0EEEC', txt:'#7A6E66' };
  return '<span class="cate-badge" style="background:' + c.bg + ';color:' + c.txt + '">' + esc(cat) + '</span>';
}

function brandTags(d){ var raw = Array.isArray(d.brandTags) && d.brandTags.length ? d.brandTags : [d.brandTag]; return raw.map(function(tag){ return String(tag || '').trim(); }).filter(Boolean).slice(0,3); }
function brandTagStyle(tag) {
  var def = storeBrandTagDefs.find(function(item){ return item.name === tag; }) || { color:'gold' };
  var color = BRAND_TAG_PALETTE[def.color] || BRAND_TAG_PALETTE.gold;
  return 'background:' + color.bg + ';color:' + color.txt + ';border-color:' + color.bd;
}
function badgeCls(s){ if (s==='已公開') return 'badge-public'; if (s==='不通過') return 'badge-reject'; return 'badge-pending'; }
function cardStatusCls(s){ if (s==='已公開') return 'status-public'; if (s==='不通過') return 'status-reject'; return 'status-pending'; }
function storeIdNum(id){ if (!id) return 0; var m = String(id).match(/(\d+)/); return m ? parseInt(m[1],10) : 0; }
function categoryGroupKey(d) {
  return FOOD_CATES.indexOf(d.category || '') !== -1 ? d.category : '其他各行各業';
}
function categoryWeight(d) {
  var idx = CATEGORY_GROUPS.indexOf(categoryGroupKey(d));
  return idx === -1 ? CATEGORY_GROUPS.length : idx;
}

function taxonomyInput(kind) {
  return document.getElementById(kind === 'categories' ? 'taxonomyCategoryInput' : 'taxonomyBrandTagInput');
}
function taxonomyText(value) { return String(value || '').trim(); }
function taxonomyValues(kind) { return Array.isArray(managedTaxonomy[kind]) ? managedTaxonomy[kind] : []; }
function renderTaxonomyValues() {
  [['categories','taxonomyCategories'],['brandTags','taxonomyBrandTags']].forEach(function(pair){
    var kind = pair[0], el = document.getElementById(pair[1]);
    if (!el) return;
    if (kind === 'brandTags') {
      var defs = taxonomyBrandTagDefs();
      el.innerHTML = defs.length ? '<div class="taxonomy-tag-editor">' + defs.map(function(def, idx){
        return '<div class="taxonomy-tag-row">'
          + '<input type="text" maxlength="6" value="' + esc(def.name) + '" aria-label="品牌標籤名稱" onchange="renameTaxonomyBrandTag(' + idx + ',this.value)">'
          + '<div class="taxonomy-swatches">' + BRAND_TAG_COLORS.map(function(color){
            return '<button type="button" class="taxonomy-swatch' + (def.color === color ? ' selected' : '') + '" data-color="' + color
              + '" aria-label="標籤色彩 ' + color + '" onclick="setTaxonomyBrandTagColor(' + idx + ',\'' + color + '\')"></button>';
          }).join('') + '</div>'
          + '<button type="button" class="taxonomy-remove-tag" aria-label="移除 ' + esc(def.name) + '" onclick="removeTaxonomyBrandTag(' + idx + ')">&#215;</button>'
          + '</div>';
      }).join('') + '</div>' : '<span class="taxonomy-empty">尚未設定</span>';
      return;
    }
    var values = taxonomyValues(kind);
    el.innerHTML = values.length ? values.map(function(value){
      return '<span class="taxonomy-chip">' + esc(value)
        + '<button type="button" aria-label="移除 ' + esc(value) + '" onclick="removeTaxonomyValue(\'' + kind + '\',\'' + jsText(value) + '\')">&#215;</button></span>';
    }).join('') : '<span class="taxonomy-empty">尚未設定</span>';
  });
}
function jsText(value) { return taxonomyText(value).replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
function addTaxonomyValue(kind) {
  var input = taxonomyInput(kind);
  var value = taxonomyText(input ? input.value : '');
  if (!value) return;
  if (kind === 'brandTags' && (/^\d+$/.test(value) || value.length > 6)) { alert('品牌標籤最多 6 個字，且不能只有數字'); return; }
  if (kind === 'categories' && value.length > 18) { alert('商家類別最多 18 個字'); return; }
  if (kind === 'brandTags') {
    if (!taxonomyBrandTagDefs().some(function(def){ return def.name === value; })) effectiveTaxonomy.brandTagDefs.push({ name:value, color:'gold' });
    syncManagedBrandTagDefs();
  } else if (taxonomyValues(kind).indexOf(value) === -1) {
    managedTaxonomy[kind].push(value);
  }
  if (input) input.value = '';
  renderTaxonomyValues();
}
function removeTaxonomyValue(kind, value) {
  managedTaxonomy[kind] = taxonomyValues(kind).filter(function(item){ return item !== value; });
  renderTaxonomyValues();
}
function taxonomyBrandTagDefs() {
  return Array.isArray(effectiveTaxonomy.brandTagDefs) ? effectiveTaxonomy.brandTagDefs : [];
}
function syncManagedBrandTagDefs() {
  managedTaxonomy.brandTagDefs = taxonomyBrandTagDefs().map(function(def){ return { name:taxonomyText(def.name), color:def.color || 'gold' }; }).filter(function(def){ return def.name; });
  managedTaxonomy.brandTags = managedTaxonomy.brandTagDefs.map(function(def){ return def.name; });
}
function renameTaxonomyBrandTag(idx, value) {
  value = taxonomyText(value);
  if (!value || value.length > 6 || /^\d+$/.test(value)) { alert('品牌標籤最多 6 個字，且不能只有數字'); renderTaxonomyValues(); return; }
  taxonomyBrandTagDefs()[idx].name = value;
  syncManagedBrandTagDefs();
  renderTaxonomyValues();
}
function setTaxonomyBrandTagColor(idx, color) {
  if (BRAND_TAG_COLORS.indexOf(color) === -1) return;
  taxonomyBrandTagDefs()[idx].color = color;
  syncManagedBrandTagDefs();
  renderTaxonomyValues();
}
function removeTaxonomyBrandTag(idx) {
  effectiveTaxonomy.brandTagDefs.splice(idx, 1);
  syncManagedBrandTagDefs();
  renderTaxonomyValues();
}
function openTaxonomyModal() {
  var overlay = document.getElementById('taxonomyOverlay');
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  apiCall('getStoreTaxonomy')
    .then(function(json){
      if (!json.success) throw new Error(json.error || '讀取失敗');
      managedTaxonomy = {
        categories: Array.isArray(json.taxonomy && json.taxonomy.categories) ? json.taxonomy.categories.slice() : [],
        brandTags: Array.isArray(json.taxonomy && json.taxonomy.brandTags) ? json.taxonomy.brandTags.slice() : []
      };
      effectiveTaxonomy = {
        categories: Array.isArray(json.effectiveTaxonomy && json.effectiveTaxonomy.categories) ? json.effectiveTaxonomy.categories.slice() : managedTaxonomy.categories.slice(),
        brandTags: Array.isArray(json.effectiveTaxonomy && json.effectiveTaxonomy.brandTags) ? json.effectiveTaxonomy.brandTags.slice() : managedTaxonomy.brandTags.slice(),
        brandTagDefs: Array.isArray(json.effectiveTaxonomy && json.effectiveTaxonomy.brandTagDefs) ? json.effectiveTaxonomy.brandTagDefs.map(function(def){ return { name:def.name, sourceName:def.name, color:def.color || 'gold' }; }) : []
      };
      syncManagedBrandTagDefs();
      renderTaxonomyValues();
    })
    .catch(function(err){ alert('類別與標籤載入失敗：' + err.message); });
}
function closeTaxonomyModal() {
  document.getElementById('taxonomyOverlay').classList.remove('open');
  document.body.style.overflow = '';
}
function saveTaxonomy() {
  var btn = document.getElementById('taxonomySaveBtn');
  btn.disabled = true;
  btn.textContent = '儲存中…';
  var brandTagRenames = taxonomyBrandTagDefs().map(function(def){
    return def.sourceName && def.sourceName !== def.name ? { from: def.sourceName, to: def.name } : null;
  }).filter(Boolean);
  apiCall('updateStoreTaxonomy', { taxonomy: managedTaxonomy, brandTagRenames: brandTagRenames })
    .then(function(json){
      if (!json.success) throw new Error(json.error || '儲存失敗');
      managedTaxonomy = json.taxonomy || managedTaxonomy;
      effectiveTaxonomy = json.effectiveTaxonomy || effectiveTaxonomy;
      closeTaxonomyModal();
      alert('類別與標籤已更新');
    })
    .catch(function(err){ alert('儲存失敗：' + err.message); })
    .finally(function(){ btn.disabled = false; btn.textContent = '儲存'; });
}

// ── LOAD ──
function saveStoresCache() {
  try {
    sessionStorage.setItem(STORES_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), stores: allStores || [] }));
  } catch(e) {}
}

function renderCachedStores() {
  try {
    var raw = sessionStorage.getItem(STORES_CACHE_KEY);
    if (!raw) return false;
    var cache = JSON.parse(raw);
    if (!cache || !Array.isArray(cache.stores)) return false;
    allStores = cache.stores;
    buildCategoryChips();
    applyFilters();
    loadViewStats();
    document.getElementById('headerSubtitle').textContent = CONFIG.VILLAGE_NAME + '・背景同步中';
    return true;
  } catch(e) {
    sessionStorage.removeItem(STORES_CACHE_KEY);
    return false;
  }
}

function loadAll() {
  apiCall('getStores')
    .then(function(json){
      if (!json.success) { showError(json.error || '無法取得資料'); return; }
      allStores = json.stores || [];
      saveStoresCache();
      buildCategoryChips();
      applyFilters();
      loadViewStats();
      var today = new Date();
      document.getElementById('headerSubtitle').textContent =
        CONFIG.VILLAGE_NAME + '・' + today.getFullYear() + '/' + (today.getMonth()+1) + '/' + today.getDate();
      if (sidebarOpen) {
        chartsDrawn = false;
        renderStats();
      }
    })
    .catch(function(){ showError('資料載入失敗，請稍後再試'); });
}
function loadViewStats() {
  apiCall('getViewStats', { page: 'storelist' })
    .then(function(json) {
      if (!json.success) return;
      vcData = json.cardCounts || {};
      updateViewBadges();
    })
    .catch(function() {});
}
function loadStoreBrandTagDefs() {
  if (!CONFIG.STORE_API_URL) return;
  fetch(CONFIG.STORE_API_URL, {
    method:'POST', headers:{ 'Content-Type':'text/plain;charset=utf-8' },
    body:JSON.stringify({ action:'getPublicStoreTaxonomy' })
  }).then(function(res){ return res.json(); }).then(function(json){
    storeBrandTagDefs = json.success && json.taxonomy && Array.isArray(json.taxonomy.brandTagDefs) ? json.taxonomy.brandTagDefs : [];
    if (allStores.length) applyFilters();
  }).catch(function(){});
}

// ── DROPDOWN ──
function toggleDropdown(id) {
  var panel = document.getElementById(id).querySelector('.dropdown-panel');
  var btn   = document.getElementById(id).querySelector('.dropdown-btn');
  var wasOpen = panel.classList.contains('open');
  closeAllDropdowns();
  if (!wasOpen) { panel.classList.add('open'); btn.classList.add('open'); }
}
function closeAllDropdowns() {
  document.querySelectorAll('.dropdown-panel').forEach(function(p){ p.classList.remove('open'); });
  document.querySelectorAll('.dropdown-btn').forEach(function(b){ b.classList.remove('open'); });
}
document.addEventListener('click', function(e){ if (!e.target.closest('.dropdown')) closeAllDropdowns(); });

function selectStatus(el) {
  currentStatusFilter = el.dataset.value;
  document.querySelectorAll('#statusList .dropdown-item').forEach(function(i){ i.classList.remove('selected'); });
  el.classList.add('selected');
  document.getElementById('statusLabel').textContent = currentStatusFilter === 'all' ? '商店狀態' : el.textContent.trim();
  document.getElementById('statusBtn').classList.toggle('active', currentStatusFilter !== 'all');
  closeAllDropdowns(); applyFilters();
}
function selectCategory(el) {
  currentCategoryFilter = el.dataset.value;
  document.querySelectorAll('#categoryList .dropdown-item').forEach(function(i){ i.classList.remove('selected'); });
  el.classList.add('selected');
  document.getElementById('categoryLabel').textContent = currentCategoryFilter === 'all' ? '商家類別' : el.textContent.trim();
  document.getElementById('categoryBtn').classList.toggle('active', currentCategoryFilter !== 'all');
  closeAllDropdowns(); applyFilters();
}
function buildCategoryChips() {
  var cats = {};
  allStores.forEach(function(d){ if (d.category) cats[d.category] = true; });
  var keys = Object.keys(cats).sort();
  var list = document.getElementById('categoryList');
  var html = '<div class="dropdown-item selected" data-value="all" onclick="selectCategory(this)">全部類別</div>';
  keys.forEach(function(c){ html += '<div class="dropdown-item" data-value="' + esc(c) + '" onclick="selectCategory(this)">' + esc(c) + '</div>'; });
  list.innerHTML = html;
}

// ── FILTER & RENDER ──
function applyFilters() {
  var q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  var sf = currentStatusFilter;
  var cf = currentCategoryFilter;

  var filtered = allStores.filter(function(d){
    if (cf !== 'all' && (d.category || '') !== cf) return false;
    if (sf !== 'all' && d.status !== sf) return false;
    if (q) {
      var hay = [d.storeId, d.storeName, brandTags(d).join(' '), d.addr, d.category, d.desc, d.offer, d.name, d.phone].join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });

  filtered.sort(function(a, b){
    var wa = categoryWeight(a), wb = categoryWeight(b);
    if (wa !== wb) return wa - wb;
    var hasA = a.sortOrder > 0, hasB = b.sortOrder > 0;
    if (hasA !== hasB) return hasA ? 1 : -1;
    if (!hasA) return storeIdNum(b.storeId) - storeIdNum(a.storeId);
    return a.sortOrder - b.sortOrder;
  });

  renderGrid(filtered);
  if (selectMode) updateBulkBar();

  var bar = document.getElementById('resultBar');
  var isFiltered = sf !== 'all' || cf !== 'all' || q;
  var tags = '';
  if (sf !== 'all') tags += ' <span style="background:var(--primary-light);color:var(--primary);padding:1px 6px;border-radius:4px;font-size:11px">' + sf + '</span>';
  if (cf !== 'all') tags += ' <span style="background:#FFF3E0;color:#B75D00;padding:1px 6px;border-radius:4px;font-size:11px">' + cf + '</span>';
  if (q)           tags += ' <span style="background:#F3EBFF;color:#6B28A8;padding:1px 6px;border-radius:4px;font-size:11px">「' + esc(q) + '」</span>';
  bar.innerHTML =
    '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> ' +
    '共 <strong>' + filtered.length + '</strong> 間' + (isFiltered ? tags : '・共 ' + allStores.length + ' 間美食地圖商家');
}

function renderGrid(stores) {
  sortableInstances.forEach(function(s){ try{ s.destroy(); }catch(e){} });
  sortableInstances = [];
  var grid = document.getElementById('cardGrid');
  if (selectMode) { grid.classList.add('select-mode'); } else { grid.classList.remove('select-mode'); }
  if (!stores.length) {
    grid.innerHTML = '<div class="state-wrap"><svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><h3>沒有符合的商店</h3><p>請嘗試調整搜尋條件或篩選項目</p></div>';
    return;
  }
  var groups = {};
  CATEGORY_GROUPS.forEach(function(p){ groups[p] = []; });
  stores.forEach(function(d){
    var p = categoryGroupKey(d);
    if (!groups[p]) groups[p] = [];
    groups[p].push(d);
  });
  var html = '';
  CATEGORY_GROUPS.forEach(function(groupKey){
    var grp = groups[groupKey];
    if (!grp.length) return;
    html += '<div class="group-header"><span class="group-label">' + esc(groupKey) + '</span><span class="group-count">' + grp.length + ' 間</span><div class="group-line"></div></div>';
    html += '<div class="group-cards" data-group-key="' + esc(groupKey) + '">';
    grp.forEach(function(d){ html += renderCard(d); });
    html += '</div>';
  });
  grid.innerHTML = html;
  CATEGORY_GROUPS.forEach(function(groupKey){
    var el = grid.querySelector('.group-cards[data-group-key="' + groupKey + '"]');
    if (!el) return;
    (function(key, container){
      var inst = Sortable.create(container, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        delay: 200,
        delayOnTouchOnly: true,
        onEnd: function(){ onSortEnd(key, container); }
      });
      sortableInstances.push(inst);
    })(groupKey, el);
  });
}

function renderCard(d) {
  var hasPhoto = !!d.photo1;
  var checkHtml = '<div class="card-check"><svg class="card-check-icon" viewBox="0 0 14 14"><polyline points="2,7 6,11 12,3"/></svg></div>';
  var thumb = hasPhoto
    ? '<div class="card-thumb">' + checkHtml + '<img src="' + esc(d.photo1) + '" alt="" loading="lazy" onerror="imgFallback(this)">' + viewBadgeHtml(d.storeId) + '</div>'
    : '<div class="card-thumb">' + checkHtml + '<div class="card-thumb-placeholder"><div class="no-photo-content"><span class="no-photo-emoji">🏪</span><span class="no-photo-text">尚無照片</span></div></div>' + viewBadgeHtml(d.storeId) + '</div>';

  var dateStr = '';
  if (d.applyTime) {
    var dd = new Date(d.applyTime);
    if (!isNaN(dd.getTime())) { dateStr = (dd.getMonth()+1) + '/' + dd.getDate(); }
    else { dateStr = String(d.applyTime).slice(0,10); }
  }

  var isSelected = selectMode && !!selectedIds[d.storeId];
  var clickHandler = selectMode
    ? 'toggleSelect(\'' + esc(d.storeId) + '\')'
    : 'openStore(\'' + esc(d.storeId) + '\')';
  var html = '<div class="store-card ' + cardStatusCls(d.status) + (isSelected ? ' selected' : '') + '" data-store-id="' + esc(d.storeId) + '" onclick="' + clickHandler + '">';
  html += thumb;
  var delBtn = selectMode ? '' : '<button class="del-btn" title="刪除商店" aria-label="刪除商店" onclick="event.stopPropagation();confirmDeleteStore(\'' + esc(d.storeId) + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>';
  html += '<div class="card-body">';
  html += '<div class="card-top"><span class="card-id">#' + esc(d.storeId) + '</span><span class="card-date">' + dateStr + '</span><span class="badge ' + badgeCls(d.status) + '">' + esc(d.status) + '</span>' + delBtn + '</div>';
  html += '<div class="card-title">' + esc(d.storeName || d.pubName || '（無名稱）') + '</div>';
  var dispPhone = d.storePhone || d.pubPhone;
  var dispAddr  = d.addr       || d.pubAddr;
  if (dispPhone) html += '<div class="card-phone"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.41 2 2 0 0 1 3.6 1.25h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.85a16 16 0 0 0 6.29 6.29l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' + esc(dispPhone) + '</div>';
  if (dispAddr) html += '<div class="card-address">' + esc(dispAddr.length > 18 ? dispAddr.slice(0,18)+'…' : dispAddr) + '</div>';
  html += '<div class="card-meta">';
  var dispCate = d.category || d.pubCate;
  if (dispCate) html += cateBadge(dispCate);
  brandTags(d).forEach(function(tag){ html += '<span class="brand-tag" style="' + brandTagStyle(tag) + '">' + esc(tag) + '</span>'; });
  html += '</div>';
  html += '<div class="card-offer-divider"></div>';
  if (d.offer) html += '<div class="card-offer-label">優惠活動</div><div class="card-desc">' + esc(d.offer) + '</div>';
  html += '</div></div>';
  return html;
}

function imgFallback(img) {
  var wrap = img.parentNode;
  var badge = wrap.querySelector('.thumb-view-badge');
  wrap.innerHTML = '<div class="card-thumb-placeholder"><div class="no-photo-content"><span class="no-photo-emoji">🏪</span><span class="no-photo-text">尚無照片</span></div></div>' + (badge ? badge.outerHTML : '');
}

function fmtNum(n) {
  n = Number(n || 0);
  return n.toLocaleString ? n.toLocaleString('zh-TW') : String(n);
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

function onSortEnd(groupKey, el) {
  var cards = el.querySelectorAll('[data-store-id]');
  var offset = CATEGORY_SORT_OFFSET[groupKey] || 0;
  var orders = [];
  for (var i = 0; i < cards.length; i++) {
    var sid = cards[i].getAttribute('data-store-id');
    var sortVal = offset + (i + 1) * 10;
    orders.push({ storeId: sid, sortOrder: sortVal });
    for (var j = 0; j < allStores.length; j++) {
      if (allStores[j].storeId === sid) { allStores[j].sortOrder = sortVal; break; }
    }
  }
  apiCall('reorderStores', { orders: orders })
    .catch(function(){ console.error('reorderStores failed'); });
}

function openStore(id) {
  for (var i = 0; i < allStores.length; i++) {
    if (allStores[i].storeId === id) {
      try { sessionStorage.setItem('store_preview_' + id, JSON.stringify(allStores[i])); } catch(e) {}
      break;
    }
  }
  window.location.href = 'storedetail.html?id=' + encodeURIComponent(id);
}

function toggleSidebar() {
  if (sidebarOpen) closeSidebar();
  else openSidebar();
}
function openSidebar() {
  sidebarOpen = true;
  document.getElementById('statsSidebar').classList.add('open');
  document.getElementById('backdrop').classList.add('open');
  document.getElementById('statsToggleBtn').classList.add('active');
  if (!chartsDrawn && allStores.length) renderStats();
}
function closeSidebar() {
  sidebarOpen = false;
  document.getElementById('statsSidebar').classList.remove('open');
  document.getElementById('backdrop').classList.remove('open');
  document.getElementById('statsToggleBtn').classList.remove('active');
}
function renderStatRows(items, colorMap) {
  if (!items.length) return '<div style="font-size:12px;color:var(--muted)">暫無資料</div>';
  var max = 0;
  items.forEach(function(item){ if (item.count > max) max = item.count; });
  return '<div class="stat-list">' + items.map(function(item){
    var width = max ? Math.max(8, Math.round(item.count / max * 100)) : 0;
    var color = colorMap && colorMap[item.label] ? colorMap[item.label] : 'var(--primary)';
    return '<div class="stat-row">' +
      '<span class="stat-dot" style="background:' + color + '"></span>' +
      '<div><div style="margin-bottom:4px">' + esc(item.label) + '</div><div class="stat-track"><div class="stat-fill" style="width:' + width + '%;background:' + color + '"></div></div></div>' +
      '<strong>' + item.count + '</strong>' +
    '</div>';
  }).join('') + '</div>';
}
function renderStats() {
  var total = allStores.length;
  var publicCount = allStores.filter(function(d){ return d.status === '已公開'; }).length;
  var pendingCount = allStores.filter(function(d){ return d.status === '申請審核中'; }).length;
  var rejectCount = allStores.filter(function(d){ return d.status === '不通過'; }).length;
  var foodCount = allStores.filter(function(d){ return FOOD_CATES.indexOf(d.category || '') !== -1; }).length;
  var otherCount = total - foodCount;

  var statusCounts = {};
  var categoryCounts = {};
  allStores.forEach(function(d){
    var status = d.status || '未設定';
    var cate = d.category || '未分類';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    categoryCounts[cate] = (categoryCounts[cate] || 0) + 1;
  });
  var statusItems = Object.keys(statusCounts).map(function(key){ return { label:key, count:statusCounts[key] }; }).sort(function(a,b){ return b.count - a.count; });
  var categoryItems = Object.keys(categoryCounts).map(function(key){ return { label:key, count:categoryCounts[key] }; }).sort(function(a,b){ return b.count - a.count; }).slice(0, 6);

  var html = '';
  html += '<div class="stats-grid">';
  html += '<div class="stats-box"><div class="stats-box-label">商店總數</div><div class="stats-box-value">' + total + '</div><div class="stats-box-note">目前資料筆數</div></div>';
  html += '<div class="stats-box"><div class="stats-box-label">已公開</div><div class="stats-box-value">' + publicCount + '</div><div class="stats-box-note">已對外顯示</div></div>';
  html += '<div class="stats-box"><div class="stats-box-label">待審核</div><div class="stats-box-value">' + pendingCount + '</div><div class="stats-box-note">待處理申請</div></div>';
  html += '<div class="stats-box"><div class="stats-box-label">美食 / 其他</div><div class="stats-box-value">' + foodCount + '</div><div class="stats-box-note">其他行業 ' + otherCount + ' 間</div></div>';
  html += '</div>';

  html += '<div class="stat-section"><div class="stat-title">狀態分布</div>' + renderStatRows(statusItems, {
    '申請審核中':'#B75D00','已公開':'#2F6836','不通過':'#7A6E66','未設定':'#B8A898'
  }) + '</div>';
  html += '<div class="stat-section"><div class="stat-title">熱門類別</div>' + renderStatRows(categoryItems, null) + '</div>';
  html += '<div class="chart-section"><div class="chart-title">商店狀態圖表</div><div class="chart-wrap"><canvas id="storeStatusChart"></canvas></div></div>';
  document.getElementById('sidebarBody').innerHTML = html;

  chartInstances.forEach(function(c){ try{ c.destroy(); }catch(e){} });
  chartInstances = [];
  var ctx = document.getElementById('storeStatusChart');
  if (ctx && statusItems.length) {
    var colors = statusItems.map(function(item){
      if (item.label === '申請審核中') return '#DDAA4B';
      if (item.label === '已公開') return '#5B9B7B';
      if (item.label === '不通過') return '#A89B90';
      return '#C8B9A8';
    });
    var chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: statusItems.map(function(item){ return item.label; }),
        datasets: [{ data: statusItems.map(function(item){ return item.count; }), backgroundColor: colors, borderWidth: 0 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true, color: '#8C7B6A', font: { size: 11 } } } }
      }
    });
    chartInstances.push(chart);
  }
  chartsDrawn = true;
}

function confirmDeleteStore(storeId) {
  if (!confirm('確定刪除商店 #' + storeId + '？\n此操作無法復原。')) return;
  apiCall('deleteStore', { storeId: storeId })
    .then(function(json) {
      if (!json.success) { alert('刪除失敗：' + (json.error || '')); return; }
      var idx = allStores.findIndex(function(s){ return s.storeId === storeId; });
      if (idx !== -1) allStores.splice(idx, 1);
      saveStoresCache();
      applyFilters();
    })
    .catch(function() { alert('網路錯誤，請稍後再試'); });
}

function showError(msg) {
  document.getElementById('cardGrid').innerHTML =
    '<div class="state-wrap"><svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><h3>載入失敗</h3><p>' + esc(msg) + '</p></div>';
  document.getElementById('resultBar').textContent = '載入失敗';
}

// ── AUTO REFRESH ──
var _refreshing = false;
function silentRefresh() {
  if (_refreshing) return;
  _refreshing = true;
  apiCall('getStores')
    .then(function(json){
      if (!json.success) return;
      var fresh = json.stores || [];
      var changed = fresh.length !== allStores.length ||
        (fresh.length && allStores.length && fresh[0].storeId !== allStores[0].storeId);
      if (changed) { allStores = fresh; saveStoresCache(); buildCategoryChips(); applyFilters(); }
    })
    .catch(function(){})
    .finally(function(){ _refreshing = false; });
}

document.addEventListener('DOMContentLoaded', function(){
  if (getSession()) { enterApp(); return; }
  var tries = 0;
  var t = setInterval(function(){
    if (typeof google !== 'undefined' || ++tries > 30) { clearInterval(t); initGoogle(); }
  }, 200);
});
setInterval(silentRefresh, 60000);
['click','keydown','mousedown','touchstart','scroll'].forEach(function(eventName){
  window.addEventListener(eventName, function(){ touchSession(); }, { passive: true });
});

// ── Multi-select & bulk status ──
function toggleSelectMode() {
  selectMode = !selectMode;
  selectedIds = {};
  var btn = document.getElementById('selectModeBtn');
  if (selectMode) {
    btn.classList.add('active');
    btn.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17h7M17.5 14v7"/></svg> 退出多選';
  } else {
    btn.classList.remove('active');
    btn.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17h7M17.5 14v7"/></svg> 多選';
  }
  updateBulkBar();
  applyFilters(); // re-render cards with/without checkboxes
}

function toggleSelect(storeId) {
  if (selectedIds[storeId]) {
    delete selectedIds[storeId];
  } else {
    selectedIds[storeId] = true;
  }
  var card = document.querySelector('[data-store-id="' + storeId + '"]');
  if (card) card.classList.toggle('selected', !!selectedIds[storeId]);
  updateBulkBar();
}

function getVisibleStoreIds() {
  var cards = document.querySelectorAll('#cardGrid [data-store-id]');
  return Array.prototype.map.call(cards, function(c){ return c.getAttribute('data-store-id'); }).filter(Boolean);
}

function bulkSelectAll() {
  var visible = getVisibleStoreIds();
  var allSel = visible.length > 0 && visible.every(function(id){ return !!selectedIds[id]; });
  if (allSel) {
    selectedIds = {};
    document.querySelectorAll('#cardGrid .store-card').forEach(function(c){ c.classList.remove('selected'); });
  } else {
    visible.forEach(function(id){ selectedIds[id] = true; });
    document.querySelectorAll('#cardGrid [data-store-id]').forEach(function(c){ c.classList.add('selected'); });
  }
  updateBulkBar();
}

function updateBulkBar() {
  var bar = document.getElementById('bulkBar');
  var count = Object.keys(selectedIds).length;
  if (selectMode) { bar.classList.add('visible'); } else { bar.classList.remove('visible'); }
  document.getElementById('bulkCount').textContent = '已選 ' + count + ' 間';
  var statusVal = document.getElementById('bulkStatusSel').value;
  document.getElementById('bulkApplyBtn').disabled = count === 0 || !statusVal;
  var visible = getVisibleStoreIds();
  var allSel = visible.length > 0 && visible.every(function(id){ return !!selectedIds[id]; });
  document.getElementById('bulkSelAllBtn').textContent = allSel ? '全不選' : '全選';
}

function applyBulkStatus() {
  var status = document.getElementById('bulkStatusSel').value;
  if (!status) return;
  var ids = Object.keys(selectedIds);
  if (!ids.length) return;
  var applyBtn = document.getElementById('bulkApplyBtn');
  applyBtn.disabled = true;
  applyBtn.textContent = '套用中…';
  var done = 0;
  var errors = 0;
  function onDone(ok) {
    if (!ok) errors++;
    done++;
    if (done < ids.length) return;
    // All done
    if (errors === 0) {
      showToast('✅ 已將 ' + ids.length + ' 間商店更新為「' + status + '」');
    } else {
      showToast('⚠️ ' + (ids.length - errors) + ' 成功，' + errors + ' 失敗');
    }
    applyBtn.textContent = '套用';
    toggleSelectMode();
  }
  ids.forEach(function(storeId) {
    apiCall('updateStore', { storeId: storeId, status: status })
      .then(function(json) {
        if (json.success) {
          for (var i = 0; i < allStores.length; i++) {
            if (allStores[i].storeId === storeId) { allStores[i].status = status; break; }
          }
        }
        onDone(json.success);
      })
      .catch(function() { onDone(false); });
  });
}

function showToast(msg) {
  var wrap = document.getElementById('toastWrap');
  var el = document.createElement('div');
  el.className = 'toast-msg';
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(function(){ if (el.parentNode) el.parentNode.removeChild(el); }, 3000);
}
