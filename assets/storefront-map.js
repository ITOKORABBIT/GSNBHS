/* 舊社商圈導覽名錄。
   舊社里專用，不共用 shared/storeopenlist.js（版面各里不同，改共用檔會動到其他里）。
   分類清單以本里 stores-api 的 taxonomy 為準，這裡不寫死分類名稱。 */

var storeCategories = Array.isArray(CONFIG.STORE_CATEGORIES) ? CONFIG.STORE_CATEGORIES.slice() : [];
var allStores = [];
var currentCate = 'all';
var searchTerm = '';
var vcData = {};
var storeBrandTagDefs = [];

/* 分類顏色按該里清單順序取，最後一色留給清單外的舊分類 */
var CATE_PALETTE = [
  { bg: '#E7EFE6', txt: '#245F49' },
  { bg: '#E9EFF2', txt: '#35627A' },
  { bg: '#EFECF4', txt: '#6B5A7D' },
  { bg: '#E5EFEE', txt: '#2C6660' },
  { bg: '#F6EFE1', txt: '#8F6218' },
  { bg: '#F7ECE5', txt: '#8B5336' },
  { bg: '#EEEFEA', txt: '#6F7A72' }
];
var BRAND_TAG_PALETTE = {
  gold: { bg: '#F6EFE1', txt: '#8F6218', bd: '#E0D0AB' }, mint: { bg: '#E7EFE6', txt: '#245F49', bd: '#C2D3C5' },
  blue: { bg: '#E9EFF2', txt: '#35627A', bd: '#CBD8DE' }, rose: { bg: '#F7ECE5', txt: '#8B5336', bd: '#DDC6B6' },
  violet: { bg: '#EFECF4', txt: '#6B5A7D', bd: '#D3CADF' }, stone: { bg: '#EEEFEA', txt: '#6F7A72', bd: '#D5D8CF' }
};

var ICON = {
  pin: '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  clock: '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  phone: '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.41 2 2 0 0 1 3.6 1.25h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.85a16 16 0 0 0 6.29 6.29l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  nav: '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" viewBox="0 0 24 24"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>',
  shop: '<svg width="30" height="30" fill="none" stroke="#8FA79A" stroke-width="1.4" opacity=".55" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  eye: '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
};

function fmtNum(n) {
  return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function cateOf(d) {
  return String((d && d.pubCate) || '').trim();
}
function firstLine(value) {
  return String(value || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean)[0] || '';
}

/* 分組＝該里的分類清單，加上資料裡出現、但清單已經沒有的舊分類（排在最後） */
function categoryGroups() {
  var groups = storeCategories.slice();
  allStores.forEach(function (d) {
    var c = cateOf(d);
    if (c && groups.indexOf(c) === -1) groups.push(c);
  });
  return groups;
}
function cateColor(cate) {
  var idx = storeCategories.indexOf(cate);
  if (idx === -1 || idx >= CATE_PALETTE.length - 1) return CATE_PALETTE[CATE_PALETTE.length - 1];
  return CATE_PALETTE[idx];
}
function brandTags(d) {
  var raw = Array.isArray(d.brandTags) && d.brandTags.length ? d.brandTags : [d.brandTag];
  return raw.map(function (t) { return String(t || '').trim(); }).filter(Boolean).slice(0, 2);
}
function brandTagStyle(tag) {
  var def = storeBrandTagDefs.find(function (item) { return item.name === tag; }) || { color: 'gold' };
  var c = BRAND_TAG_PALETTE[def.color] || BRAND_TAG_PALETTE.gold;
  return 'background:' + c.bg + ';color:' + c.txt + ';border-color:' + c.bd;
}

function apiCall(action, extra) {
  var payload = Object.assign({ action: action }, extra || {});
  var storeApiActions = { getPublicStores: 1, getPublicStore: 1, getPublicStoreTaxonomy: 1, getViewStats: 1, recordCardView: 1 };
  var endpoint = (CONFIG.STORE_API_URL && storeApiActions[action]) ? CONFIG.STORE_API_URL : CONFIG.SCRIPT_URL;
  return fetch(endpoint, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  }).then(function (r) { return r.text(); }).then(function (t) { return JSON.parse(t); });
}

