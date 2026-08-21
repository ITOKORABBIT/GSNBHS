
(function(){
  if (/Line\//i.test(navigator.userAgent)) {
    var url = new URL(location.href);
    if (!url.searchParams.has('openExternalBrowser')) {
      url.searchParams.set('openExternalBrowser', '1');
      location.replace(url.toString());
    }
  }
})();

const BULLETIN_CACHE_NAMESPACE = new URL(CONFIG.BASE_URL).hostname.split('.')[0];
const BULLETIN_DRAFT_KEY = BULLETIN_CACHE_NAMESPACE + '_bulletin_editor_drafts';
const BULLETIN_CACHE_KEY = BULLETIN_CACHE_NAMESPACE + '_bulletins_cache_v1';
let allBulletins = [];
let filterStatus = 'all';
let editingBulletinId = null;
let uploadingBulletinImage = false;
var sortableInstances = [];
var CATE_SORT_OFFSET = { '緊急通告': 0, '政策宣導': 10000, '最新消息': 20000, '教育課程': 30000, '里民活動': 40000 };
var CATE_ORDER = ['緊急通告', '政策宣導', '最新消息', '教育課程', '里民活動'];

function catGroupLabel(c) {
  if (c === '緊急通告') return '🚨 緊急通告';
  if (c === '政策宣導') return '📋 政策宣導';
  if (c === '最新消息') return '📰 最新消息';
  if (c === '教育課程') return '📚 教育課程';
  return '🎪 里民活動';
}

function openEditor() {
  document.getElementById('editorModal').classList.add('open');
  document.getElementById('editorPanel').classList.remove('collapsed');
  document.body.style.overflow = 'hidden';
}

function closeEditor() {
  persistCurrentDraftCache();
  document.getElementById('editorModal').classList.remove('open');
  document.getElementById('editorPanel').classList.add('collapsed');
  document.body.style.overflow = '';
  hideMessage();
}

function handleEditorBackdrop(event) {
  return;
}

function splitImageUrls(value) {
  return String(value || '')
    .split(/\r?\n|,/)
    .map(item => item.trim())
    .filter(Boolean);
}

function setImageUrls(urls) {
  document.getElementById('imageInput').value = (urls || []).join('\n');
}

function getImageUrls() {
  return splitImageUrls(document.getElementById('imageInput').value);
}

function syncEditorContent() {
  document.getElementById('contentInput').value = document.getElementById('contentEditor').innerHTML.trim();
}

function applyEditorCommand(command, value) {
  document.getElementById('contentEditor').focus();
  document.execCommand(command, false, value || null);
  syncEditorContent();
  refreshPreview();
}

function insertEditorLink() {
  const url = prompt('請輸入連結網址');
  if (!url) return;
  applyEditorCommand('createLink', url);
}

function stripHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  return (div.textContent || div.innerText || '').trim();
}

function normalizeBulletinStatus(status) {
  return status === '已發布' ? '已發布' : '未發布';
}

function getDraftScope() {
  return editingBulletinId || '__new__';
}

function getDraftStore() {
  try {
    return JSON.parse(localStorage.getItem(BULLETIN_DRAFT_KEY) || '{}');
  } catch (error) {
    localStorage.removeItem(BULLETIN_DRAFT_KEY);
    return {};
  }
}

function setDraftStore(store) {
  localStorage.setItem(BULLETIN_DRAFT_KEY, JSON.stringify(store || {}));
}

function buildEditorSnapshot() {
  syncEditorContent();
  return {
    bulletinId: editingBulletinId || '',
    title: document.getElementById('titleInput').value.trim(),
    status: document.getElementById('statusInput').value,
    category: document.getElementById('categoryInput').value,
    imageUrl: getImageUrls().join('\n'),
    content: document.getElementById('contentInput').value.trim(),
    linkUrl: document.getElementById('linkUrlInput').value.trim(),
    pinned: document.getElementById('pinnedInput').checked,
    ts: Date.now()
  };
}

function hasDraftContent(snapshot) {
  if (!snapshot) return false;
  return !!(snapshot.title || stripHtml(snapshot.content) || snapshot.imageUrl || snapshot.pinned);
}

