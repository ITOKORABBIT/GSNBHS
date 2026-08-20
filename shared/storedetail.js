
(function(){
  if (/Line\//i.test(navigator.userAgent)) {
    var url = new URL(location.href);
    if (!url.searchParams.has('openExternalBrowser')) {
      url.searchParams.set('openExternalBrowser', '1');
      location.replace(url.toString());
    }
  }
})();

var _sess = getSession();
if (!_sess) { location.href = 'storelist.html?redirect=' + encodeURIComponent(location.href); }
var gName  = _sess ? _sess.name  : '';
var gEmail = _sess ? _sess.email : '';

// ── API ──
function apiCall(action, extra) {
  var sess = getSession();
  var payload = Object.assign({ action: action }, extra || {});
  if (sess) payload.sessionToken = sess.sessionToken;
  var storeApiActions = { getStores: true, getStore: true, updateStore: true, reorderStores: true };
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
    if (json.code === 401) { clearSession(); location.href = 'storelist.html?redirect=' + encodeURIComponent(location.href); }
    return json;
  });
}

document.addEventListener('DOMContentLoaded', function(){
  document.getElementById('lbPrevBtn').addEventListener('click', function(e){ e.stopPropagation(); lbMove(-1); });
  document.getElementById('lbNextBtn').addEventListener('click', function(e){ e.stopPropagation(); lbMove(1); });
  var lb = document.getElementById('lightbox');
  var sx = 0;
  lb.addEventListener('touchstart', function(e){ sx = e.touches[0].clientX; }, {passive: true});
  lb.addEventListener('touchend', function(e){
    var dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 50){ e.preventDefault(); dx < 0 ? lbMove(1) : lbMove(-1); }
  }, {passive: false});
  loadStoreTaxonomy();
  loadStore();
});

// ── LOAD ──
var storeId   = new URLSearchParams(location.search).get('id') || '';
var storeData = null;

function loadStore() {
  if (!storeId) { showError('缺少商店編號', '請確認網址是否正確'); return; }

  // 從 sessionStorage 取預覽資料，先立即渲染（不等 GAS）
  var hasPreview = false;
  try {
    var preview = JSON.parse(sessionStorage.getItem('store_preview_' + storeId) || 'null');
    if (preview && preview.storeId) { storeData = preview; renderStore(); hasPreview = true; }
  } catch(e) {}

  apiCall('getStore', { storeId: storeId })
    .then(function(json){
      if (!json.success) {
        if (!hasPreview) showError('找不到商店', json.error || '商店編號「' + storeId + '」不存在');
        return;
      }
      storeData = json.storeData;
      // 若 modal 已開啟（使用者正在填表），不重繪以免中斷輸入
      if (!document.getElementById('reviewModal').classList.contains('open')) {
        renderStore();
      }
    })
    .catch(function(){
      if (!hasPreview) showError('載入失敗', '無法讀取資料，請稍後再試');
    });
}

// ── HELPERS ──
function brandTags(d){ var raw = Array.isArray(d.brandTags) && d.brandTags.length ? d.brandTags : [d.brandTag]; return raw.map(function(tag){ return String(tag || '').trim(); }).filter(Boolean).slice(0,3); }
function brandTagsText(d){ return brandTags(d).join('、'); }
function brandTagBadges(d){ var tags = brandTags(d); return tags.length ? '<div class="brand-tag-list">' + tags.map(function(tag){ return '<span class="brand-tag-badge" style="' + brandTagCss(tag) + '">' + esc(tag) + '</span>'; }).join('') + '</div>' : '<span class="empty">—</span>'; }
function v(s){ return (s && String(s).trim()) ? esc(s) : '<span class="empty">—</span>'; }
function row(lbl, val){ return '<div class="info-row"><div class="info-lbl">' + lbl + '</div><div class="info-val">' + val + '</div></div>'; }
function splitParagraphText(s) {
  var text = String(s || '').replace(/\r\n?/g, '\n').trim();
  if (!text) return [];
  return text.split(/\n+/).map(function(p){ return p.trim(); }).filter(Boolean);
}
function paragraphValue(s) {
  var parts = splitParagraphText(s);
  if (!parts.length) return '<span class="empty">—</span>';
  return '<div class="paragraph-list">' + parts.map(function(p){ return '<p>' + esc(p) + '</p>'; }).join('') + '</div>';
}
function urlValue(s) {
  var text = String(s || '').trim();
  if (!text) return '<span class="empty">—</span>';
  if (/^https?:\/\//i.test(text)) {
    return '<a href="' + esc(text) + '" target="_blank" rel="noopener">' + esc(text) + '</a>';
  }
  return esc(text);
}

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
function badgeCls(s){ if (s==='已公開') return 'badge-public'; if (s==='不通過') return 'badge-reject'; return 'badge-pending'; }

