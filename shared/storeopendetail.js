
function apiCall(action, extra) {
  var payload = Object.assign({ action: action }, extra || {});
  return fetch(storeApiEndpoint(action), {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  })
  .then(function(r){ return r.text(); })
  .then(function(t){ return JSON.parse(t); });
}

function brandTags(d){ var raw = Array.isArray(d.brandTags) && d.brandTags.length ? d.brandTags : [d.brandTag]; return raw.map(function(tag){ return String(tag || '').trim(); }).filter(Boolean).slice(0,3); }
var taxonomyBrandTagDefs = [];
var renderedStoreData = null;
var BRAND_TAG_PALETTE = {
  gold:{ bg:'#FFF3E0', txt:'#B75D00', bd:'#F5D7A2' }, mint:{ bg:'#EAF3EB', txt:'#2F6836', bd:'#CFE2D3' },
  blue:{ bg:'#EFF6FF', txt:'#2563EB', bd:'#BFDBFE' }, rose:{ bg:'#FFF1F4', txt:'#B4235A', bd:'#F7C1CF' },
  violet:{ bg:'#F5F0FF', txt:'#6B28A8', bd:'#DCCBFF' }, stone:{ bg:'#F0EEEC', txt:'#7A6E66', bd:'#D8D0C8' }
};
function brandTagCss(tag) {
  var def = taxonomyBrandTagDefs.find(function(item){ return item.name === tag; }) || { color:'gold' };
  var color = BRAND_TAG_PALETTE[def.color] || BRAND_TAG_PALETTE.gold;
  return 'background:' + color.bg + ';color:' + color.txt + ';border:1px solid ' + color.bd + ';padding:3px 8px;border-radius:999px;display:inline-flex;margin:2px 5px 2px 0;font-weight:700;font-size:12px';
}
function brandTagBadges(d){ return brandTags(d).map(function(tag){ return '<span style="' + brandTagCss(tag) + '">' + esc(tag) + '</span>'; }).join(''); }
function loadStoreBrandTagDefs() {
  apiCall('getPublicStoreTaxonomy').then(function(json){
    taxonomyBrandTagDefs = json.success && json.taxonomy && Array.isArray(json.taxonomy.brandTagDefs) ? json.taxonomy.brandTagDefs : [];
    if (renderedStoreData) renderStore(renderedStoreData);
  }).catch(function(){});
}
function splitParagraphText(s) {
  var text = String(s || '').replace(/\r\n?/g, '\n').trim();
  if (!text) return [];
  return text.split(/\n+/).map(function(p){ return p.trim(); }).filter(Boolean);
}
function paragraphValue(s) {
  var parts = splitParagraphText(s);
  if (!parts.length) return '';
  return '<div class="paragraph-list">' + parts.map(function(p){ return '<p>' + esc(p) + '</p>'; }).join('') + '</div>';
}

var CATE_COLOR = {
  '食': { bg:'#FFF3E0', txt:'#B75D00' },
  '衣': { bg:'#F3EBFF', txt:'#6B28A8' },
  '住': { bg:'#EBF3FF', txt:'#1A56A8' },
  '行': { bg:'#E0F7FA', txt:'#006B6B' },
  '育': { bg:'#EAF3EB', txt:'#2F6836' },
  '樂': { bg:'#FEE2E2', txt:'#991B1B' },
  '其他': { bg:'#F0EEEC', txt:'#7A6E66' },
};
function cateBadge(cat) {
  var c = CATE_COLOR[cat] || { bg:'#F0EEEC', txt:'#7A6E66' };
  return '<span class="cate-badge" style="background:' + c.bg + ';color:' + c.txt + '">' + esc(cat) + '</span>';
}

var _lbPhotos = [], _lbIdx = 0;
function openLb(photos, idx){
  _lbPhotos = photos; _lbIdx = idx || 0;
  _updateLb();
  document.getElementById('lightbox').classList.add('open');
}
function _updateLb(){
  document.getElementById('lbImg').src = _lbPhotos[_lbIdx];
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
  document.getElementById('lbImg').src = '';
}
document.addEventListener('keydown', function(e){
  if (e.key === 'Escape')     closeLb();
  if (e.key === 'ArrowLeft')  lbMove(-1);
  if (e.key === 'ArrowRight') lbMove(1);
});

/* ── Carousel state ── */
var carouselPhotos = [];
var carouselIdx = 0;

function buildCarousel(photos) {
  if (!photos.length) {
    return '<div class="hero-placeholder"><svg width="48" height="48" fill="none" stroke="#4A92C4" stroke-width="1.5" opacity=".4" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>';
  }
  var slides = photos.map(function(url, i) {
    return '<div class="carousel-slide" onclick="openLb(carouselPhotos,' + i + ')">' +
      '<img src="' + esc(url) + '" alt="" loading="' + (i === 0 ? 'eager' : 'lazy') + '" ' +
      'onerror="this.parentNode.style.background=\'#1a1a1a\'">' +
      '</div>';
  }).join('');
  var dots = photos.length > 1 ? photos.map(function(_, i) {
    return '<div class="carousel-dot' + (i === 0 ? ' active' : '') + '" onclick="goSlide(' + i + ')"></div>';
  }).join('') : '';
  var btns = photos.length > 1
    ? '<button class="carousel-btn prev" onclick="prevSlide(event)">&#8249;</button>' +
      '<button class="carousel-btn next" onclick="nextSlide(event)">&#8250;</button>'
    : '';
  return '<div class="carousel-wrap" id="carouselWrap">' +
    '<div class="carousel-track" id="carouselTrack">' + slides + '</div>' +
    btns +
    (dots ? '<div class="carousel-dots" id="carouselDots">' + dots + '</div>' : '') +
    '</div>';
}