function persistCurrentDraftCache() {
  const store = getDraftStore();
  const scope = getDraftScope();
  const snapshot = buildEditorSnapshot();
  if (hasDraftContent(snapshot)) {
    if (!editingBulletinId) snapshot.status = '未發布';
    store[scope] = snapshot;
  } else {
    delete store[scope];
  }
  setDraftStore(store);
}

function clearDraftCache(scope) {
  const store = getDraftStore();
  delete store[scope];
  setDraftStore(store);
}

function applyDraftSnapshot(snapshot) {
  if (!snapshot) return;
  document.getElementById('titleInput').value = snapshot.title || '';
  document.getElementById('statusInput').value = normalizeBulletinStatus(snapshot.status);
  document.getElementById('categoryInput').value = snapshot.category || '里民活動';
  setImageUrls(splitImageUrls(snapshot.imageUrl || ''));
  document.getElementById('imageFileInput').value = '';
  document.getElementById('imageUrlInput').value = '';
  document.getElementById('contentInput').value = snapshot.content || '';
  document.getElementById('contentEditor').innerHTML = snapshot.content || '';
  document.getElementById('linkUrlInput').value = snapshot.linkUrl || '';
  document.getElementById('pinnedInput').checked = !!snapshot.pinned;
  updateImageMeta(getImageUrls());
  refreshPreview();
}

function restoreDraftCache(scope) {
  const snapshot = getDraftStore()[scope];
  if (!snapshot || !hasDraftContent(snapshot)) return false;
  applyDraftSnapshot(snapshot);
  showMessage('已替你恢復上次未送出的內容。', true);
  return true;
}

// workerCall：公告 CRUD 走 Worker；apiCall 保留給 GAS（圖片上傳）
function workerCall(action, extra) {
  const sess = getSession();
  const payload = Object.assign({ action: action }, extra || {});
  if (sess) {
    payload.sessionToken = sess.sessionToken;
    if (sess.id_token) payload.id_token = sess.id_token;
  }
  return fetch(CONFIG.BULLETIN_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  }).then(r => r.json());
}

function apiCall(action, extra) {
  const sess = getSession();
  const payload = Object.assign({ action: action }, extra || {});
  if (sess) payload.sessionToken = sess.sessionToken;
  return fetch(CONFIG.SCRIPT_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  })
  .then(r => r.text())
  .then(t => JSON.parse(t));
}

function showMessage(message, success) {
  const box = document.getElementById('messageBox');
  box.textContent = message;
  box.className = success ? 'hint success' : 'hint';
  box.style.display = 'block';
}

function hideMessage() {
  document.getElementById('messageBox').style.display = 'none';
}

function saveBulletinsCache() {
  try {
    sessionStorage.setItem(BULLETIN_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), bulletins: allBulletins || [] }));
  } catch (error) {}
}

function renderCachedBulletins() {
  try {
    const raw = sessionStorage.getItem(BULLETIN_CACHE_KEY);
    if (!raw) return false;
    const cache = JSON.parse(raw);
    if (!cache || !Array.isArray(cache.bulletins)) return false;
    allBulletins = cache.bulletins;
    renderBulletins();
    return true;
  } catch (error) {
    sessionStorage.removeItem(BULLETIN_CACHE_KEY);
    return false;
  }
}

function ensureLogin() {
  return !!getSession();
}


function initGoogle() {
  if (ensureLogin()) {
    enterApp();
    return;
  }
  if (!CONFIG.GOOGLE_CLIENT_ID) return;
  if (typeof google === 'undefined') {
    setTimeout(initGoogle, 300);
    return;
  }
  google.accounts.id.initialize({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    callback: onGoogleSignIn,
    auto_select: true
  });
  google.accounts.id.renderButton(document.getElementById('loginBtnWrap'), {
    type: 'standard',
    theme: 'filled_blue',
    size: 'large',
    text: 'signin_with',
    locale: 'zh-TW',
    width: 280
  });
  google.accounts.id.prompt();
}