// ── RENDER ──
function renderStore() {
  var d = storeData;
  var photos = [d.photo1, d.photo2, d.photo3, d.photo4, d.photo5,
                d.photo6, d.photo7, d.photo8, d.photo9, d.photo10].filter(Boolean);

  document.getElementById('pageTitle').textContent = d.storeName || d.pubName || '商店詳情';

  // helper: first non-empty value from private field, then pub* fallback
  var dispName  = d.storeName  || d.pubName;
  var dispCate  = d.category   || d.pubCate;
  var dispPhone = d.storePhone || d.pubPhone;
  var dispNum   = d.storeNum   || d.pubStoreNum;
  var dispDesc  = d.desc       || d.pubDesc;
  var dispOffer = d.offer      || d.pubOffer;
  var dispHours = d.hours      || d.pubHours;
  var dispAddr  = d.addr       || d.pubAddr;
  var dispMap   = d.mapUrl     || d.pubMapUrl;

  var html = '';

  // ── 狀態＋申請人 bar ──
  html += '<div class="status-bar">';
  html += '<div class="status-bar-item"><div class="sb-lbl">狀態</div><div class="sb-val"><span class="badge ' + badgeCls(d.status) + '">' + esc(d.status || '未設定') + '</span></div></div>';
  html += '<div class="status-bar-item"><div class="sb-lbl">申請人姓名</div><div class="sb-val">' + (v(d.name)) + '</div></div>';
  html += '<div class="status-bar-item"><div class="sb-lbl">申請人電話</div><div class="sb-val">' + (d.phone ? '<a href="tel:' + esc(d.phone) + '">' + esc(d.phone) + '</a>' : '—') + '</div></div>';
  // 從 LINE 選單進來申請時自動記錄，可用來核對申請人身分
  html += '<div class="status-bar-item"><div class="sb-lbl">LINE 名稱</div><div class="sb-val">' + (v(d.lineDisplayName)) + '</div></div>';
  html += '<div class="status-bar-item"><div class="sb-lbl">LINE ID</div><div class="sb-val" style="font-size:11px;word-break:break-all">' + (v(d.lineId)) + '</div></div>';
  html += '</div>';

  // ── 商家資訊 ──
  html += '<div class="card">';
  html += '<div class="card-header"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> 商家資訊</div>';
  html += row('商家類別',  dispCate ? cateBadge(dispCate) : '<span class="empty">—</span>');
  html += row('店家名稱',  v(dispName));
  html += row('店家電話',  dispPhone ? '<a href="tel:' + esc(dispPhone) + '">' + esc(dispPhone) + '</a>' : '<span class="empty">—</span>');
  html += row('統一編號',  v(dispNum));
  html += row('品牌標籤',  brandTagBadges(d));
  html += row('經營內容',  paragraphValue(dispDesc));
  html += row('優惠方案',  paragraphValue(dispOffer));
  html += row('營業時間',  paragraphValue(dispHours));
  html += row('店家地址',  dispAddr ? (esc(dispAddr) + (dispMap ? ' <a href="' + esc(dispMap) + '" target="_blank" rel="noopener">地圖 ↗</a>' : '')) : '<span class="empty">—</span>');
  html += row('店家官網',  urlValue(d.brandUrl));
  html += row('申請時間',  v(d.applyTime));
  if (d.note) html += row('管理員備註', '<span class="desc">' + esc(d.note) + '</span>');
  if (d.lastUpdate) html += row('最後更新', v(d.lastUpdate));
  html += '</div>';

  // ── 公開資訊（若已公開） ──
  if (d.status === '已公開') {
    html += '<div class="card">';
    html += '<div class="card-header" style="color:var(--primary)"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> 對外公開資訊</div>';
    html += row('公開店名',    v(d.pubName));
    html += row('公開類別',    d.pubCate ? cateBadge(d.pubCate) : '<span class="empty">—</span>');
    html += row('品牌標籤',    brandTagBadges(d));
    if (d.pubStoreNum) html += row('公開統一編號', v(d.pubStoreNum));
    html += row('公開電話',    d.pubPhone ? '<a href="tel:' + esc(d.pubPhone) + '">' + esc(d.pubPhone) + '</a>' : '<span class="empty">—</span>');
    html += row('公開地址',    d.pubAddr ? (esc(d.pubAddr) + (d.pubMapUrl ? ' <a href="' + esc(d.pubMapUrl) + '" target="_blank" rel="noopener">地圖 ↗</a>' : '')) : '<span class="empty">—</span>');
    if (d.pubDesc)  html += row('公開經營內容', paragraphValue(d.pubDesc));
    if (d.pubOffer) html += row('公開優惠方案', paragraphValue(d.pubOffer));
    if (d.pubHours) html += row('公開營業時間', paragraphValue(d.pubHours));
    html += row('店家官網', urlValue(d.brandUrl));
    html += '</div>';
  }

  // ── 照片 ──
  if (photos.length) {
    html += '<div class="card">';
    html += '<div class="card-header"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> 店家照片</div>';
    html += '<div class="photo-grid-wrap"><div class="photo-grid">';
    _lbViewPhotos = photos;
    photos.forEach(function(p, i){ html += renderPhotoCard(p, '店家照片' + (i+1), '_lbViewPhotos', i); });
    html += '</div></div></div>';
  }

  document.getElementById('mainContent').innerHTML = html;
  document.getElementById('actionBar').style.display = 'flex';
}