/* ── 卡片 ── */
function shopHtml(d) {
  var views = vcData[d.storeId];
  var figure = d.photo1
    ? '<img src="' + esc(d.photo1) + '" alt="" loading="lazy" onerror="imgFallback(this)">'
    : '<div class="ph">' + ICON.shop + '</div>';

  var html = '<article class="shop" role="button" tabindex="0" data-id="' + esc(d.storeId) + '">';
  html += '<div class="shop-figure">' + figure +
    (views ? '<span class="shop-views">' + ICON.eye + ' ' + fmtNum(views) + '</span>' : '') + '</div>';
  html += '<div class="shop-body">';
  html += '<div class="shop-name">' + esc(d.pubName || '（未命名）') + '</div>';

  html += '<div class="shop-tags">';
  if (d.pubCate) {
    var c = cateColor(d.pubCate);
    html += '<span class="tag" style="background:' + c.bg + ';color:' + c.txt + '">' + esc(d.pubCate) + '</span>';
  }
  brandTags(d).forEach(function (tag) {
    html += '<span class="tag tag-brand" style="' + brandTagStyle(tag) + '">' + esc(tag) + '</span>';
  });
  html += '</div>';

  html += '<div class="shop-lines">';
  if (d.pubAddr) html += '<div class="shop-line">' + ICON.pin + '<span>' + esc(d.pubAddr) + '</span></div>';
  var hours = firstLine(String(d.pubHours || '').replace(/^營業時間[：:]\s*/, ''));
  if (hours) html += '<div class="shop-line">' + ICON.clock + '<span>' + esc(hours) + '</span></div>';
  html += '</div>';

  if (d.pubOffer) {
    html += '<div class="shop-offer"><b>里民優惠</b>' + esc(String(d.pubOffer).replace(/\s*\n\s*/g, '　')) + '</div>';
  }

  html += '<div class="shop-actions">';
  if (d.pubPhone) {
    html += '<a class="act" href="tel:' + esc(d.pubPhone) + '" data-stop>' + ICON.phone + ' 撥號</a>';
  }
  if (d.pubMapUrl) {
    html += '<a class="act" href="' + esc(d.pubMapUrl) + '" target="_blank" rel="noopener" data-stop>' + ICON.nav + ' 導航</a>';
  }
  html += '</div>';

  html += '</div></article>';
  return html;
}

function imgFallback(img) {
  var wrap = img.parentNode;
  var badge = wrap.querySelector('.shop-views');
  wrap.innerHTML = '<div class="ph">' + ICON.shop + '</div>' + (badge ? badge.outerHTML : '');
}

/* ── 篩選與渲染 ── */
function visibleStores() {
  var q = searchTerm;
  return allStores.filter(function (d) {
    if (currentCate !== 'all' && cateOf(d) !== currentCate) return false;
    if (!q) return true;
    var hay = [d.pubName, d.pubCate, brandTags(d).join(' '), d.pubAddr, d.pubDesc, d.pubOffer].join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  });
}

function sortInGroup(a, b) {
  var ha = a.sortOrder > 0, hb = b.sortOrder > 0;
  if (ha !== hb) return ha ? 1 : -1;
  if (!ha) return String(b.storeId).localeCompare(String(a.storeId));
  return a.sortOrder - b.sortOrder;
}

function render() {
  var stores = visibleStores();
  var listing = document.getElementById('listing');

  document.getElementById('resultBar').innerHTML = stores.length
    ? '共 <strong>' + stores.length + '</strong> 家' +
      (stores.length !== allStores.length ? '　<span>（全部 ' + allStores.length + ' 家）</span>' : '')
    : '沒有符合的店家';

  if (!stores.length) {
    listing.innerHTML = '<div class="shops"><div class="state">' +
      '<svg width="46" height="46" fill="none" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
      '<h3>找不到這家店</h3><p>換個關鍵字，或先選「全部」再找找看。</p></div></div>';
    return;
  }

  var order = categoryGroups();
  var buckets = order.map(function (c) { return { label: c, list: [] }; });
  var others = { label: '其他', list: [] };
  stores.forEach(function (d) {
    var i = order.indexOf(cateOf(d));
    (i === -1 ? others : buckets[i]).list.push(d);
  });
  buckets.push(others);

  var html = '';
  buckets.forEach(function (bucket) {
    if (!bucket.list.length) return;
    // 選定單一分類時不再重複標題
    if (currentCate === 'all') {
      html += '<div class="block-head"><h2>' + esc(bucket.label) + '</h2>' +
        '<span class="n">' + bucket.list.length + ' 家</span></div>';
    }
    html += '<div class="shops">' + bucket.list.slice().sort(sortInGroup).map(shopHtml).join('') + '</div>';
  });
  listing.innerHTML = html;
}

function buildTiles() {
  var counts = {};
  allStores.forEach(function (d) {
    var c = cateOf(d);
    if (c) counts[c] = (counts[c] || 0) + 1;
  });
  var tiles = [{ key: 'all', label: '全部', n: allStores.length }];
  categoryGroups().forEach(function (c) {
    if (counts[c]) tiles.push({ key: c, label: c, n: counts[c] });
  });
  document.getElementById('tiles').innerHTML = tiles.map(function (t) {
    return '<button class="tile" data-cate="' + esc(t.key) + '"' +
      ' aria-pressed="' + (t.key === currentCate ? 'true' : 'false') + '">' +
      esc(t.label) + '<span class="n">' + t.n + '</span></button>';
  }).join('');
}

function updateFigures() {
  var cates = {};
  var offers = 0;
  allStores.forEach(function (d) {
    if (cateOf(d)) cates[cateOf(d)] = 1;
    if (d.pubOffer) offers++;
  });
  document.getElementById('figShops').textContent = allStores.length;
  document.getElementById('figCates').textContent = Object.keys(cates).length;
  // 家數與優惠數常常一樣大，改顯示比例才有資訊量
  document.getElementById('figOffers').textContent =
    allStores.length ? Math.round(offers / allStores.length * 100) + '%' : '–';
}