function onGoogleSignIn(resp) {
  document.getElementById('loginError').style.display = 'none';
  fetch(CONFIG.BULLETIN_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'login', id_token: resp.credential })
  })
  .then(r => r.json())
  .then(json => {
    if (!json.success) {
      document.getElementById('loginError').style.display = 'block';
      return;
    }
    setSession(json.sessionToken, json.email, json.name, json.role || '', json.id_token || resp.credential);
    enterApp();
  })
  .catch(() => {
    document.getElementById('loginError').style.display = 'block';
  });
}

function enterApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'block';
  closeEditor();
  renderCachedBulletins();
  loadBulletins();
}

function createBulletin() {
  openEditor();
  editingBulletinId = null;
  document.getElementById('editorTitle').textContent = '新增公告';
  document.getElementById('editorSub').textContent = '建立新公告後，可先存為未發布，再決定是否發布到里民前台。';
  document.getElementById('titleInput').value = '';
  document.getElementById('statusInput').value = '未發布';
  document.getElementById('categoryInput').value = '里民活動';
  document.getElementById('imageInput').value = '';
  document.getElementById('imageFileInput').value = '';
  document.getElementById('imageUrlInput').value = '';
  document.getElementById('contentInput').value = '';
  document.getElementById('contentEditor').innerHTML = '';
  document.getElementById('linkUrlInput').value = '';
  document.getElementById('pinnedInput').checked = false;
  document.getElementById('deleteBtn').style.display = 'none';
  hideMessage();
  updateImageMeta([]);
  refreshPreview();
  restoreDraftCache('__new__');
}

function resetEditor() {
  clearDraftCache('__new__');
  createBulletin();
}

function fillEditor(item) {
  openEditor();
  editingBulletinId = item.bulletinId;
  document.getElementById('editorTitle').textContent = '編輯公告';
  document.getElementById('editorSub').textContent = '目前正在編輯 ' + item.bulletinId + '，儲存後會立即同步到資料表。';
  document.getElementById('titleInput').value = item.title || '';
  document.getElementById('statusInput').value = normalizeBulletinStatus(item.status);
  document.getElementById('categoryInput').value = item.category || '里民活動';
  document.getElementById('imageInput').value = item.imageUrl || '';
  document.getElementById('imageFileInput').value = '';
  document.getElementById('imageUrlInput').value = '';
  document.getElementById('contentInput').value = item.content || '';
  document.getElementById('contentEditor').innerHTML = item.content || '';
  document.getElementById('linkUrlInput').value = item.linkUrl || '';
  document.getElementById('pinnedInput').checked = !!item.pinned;
  document.getElementById('deleteBtn').style.display = 'inline-flex';
  hideMessage();
  updateImageMeta(splitImageUrls(item.imageUrl || ''));
  refreshPreview();
  restoreDraftCache(item.bulletinId);
}

function updateImageMeta(urls) {
  const meta = document.getElementById('imageUploadMeta');
  const removeBtn = document.getElementById('removeImageBtn');
  if (uploadingBulletinImage) {
    meta.innerHTML = '<strong>圖片上傳中…</strong><br>請稍候，完成後會自動套用到公告。';
    removeBtn.style.display = 'none';
    return;
  }
  if (urls && urls.length) {
    meta.innerHTML = '<strong>已上傳圖片 ' + urls.length + ' 張</strong><div class="upload-list">' + urls.map((url, index) => (
      '<div class="upload-item"><a class="upload-link" href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' + escapeHtml(url) + '</a><button class="upload-remove" type="button" onclick="removeBulletinImage(' + index + ')">移除</button></div>'
    )).join('') + '</div>';
    removeBtn.style.display = 'inline-flex';
    return;
  }
  meta.textContent = '尚未上傳圖片';
  removeBtn.style.display = 'none';
}