// ── MODAL ──
var CATE_OPTIONS = ['美食地圖','飲料冰品','健康醫療','生活便利','住宅相關','寵物專區','其他'];
var taxonomyBrandTags = [];
var taxonomyBrandTagDefs = [];
var BRAND_TAG_PALETTE = {
  gold:{ bg:'#FFF3E0', txt:'#B75D00', bd:'#F5D7A2' }, mint:{ bg:'#EAF3EB', txt:'#2F6836', bd:'#CFE2D3' },
  blue:{ bg:'#EFF6FF', txt:'#2563EB', bd:'#BFDBFE' }, rose:{ bg:'#FFF1F4', txt:'#B4235A', bd:'#F7C1CF' },
  violet:{ bg:'#F5F0FF', txt:'#6B28A8', bd:'#DCCBFF' }, stone:{ bg:'#F0EEEC', txt:'#7A6E66', bd:'#D8D0C8' }
};
function brandTagCss(tag) {
  var def = taxonomyBrandTagDefs.find(function(item){ return item.name === tag; }) || { color:'gold' };
  var color = BRAND_TAG_PALETTE[def.color] || BRAND_TAG_PALETTE.gold;
  return 'background:' + color.bg + ';color:' + color.txt + ';border-color:' + color.bd;
}

function loadStoreTaxonomy() {
  if (!CONFIG.STORE_API_URL) return;
  fetch(CONFIG.STORE_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'getPublicStoreTaxonomy' })
  })
    .then(function(res){ return res.json(); })
    .then(function(json){
      var taxonomy = json.success && json.taxonomy ? json.taxonomy : {};
      if (Array.isArray(taxonomy.categories) && taxonomy.categories.length) CATE_OPTIONS = taxonomy.categories;
      taxonomyBrandTags = Array.isArray(taxonomy.brandTags) ? taxonomy.brandTags : [];
      taxonomyBrandTagDefs = Array.isArray(taxonomy.brandTagDefs) ? taxonomy.brandTagDefs : [];
      reviewAvailableBrandTags = taxonomyBrandTags.slice();
      if (storeData) renderStore();
      renderReviewBrandTags();
    })
    .catch(function(){});
}

