/* 公佈欄：里刊新聞版面（四個里共用）。
   版面樣式在 assets/bulletin-news.css，顏色走 var(--gs-*)；
   各里的色票各自定義在自己的 assets/theme.css，改色不用動這支。 */

var CATE_ORDER = ['緊急通告', '政策宣導', '最新消息', '教育課程', '里民活動'];
var CATE_TAG = {
  '緊急通告': 'tag-emergency',
  '政策宣導': 'tag-policy',
  '最新消息': 'tag-news',
  '教育課程': 'tag-course',
  '里民活動': 'tag-activity'
};
var EYE_SVG = '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="display:inline;vertical-align:-1px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';

var allBulletins = [];
var currentCate = 'all';
var vcData = {};
var vcNames = {};

function fmtNum(n) {
  return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function cateOf(b) {
  return (b && b.category) || '里民活動';
}

function newsDate(value) {
  if (!value) return '';
  var s = String(value).replace('T', ' ');
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + '.' + m[2] + '.' + m[3] : s.slice(0, 10);
}

function apiPost(action, extra) {
  var payload = Object.assign({ action: action }, extra || {});
  return fetch(CONFIG.BULLETIN_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  }).then(function (r) { return r.json(); });
}

function splitImageUrls(value) {
  return String(value || '').split(/\r?\n|,/).map(function (s) { return s.trim(); }).filter(Boolean);
}

function stripHtml(html) {
  var div = document.createElement('div');
  div.innerHTML = html || '';
  return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
}

function sanitizeHtml(html) {
  var template = document.createElement('template');
  template.innerHTML = html || '';
  var allowed = { P: 1, BR: 1, STRONG: 1, B: 1, EM: 1, I: 1, U: 1, A: 1, UL: 1, OL: 1, LI: 1, H2: 1, H3: 1, BLOCKQUOTE: 1 };
  var walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT, null);
  var nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(function (node) {
    if (!allowed[node.tagName]) {
      var frag = document.createDocumentFragment();
      while (node.firstChild) frag.appendChild(node.firstChild);
      node.parentNode.replaceChild(frag, node);
      return;
    }
    Array.prototype.slice.call(node.attributes).forEach(function (attr) {
      if (node.tagName === 'A' && attr.name === 'href') {
        if (!/^https?:|^mailto:|^tel:/i.test(attr.value || '')) node.removeAttribute('href');
      } else {
        node.removeAttribute(attr.name);
      }
    });
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener');
    }
  });
  return template.innerHTML;
}

/* ── 排序：置頂 → 緊急通告 → 日期新的在前。
   新聞版面以時間為主軸，只有置頂與緊急通告可以插隊，其餘分類不加權。 ── */
function newsRank(a, b) {
  var pa = a.pinned ? 0 : 1, pb = b.pinned ? 0 : 1;
  if (pa !== pb) return pa - pb;
  var ea = cateOf(a) === '緊急通告' ? 0 : 1, eb = cateOf(b) === '緊急通告' ? 0 : 1;
  if (ea !== eb) return ea - eb;
  return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
}

/* ── 原始連結 ──
   linkUrl 是里長在後台填的「原始連結」，實際上幾乎都是臉書貼文。
   只認 http(s)：資料裡也有 action:community 這種給 LINE 用的值，不是網址。 */
var FB_SVG = '<svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.96h-1.51c-1.49 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z"/></svg>';
var LINK_SVG = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

function sourceUrl(b) {
  var url = String((b && b.linkUrl) || '').trim();
  return /^https?:\/\//i.test(url) ? url : '';
}

function isFacebook(url) {
  return /^https?:\/\/([a-z0-9-]+\.)*(facebook\.com|fb\.com|fb\.me|fb\.watch)(\/|$)/i.test(url);
}

function sourceLinkHtml(b) {
  var url = sourceUrl(b);
  if (!url) return '';
  var fb = isFacebook(url);
  return '<a class="source-link" href="' + esc(url) + '" target="_blank" rel="noopener">' +
    (fb ? FB_SVG : LINK_SVG) +
    '<span>' + (fb ? '在 Facebook 看這則貼文' : '查看原始連結') + '</span>' +
    '<span class="source-link-arrow" aria-hidden="true">↗</span></a>';
}

/* ── 小元件 ── */
function metaHtml(b, withViews) {
  var cate = cateOf(b);
  var html = '';
  if (b.pinned) html += '<span class="tag tag-pin">置頂</span>';
  html += '<span class="tag ' + (CATE_TAG[cate] || 'tag-activity') + '">' + esc(cate) + '</span>';
  html += '<span class="dateline">' + esc(newsDate(b.createdAt)) + '</span>';
  if (withViews) html += '<span class="views" id="vc-' + esc(b.bulletinId) + '">' + EYE_SVG + ' –</span>';
  return html;
}