async function addImageUrlFromInput() {
  const input = document.getElementById('imageUrlInput');
  const url = input.value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) {
    showMessage('網址需以 http:// 或 https:// 開頭。', false);
    return;
  }
  if (uploadingBulletinImage) return;
  uploadingBulletinImage = true;
  updateImageMeta(getImageUrls());
  hideMessage();
  try {
    const json = await workerCall('importBulletinImageUrl', { imageUrl: url });
    if (json.code === 401) {
      clearSession();
      location.reload();
      return;
    }
    if (!json.success || !json.url) {
      throw new Error(json.error || 'Facebook 圖片匯入失敗。');
    }
    const urls = getImageUrls();
    urls.push(json.url);
    setImageUrls(urls);
    input.value = '';
    refreshPreview();
    persistCurrentDraftCache();
    showMessage('Facebook 圖片已轉存到 Drive。', true);
  } catch (error) {
    showMessage(error.message || 'Facebook 圖片匯入失敗，請稍後再試。', false);
  } finally {
    uploadingBulletinImage = false;
    updateImageMeta(getImageUrls());
  }
}

function removeBulletinImage(index) {
  const urls = getImageUrls();
  if (index < 0 || index >= urls.length) return;
  urls.splice(index, 1);
  setImageUrls(urls);
  updateImageMeta(urls);
  refreshPreview();
  persistCurrentDraftCache();
}

function clearBulletinImage() {
  setImageUrls([]);
  document.getElementById('imageFileInput').value = '';
  updateImageMeta([]);
  refreshPreview();
  persistCurrentDraftCache();
}

async function uploadBulletinImages(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  if (uploadingBulletinImage) return;
  uploadingBulletinImage = true;
  updateImageMeta(getImageUrls());
  hideMessage();
  try {
    const existing = getImageUrls();
    for (const file of files) {
      if (!/^image\/(jpeg|png|gif|webp)$/i.test(file.type)) {
        throw new Error('僅支援 JPG、PNG、GIF、WEBP 圖片。');
      }
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('圖片檔案太大，請控制在 5MB 以內。');
      }
      const dataUrl = await readFileAsDataUrl(file);
      const b64 = dataUrl.indexOf(',') !== -1 ? dataUrl.split(',')[1] : String(dataUrl || '');
      const json = await workerCall('uploadBulletinImage', {
        imageBase64: b64,
        mimeType: file.type || 'image/jpeg'
      });
      if (json.code === 401) {
        clearSession();
        location.reload();
        return;
      }
      if (!json.success || !json.url) {
        throw new Error(json.error || '圖片上傳失敗。');
      }
      existing.push(json.url);
      setImageUrls(existing);
      updateImageMeta(existing);
      refreshPreview(dataUrl, json.url);
      persistCurrentDraftCache();
    }
    showMessage('圖片已上傳。', true);
  } catch (error) {
    showMessage(error.message || '圖片上傳失敗，請稍後再試。', false);
  } finally {
    uploadingBulletinImage = false;
    updateImageMeta(getImageUrls());
    document.getElementById('imageFileInput').value = '';
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function() { resolve(reader.result); };
    reader.onerror = function() { reject(new Error('讀取圖片失敗，請重新選擇。')); };
    reader.readAsDataURL(file);
  });
}

function buildPills() {
  const counts = { all: allBulletins.length };
  allBulletins.forEach(item => {
    const key = normalizeBulletinStatus(item.status);
    counts[key] = (counts[key] || 0) + 1;
  });
  const pills = [{ value: 'all', label: '全部 ' + counts.all }];
  ['已發布', '未發布'].forEach(k => {
    pills.push({ value: k, label: k + ' ' + (counts[k] || 0) });
  });
  document.getElementById('statusPills').innerHTML = pills.map(item => (
    '<button class="pill' + (item.value === filterStatus ? ' active' : '') + '" onclick="setFilterStatus(\'' + escapeHtml(item.value) + '\')">' + escapeHtml(item.label) + '</button>'
  )).join('');
}

function setFilterStatus(value) {
  filterStatus = value;
  renderBulletins();
}