function openModal() {
  if (!storeData) return;
  var d = storeData;
  var html = '';

  // 狀態
  html += '<div class="field"><div class="field-label">商店狀態 <span class="req">*</span></div>';
  html += '<select id="m_status" onchange="togglePubSection()">';
  html += '<option value="">請選擇</option>';
  ['申請審核中', '已公開', '不通過'].forEach(function(s){
    html += '<option value="' + s + '"' + (d.status === s ? ' selected' : '') + '>' + s + '</option>';
  });
  html += '</select></div>';

  // 管理員備註
  html += '<div class="field"><div class="field-label">管理員備註</div>';
  html += '<textarea id="m_note" rows="3" placeholder="內部備註（不對外顯示）">' + esc(d.note || '') + '</textarea></div>';

  // 審核人（唯讀，自動帶入登入帳號）
  html += '<div class="field"><div class="field-label">審核人</div>';
  html += '<input type="text" id="m_reviewer" value="' + esc(gName) + '" readonly>';
  html += '<div style="font-size:12px;color:var(--primary);margin-top:4px">✓ 已登入為 ' + esc(gName) + '</div></div>';

  html += '<div class="field"><div class="field-label">商店照片 <span style="color:var(--muted);font-size:11px;font-weight:400">（最多 10 張，可拖曳調整順序）</span></div>';
  html += '<div class="photo-upload-area" id="storePhotoUploadArea">';
  html += '<div class="photo-preview-grid" id="storePhotoGrid"></div>';
  html += '<label class="photo-add-btn" id="storePhotoAddBtn">';
  html += '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  html += '新增照片';
  html += '<input type="file" accept="image/*" multiple id="storePhotoFileInput" style="display:none" onchange="handleStoreMultiPhotoAdd(this)">';
  html += '</label>';
  html += '</div></div>';

  // ── 公開資訊區塊 ──
  var pubVisible = (d.status === '已公開') ? '' : 'display:none';
  html += '<div id="pubSection" style="' + pubVisible + '">';
  html += '<div style="margin:18px -20px 18px;border-top:1px solid var(--divider)"></div>';
  html += '<div style="font-size:12px;font-weight:700;color:var(--lbl);letter-spacing:.5px;text-transform:uppercase;margin-bottom:14px">公開資訊設定</div>';
  html += '<div style="font-size:12px;color:var(--muted);margin-bottom:16px;background:var(--primary-light);padding:10px 12px;border-radius:8px;border-left:3px solid var(--primary)">以下為對外公開顯示的內容，可在原始資料基礎上調整後再公開。原始申請資料不受影響。</div>';

  // 原始資料參考（唯讀）
  html += '<div style="background:var(--bg);border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:12px;color:var(--lbl)">';
  html += '<div style="font-weight:700;margin-bottom:8px;color:var(--val)">原始申請資料（唯讀參考）</div>';
  html += '<div style="display:grid;grid-template-columns:80px 1fr;gap:4px 8px">';
  [['店名',d.storeName],['類別',d.category],['品牌標籤',brandTagsText(d)],['統一編號',d.storeNum],['電話',d.storePhone],['地址',d.addr],['店家官網',d.brandUrl],['經營內容',d.desc],['優惠方案',d.offer],['營業時間',d.hours]].forEach(function(pair){
    if (pair[1]) {
      html += '<span style="color:var(--muted)">' + pair[0] + '</span>';
      html += '<span style="color:var(--val);word-break:break-all">' + esc(pair[1]) + '</span>';
    }
  });
  html += '</div></div>';

  // 公開欄位編輯
  html += mf('公開店名 <span class="req">*</span>', '<input type="text" id="m_pubName" value="' + esc(d.pubName || d.storeName || '') + '" placeholder="對外顯示的店名">');

  html += mf('公開類別 <span class="req">*</span>', (function(){
    var sel = '<select id="m_pubCate">';
    CATE_OPTIONS.forEach(function(c){
      var cur = d.pubCate || d.category || '';
      sel += '<option value="' + c + '"' + (cur === c ? ' selected' : '') + '>' + c + '</option>';
    });
    sel += '</select>';
    return sel;
  })());

  html += mf('公開統一編號', '<input type="text" id="m_pubStoreNum" value="' + esc(pubVal(d, 'pubStoreNum', 'storeNum')) + '" placeholder="統一編號（選填）">');
  html += mf('公開電話', '<input type="text" id="m_pubPhone" value="' + esc(pubVal(d, 'pubPhone', 'storePhone')) + '" placeholder="對外顯示的電話">');
  html += mf('公開地址', '<input type="text" id="m_pubAddr" value="' + esc(pubVal(d, 'pubAddr', 'addr')) + '" placeholder="對外顯示的地址">');
  html += mf('地圖連結', '<input type="text" id="m_pubMapUrl" value="' + esc(pubVal(d, 'pubMapUrl', 'mapUrl')) + '" placeholder="Google Maps 連結">');
  html += mf('品牌標籤', '<div class="brand-tag-picker">'
    + '<div class="brand-tag-selected" id="reviewBrandTagSelected"></div>'
    + '<div class="brand-tag-input-row">'
    + '<input type="text" id="m_brandTagNew" maxlength="6" placeholder="沒有適合的標籤時輸入新的">'
    + '<button type="button" class="brand-tag-add" onclick="addReviewBrandTagInput()">新增</button>'
    + '</div>'
    + '<div class="brand-tag-options" id="reviewBrandTagOptions"></div>'
    + '<div class="brand-tag-hint">最多 3 個，每個最多 6 個字；公開後才會提供其他店家選用</div>'
    + '</div>');
  html += mf('店家官網', '<input type="url" id="m_brandUrl" value="' + esc(d.brandUrl || '') + '" placeholder="官網、粉絲頁或訂餐連結">');
  html += mf('公開經營內容', '<textarea id="m_pubDesc" class="rich-textarea" rows="6" placeholder="對外顯示的經營內容；可直接換行分段">' + esc(pubVal(d, 'pubDesc', 'desc')) + '</textarea>');
  html += mf('公開優惠方案', '<textarea id="m_pubOffer" class="rich-textarea" rows="6" placeholder="對外顯示的優惠方案；留空代表不對外顯示">' + esc(pubVal(d, 'pubOffer', 'offer')) + '</textarea>');
  html += mf('公開營業時間', '<textarea id="m_pubHours" class="rich-textarea" rows="5" placeholder="例：週一 11:00-22:00&#10;週二公休">' + esc(pubVal(d, 'pubHours', 'hours')) + '</textarea>');

  html += '</div>'; // end pubSection

  document.getElementById('modalBody').innerHTML = html;
  initStorePhotos(d);
  initReviewBrandTags(d);
  document.getElementById('reviewModal').classList.add('open');
  document.body.style.overflow = 'hidden';

}