/* 沒放圖的公告不留空框，該則改成純文字排版（配 no-figure） */
function hasFigure(b) {
  return splitImageUrls(b.imageUrl).length > 0;
}
function figureHtml(b, cls) {
  var images = splitImageUrls(b.imageUrl);
  if (!images.length) return '';
  return '<div class="' + cls + '"><img src="' + esc(images[0]) + '" alt="" loading="lazy"></div>';
}
function figureClass(b) {
  return hasFigure(b) ? '' : ' no-figure';
}

function openAttrs(id, classes) {
  return 'class="clickable' + (classes ? ' ' + classes : '') + '" role="button" tabindex="0" data-id="' + esc(id) + '"';
}

/* ── 版面 ── */
function renderFeed(list) {
  var feed = document.getElementById('feed');
  if (!list.length) {
    var nothingAtAll = !allBulletins.length;
    feed.innerHTML = '<div class="state">' +
      '<svg width="46" height="46" fill="none" stroke-width="1.5" viewBox="0 0 24 24">' +
      '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>' +
      '<rect x="9" y="3" width="6" height="4" rx="1"/></svg>' +
      (nothingAtAll
        ? '<h3>目前尚無公告</h3><p>里辦發布的消息會第一時間出現在這裡。</p>'
        : '<h3>這個分類還沒有公告</h3><p>換個分類看看，或稍後再回來。</p>') +
      '</div>';
    return;
  }

  var lead = list[0];
  var subs = list.slice(1, 4);
  var rest = list.slice(4);
  var html = '';

  html += '<div class="kicker-line">頭條</div>';
  html += '<article ' + openAttrs(lead.bulletinId) + '><div class="lead' + figureClass(lead) + '">' +
    figureHtml(lead, 'lead-figure') +
    '<div><div class="lead-meta">' + metaHtml(lead, true) + '</div>' +
    '<h2>' + esc(lead.title) + '</h2>' +
    '<p class="lead-excerpt">' + esc(stripHtml(lead.content)) + '</p>' +
    '<div class="lead-more"><span>閱讀全文</span> →</div>' +
    '</div></div></article>';

  if (subs.length) {
    html += '<div class="subleads">';
    subs.forEach(function (b) {
      html += '<article ' + openAttrs(b.bulletinId, 'sublead' + figureClass(b)) + '>' +
        figureHtml(b, 'sublead-figure') +
        '<div><div class="story-meta">' + metaHtml(b, true) + '</div>' +
        '<h3>' + esc(b.title) + '</h3>' +
        '<p class="sublead-excerpt">' + esc(stripHtml(b.content)) + '</p></div></article>';
    });
    html += '</div>';
  }

  if (rest.length) {
    html += '<div class="stories"><div class="kicker-line">更多消息</div>';
    rest.forEach(function (b) {
      html += '<article ' + openAttrs(b.bulletinId, 'story' + figureClass(b)) + '>' +
        figureHtml(b, 'story-figure') +
        '<div><div class="story-meta">' + metaHtml(b, true) + '</div>' +
        '<h3>' + esc(b.title) + '</h3>' +
        '<p class="story-excerpt">' + esc(stripHtml(b.content)) + '</p></div></article>';
    });
    html += '</div>';
  }

  feed.innerHTML = html;
  updateViewBadges();
}

function buildTabs() {
  var counts = {};
  allBulletins.forEach(function (b) {
    var c = cateOf(b);
    counts[c] = (counts[c] || 0) + 1;
  });
  var tabs = [{ key: 'all', label: '全部', n: allBulletins.length }];
  CATE_ORDER.forEach(function (c) {
    if (counts[c]) tabs.push({ key: c, label: c, n: counts[c] });
  });
  Object.keys(counts).forEach(function (c) {
    if (CATE_ORDER.indexOf(c) === -1) tabs.push({ key: c, label: c, n: counts[c] });
  });

  document.getElementById('cateTabs').innerHTML = tabs.map(function (t) {
    return '<button class="cate-tab" role="tab" data-cate="' + esc(t.key) + '"' +
      ' aria-selected="' + (t.key === currentCate ? 'true' : 'false') + '">' +
      esc(t.label) + '<span class="n">' + t.n + '</span></button>';
  }).join('');
}

function applyCate(cate) {
  currentCate = cate;
  document.querySelectorAll('.cate-tab').forEach(function (el) {
    el.setAttribute('aria-selected', el.dataset.cate === cate ? 'true' : 'false');
  });
  var list = cate === 'all' ? allBulletins : allBulletins.filter(function (b) { return cateOf(b) === cate; });
  renderFeed(list);
}

/* ── 瀏覽統計 ── */
function loadViewStats() {
  apiPost('getViewStats', { page: 'bulletin' }).then(function (json) {
    if (!json.success) return;
    vcData = json.cardCounts || {};
    var box = document.getElementById('pageViews');
    box.hidden = false;
    document.getElementById('pageViewCount').textContent = fmtNum(json.pageCount);
    updateViewBadges();
    renderRank();
  }).catch(function () {});
}