function goSlide(idx) {
  if (!carouselPhotos.length) return;
  carouselIdx = (idx + carouselPhotos.length) % carouselPhotos.length;
  var track = document.getElementById('carouselTrack');
  if (track) track.style.transform = 'translateX(-' + (carouselIdx * 100) + '%)';
  var dots = document.querySelectorAll('.carousel-dot');
  dots.forEach(function(d, i) { d.classList.toggle('active', i === carouselIdx); });
}
function prevSlide(e) { if (e) e.stopPropagation(); goSlide(carouselIdx - 1); }
function nextSlide(e) { if (e) e.stopPropagation(); goSlide(carouselIdx + 1); }

/* touch swipe */
var _tsX = 0;
document.addEventListener('touchstart', function(e) {
  var w = document.getElementById('carouselWrap');
  if (w && w.contains(e.target)) _tsX = e.touches[0].clientX;
}, { passive: true });
document.addEventListener('touchend', function(e) {
  var w = document.getElementById('carouselWrap');
  if (!w || !w.contains(e.target)) return;
  var dx = e.changedTouches[0].clientX - _tsX;
  if (Math.abs(dx) > 40) dx < 0 ? nextSlide(null) : prevSlide(null);
}, { passive: true });

var storeId = new URLSearchParams(location.search).get('id') || '';

function loadStore() {
  if (!storeId) { showError('缺少商店編號'); return; }

  var hasPreview = false;
  try {
    var preview = JSON.parse(sessionStorage.getItem('store_preview_' + storeId) || 'null');
    if (preview && preview.storeId) { renderStore(preview); hasPreview = true; }
  } catch(e) {}

  apiCall('getPublicStore', { storeId: storeId })
    .then(function(json){
      if (!json.success) {
        if (!hasPreview) showError(json.error || '找不到此商店');
        return;
      }
      renderStore(json.storeData);
    })
    .catch(function(){ if (!hasPreview) showError('載入失敗，請稍後再試'); });
}

function storeApiEndpoint(action) {
  var storeApiActions = { getPublicStores: true, getPublicStore: true, getPublicStoreTaxonomy: true };
  return (CONFIG.STORE_API_URL && storeApiActions[action]) ? CONFIG.STORE_API_URL : CONFIG.SCRIPT_URL;
}

function renderStore(d) {
  renderedStoreData = d;
  var name = d.pubName || '（未命名）';
  document.getElementById('pageTitle').textContent = name;

  var html = '';

  // ── 照片輪播 ──
  var photoKeys = ['photo1','photo2','photo3','photo4','photo5','photo6','photo7','photo8','photo9','photo10'];
  carouselPhotos = photoKeys.map(function(k){ return d[k] || ''; }).filter(Boolean);
  carouselIdx = 0;
  html += buildCarousel(carouselPhotos);

  // ── 店名 + 類別 ──
  html += '<div class="title-card">';
  if (d.pubCate) {
    html += '<div class="title-meta">' + cateBadge(d.pubCate) + '</div>';
  }
  html += '<div class="store-name">' + esc(name) + '</div>';
  if (d.pubPhone) {
    html += '<div class="store-phone-hero">';
    html += '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.41 2 2 0 0 1 3.6 1.25h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.85a16 16 0 0 0 6.29 6.29l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
    html += '<a href="tel:' + esc(d.pubPhone) + '">' + esc(d.pubPhone) + '</a>';
    html += '</div>';
  }
  html += '</div>';

  // ── 商店資訊 ──
  html += '<div class="card">';
  html += '<div class="card-header">';
  html += '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';
  html += ' 商店資訊</div>';
  html += '<div class="info-table">';

  if (d.pubAddr) {
    var addrHtml = esc(d.pubAddr);
    if (d.pubMapUrl) addrHtml += ' <a href="' + esc(d.pubMapUrl) + '" target="_blank" rel="noopener">地圖 ↗</a>';
    html += row('地址', addrHtml);
  }
  if (d.pubHours) html += row('營業時間', paragraphValue(d.pubHours));
  if (d.pubStoreNum) html += row('統一編號', esc(d.pubStoreNum));
  if (brandTags(d).length) html += row('品牌標籤', brandTagBadges(d));
  if (d.pubDesc) html += row('經營內容', paragraphValue(d.pubDesc));
  if (d.brandUrl) html += row('店家官網', linkUrl(d.brandUrl));

  html += '</div>';

  // ── 優惠方案 ──
  if (d.pubOffer) {
    html += '<div class="offer-box">' +
      '<div style="font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;opacity:.7;margin-bottom:6px">優惠方案</div>' +
      paragraphValue(d.pubOffer) + '</div>';
  }

  html += '</div>';

  document.getElementById('mainContent').innerHTML = html;
}

function row(lbl, val){
  return '<div class="info-row"><div class="info-lbl">' + lbl + '</div><div class="info-val">' + val + '</div></div>';
}

function linkUrl(url) {
  var text = String(url || '').trim();
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) return esc(text);
  return '<a href="' + esc(text) + '" target="_blank" rel="noopener">前往連結 ↗</a>';
}

function showError(msg) {
  document.getElementById('mainContent').innerHTML =
    '<div class="state-wrap">' +
    '<svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
    '<h3>無法顯示</h3><p>' + esc(msg) + '</p></div>';
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
  loadStoreBrandTagDefs();
  loadStore();
});