// 尚未編輯過的店家，公開欄位空白時預填原始申請資料；
// 編輯過之後（pubEdited）留空就是留空，不再自動帶回舊值
function pubVal(d, pubKey, srcKey) {
  var pv = d[pubKey] || '';
  if (d.pubEdited) return pv;
  return pv || d[srcKey] || '';
}

function mf(lbl, input) {
  return '<div class="field"><div class="field-label">' + lbl + '</div>' + input + '</div>';
}

function togglePubSection() {
  var s = document.getElementById('m_status').value;
  var sec = document.getElementById('pubSection');
  if (sec) sec.style.display = (s === '已公開') ? '' : 'none';
}

function closeModal() {
  document.getElementById('reviewModal').classList.remove('open');
  document.body.style.overflow = '';
}

var reviewAvailableBrandTags = [];
var reviewSelectedBrandTags = [];

function brandTagJs(value) {
  return esc(String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
}

function renderReviewBrandTags() {
  var selected = document.getElementById('reviewBrandTagSelected');
  var options = document.getElementById('reviewBrandTagOptions');
  if (!selected || !options) return;
  selected.innerHTML = reviewSelectedBrandTags.length
    ? reviewSelectedBrandTags.map(function(tag){
        return '<span class="brand-tag-chip" style="' + brandTagCss(tag) + '">' + esc(tag)
          + '<button type="button" aria-label="移除 ' + esc(tag) + '" onclick="removeReviewBrandTag(\'' + brandTagJs(tag) + '\')">×</button></span>';
      }).join('')
    : '<span class="brand-tag-empty">尚未選擇標籤</span>';
  options.innerHTML = reviewAvailableBrandTags.length
    ? reviewAvailableBrandTags.map(function(tag){
        var active = reviewSelectedBrandTags.indexOf(tag) !== -1;
        return '<button type="button" class="brand-tag-option' + (active ? ' selected' : '')
          + '" style="' + brandTagCss(tag) + '" onclick="toggleReviewBrandTag(\'' + brandTagJs(tag) + '\')">' + esc(tag) + '</button>';
      }).join('')
    : '<span class="brand-tag-empty">公開店家累積標籤後會顯示在這裡</span>';
}

function addReviewBrandTag(tag) {
  tag = String(tag || '').trim();
  if (!tag) return true;
  if (tag.length > 6) { alert('每個標籤最多 6 個字'); return false; }
  if (/^\d+$/.test(tag)) { alert('品牌標籤不能只有數字'); return false; }
  if (reviewSelectedBrandTags.indexOf(tag) !== -1) return true;
  if (reviewSelectedBrandTags.length >= 3) { alert('一家店最多 3 個品牌標籤'); return false; }
  reviewSelectedBrandTags.push(tag);
  renderReviewBrandTags();
  return true;
}

function addReviewBrandTagInput() {
  var input = document.getElementById('m_brandTagNew');
  if (!input || !addReviewBrandTag(input.value)) return;
  input.value = '';
}

function removeReviewBrandTag(tag) {
  reviewSelectedBrandTags = reviewSelectedBrandTags.filter(function(item){ return item !== tag; });
  renderReviewBrandTags();
}

function toggleReviewBrandTag(tag) {
  if (reviewSelectedBrandTags.indexOf(tag) !== -1) removeReviewBrandTag(tag);
  else addReviewBrandTag(tag);
}

function initReviewBrandTags(d) {
  reviewSelectedBrandTags = brandTags(d);
  reviewAvailableBrandTags = taxonomyBrandTags.slice();
  renderReviewBrandTags();
  var input = document.getElementById('m_brandTagNew');
  if (input) input.addEventListener('keydown', function(e){
    if (e.key === 'Enter') { e.preventDefault(); addReviewBrandTagInput(); }
  });
}

var storePhotos = [];
var storePhotoIdSeq = 0;
var storePhotoSortable = null;

function renderPhotoCard(url, label, groupVar, idx){
  var safeUrl = esc(url);
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

function initStorePhotos(d) {
  storePhotos = [];
  storePhotoIdSeq = 0;
  if (storePhotoSortable) { storePhotoSortable.destroy(); storePhotoSortable = null; }
  [d.photo1, d.photo2, d.photo3, d.photo4, d.photo5,
   d.photo6, d.photo7, d.photo8, d.photo9, d.photo10].forEach(function(url) {
    if (url) storePhotos.push({ id: storePhotoIdSeq++, src: url, file: null, origUrl: url });
  });
  renderStorePhotoGrid();
}

function renderStorePhotoGrid() {
  var grid   = document.getElementById('storePhotoGrid');
  var addBtn = document.getElementById('storePhotoAddBtn');
  if (!grid) return;
  grid.innerHTML = '';
  storePhotos.forEach(function(p) {
    var div = document.createElement('div');
    div.className = 'photo-preview-item';
    div.setAttribute('data-sort-id', String(p.id));
    var img = document.createElement('img');
    img.src = p.src; img.alt = '照片';
    var rmBtn = document.createElement('button');
    rmBtn.type = 'button'; rmBtn.className = 'item-remove'; rmBtn.textContent = '✕';
    rmBtn.setAttribute('data-pid', String(p.id));
    rmBtn.addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation();
      var pid = parseInt(this.getAttribute('data-pid'));
      syncStorePhotosFromDOM();
      storePhotos = storePhotos.filter(function(x) { return x.id !== pid; });
      renderStorePhotoGrid();
    });
    div.appendChild(img); div.appendChild(rmBtn);
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
    if (storePhotos.length > 1) {
      var hint = document.createElement('span');
      hint.className = 'drag-hint'; hint.textContent = '拖曳排序';
      div.appendChild(hint);
    }
    grid.appendChild(div);
  });
  if (addBtn) addBtn.classList.toggle('hidden', storePhotos.length >= 10);
  if (storePhotoSortable) { storePhotoSortable.destroy(); storePhotoSortable = null; }
  if (storePhotos.length > 1) {
    storePhotoSortable = new SortableOrder(grid, {
      selector: '.photo-preview-item',
      onReorder: function(ids) {
        var idMap = {};
        storePhotos.forEach(function(p) { idMap[p.id] = p; });
        storePhotos = ids.map(function(id) { return idMap[parseInt(id)]; }).filter(Boolean);
      }
    });
  }
}