function updateViewBadges() {
  Object.keys(vcData).forEach(function (id) {
    var el = document.getElementById('vc-' + id);
    if (el) el.innerHTML = EYE_SVG + ' ' + fmtNum(vcData[id]);
  });
}

function renderRank() {
  var entries = Object.keys(vcData)
    .filter(function (id) { return vcNames[id]; })
    .map(function (id) { return { id: id, name: vcNames[id], count: vcData[id] }; })
    .sort(function (a, b) { return b.count - a.count; })
    .slice(0, 5);

  var body = document.getElementById('rankBody');
  if (!entries.length) {
    body.innerHTML = '<div class="rail-empty">尚無點閱資料</div>';
    return;
  }
  var cls = ['r1', 'r2', 'r3', '', ''];
  body.innerHTML = entries.map(function (item, i) {
    return '<div class="rank-row" data-id="' + esc(item.id) + '">' +
      '<div class="rank-num ' + cls[i] + '">' + (i + 1) + '</div>' +
      '<div class="rank-name">' + esc(item.name) + '</div>' +
      '<div class="views">' + fmtNum(item.count) + '</div></div>';
  }).join('');
}

/* ── 全文彈窗 ── */
function openById(id) {
  var b = null;
  for (var i = 0; i < allBulletins.length; i++) {
    if (allBulletins[i].bulletinId === id) { b = allBulletins[i]; break; }
  }
  if (!b) return;

  apiPost('recordCardView', { page: 'bulletin', itemId: id }).catch(function () {});
  vcData[id] = (vcData[id] || 0) + 1;
  updateViewBadges();

  document.getElementById('modalTitle').textContent = b.title || '';
  document.getElementById('modalMeta').innerHTML = metaHtml(b, false);
  var contentHtml = String(b.content || '')
    .replace(/<div>/gi, '<p>')
    .replace(/<\/div>/gi, '</p>')
    .replace(/\n/g, '<br>');
  document.getElementById('modalContent').innerHTML = sanitizeHtml(contentHtml);
  document.getElementById('modalSource').innerHTML = sourceLinkHtml(b);

  var gallery = document.getElementById('modalGallery');
  var images = splitImageUrls(b.imageUrl);
  if (images.length) {
    gallery.innerHTML = images.map(function (url) {
      return '<img src="' + esc(url) + '" alt="" loading="lazy">';
    }).join('');
    gallery.hidden = false;
  } else {
    gallery.innerHTML = '';
    gallery.hidden = true;
  }
  document.querySelector('.modal-scroll').scrollTop = 0;
  document.getElementById('modalBackdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
  document.querySelector('.modal-close').focus();
}

function closeModal(e) {
  if (e.target === document.getElementById('modalBackdrop')) closeModalDirect();
}
function closeModalDirect() {
  document.getElementById('modalBackdrop').classList.remove('open');
  document.body.style.overflow = '';
}

/* ── 事件 ── */
document.addEventListener('click', function (e) {
  var tab = e.target.closest('.cate-tab');
  if (tab) { applyCate(tab.dataset.cate); return; }
  var item = e.target.closest('[data-id]');
  if (item && !e.target.closest('.modal')) openById(item.dataset.id);
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') { closeModalDirect(); return; }
  if (e.key !== 'Enter' && e.key !== ' ') return;
  var item = e.target.closest && e.target.closest('.clickable[data-id]');
  if (item) { e.preventDefault(); openById(item.dataset.id); }
});

/* ── 載入 ── */
function load() {
  document.getElementById('mastheadKicker').textContent = CONFIG.VILLAGE_NAME + ' ' + CONFIG.SYSTEM_NAME;
  var now = new Date();
  document.getElementById('todayLine').textContent =
    now.getFullYear() + '.' + String(now.getMonth() + 1).padStart(2, '0') + '.' + String(now.getDate()).padStart(2, '0') + ' 更新';

  apiPost('getPublicBulletins').then(function (d) {
    if (!d.success || !d.bulletins || !d.bulletins.length) {
      document.getElementById('cateTabs').innerHTML = '';
      renderFeed([]);
      return;
    }
    allBulletins = d.bulletins.slice().sort(newsRank);
    allBulletins.forEach(function (b) { vcNames[b.bulletinId] = b.title || b.bulletinId; });

    var wantCate = new URLSearchParams(location.search).get('category');
    currentCate = wantCate && allBulletins.some(function (b) { return cateOf(b) === wantCate; }) ? wantCate : 'all';

    buildTabs();
    applyCate(currentCate);
    loadViewStats();
  }).catch(function () {
    document.getElementById('feed').innerHTML =
      '<div class="state"><svg width="46" height="46" fill="none" stroke-width="1.5" viewBox="0 0 24 24">' +
      '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
      '<h3>載入失敗</h3><p>請重新整理頁面再試一次。</p></div>';
  });
}

load();