function renderBulletinCard(item) {
  var statusClass = normalizeBulletinStatus(item.status) === '已發布' ? 'badge-published' : 'badge-draft';
  var preview = stripHtml(item.content || '').slice(0, 80);
  var bid = escapeHtml(item.bulletinId);
  return '<div class="bull-item" data-bulletin-id="' + bid + '" onclick="editBulletin(\'' + bid + '\')" style="cursor:pointer">' +
    '<div class="bull-drag-handle" onclick="event.stopPropagation()">⠿</div>' +
    '<div class="bull-item-body">' +
      '<div class="bull-item-title">' + escapeHtml(item.title || '（無標題）') + '</div>' +
      '<div class="bull-item-meta">' +
        '<span class="badge ' + statusClass + '">' + escapeHtml(normalizeBulletinStatus(item.status)) + '</span>' +
        (item.pinned ? ' <span class="badge badge-pinned">置頂</span>' : '') +
        ' <span style="font-size:12px;color:var(--muted)">' + escapeHtml(fmtDate(item.createdAt)) + '</span>' +
      '</div>' +
      (preview ? '<div class="bull-item-preview">' + escapeHtml(preview) + '</div>' : '') +
    '</div>' +
    '<div class="bull-item-actions">' +
      '<button class="inline-btn" onclick="event.stopPropagation(); quickToggleStatus(\'' + bid + '\')">' +
        (normalizeBulletinStatus(item.status) === '已發布' ? '取消發布' : '發布') +
      '</button>' +
    '</div>' +
  '</div>';
}

function renderBulletins() {
  sortableInstances.forEach(function(s){ try{ s.destroy(); }catch(e){} });
  sortableInstances = [];

  buildPills();
  var q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  var listWrap = document.getElementById('listWrap');

  var list = allBulletins.filter(function(item) {
    if (filterStatus !== 'all' && normalizeBulletinStatus(item.status) !== filterStatus) return false;
    if (!q) return true;
    var hay = [item.bulletinId, item.title, item.content, item.author, item.category || ''].join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  });

  // Sort by category group, then sortOrder
  var catW = { '緊急通告': 1, '政策宣導': 2, '最新消息': 3, '教育課程': 4, '里民活動': 5 };
  list.sort(function(a, b) {
    var wa = catW[a.category] || 5, wb = catW[b.category] || 5;
    if (wa !== wb) return wa - wb;
    var ha = a.sortOrder > 0, hb = b.sortOrder > 0;
    if (ha !== hb) return ha ? 1 : -1;
    if (!ha) return (b.createdAt || '').localeCompare(a.createdAt || '');
    return a.sortOrder - b.sortOrder;
  });

  if (!list.length) {
    listWrap.innerHTML = '<div class="empty"><h3>沒有符合的公告</h3><p>請切換狀態或調整搜尋條件。</p></div>';
    return;
  }

  // Group by category
  var groups = {};
  CATE_ORDER.forEach(function(c) { groups[c] = []; });
  list.forEach(function(item) {
    var c = item.category || '里民活動';
    if (!groups[c]) groups[c] = [];
    groups[c].push(item);
  });

  var html = '';
  CATE_ORDER.forEach(function(cateKey) {
    var grp = groups[cateKey];
    if (!grp || !grp.length) return;
    html += '<div class="group-header">' + escapeHtml(catGroupLabel(cateKey)) +
            ' <span style="font-weight:400;font-size:12px;opacity:.7">(' + grp.length + ')</span></div>';
    html += '<div class="group-cards" data-group-key="' + escapeHtml(cateKey) + '">';
    grp.forEach(function(item) { html += renderBulletinCard(item); });
    html += '</div>';
  });
  listWrap.innerHTML = html;

  // Init SortableJS per group
  CATE_ORDER.forEach(function(cateKey) {
    var el = listWrap.querySelector('.group-cards[data-group-key="' + cateKey + '"]');
    if (!el) return;
    (function(key, container) {
      var inst = Sortable.create(container, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        delay: 200,
        delayOnTouchOnly: true,
        onEnd: function() { onBulletinSortEnd(key, container); }
      });
      sortableInstances.push(inst);
    })(cateKey, el);
  });
}