function syncStorePhotosFromDOM() {
  var grid = document.getElementById('storePhotoGrid');
  if (!grid) return;
  var idMap = {};
  storePhotos.forEach(function(p) { idMap[p.id] = p; });
  var ordered = Array.prototype.map.call(grid.querySelectorAll('[data-sort-id]'), function(el) {
    return idMap[parseInt(el.getAttribute('data-sort-id'))];
  }).filter(Boolean);
  if (ordered.length === storePhotos.length) storePhotos = ordered;
}

function handleStoreMultiPhotoAdd(input) {
  if (!input.files || !input.files.length) return;
  var slots = 10 - storePhotos.length;
  if (slots <= 0) return;
  var files = Array.prototype.slice.call(input.files, 0, slots);
  var pending = files.length;
  files.forEach(function(file) {
    var id = storePhotoIdSeq++;
    var reader = new FileReader();
    reader.onload = function(e) {
      storePhotos.push({ id: id, src: e.target.result, file: file, origUrl: '' });
      pending--;
      if (pending === 0) renderStorePhotoGrid();
    };
    reader.readAsDataURL(file);
  });
  input.value = '';
}

function compressStoreImage(file){
  return new Promise(function(resolve){
    var reader = new FileReader();
    reader.onload = function(e){
      var img = new Image();
      img.onload = function(){
        var canvas = document.createElement('canvas');
        var max = 1600, w = img.width, h = img.height;
        if (w > max || h > max){
          if (w > h){ h = Math.round(h * max / w); w = max; }
          else { w = Math.round(w * max / h); h = max; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadStorePhotoFile(file){
  if (!file) return '';
  try {
    var dataUrl = await compressStoreImage(file);
    var b64 = dataUrl.indexOf(',') !== -1 ? dataUrl.split(',')[1] : dataUrl;
    var sess = getSession();
    var res = await fetch(CONFIG.STORE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'uploadAdminPhoto',
        imageBase64: b64,
        mimeType: 'image/jpeg',
        sessionToken: sess ? sess.sessionToken : '',
        id_token: sess ? (sess.id_token || '') : ''
      })
    });
    var json = await res.json();
    return (json.success && json.url) ? json.url : '';
  } catch (e) {
    return '';
  }
}

// ── SUBMIT ──
async function submitReview() {
  var status = document.getElementById('m_status').value;
  if (!status) {
    var el = document.getElementById('m_status');
    el.style.borderColor = 'var(--warn)';
    el.addEventListener('change', function(){ el.style.borderColor = ''; }, { once: true });
    return;
  }

  var btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 儲存中…';

  try {
    var sess = getSession();
    function gv(id){ var el = document.getElementById(id); return el ? el.value.trim() : ''; }
    syncStorePhotosFromDOM();
    var nextPhotos = await Promise.all(storePhotos.map(function(p) {
      return p.file ? uploadStorePhotoFile(p.file) : Promise.resolve(p.origUrl || '');
    }));
    while (nextPhotos.length < 10) nextPhotos.push('');
    var payload = {
      action: 'updateStore',
      sessionToken: sess ? sess.sessionToken : '',
      id_token: sess ? (sess.id_token || '') : '',
      storeId: storeId,
      status:  status,
      note:    gv('m_note'),
      reviewer: gv('m_reviewer'),
      planType: storeData.planType || '免費',
      pinOrder: parseInt(storeData.pinOrder, 10) || 0,
      photo1: nextPhotos[0],  photo2: nextPhotos[1],  photo3: nextPhotos[2],
      photo4: nextPhotos[3],  photo5: nextPhotos[4],  photo6: nextPhotos[5],
      photo7: nextPhotos[6],  photo8: nextPhotos[7],  photo9: nextPhotos[8],
      photo10: nextPhotos[9],
      pubName:       gv('m_pubName'),
      pubCate:       gv('m_pubCate'),
      pubStoreNum:   gv('m_pubStoreNum'),
      pubPhone:      gv('m_pubPhone'),
      pubAddr:   gv('m_pubAddr'),
      pubMapUrl: gv('m_pubMapUrl'),
      brandTags: reviewSelectedBrandTags.slice(0, 3),
      brandUrl:  gv('m_brandUrl'),
      pubDesc:   gv('m_pubDesc'),
      pubOffer:  gv('m_pubOffer'),
      pubHours:  gv('m_pubHours'),
    };
    var res = await fetch(CONFIG.STORE_API_URL || CONFIG.SCRIPT_URL, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    var json = JSON.parse(await res.text());
    if (!json.success) throw new Error(json.error || '寫入失敗');

    Object.assign(storeData, {
      status: payload.status,
      note: payload.note,
      reviewer: payload.reviewer,
      pubName: payload.pubName,
      pubCate: payload.pubCate,
      pubStoreNum: payload.pubStoreNum,
      pubPhone: payload.pubPhone,
      pubAddr: payload.pubAddr,
      pubMapUrl: payload.pubMapUrl,
      brandTags: payload.brandTags,
      brandTag: payload.brandTags[0] || '',
      brandUrl: payload.brandUrl,
      pubDesc: payload.pubDesc,
      pubOffer: payload.pubOffer,
      pubHours: payload.pubHours,
      pubEdited: true,
      lastUpdate: new Date().toISOString()
    });
    for (var si = 0; si < 10; si++) storeData['photo' + (si + 1)] = nextPhotos[si] || '';
    try { sessionStorage.setItem('store_preview_' + storeId, JSON.stringify(storeData)); } catch(e) {}
    closeModal();
    renderStore();
    btn.disabled = false;
    btn.innerHTML = '儲存';
    document.getElementById('successOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
    var _cdEl = document.getElementById('successCountdown');
    if (_cdEl) _cdEl.textContent = '已更新畫面，不需重新載入。';
    setTimeout(closeSuccessOverlay, 900);
  } catch(err) {
    alert('儲存失敗，請稍後再試。\n錯誤：' + err.message);
    btn.disabled = false;
    btn.innerHTML = '儲存';
  }
}

function showError(t, m){
  document.getElementById('mainContent').innerHTML =
    '<div class="card"><div class="state-box"><h3>' + t + '</h3><p>' + m + '</p></div></div>';
}

function closeSuccessOverlay(){
  var el = document.getElementById('successOverlay');
  if (el) el.classList.remove('open');
  document.body.style.overflow = '';
}

// ── LIGHTBOX ──
var _lbPhotos = [], _lbIdx = 0, _lbViewPhotos = [];
function openLb(photos, idx){ _lbPhotos = photos; _lbIdx = idx||0; _updateLb(); document.getElementById('lightbox').classList.add('open'); document.body.style.overflow='hidden'; }
function _updateLb(){ document.getElementById('lbImg').src=_lbPhotos[_lbIdx]; var multi=_lbPhotos.length>1; var prev=document.getElementById('lbPrevBtn'); var next=document.getElementById('lbNextBtn'); var ctr=document.getElementById('lbCounter'); prev.style.display=(multi&&_lbIdx>0)?'flex':'none'; next.style.display=(multi&&_lbIdx<_lbPhotos.length-1)?'flex':'none'; if(multi){ctr.textContent=(_lbIdx+1)+' / '+_lbPhotos.length;ctr.style.display='block';}else{ctr.style.display='none';} }
function lbMove(dir){ var n=_lbIdx+dir; if(n>=0&&n<_lbPhotos.length){_lbIdx=n;_updateLb();} }
function closeLb(){ document.getElementById('lightbox').classList.remove('open'); document.body.style.overflow=''; }
document.addEventListener('keydown', function(e){ if(e.key==='Escape'){closeLb();closeModal();} if(e.key==='ArrowLeft')lbMove(-1); if(e.key==='ArrowRight')lbMove(1); });

function goBack(){ if (history.length > 1) { history.back(); return; } location.href = CONFIG.BASE_URL + '/storelist.html'; }
['click','keydown','mousedown','touchstart','scroll'].forEach(function(eventName){
  window.addEventListener(eventName, function(){ touchSession(); }, { passive: true });
});
