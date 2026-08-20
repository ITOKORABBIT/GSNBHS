
document.getElementById('villageLabel').textContent = CONFIG.VILLAGE_NAME;

const PIN_SVG = '<svg class="pin-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a5 5 0 0 1 5 5c0 4-5 11-5 11S7 11 7 7a5 5 0 0 1 5-5z"/><circle cx="12" cy="7" r="2"/></svg>';

let _bulletins = [];
let vcData = {};
let vcNamesMap = {};
const EYE_SVG = '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="display:inline;vertical-align:-1px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';

function fmtNum(n) {
  return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function apiPost(action, extra) {
  const payload = Object.assign({ action: action }, extra || {});
  return fetch(CONFIG.BULLETIN_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  }).then(r => r.json());
}

function loadViewStats() {
  apiPost('getViewStats', { page: 'bulletin' })
    .then(function(json) {
      if (!json.success) return;
      vcData = json.cardCounts || {};
      document.getElementById('statsRow').style.display = 'flex';
      document.getElementById('pageViewCount').textContent = fmtNum(json.pageCount);
      Object.keys(vcData).forEach(function(id) {
        const el = document.getElementById('vc-' + id);
        if (el) el.innerHTML = EYE_SVG + ' ' + vcData[id];
      });
    })
    .catch(function() {});
}

function recordCardView(id) {
  apiPost('recordCardView', { page: 'bulletin', itemId: id }).catch(function() {});
}

function openVmModal() {
  const entries = Object.keys(vcData).map(id => ({
    id, name: vcNamesMap[id] || id, count: vcData[id]
  }));
  entries.sort((a, b) => b.count - a.count);
  const top5 = entries.slice(0, 5);
  const cls = ['r1', 'r2', 'r3', '', ''];
  const html = top5.length
    ? top5.map((item, i) =>
        '<div class="rank-row">' +
        '<div class="rank-num ' + (cls[i] || '') + '">' + (i + 1) + '</div>' +
        '<div class="rank-name">' + esc(item.name) + '</div>' +
        '<div class="rank-cnt">' + EYE_SVG + ' ' + fmtNum(item.count) + '</div>' +
        '</div>'
      ).join('')
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

function splitImageUrls(value) {
  return String(value || '')
    .split(/\r?\n|,/)
    .map(item => item.trim())
    .filter(Boolean);
}

function stripHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  return (div.textContent || div.innerText || '').trim();
}

function sanitizeHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html || '';
  const allowed = new Set(['P','BR','STRONG','B','EM','I','U','A','UL','OL','LI','H2','H3','BLOCKQUOTE']);
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT, null);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(node => {
    if (!allowed.has(node.tagName)) {
      const frag = document.createDocumentFragment();
      while (node.firstChild) frag.appendChild(node.firstChild);
      node.parentNode.replaceChild(frag, node);
      return;
    }
    Array.from(node.attributes).forEach(attr => {
      if (node.tagName === 'A' && attr.name === 'href') {
        const href = attr.value || '';
        if (!/^https?:|^mailto:|^tel:/i.test(href)) node.removeAttribute('href');
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

function fmtDate(s) {
  if (!s) return '';
  return s.replace('T', ' ').slice(0, 16);
}

async function load() {
  try {
    const r = await fetch(CONFIG.BULLETIN_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'getPublicBulletins' }),
    });
    const d = await r.json();
    document.getElementById('loadingEl').style.display = 'none';
    if (!d.success || !d.bulletins || d.bulletins.length === 0) {
      document.getElementById('emptyEl').style.display = 'block';
      return;
    }
    _bulletins = d.bulletins;
    const wantCate = new URLSearchParams(location.search).get('category');
    if (wantCate) _bulletins = _bulletins.filter(b => (b.category || '里民活動') === wantCate);
    if (wantCate && !_bulletins.length) {
      document.getElementById('emptyEl').style.display = 'block';
      return;
    }
    _bulletins.forEach(b => { vcNamesMap[b.bulletinId] = b.title || b.bulletinId; });
    render(_bulletins);
    loadViewStats();
  } catch (e) {
    document.getElementById('loadingEl').innerHTML =
      '<div class="empty"><p>載入失敗，請重新整理頁面</p></div>';
  }
}

function catBadgeClass(cate) {
  if (cate === '緊急通告') return 'cate-emergency';
  if (cate === '政策宣導') return 'cate-policy';
  if (cate === '最新消息') return 'cate-news';
  if (cate === '教育課程') return 'cate-course';
  return 'cate-activity';
}
function catHeaderLabel(cate) {
  if (cate === '緊急通告') return '🚨 緊急通告';
  if (cate === '政策宣導') return '📋 政策宣導';
  if (cate === '最新消息') return '📰 最新消息';
  if (cate === '教育課程') return '📚 教育課程';
  return '🎪 里民活動';
}

function render(list) {
  // Client-side sort to ensure correct category order
  var catW = { '緊急通告': 1, '政策宣導': 2, '最新消息': 3, '教育課程': 4, '里民活動': 5 };
  list = list.slice().sort(function(a, b) {
    var wa = catW[a.category] || 5, wb = catW[b.category] || 5;
    if (wa !== wb) return wa - wb;
    var ha = (a.sortOrder || 0) > 0, hb = (b.sortOrder || 0) > 0;
    if (ha !== hb) return ha ? 1 : -1;
    if (!ha) return (b.createdAt || '').localeCompare(a.createdAt || '');
    return (a.sortOrder || 0) - (b.sortOrder || 0);
  });
  _bulletins = list;

  const el = document.getElementById('listEl');
  el.style.display = 'flex';
  el.innerHTML = '';
  let lastCate = null;
  list.forEach(function(b, idx) {
    const cate = b.category || '里民活動';
    if (cate !== lastCate) {
      const header = document.createElement('div');
      header.className = 'cate-header';
      header.textContent = catHeaderLabel(cate);
      el.appendChild(header);
      lastCate = cate;
    }

    const card = document.createElement('div');
    card.className = 'bull-card' + (b.pinned ? ' pinned' : '');
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', b.title);
    card.addEventListener('click', function() { openModal(idx); });
    card.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') openModal(idx); });

    const images = splitImageUrls(b.imageUrl);
    let html = '<div class="card-body"><div class="card-meta">';
    if (b.pinned) html += '<span class="pin-badge">' + PIN_SVG + ' 置頂</span>';
    html += '<span class="cate-badge ' + catBadgeClass(cate) + '">' + esc(cate) + '</span>';
    html += '<span class="date-lbl">' + esc(fmtDate(b.createdAt)) + '</span>';
    html += '</div><div class="card-title">' + esc(b.title) + '</div>';
    html += '<div class="card-preview">' + esc(stripHtml(b.content)) + '</div>';
    html += '<span class="vc-badge" id="vc-' + esc(b.bulletinId) + '">' + EYE_SVG + ' –</span>';
    html += '</div>';
    if (images.length) {
      html += '<div class="card-thumb"><img src="' + esc(images[0]) + '" alt="" loading="lazy"></div>';
    }
    card.innerHTML = html;
    el.appendChild(card);
  });
}

function openModal(idx) {
  const b = _bulletins[idx];
  if (!b) return;
  recordCardView(b.bulletinId);
  vcData[b.bulletinId] = (vcData[b.bulletinId] || 0) + 1;
  const badge = document.getElementById('vc-' + b.bulletinId);
  if (badge) badge.innerHTML = EYE_SVG + ' ' + vcData[b.bulletinId];
  const images = splitImageUrls(b.imageUrl);
  document.getElementById('modalTitle').textContent   = b.title;
  document.getElementById('modalDate').textContent    = fmtDate(b.createdAt);
  const contentHtml = (b.content || '')
    .replace(/<div>/gi, '<p>')
    .replace(/<\/div>/gi, '</p>')
    .replace(/\n/g, '<br>');
  document.getElementById('modalContent').innerHTML = sanitizeHtml(contentHtml);
  const gallery = document.getElementById('modalGallery');
  if (images.length) {
    gallery.innerHTML = images.map(url => '<img src="' + esc(url) + '" alt="" loading="lazy">').join('');
    gallery.style.display = 'grid';
  } else {
    gallery.innerHTML = '';
    gallery.style.display = 'none';
  }
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

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeModalDirect();
});

load();