function onBulletinSortEnd(groupKey, el) {
  var cards = el.querySelectorAll('[data-bulletin-id]');
  var offset = CATE_SORT_OFFSET[groupKey] || 0;
  var orders = [];
  for (var i = 0; i < cards.length; i++) {
    var bid = cards[i].getAttribute('data-bulletin-id');
    var sortVal = offset + (i + 1) * 10;
    orders.push({ bulletinId: bid, sortOrder: sortVal });
    for (var j = 0; j < allBulletins.length; j++) {
      if (allBulletins[j].bulletinId === bid) { allBulletins[j].sortOrder = sortVal; break; }
    }
  }
  saveBulletinsCache();
  workerCall('reorderBulletins', { orders: orders })
    .catch(function() { console.error('reorderBulletins failed'); });
}

function editBulletin(id) {
  const item = allBulletins.find(entry => entry.bulletinId === id);
  if (!item) return;
  fillEditor(item);
}

function quickToggleStatus(id) {
  const item = allBulletins.find(entry => entry.bulletinId === id);
  if (!item) return;
  const oldStatus = normalizeBulletinStatus(item.status);
  const nextStatus = oldStatus === '已發布' ? '未發布' : '已發布';
  item.status = nextStatus;
  saveBulletinsCache();
  renderBulletins();
  workerCall('updateBulletin', {
    bulletinId: id,
    status: nextStatus
  }).then(json => {
    if (json.code === 401) {
      clearSession();
      location.reload();
      return;
    }
    if (!json.success) {
      item.status = oldStatus;
      saveBulletinsCache();
      renderBulletins();
      showMessage(json.error || '更新失敗', false);
      return;
    }
    showMessage('公告狀態已更新。', true);
  }).catch(() => {
    item.status = oldStatus;
    saveBulletinsCache();
    renderBulletins();
    showMessage('更新失敗，請稍後再試。', false);
  });
}

function loadBulletins() {
  workerCall('getBulletins').then(json => {
    if (json.code === 401) {
      clearSession();
      location.reload();
      return;
    }
    if (!json.success) throw new Error(json.error || '載入失敗');
    allBulletins = json.bulletins || [];
    saveBulletinsCache();
    renderBulletins();
  }).catch(error => {
    document.getElementById('listWrap').innerHTML = '<div class="empty"><h3>無法載入公告</h3><p>' + escapeHtml(error.message || '請稍後再試') + '</p></div>';
  });
}

function saveBulletin() {
  syncEditorContent();
  const title = document.getElementById('titleInput').value.trim();
  const content = document.getElementById('contentInput').value.trim();
  const imageUrl = getImageUrls().join('\n');
  const status = normalizeBulletinStatus(document.getElementById('statusInput').value);
  const category = document.getElementById('categoryInput').value;
  const linkUrl = document.getElementById('linkUrlInput').value.trim();
  const pinned = document.getElementById('pinnedInput').checked;

  if (!title) {
    showMessage('請輸入公告標題。', false);
    return;
  }

  const action = editingBulletinId ? 'updateBulletin' : 'addBulletin';
  const payload = {
    title: title,
    content: content,
    imageUrl: imageUrl,
    status: status,
    category: category,
    linkUrl: linkUrl,
    pinned: pinned
  };
  if (editingBulletinId) payload.bulletinId = editingBulletinId;

  document.getElementById('saveBtn').textContent = '儲存中…';
  workerCall(action, payload).then(json => {
    document.getElementById('saveBtn').textContent = '儲存公告';
    if (json.code === 401) {
      clearSession();
      location.reload();
      return;
    }
    if (!json.success) {
      showMessage(json.error || '儲存失敗', false);
      return;
    }
    showMessage(editingBulletinId ? '公告已更新。' : '公告已新增。', true);
    const previousScope = getDraftScope();
    if (!editingBulletinId && json.bulletinId) editingBulletinId = json.bulletinId;
    const cachedItem = Object.assign({}, payload, {
      bulletinId: editingBulletinId,
      status: normalizeBulletinStatus(payload.status),
      pinned: !!payload.pinned,
      updatedAt: new Date().toISOString()
    });
    const idx = allBulletins.findIndex(item => item.bulletinId === editingBulletinId);
    if (idx >= 0) allBulletins[idx] = Object.assign({}, allBulletins[idx], cachedItem);
    else allBulletins.unshift(cachedItem);
    saveBulletinsCache();
    renderBulletins();
    clearDraftCache(previousScope);
    clearDraftCache(getDraftScope());
    loadBulletins();
  }).catch(() => {
    document.getElementById('saveBtn').textContent = '儲存公告';
    showMessage('儲存失敗，請稍後再試。', false);
  });
}