function renderHot() {
  var names = {};
  allStores.forEach(function (d) { names[d.storeId] = d.pubName || d.storeId; });
  var top = Object.keys(vcData)
    .filter(function (id) { return names[id]; })
    .map(function (id) { return { id: id, name: names[id], n: vcData[id] }; })
    .sort(function (a, b) { return b.n - a.n; })
    .slice(0, 5);
  if (top.length < 3) return;

  var cls = ['r1', 'r2', 'r3', '', ''];
  document.getElementById('hotList').innerHTML = top.map(function (item, i) {
    return '<div class="hot-item" data-id="' + esc(item.id) + '">' +
      '<span class="hot-num ' + cls[i] + '">' + (i + 1) + '</span>' +
      '<span class="hot-name">' + esc(item.name) + '</span></div>';
  }).join('');
  document.getElementById('hotBlock').hidden = false;
}

/* ── 載入 ── */
function applySnapshot(stores) {
  allStores = stores || [];
  updateFigures();
  buildTiles();
  render();
}

function loadViewStats() {
  apiCall('getViewStats', { page: 'storelist' }).then(function (json) {
    if (!json.success) return;
    vcData = json.cardCounts || {};
    document.getElementById('pageViews').hidden = false;
    document.getElementById('pageViewCount').textContent = fmtNum(json.pageCount);
    render();
    renderHot();
  }).catch(function () {});
}

function loadTaxonomy() {
  apiCall('getPublicStoreTaxonomy').then(function (json) {
    if (!json.success || !json.taxonomy) return;
    storeBrandTagDefs = Array.isArray(json.taxonomy.brandTagDefs) ? json.taxonomy.brandTagDefs : [];
    var cats = json.taxonomy.categories;
    if (Array.isArray(cats) && cats.length) {
      var next = cats.map(function (c) { return String(c || '').trim(); }).filter(Boolean);
      if (next.join('|') !== storeCategories.join('|')) storeCategories = next;
    }
    if (allStores.length) { buildTiles(); render(); }
  }).catch(function () {});
}

function showError(msg) {
  document.getElementById('listing').innerHTML = '<div class="shops"><div class="state">' +
    '<svg width="46" height="46" fill="none" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
    '<h3>載入失敗</h3><p>' + esc(msg) + '</p></div></div>';
  document.getElementById('resultBar').textContent = '載入失敗';
}

function loadStores() {
  try {
    var cached = JSON.parse(sessionStorage.getItem('pub_stores_cache') || 'null');
    if (cached && Array.isArray(cached) && cached.length) {
      applySnapshot(cached);
      loadViewStats();
    }
  } catch (e) {}

  apiCall('getPublicStores').then(function (json) {
    if (!json.success) {
      if (!allStores.length) showError(json.error || '無法取得資料');
      return;
    }
    try { sessionStorage.setItem('pub_stores_cache', JSON.stringify(json.stores || [])); } catch (e) {}
    applySnapshot(json.stores || []);
    loadViewStats();
  }).catch(function () {
    if (!allStores.length) showError('資料載入失敗，請稍後再試');
  });
}

function openStore(id) {
  apiCall('recordCardView', { page: 'storelist', itemId: id }).catch(function () {});
  for (var i = 0; i < allStores.length; i++) {
    if (allStores[i].storeId === id) {
      try { sessionStorage.setItem('store_preview_' + id, JSON.stringify(allStores[i])); } catch (e) {}
      break;
    }
  }
  window.location.href = 'storeopendetail.html?id=' + encodeURIComponent(id);
}

/* ── 事件 ── */
document.addEventListener('click', function (e) {
  if (e.target.closest('[data-stop]')) return;   // 撥號／導航不觸發進店
  var tile = e.target.closest('.tile');
  if (tile) {
    currentCate = tile.dataset.cate;
    document.querySelectorAll('.tile').forEach(function (t) {
      t.setAttribute('aria-pressed', t.dataset.cate === currentCate ? 'true' : 'false');
    });
    render();
    return;
  }
  var item = e.target.closest('[data-id]');
  if (item) openStore(item.dataset.id);
});

document.addEventListener('keydown', function (e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.target.closest('[data-stop], a, button, input, select, textarea')) return;
  var item = e.target.closest && e.target.closest('.shop[data-id]');
  if (item) { e.preventDefault(); openStore(item.dataset.id); }
});

document.getElementById('searchInput').addEventListener('input', function (e) {
  searchTerm = (e.target.value || '').trim().toLowerCase();
  render();
});

document.getElementById('heroKicker').textContent = CONFIG.VILLAGE_NAME + ' ' + CONFIG.SYSTEM_NAME;
loadTaxonomy();
loadStores();
setInterval(loadStores, 60000);