function removeBulletin() {
  if (!editingBulletinId) return;
  if (!confirm('確定要刪除這則公告？')) return;
  const removingScope = getDraftScope();
  workerCall('deleteBulletin', { bulletinId: editingBulletinId }).then(json => {
    if (json.code === 401) {
      clearSession();
      location.reload();
      return;
    }
    if (!json.success) {
      showMessage(json.error || '刪除失敗', false);
      return;
    }
    clearDraftCache(removingScope);
    allBulletins = allBulletins.filter(item => item.bulletinId !== editingBulletinId);
    saveBulletinsCache();
    renderBulletins();
    closeEditor();
    loadBulletins();
  }).catch(() => {
    showMessage('刪除失敗，請稍後再試。', false);
  });
}

// freshLocalUrl: 剛上傳的 data URL（本地預覽用）；freshDriveUrl: 對應的 Drive URL（已存入 imageInput）
function refreshPreview(freshLocalUrl, freshDriveUrl) {
  const title = document.getElementById('titleInput').value.trim();
  syncEditorContent();
  const content = document.getElementById('contentInput').value.trim();
  const images = getImageUrls();
  const status = document.getElementById('statusInput').value;
  const category = document.getElementById('categoryInput').value;
  const pinned = document.getElementById('pinnedInput').checked;
  document.getElementById('previewTitle').textContent = title || '尚未輸入標題';
  document.getElementById('previewMeta').textContent = '狀態：' + normalizeBulletinStatus(status) + ' ・ ' + category + (pinned ? ' ・ 置頂' : '');
  const previewContent = document.getElementById('previewContent');
  previewContent.innerHTML = content || '尚未輸入內容';
  const gallery = document.getElementById('previewGallery');
  if (images.length) {
    gallery.innerHTML = images.map(function(url) {
      // 剛上傳的照片用本地 data URL 顯示，避免 lh3 propagation delay
      var src = (freshDriveUrl && freshLocalUrl && url === freshDriveUrl) ? freshLocalUrl : url;
      return '<img src="' + escapeHtml(src) + '" alt="" onerror="retryLh3Img(this)" data-orig="' + escapeHtml(url) + '">';
    }).join('');
    gallery.style.display = 'grid';
  } else {
    gallery.style.display = 'none';
    gallery.innerHTML = '';
  }
}

['titleInput', 'contentInput', 'imageInput', 'statusInput', 'categoryInput', 'linkUrlInput', 'pinnedInput'].forEach(id => {
  document.addEventListener('input', event => {
    if (event.target && event.target.id === id) refreshPreview();
  });
  document.addEventListener('change', event => {
    if (event.target && event.target.id === id) refreshPreview();
  });
});
document.getElementById('contentEditor').addEventListener('input', function() {
  syncEditorContent();
  refreshPreview();
  persistCurrentDraftCache();
});

['titleInput', 'contentInput', 'imageInput', 'statusInput', 'categoryInput', 'linkUrlInput', 'pinnedInput'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', persistCurrentDraftCache);
  el.addEventListener('change', persistCurrentDraftCache);
});

document.addEventListener('DOMContentLoaded', function() {
  if (getSession()) { enterApp(); return; }
  let tries = 0;
  const timer = setInterval(function() {
    if (typeof google !== 'undefined' || ++tries > 30) {
      clearInterval(timer);
      initGoogle();
    }
  }, 200);
});
['click','keydown','mousedown','touchstart','scroll'].forEach(function(eventName) {
  window.addEventListener(eventName, function() {
    touchSession();
  }, { passive: true });
});
